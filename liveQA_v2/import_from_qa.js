// ============================================================
// 기존 QA(운영) DB → QA2 DB 데이터 이관 —  node import_from_qa.js [--dry] [--include-mendix]
// ------------------------------------------------------------
//  ⚠️ 원본(QA)은 **읽기만** 한다. src 클라이언트로는 select 외에 아무것도 호출하지 않는다.
//
//  옮기는 것: projects → tracks → sessions → questions → votes → banned_words
//  빼는 것  : 멘딕스 관련 행사 (--include-mendix 로 포함 가능)
//
//  🔑 id / code / admin_token 을 **그대로 보존**한다.
//     - 이미 인쇄·배포한 QR(#/e/<code>, #/s/<code>, #/r/<code>/<룸>)이 그대로 살아 있고
//     - 긴 UUID 링크(#/session/<uuid>)와 연사 대시보드 토큰도 계속 동작한다.
//
//  같은 id 가 이미 있으면 덮어쓴다(upsert). 여러 번 돌려도 중복이 생기지 않는다.
//
//  sessions.qa_parent_id 는 자기 테이블을 참조하므로 2단계로 넣는다:
//   1) qa_parent_id 를 비운 채 전부 insert → 2) 값이 있던 행만 update
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const INCLUDE_MENDIX = process.argv.includes('--include-mendix');
const MENDIX_RE = /mendix|멘딕스/i;

// .env 파일을 직접 파싱한다 — dotenv 는 프로세스당 한 번만 로드되므로 두 환경을 함께 못 읽는다.
const readEnv = (p) => {
  const env = {};
  fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].trim();
  });
  return env;
};

const SRC_ENV = path.join(__dirname, '..', 'QA', '.env.local');
const DST_ENV = path.join(__dirname, '.env.local');
if (!fs.existsSync(SRC_ENV)) { console.error(`원본 환경파일이 없습니다: ${SRC_ENV}`); process.exit(1); }

const A = readEnv(SRC_ENV);
const B = readEnv(DST_ENV);
if (A.SUPABASE_URL === B.SUPABASE_URL) {
  console.error('원본과 대상이 같은 Supabase 프로젝트입니다. 이관할 필요가 없습니다.');
  process.exit(1);
}

const src = createClient(A.SUPABASE_URL, A.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const dst = createClient(B.SUPABASE_URL, B.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const pick = (row, cols) => { const o = {}; cols.forEach((c) => { if (row[c] !== undefined) o[c] = row[c]; }); return o; };

// 대상에만 있는 신규 컬럼(translations/source_lang/survey_open…)은 기본값에 맡긴다.
const COLS = {
  projects: ['id', 'title', 'client_name', 'description', 'start_date', 'end_date', 'status', 'code',
    'sheet_url', 'sheet_auto_sync', 'sheet_synced_at', 'sheet_last_result', 'created_at'],
  tracks: ['id', 'project_id', 'name', 'sort_order', 'code', 'created_at'],
  sessions: ['id', 'project_id', 'title', 'description', 'starts_at', 'ends_at', 'is_public',
    'admin_token', 'code', 'speaker', 'track_id', 'source_key', 'qa_parent_id', 'created_at'],
  questions: ['id', 'session_id', 'title', 'content', 'author', 'like_count', 'is_answered', 'is_hidden',
    'translated_title', 'translated_content', 'translated_lang', 'translated_at', 'created_at'],
  votes: ['id', 'question_id', 'voter_key', 'voter_fp', 'created_at'],
};

// upsert 는 한 번에 너무 많이 보내지 않도록 나눠서.
async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) return 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await dst.from(table).upsert(rows.slice(i, i + 200), { onConflict });
    if (error) throw new Error(`${table} 저장 실패: ${error.message}${error.details ? ' / ' + error.details : ''}`);
  }
  return rows.length;
}

