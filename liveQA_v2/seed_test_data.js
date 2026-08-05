// ============================================================
// QA2 테스트 데이터 생성 —  node seed_test_data.js  [--clean]
// ------------------------------------------------------------
//  브라우저에서 바로 눌러볼 수 있도록 행사 1개 + 세션 3개 + 다국어 질문을 만든다.
//   - 행사/세션/트랙 : server.js 관리자 API 경유 (짧은 코드가 자동 발급됨)
//   - 질문/좋아요    : Supabase anon 경유 = **참가자와 똑같은 경로**
//                      (RLS · 금지어 트리거 · 도배 제한까지 실제로 통과하는지 확인됨)
//
//  세션 3개는 각각 다른 상태로 만든다:
//   1) 진행 중        → 스피커 뷰 · 번역 테스트용
//   2) 방금 종료      → ⭐ 설문이 자동으로 뜨는 조건
//   3) 시작 전        → 설문 [수동 열기] 테스트용
//
//  --clean 을 붙이면 이 스크립트가 만든 행사를 통째로 지운다(cascade).
//  ⚠️ 서버가 떠 있어야 한다 (npm start).
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const BASE = `http://localhost:${(process.env.PORT || '8787').trim()}`;
const TOKEN = (process.env.ADMIN_CONSOLE_TOKEN || '').trim();
const SB_URL = (process.env.SUPABASE_URL || '').trim();
const ANON = (process.env.SUPABASE_ANON_KEY || '').trim();
const PROJECT_TITLE = 'QA2 통합 테스트 행사';

const anon = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success === false) {
    throw new Error(`${method} ${path} → ${res.status} ${(json && json.message) || ''}`);
  }
  return json.data;
};

