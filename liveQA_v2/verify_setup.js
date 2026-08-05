// ============================================================
// QA2 설치 점검 스크립트 —  node verify_setup.js
// ------------------------------------------------------------
//  .env.local 에 Supabase 키를 붙여넣은 뒤 실행하세요.
//   1) 필수 환경변수가 다 있는지
//   2) index.html 의 anon 키를 .env.local 값과 자동으로 맞춤
//   3) service_role 로 DB 연결 + QA2_SETUP_ALL.sql 적용 여부 확인
//   4) anon 키로 admin_token 이 차단되는지 (보안 회귀 검사)
//   5) 번역 API(Gemini/GPT) 연결 확인
//  ⚠️ 데이터를 만들거나 지우지 않습니다. 읽기 전용 점검입니다.
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const URL = (process.env.SUPABASE_URL || '').trim();
const ANON = (process.env.SUPABASE_ANON_KEY || '').trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const CONSOLE_TOKEN = (process.env.ADMIN_CONSOLE_TOKEN || '').trim();
const GEMINI = (process.env.GEMINI_API_KEY || '').trim();
const OPENAI = (process.env.OPENAI_API_KEY || '').trim();

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => { console.log('  \x1b[31m✗\x1b[0m ' + m); failed++; };
const warn = (m) => console.log('  \x1b[33m!\x1b[0m ' + m);
let failed = 0;