(async () => {
  console.log(`원본 : ${A.SUPABASE_URL}   (읽기 전용)`);
  console.log(`대상 : ${B.SUPABASE_URL}`);
  if (DRY) console.log('\n*** --dry : 실제로 쓰지 않고 무엇이 옮겨질지만 보여줍니다 ***');

  // ---------- 1) 대상 프로젝트 고르기 ----------
  const { data: allProjects, error: pErr } = await src.from('projects').select('*').order('created_at');
  if (pErr) throw pErr;

  const skipped = [];
  const projects = (allProjects || []).filter((p) => {
    const isMendix = MENDIX_RE.test(`${p.title} ${p.client_name || ''} ${p.description || ''}`);
    if (isMendix && !INCLUDE_MENDIX) { skipped.push(p.title); return false; }
    return true;
  });
  if (skipped.length) console.log(`\n제외(멘딕스): ${skipped.join(', ')}`);
  if (!projects.length) { console.log('\n옮길 행사가 없습니다.'); return; }

  const projectIds = projects.map((p) => p.id);

  // ---------- 2) 딸린 데이터 읽기 ----------
  const { data: tracks = [] } = await src.from('tracks').select('*').in('project_id', projectIds);
  const { data: sessions = [] } = await src.from('sessions').select('*').in('project_id', projectIds);
  const sessionIds = (sessions || []).map((s) => s.id);

  let questions = [];
  if (sessionIds.length) {
    const { data, error } = await src.from('questions').select('*').in('session_id', sessionIds);
    if (error) throw error;
    questions = data || [];
  }
  let votes = [];
  if (questions.length) {
    const { data, error } = await src.from('votes').select('*').in('question_id', questions.map((q) => q.id));
    if (error) throw error;
    votes = data || [];
  }
  const { data: banned = [] } = await src.from('banned_words').select('*');

  console.log('\n옮길 대상');
  console.log('-'.repeat(64));
  projects.forEach((p) => {
    const ss = sessions.filter((s) => s.project_id === p.id);
    const qs = questions.filter((q) => ss.some((s) => s.id === q.session_id));
    console.log(`  ${p.title}  (${p.client_name || '-'})`);
    console.log(`     code=${p.code || '없음'}  세션 ${ss.length}  트랙 ${tracks.filter((t) => t.project_id === p.id).length}  질문 ${qs.length}`);
  });
  console.log(`  금지어 ${banned.length}건 (대상에 없는 단어만 추가)`);
  console.log('-'.repeat(64));

  if (DRY) { console.log('\n--dry 모드라 아무것도 쓰지 않았습니다.\n'); return; }

  // ---------- 3) 쓰기 (FK 순서 준수) ----------
  console.log('\n이관 중…');
  console.log('  projects  ' + await upsert('projects', projects.map((r) => pick(r, COLS.projects))));
  console.log('  tracks    ' + await upsert('tracks', (tracks || []).map((r) => pick(r, COLS.tracks))));

  // sessions: 자기 참조(qa_parent_id) 때문에 2단계
  const sessionRows = (sessions || []).map((r) => ({ ...pick(r, COLS.sessions), qa_parent_id: null }));
  console.log('  sessions  ' + await upsert('sessions', sessionRows));
  const merged = (sessions || []).filter((s) => s.qa_parent_id);
  for (const s of merged) {
    const { error } = await dst.from('sessions').update({ qa_parent_id: s.qa_parent_id }).eq('id', s.id);
    if (error) throw new Error(`qa_parent_id 복원 실패(${s.title}): ${error.message}`);
  }
  if (merged.length) console.log(`            └ Q&A 통합 연결 ${merged.length}건 복원`);

  // questions: 금지어 트리거에 걸리는 행이 있을 수 있으니 실패해도 나머지는 계속 넣는다.
  let qOk = 0; const qFail = [];
  for (const q of questions) {
    const { error } = await dst.from('questions').upsert(pick(q, COLS.questions), { onConflict: 'id' });
    if (error) qFail.push(`${(q.title || '').slice(0, 24)} — ${error.message.slice(0, 60)}`);
    else qOk += 1;
  }
  console.log('  questions ' + qOk + (qFail.length ? `  (실패 ${qFail.length})` : ''));
  qFail.forEach((m) => console.log('            ⚠ ' + m));

  console.log('  votes     ' + await upsert('votes', (votes || []).map((r) => pick(r, COLS.votes))));

  const { data: haveWords } = await dst.from('banned_words').select('word');
  const have = new Set((haveWords || []).map((w) => w.word));
  const newWords = (banned || []).filter((w) => !have.has(w.word)).map((w) => ({ word: w.word }));
  if (newWords.length) await upsert('banned_words', newWords, 'word');
  console.log(`  banned_words ${newWords.length}건 추가 (기존 ${have.size}건 유지)`);

  // ---------- 4) 검증 ----------
  console.log('\n검증');
  const { count: pc } = await dst.from('projects').select('*', { count: 'exact', head: true });
  const { count: sc } = await dst.from('sessions').select('*', { count: 'exact', head: true });
  const { count: qc } = await dst.from('questions').select('*', { count: 'exact', head: true });
  console.log(`  QA2 현재: 행사 ${pc} · 세션 ${sc} · 질문 ${qc}`);

  const base = `http://localhost:${(B.PORT || '8787')}/#`;
  console.log('\n🔗 옮겨온 행사 (기존 QR/링크 그대로 동작)');
  for (const p of projects) {
    console.log(`  ${p.title}`);
    console.log(`     랜딩   ${base}/e/${p.code || p.id}`);
    console.log(`     콘솔   ${base}/admin/project/${p.id}`);
  }
  console.log('');
})().catch((e) => { console.error('\n❌ ' + e.message + '\n'); process.exit(1); });