// 'HH:MM ~ HH:MM' — server.js 가 이 형식으로 starts_at/ends_at 을 만든다.
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const at = (minFromNow) => new Date(Date.now() + minFromNow * 60000);
const span = (a, b) => `${hhmm(at(a))} ~ ${hhmm(at(b))}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function findProject() {
  const list = await api('/api/admin/projects');
  return (list || []).find((p) => p.name === PROJECT_TITLE) || null;
}

async function clean() {
  const p = await findProject();
  if (!p) { console.log('지울 테스트 행사가 없습니다.'); return; }
  await api(`/api/admin/projects/${p.id}`, { method: 'DELETE' });
  console.log(`🧹 '${PROJECT_TITLE}' 삭제 완료 (세션·질문·설문 모두 함께 삭제)`);
}

async function seed() {
  const existing = await findProject();
  if (existing) {
    console.log(`이미 '${PROJECT_TITLE}' 가 있습니다. 먼저 지웁니다.`);
    await api(`/api/admin/projects/${existing.id}`, { method: 'DELETE' });
  }

  const today = ymd(new Date());
  const project = await api('/api/admin/projects', {
    method: 'POST',
    body: {
      name: PROJECT_TITLE,
      client: '내부 테스트',
      description: '스피커 뷰 · 한/영/중/일 번역 · 종료 설문을 확인하기 위한 샘플 행사',
      start_date: today, end_date: today, status: '진행중',
    },
  });
  console.log(`✓ 행사 생성  code=${project.code}`);

  const trackA = await api(`/api/admin/projects/${project.id}/tracks`, {
    method: 'POST', body: { name: 'Room A · 메인홀', sort_order: 1 },
  });
  const trackB = await api(`/api/admin/projects/${project.id}/tracks`, {
    method: 'POST', body: { name: 'Room B · 세미나실', sort_order: 2 },
  });
  console.log('✓ 트랙 2개 생성');

  const mkSession = (payload) => api(`/api/admin/projects/${project.id}/sessions`, { method: 'POST', body: payload });

  // 1) 진행 중 — 스피커 뷰/번역용
  const live = await mkSession({
    name: 'AI 시대의 로우코드 전략', speaker: '김민수 (Mendix Korea)',
    description: '엔터프라이즈 로우코드 도입 사례와 2027 로드맵',
    session_date: today, duration: span(-30, 30),
    track_id: trackA.id, is_public: true,
  });
  // 2) 방금 종료 — ⭐ 설문 자동 노출 조건
  const ended = await mkSession({
    name: '글로벌 사례로 보는 도입 ROI', speaker: 'Sarah Chen (APAC)',
    description: '아시아 12개국 고객 도입 효과 분석',
    session_date: today, duration: span(-70, -5),
    track_id: trackA.id, is_public: true,
  });
  // 3) 시작 전 — 설문 수동 열기용
  const upcoming = await mkSession({
    name: '실습: 첫 앱 30분 만에 만들기', speaker: '박지영',
    description: '핸즈온 워크숍',
    session_date: today, duration: span(60, 120),
    track_id: trackB.id, is_public: true,
  });
  console.log('✓ 세션 3개 생성 (진행중 / 방금종료 / 시작전)');

  // ---- 질문: 참가자와 같은 경로(anon)로 넣는다 ----
  const QUESTIONS = {
    [live.id]: [
      ['田中',      '導入コストについて',   '弊社のような中小企業でも導入できますか？初期費用と運用コストの目安を教えてください。', 6],
      ['Sarah',     'Roadmap for 2027',    'Could you share the 2027 product roadmap, especially around public API access and SSO?', 4],
      ['王伟',      '关于数据安全',         '数据存储在哪个区域？是否符合我们所在地区的合规要求？能否选择本地部署？', 3],
      ['이지훈',    '기존 시스템 연동',      '저희가 쓰는 SAP ERP와 연동하려면 별도 개발이 필요한가요? 표준 커넥터가 있는지 궁금합니다.', 5],
      ['박서연',    '라이선스 정책',         '과금 기준이 사용자 수인가요, 만든 앱 개수인가요? 내부 직원만 쓰는 경우도 동일한가요?', 1],
    ],
    [ended.id]: [
      ['Nguyen',    'ROI measurement',     'How do you measure ROI in the first 6 months? What baseline did the case studies use?', 3],
      ['최유진',    '도입 기간',            '평균적으로 파일럿부터 전사 확산까지 얼마나 걸렸나요?', 2],
    ],
    [upcoming.id]: [
      ['山本',      '事前準備は必要ですか', 'ノートPCとアカウント以外に、事前にインストールしておくものはありますか？', 1],
    ],
  };

  let total = 0;
  for (const [sessionId, rows] of Object.entries(QUESTIONS)) {
    for (const [author, title, content, likes] of rows) {
      const { data, error } = await anon.from('questions')
        .insert({ session_id: sessionId, title, content, author })
        .select('id').single();
      if (error) throw new Error(`질문 등록 실패(${title}): ${error.message}`);
      total += 1;
      // 좋아요 — voter_key 를 바꿔가며 RPC 호출 (인기순 정렬 확인용)
      for (let i = 0; i < likes; i++) {
        const { error: rpcErr } = await anon.rpc('like_question', {
          p_question_id: data.id, p_voter_key: `seed-voter-${sessionId.slice(0, 8)}-${i}`,
        });
        if (rpcErr) throw new Error(`좋아요 실패: ${rpcErr.message}`);
      }
    }
  }
  console.log(`✓ 질문 ${total}건 + 좋아요 등록 (anon 경로 = 참가자와 동일)`);

  // ---- 링크 출력 ----
  const u = (seg) => `${BASE}/#${seg}`;
  const line = (label, url) => console.log(`   ${label.padEnd(22)} ${url}`);

  console.log('\n' + '='.repeat(78));
  console.log('🔗 브라우저에서 열어보세요');
  console.log('='.repeat(78));

  console.log('\n[운영자]');
  line('관리자 콘솔', u('/admin'));
  console.log(`   ${''.padEnd(22)} 토큰: ${TOKEN}`);

  console.log('\n[참가자]');
  line('행사 랜딩(전체 세션)', u(`/e/${project.code}`));
  line('① 진행 중 세션', u(`/s/${live.code}`));
  line('② 방금 종료 ⭐설문자동', u(`/s/${ended.code}`));
  line('③ 시작 전 세션', u(`/s/${upcoming.code}`));
  line('룸 QR (Room A)', u(`/r/${project.code}/${trackA.code || 1}`));

  console.log('\n[연사 · 스피커 뷰]  ← 이번에 추가된 화면');
  line('① 진행 중 세션', u(`/sp/${live.code}?token=${live.admin_token}`));
  line('② 방금 종료', u(`/sp/${ended.code}?token=${ended.admin_token}`));

  console.log('\n[운영자 · 세션 대시보드]  ← 설문 열기/결과');
  line('① 진행 중 세션', u(`/a/${live.code}?token=${live.admin_token}`));
  line('② 방금 종료', u(`/a/${ended.code}?token=${ended.admin_token}`));
  line('③ 시작 전 (수동열기용)', u(`/a/${upcoming.code}?token=${upcoming.admin_token}`));

  console.log('\n' + '-'.repeat(78));
  console.log('정리하려면:  node seed_test_data.js --clean');
  console.log('-'.repeat(78) + '\n');
}

(async () => {
  if (!TOKEN) throw new Error('ADMIN_CONSOLE_TOKEN 이 .env.local 에 없습니다.');
  try {
    await fetch(BASE + '/api/admin/projects', { headers: { 'x-admin-token': TOKEN } });
  } catch (e) {
    throw new Error(`서버에 연결할 수 없습니다 (${BASE}). 먼저 npm start 로 서버를 띄우세요.`);
  }
  if (process.argv.includes('--clean')) await clean();
  else await seed();
})().catch((e) => { console.error('\n❌ ' + e.message + '\n'); process.exit(1); });