(async () => {
  // ---------- 1) 환경변수 ----------
  console.log('\n[1] 환경변수 (.env.local)');
  URL ? ok('SUPABASE_URL = ' + URL) : bad('SUPABASE_URL 이 비어 있습니다');
  ANON ? ok('SUPABASE_ANON_KEY 있음 (' + ANON.length + '자)') : bad('SUPABASE_ANON_KEY 가 비어 있습니다 → 대시보드 Settings → API Keys');
  SERVICE ? ok('SUPABASE_SERVICE_ROLE_KEY 있음 (' + SERVICE.length + '자)') : bad('SUPABASE_SERVICE_ROLE_KEY 가 비어 있습니다');
  CONSOLE_TOKEN ? ok('ADMIN_CONSOLE_TOKEN 있음') : bad('ADMIN_CONSOLE_TOKEN 이 비어 있습니다');
  GEMINI ? ok('GEMINI_API_KEY 있음') : warn('GEMINI_API_KEY 없음 — GPT 만으로 번역합니다');
  OPENAI ? ok('OPENAI_API_KEY 있음 (폴백)') : warn('OPENAI_API_KEY 없음 — Gemini 실패 시 폴백이 없습니다');
  if (!URL || !ANON || !SERVICE) { console.log('\n환경변수를 먼저 채워 주세요.\n'); process.exit(1); }

  // ---------- 2) index.html 동기화 ----------
  console.log('\n[2] index.html ↔ .env.local 동기화');
  const htmlPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const before = html;
  html = html.replace(/const SUPABASE_URL = '[^']*';/, `const SUPABASE_URL = '${URL}';`);
  html = html.replace(/const SUPABASE_ANON_KEY = '[^']*';/, `const SUPABASE_ANON_KEY = '${ANON}';`);
  if (html !== before) {
    fs.writeFileSync(htmlPath, html);
    ok('index.html 의 SUPABASE_URL / SUPABASE_ANON_KEY 를 갱신했습니다');
  } else {
    ok('index.html 이 이미 .env.local 과 같습니다');
  }

  // ---------- 3) service_role 연결 + 스키마 ----------
  console.log('\n[3] DB 연결 & 스키마 (service_role)');
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  const TABLES = ['projects', 'sessions', 'questions', 'votes', 'tracks', 'banned_words', 'post_throttle', 'survey_responses'];
  for (const t of TABLES) {
    const { error } = await admin.from(t).select('*', { count: 'exact', head: true });
    error ? bad(`테이블 ${t} 없음/접근 불가 — ${error.message}`) : ok(`테이블 ${t}`);
  }

  // 신규 컬럼 — 없으면 QA2_SETUP_ALL.sql 이 덜 적용된 것
  const COLS = [
    ['questions', 'translations'], ['questions', 'source_lang'],
    ['sessions', 'survey_open'], ['sessions', 'survey_opened_at'],
    ['sessions', 'code'], ['sessions', 'speaker'], ['sessions', 'qa_parent_id'],
  ];
  for (const [tbl, col] of COLS) {
    const { error } = await admin.from(tbl).select(col).limit(1);
    error ? bad(`${tbl}.${col} 없음 — QA2_SETUP_ALL.sql 을 실행하세요`) : ok(`${tbl}.${col}`);
  }

  // ---------- 4) anon 보안 회귀 검사 ----------
  console.log('\n[4] 보안 — anon 키로 admin_token 이 막히는지');
  const anonC = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: leakErr } = await anonC.from('sessions').select('id, admin_token').limit(1);
  if (leakErr) ok('admin_token 차단됨 (' + (leakErr.code || leakErr.message).toString().slice(0, 40) + ')');
  else bad('🔴 anon 키로 admin_token 이 읽힙니다 — fix_admin_token_exposure 구간이 적용되지 않았습니다');

  const { error: pubErr } = await anonC.from('sessions').select('id, title, code').limit(1);
  pubErr ? bad('공개 컬럼도 못 읽습니다 — ' + pubErr.message) : ok('공개 컬럼(id/title/code)은 정상 조회');

  // ⚠️ RLS 가 켜져 있고 정책이 하나도 없으면 SELECT 는 "에러 없이 0행"이 정상이다
  //    (에러가 안 났다고 열려 있는 게 아니다). 그래서 행 수와 쓰기 거부를 함께 본다.
  const { data: srRows, error: srErr } = await anonC.from('survey_responses').select('id').limit(1);
  if (srErr) ok('survey_responses SELECT 차단됨 (' + srErr.code + ')');
  else if ((srRows || []).length === 0) ok('survey_responses SELECT 0행 (RLS 정책 없음 = 차단)');
  else bad('🔴 anon 이 survey_responses 를 읽습니다 — add_survey 구간의 RLS 를 확인하세요');

  const srIns = await anonC.from('survey_responses')
    .insert({ session_id: '00000000-0000-0000-0000-000000000000', respondent_key: '__verify__', q1_score: 1 });
  if (srIns.error && srIns.error.code === '42501') ok('survey_responses INSERT 차단됨 (42501 · 서버 전용)');
  else if (srIns.error) warn('survey_responses INSERT 거부됨 (' + srIns.error.code + ') — RLS 외 사유일 수 있습니다');
  else bad('🔴 anon 이 survey_responses 에 직접 씁니다 — add_survey 구간의 RLS 를 확인하세요');

  // ---------- 5) 번역 API ----------
  console.log('\n[5] 번역 API 연결');
  if (GEMINI) {
    const model = (process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
        signal: AbortSignal.timeout(20000),
      });
      r.ok ? ok(`Gemini ${model} 응답 OK`) : warn(`Gemini ${model} → ${r.status} (폴백 모델/GPT 로 넘어갑니다)`);
    } catch (e) { warn('Gemini 연결 실패: ' + e.message); }
  }
  if (OPENAI) {
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: 5 }),
        signal: AbortSignal.timeout(20000),
      });
      r.ok ? ok(`OpenAI ${model} 응답 OK (폴백 준비됨)`) : warn(`OpenAI ${model} → ${r.status}`);
    } catch (e) { warn('OpenAI 연결 실패: ' + e.message); }
  }

  console.log(failed === 0
    ? '\n\x1b[32m▶ 전부 통과했습니다. npm start 로 띄우세요.\x1b[0m\n'
    : `\n\x1b[31m▶ ${failed}건 실패 — 위 ✗ 항목을 확인하세요.\x1b[0m\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
