// ============================================================
// 실시간 행사 Live Poll 솔루션 — 백엔드 (server.js)
// -----------------------------------------------------------------------
//  - 같은 오리진에서 참석자(index.html) + 관리자(admin.html) + API 를 함께 제공.
//  - 모든 DB 접근은 service_role 키로 RLS 를 우회(단일 게이트웨이).
//  - 공개(public) 경로: 프로젝트 랜딩 / Poll 조회 / 응답 제출 / 결과 조회.
//      · 응답 제출은 submit_poll_response RPC 로 원자적 저장 + 중복 방지(PRD 8.1).
//  - 관리자(admin) 경로: Poll CRUD / 시작·종료 / 결과 / 대상자 / 엑셀.
//      · ADMIN_CONSOLE_TOKEN 헤더(x-admin-token) 로 보호.
//  - DB(row) ↔ 앱(object) 변환은 map*Row 헬퍼로 일원화.
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');

// ---------- 환경변수 ----------
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ADMIN_CONSOLE_TOKEN = (process.env.ADMIN_CONSOLE_TOKEN || '').trim();
const PORT = parseInt((process.env.PORT || '8787').trim(), 10) || 8787;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[server] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 필요합니다.');
}
if (!ADMIN_CONSOLE_TOKEN) {
  console.error('[server] ADMIN_CONSOLE_TOKEN 이 .env.local 에 필요합니다.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
// 바디 한도: 전역은 1mb 유지, 세션 import(엑셀 base64 업로드)만 8mb 허용.
// 공개 제출 엔드포인트까지 8배 상향되어 스토리지 남용에 악용되는 것을 방지.
const jsonSmall = express.json({ limit: '1mb' });
const jsonLarge = express.json({ limit: '8mb' });
app.use((req, res, next) => {
  if (req.method === 'POST' && /\/sessions\/import\/?$/.test(req.path)) return jsonLarge(req, res, next);
  return jsonSmall(req, res, next);
});

// ---------- 공개 제출 입력 한도 & 간이 IP 레이트리밋 ----------
const MAX_ANSWER_TEXT = 200;   // answer_text 서버측 강제 길이(문항 메타 max_length 와 일치)
const MAX_ANSWERS = 200;       // 한 번의 제출에서 허용하는 최대 answers 개수
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = 20;             // IP당 분당 최대 제출 횟수
const rlHits = new Map();      // ip -> number[] (timestamps)
function publicSubmitLimiter(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (rlHits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) return res.status(429).json({ success: false, error: 'rate_limited' });
  arr.push(now); rlHits.set(ip, arr);
  if (rlHits.size > 5000) { // 메모리 상한: 만료된 항목 정리
    for (const [k, v] of rlHits) { if (!v.some((t) => now - t < RL_WINDOW_MS)) rlHits.delete(k); }
  }
  next();
}
// 익명 answers 정규화 + 서버측 길이/개수 강제
function normalizePublicAnswers(answers) {
  const list = Array.isArray(answers) ? answers.slice(0, MAX_ANSWERS) : [];
  return list.map((a) => ({
    ...a,
    answer_text: a.answer_text == null ? null : String(a.answer_text).slice(0, MAX_ANSWER_TEXT),
  }));
}

// ============================================================
// 🗺️ 변환 헬퍼 (DB row → 앱 object)
// ============================================================
const POLL_TYPES = ['single_choice', 'multiple_choice', 'rating', 'short_text'];
const POLL_STATUSES = ['draft', 'scheduled', 'live', 'closed', 'archived'];

const mapOption = (o) => ({
  id: o.id, label: o.label, value: o.value, sort_order: o.sort_order,
});

const mapPoll = (row, opts = [], extra = {}) => row ? ({
  id: row.id,
  code: row.code,
  project_id: row.project_id,
  session_id: row.session_id,
  session_name: extra.session_name ?? null,
  title: row.title,
  question: row.question,
  poll_type: row.poll_type,
  status: row.status,
  source_type: row.source_type,
  is_public: row.is_public,
  show_results: row.show_results,
  allow_multiple_answers: row.allow_multiple_answers,
  internal_memo: row.internal_memo || '',
  starts_at: row.starts_at,
  ends_at: row.ends_at,
  created_at: row.created_at,
  response_count: extra.response_count ?? 0,
  options: (opts || []).map(mapOption),
}) : null;

// ---------- 공통 응답 헬퍼 ----------
const ok = (res, body) => res.json(body);
const fail = (res, code, error) => res.status(code).json({ success: false, error });

// 비동기 라우트 에러 래퍼
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[server] 처리 오류:', e?.message || e);
  if (!res.headersSent) res.status(500).json({ success: false, error: 'internal_error' });
});

// ============================================================
// 🔢 결과 집계 (PRD 9.1 — 조회 시점 집계)
// ============================================================
async function fetchPollByCode(code) {
  const { data } = await supabase.from('polls').select('*').eq('code', code).maybeSingle();
  return data || null;
}

async function fetchOptions(pollId) {
  const { data } = await supabase.from('poll_options')
    .select('*').eq('poll_id', pollId).order('sort_order', { ascending: true });
  return data || [];
}

async function countResponses(pollId) {
  const { count } = await supabase.from('poll_responses')
    .select('id', { count: 'exact', head: true }).eq('poll_id', pollId);
  return count || 0;
}

// pollId 의 전체 결과를 계산해서 반환
async function computeResults(pollRow) {
  const pollId = pollRow.id;
  const options = await fetchOptions(pollId);

  // 응답 헤더
  const { data: responses } = await supabase.from('poll_responses')
    .select('id, submitted_at').eq('poll_id', pollId);
  const respIds = (responses || []).map((r) => r.id);
  const total = respIds.length;

  // 답변 상세
  let answers = [];
  if (respIds.length) {
    const { data } = await supabase.from('poll_response_answers')
      .select('option_id, answer_text, answer_number, response_id')
      .in('response_id', respIds);
    answers = data || [];
  }
  const submittedAtByResp = {};
  (responses || []).forEach((r) => { submittedAtByResp[r.id] = r.submitted_at; });

  // 객관식: 선택지별 카운트
  const counts = {};
  options.forEach((o) => { counts[o.id] = 0; });
  answers.forEach((a) => { if (a.option_id && counts[a.option_id] !== undefined) counts[a.option_id] += 1; });
  const totalSelections = Object.values(counts).reduce((s, n) => s + n, 0) || 0;
  const optionResults = options.map((o) => ({
    option_id: o.id,
    label: o.label,
    value: o.value,
    count: counts[o.id] || 0,
    percent: totalSelections ? Math.round((counts[o.id] / totalSelections) * 1000) / 10 : 0,
  }));

  // 척도형: 평균 + 1~5 분포
  let averageScore = null;
  let distribution = null;
  if (pollRow.poll_type === 'rating') {
    const nums = answers.map((a) => a.answer_number).filter((n) => n !== null && n !== undefined).map(Number);
    if (nums.length) averageScore = Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100;
    const buckets = [0, 0, 0, 0, 0];
    nums.forEach((n) => { if (n >= 1 && n <= 5) buckets[Math.round(n) - 1] += 1; });
    const ratingTotal = nums.length || 0;
    distribution = buckets.map((c, i) => ({
      score: i + 1, count: c, percent: ratingTotal ? Math.round((c / ratingTotal) * 100) : 0,
    }));
  }

  // 주관식: 텍스트 응답 (최신순)
  let textAnswers = [];
  if (pollRow.poll_type === 'short_text') {
    textAnswers = answers
      .filter((a) => a.answer_text)
      .map((a) => ({ text: a.answer_text, submitted_at: submittedAtByResp[a.response_id] || null }))
      .sort((x, y) => new Date(y.submitted_at || 0) - new Date(x.submitted_at || 0));
  }

  return { total_responses: total, options: optionResults, average_score: averageScore, distribution, text_answers: textAnswers };
}

// ============================================================
// 🌐 공개(public) API — 참석자 페이지(index.html)
// ============================================================

// 프로젝트 랜딩: code 로 프로젝트 + 진행중 Poll + 세션 목록
app.get('/api/public/projects/:projectCode', wrap(async (req, res) => {
  const { data: project } = await supabase.from('projects')
    .select('*').eq('code', req.params.projectCode).maybeSingle();
  if (!project) return fail(res, 404, 'project_not_found');

  const { data: tracks } = await supabase.from('tracks')
    .select('id, name, sort_order').eq('project_id', project.id).order('sort_order');
  const trackName = {};
  (tracks || []).forEach((t) => { trackName[t.id] = t.name; });

  const { data: sessions } = await supabase.from('sessions')
    .select('id, code, title, speaker, track_id, session_date, time_range, room').eq('project_id', project.id).eq('is_public', true)
    .order('created_at', { ascending: true });
  const sessionName = {};
  (sessions || []).forEach((s) => { sessionName[s.id] = s.title; });

  // 진행 중(live, 공개) Poll
  const { data: polls } = await supabase.from('polls')
    .select('*').eq('project_id', project.id).eq('status', 'live').eq('is_public', true)
    .order('created_at', { ascending: true });

  const livePolls = (polls || []).map((p) => mapPoll(p, [], { session_name: sessionName[p.session_id] || null }));

  ok(res, {
    code: project.code,
    title: project.title,
    client: project.client_name || '',
    status: project.status,
    sessions: (sessions || []).map((s) => ({
      id: s.id, code: s.code, name: s.title, speaker: s.speaker || '',
      track_id: s.track_id, track_name: s.track_id ? (trackName[s.track_id] || '') : '',
      session_date: s.session_date || '', time_range: s.time_range || '', room: s.room || '',
    })),
    livePolls,
  });
}));

// 세션 페이지: 세션 code 로 세션 + 그 세션의 live Poll
app.get('/api/public/sessions/:sessionCode', wrap(async (req, res) => {
  const { data: session } = await supabase.from('sessions')
    .select('*').eq('code', req.params.sessionCode).eq('is_public', true).maybeSingle();
  if (!session) return fail(res, 404, 'session_not_found');

  let trackName = '';
  if (session.track_id) {
    const { data: t } = await supabase.from('tracks').select('name').eq('id', session.track_id).maybeSingle();
    trackName = t?.name || '';
  }

  const { data: polls } = await supabase.from('polls')
    .select('*').eq('session_id', session.id).eq('status', 'live').eq('is_public', true)
    .order('created_at', { ascending: true });

  ok(res, {
    code: session.code,
    name: session.title,
    speaker: session.speaker || '',
    track_name: trackName,
    session_date: session.session_date || '', time_range: session.time_range || '', room: session.room || '',
    project_id: session.project_id,
    livePolls: (polls || []).map((p) => mapPoll(p, [], { session_name: session.title })),
  });
}));

// Poll 단건 조회 (참여 화면). ?token= 있으면 recipient 식별.
app.get('/api/public/polls/:pollCode', wrap(async (req, res) => {
  const poll = await fetchPollByCode(req.params.pollCode);
  if (!poll || !poll.is_public) return fail(res, 404, 'poll_not_found');

  let sessionName = null;
  let sessionCode = null;
  if (poll.session_id) {
    const { data: s } = await supabase.from('sessions').select('code, title, speaker').eq('id', poll.session_id).maybeSingle();
    sessionName = s?.title || null;
    sessionCode = s?.code || null;
  }
  // 제출 후 리스트(행사 랜딩)로 돌아가기 위한 프로젝트 코드
  const { data: proj } = await supabase.from('projects').select('code, title').eq('id', poll.project_id).maybeSingle();
  const options = await fetchOptions(poll.id);
  const response_count = await countResponses(poll.id);

  // 토큰 유효성(있으면) — recipient 존재 여부만 확인
  let recipient = null;
  if (req.query.token) {
    const { data: r } = await supabase.from('poll_recipients')
      .select('id, name').eq('token', String(req.query.token)).maybeSingle();
    recipient = r ? { name: r.name || '' } : null;
  }

  ok(res, {
    ...mapPoll(poll, options, { session_name: sessionName, response_count }),
    session_code: sessionCode,
    project_code: proj?.code || null,
    project_title: proj?.title || null,
    recipient,
  });
}));

// 응답 제출 — submit_poll_response RPC 로 원자적 저장 (PRD 8.1)
app.post('/api/public/polls/:pollCode/responses', publicSubmitLimiter, wrap(async (req, res) => {
  const poll = await fetchPollByCode(req.params.pollCode);
  if (!poll) return fail(res, 404, 'poll_not_found');

  const { respondent_key, recipient_token } = req.body || {};
  const answers = normalizePublicAnswers((req.body || {}).answers);
  if (!answers.length) return fail(res, 400, 'answers_required');

  // recipient_token → recipient_id
  let recipientId = null;
  let source = poll.source_type;
  if (recipient_token) {
    const { data: r } = await supabase.from('poll_recipients')
      .select('id').eq('token', recipient_token).maybeSingle();
    if (!r) return fail(res, 400, 'invalid_token');
    recipientId = r.id;
    source = 'newsletter';
  }

  // 답변 정규화
  const normAnswers = answers.map((a) => ({
    option_id: a.option_id || null,
    answer_text: a.answer_text ?? null,
    answer_number: (a.answer_number ?? null) === null ? null : String(a.answer_number),
  }));

  const { data, error } = await supabase.rpc('submit_poll_response', {
    p_poll_id: poll.id,
    p_respondent_key: respondent_key || null,
    p_recipient_id: recipientId,
    p_source: source,
    p_answers: normAnswers,
  });
  if (error) {
    console.error('[server] submit RPC 오류:', error.message);
    return fail(res, 400, error.message);
  }
  const result = data || {};
  if (result.success === false) return fail(res, 400, result.error || 'submit_failed');
  ok(res, { success: true, response_id: result.response_id || null, already_submitted: !!result.already_submitted });
}));

// 공개 결과 조회 — show_results=true 일 때만
app.get('/api/public/polls/:pollCode/results', wrap(async (req, res) => {
  const poll = await fetchPollByCode(req.params.pollCode);
  if (!poll) return fail(res, 404, 'poll_not_found');
  if (!poll.show_results) return fail(res, 403, 'results_hidden');
  const results = await computeResults(poll);
  ok(res, { poll_type: poll.poll_type, ...results });
}));

// ---------- 공개 설문(survey) ----------
const SURVEY_PRIVACY_NOTICE =
  '수집 목적: 행사 만족도 조사 및 후속 안내 / 수집 항목: 응답 내용, 이메일(토큰 링크 시) / 보유 기간: 수집일로부터 1년. 관리자만 응답을 열람·다운로드합니다.';

async function fetchSurveyByCode(code) {
  const { data } = await supabase.from('surveys').select('*').eq('code', code).maybeSingle();
  return data || null;
}

// 설문의 문항(poll) 목록을 정렬해서 가져옴 (+ 각 문항 옵션)
// Supabase 1000행 제한 회피용 페이지네이션 (build: (sb) => 필터까지 적용된 쿼리빌더)
async function fetchAllPaged(build) {
  const out = []; const PAGE = 1000; let from = 0;
  for (;;) {
    const { data, error } = await build(supabase).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchSurveyQuestions(surveyId) {
  const { data: qpolls } = await supabase.from('polls')
    .select('*').eq('survey_id', surveyId).order('sort_order', { ascending: true });
  const polls = qpolls || [];
  if (!polls.length) return [];
  const ids = polls.map((p) => p.id);
  // 옵션 일괄 조회 (문항마다 개별 조회하던 N+1 제거)
  const opts = await fetchAllPaged((sb) => sb.from('poll_options').select('*').in('poll_id', ids).order('sort_order', { ascending: true }).order('id', { ascending: true }));
  const byPoll = {};
  opts.forEach((o) => { (byPoll[o.poll_id] = byPoll[o.poll_id] || []).push(o); });
  return polls.map((p) => ({ ...p, options: byPoll[p.id] || [] }));
}

// 설문 조회 (참여 화면) — bundle 형태로 반환
app.get('/api/public/surveys/:surveyCode', wrap(async (req, res) => {
  const survey = await fetchSurveyByCode(req.params.surveyCode);
  if (!survey || !survey.is_public) return fail(res, 404, 'survey_not_found');
  const questions = await fetchSurveyQuestions(survey.id);
  const { data: proj } = await supabase.from('projects').select('code, title').eq('id', survey.project_id).maybeSingle();

  let recipient = null;
  if (req.query.token) {
    const { data: r } = await supabase.from('poll_recipients')
      .select('id, name').eq('token', String(req.query.token)).maybeSingle();
    recipient = r ? { name: r.name || '' } : null;
  }

  ok(res, {
    code: survey.code,
    title: survey.title,
    question: survey.intro || '',
    poll_type: 'bundle',
    source_type: survey.source_type,
    status: survey.status,
    show_results: survey.show_results,
    privacy_notice: SURVEY_PRIVACY_NOTICE,
    project_code: proj?.code || null,
    project_title: proj?.title || null,
    recipient,
    questions: questions.map((q) => ({
      id: q.id, poll_type: q.poll_type, question: q.question,
      // 필수 여부는 문항 행(polls.required)을 기준으로 판단.
      // NULL/미지정(컬럼 부재 포함)은 '필수'로 폴백 → 기존 뉴스레터/NPS 설문 동작 보존.
      // generate-day 로 만든 세션 rating 만 required=false 로 저장되어 선택 응답이 됨.
      required: q.required == null ? true : !!q.required, max_length: 200,
      options: (q.options || []).map(mapOption),
    })),
  });
}));

// 설문 응답 제출 — 문항별로 submit_poll_response RPC 호출(원자적)
app.post('/api/public/surveys/:surveyCode/responses', publicSubmitLimiter, wrap(async (req, res) => {
  const survey = await fetchSurveyByCode(req.params.surveyCode);
  if (!survey) return fail(res, 404, 'survey_not_found');
  if (survey.status !== 'live') return fail(res, 400, 'survey_not_live');

  const { respondent_key, recipient_token } = req.body || {};
  if (!Array.isArray((req.body || {}).answers)) return fail(res, 400, 'answers_required');
  const answers = normalizePublicAnswers((req.body || {}).answers);

  let recipientId = null;
  let source = survey.source_type;
  if (recipient_token) {
    const { data: r } = await supabase.from('poll_recipients')
      .select('id').eq('token', recipient_token).maybeSingle();
    if (!r) return fail(res, 400, 'invalid_token');
    recipientId = r.id;
    source = 'newsletter';
  }

  // 문항(poll) id 화이트리스트
  const questions = await fetchSurveyQuestions(survey.id);
  const validIds = new Set(questions.map((q) => q.id));

  // answers: [{ question_id, option_id?, answer_text?, answer_number? }, ...]
  // 문항별로 그룹핑 후 각 문항 poll 에 제출
  const byQuestion = {};
  for (const a of answers) {
    const qid = a.question_id || a.poll_id;
    if (!validIds.has(qid)) continue;
    (byQuestion[qid] = byQuestion[qid] || []).push({
      option_id: a.option_id || null,
      answer_text: a.answer_text ?? null,
      answer_number: (a.answer_number ?? null) === null ? null : String(a.answer_number),
    });
  }

  let submitted = 0;
  for (const qid of Object.keys(byQuestion)) {
    const { data, error } = await supabase.rpc('submit_poll_response', {
      p_poll_id: qid,
      p_respondent_key: respondent_key || null,
      p_recipient_id: recipientId,
      p_source: source,
      p_answers: byQuestion[qid],
    });
    if (!error && data && data.success !== false && !data.already_submitted) submitted += 1;
  }

  ok(res, { success: true, submitted_questions: submitted, total_questions: questions.length });
}));

// ============================================================
// 🔐 관리자(admin) API — admin.html
// ============================================================
function requireAdmin(req, res, next) {
  const token = (req.headers['x-admin-token'] || req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '').trim();
  if (!ADMIN_CONSOLE_TOKEN || token !== ADMIN_CONSOLE_TOKEN) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  next();
}
app.use('/api/admin', requireAdmin);

// 프로젝트 목록 + 통계
app.get('/api/admin/projects', wrap(async (req, res) => {
  const { data: projects } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  const out = [];
  for (const p of projects || []) {
    const { count: sessionCount } = await supabase.from('sessions')
      .select('id', { count: 'exact', head: true }).eq('project_id', p.id);
    const { data: pollRows } = await supabase.from('polls').select('id').eq('project_id', p.id);
    const pollIds = (pollRows || []).map((r) => r.id);
    let responseCount = 0;
    if (pollIds.length) {
      const { count } = await supabase.from('poll_responses')
        .select('id', { count: 'exact', head: true }).in('poll_id', pollIds);
      responseCount = count || 0;
    }
    out.push({
      id: p.id, code: p.code, name: p.title, client: p.client_name || '', status: p.status,
      session_count: sessionCount || 0, poll_count: pollIds.length, response_count: responseCount,
    });
  }
  ok(res, out);
}));

// 프로젝트 상세 (트랙/세션)
app.get('/api/admin/projects/:projectId', wrap(async (req, res) => {
  const { data: p } = await supabase.from('projects').select('*').eq('id', req.params.projectId).maybeSingle();
  if (!p) return fail(res, 404, 'project_not_found');
  const { data: tracks } = await supabase.from('tracks')
    .select('id, name, sort_order').eq('project_id', p.id).order('sort_order');
  const { data: sessions } = await supabase.from('sessions')
    .select('id, code, title, speaker, track_id, is_public, session_date, time_range, room').eq('project_id', p.id).order('created_at', { ascending: true });
  ok(res, {
    id: p.id, code: p.code, name: p.title, client: p.client_name || '', status: p.status,
    tracks: (tracks || []).map((t) => ({ id: t.id, name: t.name })),
    sessions: (sessions || []).map((s) => ({
      id: s.id, code: s.code, name: s.title, speaker: s.speaker || '', track_id: s.track_id, is_public: s.is_public,
      session_date: s.session_date || '', time_range: s.time_range || '', room: s.room || '',
    })),
  });
}));

// 프로젝트 생성
app.post('/api/admin/projects', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return fail(res, 400, 'name_required');
  // 6자리 short code 자동 생성(충돌 시 재시도)
  const genCode = () => Math.random().toString(16).slice(2, 8);
  let code = genCode();
  for (let i = 0; i < 5; i++) {
    const { data: dup } = await supabase.from('projects').select('id').eq('code', code).maybeSingle();
    if (!dup) break;
    code = genCode();
  }
  const insert = {
    title: b.name.trim(),
    client_name: b.client || null,
    description: b.description || null,
    status: b.status || '준비중',
    code,
  };
  const { data: p, error } = await supabase.from('projects').insert(insert).select('*').single();
  if (error) return fail(res, 400, error.message);
  ok(res, {
    id: p.id, code: p.code, name: p.title, client: p.client_name || '', status: p.status,
    session_count: 0, poll_count: 0, response_count: 0,
  });
}));

// 프로젝트 수정
app.patch('/api/admin/projects/:projectId', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.title = b.name;
  if (b.client !== undefined) patch.client_name = b.client || null;
  if (b.description !== undefined) patch.description = b.description || null;
  if (b.status !== undefined) patch.status = b.status;
  const { data: p, error } = await supabase.from('projects').update(patch).eq('id', req.params.projectId).select('*').single();
  if (error) return fail(res, 400, error.message);
  ok(res, { id: p.id, code: p.code, name: p.title, client: p.client_name || '', status: p.status });
}));

// 프로젝트 삭제 (cascade: 세션/Poll/응답 함께 삭제)
app.delete('/api/admin/projects/:projectId', wrap(async (req, res) => {
  const { error } = await supabase.from('projects').delete().eq('id', req.params.projectId);
  if (error) return fail(res, 400, error.message);
  ok(res, { success: true });
}));

// ---------- 트랙(track) CRUD ----------
app.post('/api/admin/projects/:projectId/tracks', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return fail(res, 400, 'name_required');
  const { data: t, error } = await supabase.from('tracks').insert({
    project_id: req.params.projectId, name: b.name.trim(), sort_order: b.sort_order ?? 0,
  }).select('id, name, sort_order').single();
  if (error) return fail(res, 400, error.message);
  ok(res, { id: t.id, name: t.name, sort_order: t.sort_order });
}));
app.patch('/api/admin/tracks/:trackId', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.sort_order !== undefined) patch.sort_order = b.sort_order;
  const { data: t, error } = await supabase.from('tracks').update(patch).eq('id', req.params.trackId).select('id, name, sort_order').single();
  if (error) return fail(res, 400, error.message);
  ok(res, t);
}));
app.delete('/api/admin/tracks/:trackId', wrap(async (req, res) => {
  const { error } = await supabase.from('tracks').delete().eq('id', req.params.trackId);
  if (error) return fail(res, 400, error.message);
  ok(res, { success: true });
}));

// ---------- 세션(session) CRUD ----------
const mapSessionRow = (s) => ({
  id: s.id, code: s.code, name: s.title, speaker: s.speaker || '',
  track_id: s.track_id, is_public: s.is_public, description: s.description || '',
  session_date: s.session_date || '', time_range: s.time_range || '', room: s.room || '',
});

app.post('/api/admin/projects/:projectId/sessions', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return fail(res, 400, 'name_required');
  const { data: s, error } = await supabase.from('sessions').insert({
    project_id: req.params.projectId,
    title: b.name.trim(),
    speaker: b.speaker || null,
    description: b.description || null,
    track_id: b.track_id || null,
    is_public: b.is_public !== false,
    session_date: b.session_date || null,
    time_range: b.time_range || null,
    room: b.room || null,
  }).select('*').single();
  if (error) return fail(res, 400, error.message);
  ok(res, mapSessionRow(s));
}));
app.patch('/api/admin/sessions/:sessionId', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.name !== undefined) patch.title = b.name;
  if (b.speaker !== undefined) patch.speaker = b.speaker || null;
  if (b.description !== undefined) patch.description = b.description || null;
  if (b.track_id !== undefined) patch.track_id = b.track_id || null;
  if (b.is_public !== undefined) patch.is_public = b.is_public;
  if (b.session_date !== undefined) patch.session_date = b.session_date || null;
  if (b.time_range !== undefined) patch.time_range = b.time_range || null;
  if (b.room !== undefined) patch.room = b.room || null;
  const { data: s, error } = await supabase.from('sessions').update(patch).eq('id', req.params.sessionId).select('*').single();
  if (error) return fail(res, 400, error.message);
  ok(res, mapSessionRow(s));
}));
app.delete('/api/admin/sessions/:sessionId', wrap(async (req, res) => {
  const { error } = await supabase.from('sessions').delete().eq('id', req.params.sessionId);
  if (error) return fail(res, 400, error.message);
  ok(res, { success: true });
}));

// ---------- 세션 일괄 업로드 (엑셀/CSV → 세션 자동 생성) ----------
// 컬럼(한/영 유연): 세션명(필수) / 연사 / 설명 / 트랙(없으면 자동 생성) / 공개여부
const SESSION_IMPORT_COLS = {
  title:    ['name', 'title', 'session', '세션', '세션명', '세션이름', '세션 이름', '제목'],
  speaker:  ['speaker', '연사', '발표자', '강연자', '강사'],
  desc:     ['description', 'desc', '설명', '내용', '비고'],
  track:    ['track', '트랙', '분야'],
  isPublic: ['is_public', 'public', '공개', '공개여부', '공개 여부'],
  date:     ['날짜', 'date', '일자', '일시'],
  time:     ['시간', 'time', '시간대', '시각'],
  room:     ['세션룸', '룸', 'room', '장소', '강의실', '홀', 'hall', 'ballroom'],
};
const parseBoolPublic = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return !['false', '0', 'n', 'no', 'x', '비공개', 'private', '숨김'].includes(s); // 기본 공개
};

// 일괄 업로드 상한 (sessions.title varchar(255) / speaker varchar(100) 스키마와 일치)
const IMPORT_MAX_ROWS = 1000;      // 8MB CSV(수만 행) 무제한 insert 방지
const IMPORT_MAX_TITLE = 255;
const IMPORT_MAX_SPEAKER = 100;

app.post('/api/admin/projects/:projectId/sessions/import', wrap(async (req, res) => {
  const projectId = req.params.projectId;
  const { header, rows } = await parseSheet(req.body || {});
  if (!header.length || !rows.length) return fail(res, 400, 'no_valid_rows');
  if (rows.length > IMPORT_MAX_ROWS) {
    return fail(res, 400, `too_many_rows: 한 번에 최대 ${IMPORT_MAX_ROWS}행까지 업로드할 수 있습니다 (요청 ${rows.length}행).`);
  }

  const findCol = (aliases) => header.findIndex((h) => aliases.includes(h));
  const iTitle = findCol(SESSION_IMPORT_COLS.title);
  const iSpeaker = findCol(SESSION_IMPORT_COLS.speaker);
  const iDesc = findCol(SESSION_IMPORT_COLS.desc);
  const iTrack = findCol(SESSION_IMPORT_COLS.track);
  const iPublic = findCol(SESSION_IMPORT_COLS.isPublic);
  const iDate = findCol(SESSION_IMPORT_COLS.date);
  const iTime = findCol(SESSION_IMPORT_COLS.time);
  const iRoom = findCol(SESSION_IMPORT_COLS.room);
  const titleIdx = iTitle >= 0 ? iTitle : 0; // 헤더 매칭 실패 시 첫 컬럼을 세션명으로
  const cell = (cols, i) => (i >= 0 ? (String(cols[i] ?? '').trim() || null) : null);

  // 1) 트랙/세션 생성 전에 전체 행을 먼저 검증한다.
  //    (길이 초과가 있으면 트랙을 하나도 만들지 않고 반환 → 트랙만 잔존하는 비원자성 방지)
  const prepared = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i];
    const rowNum = i + 2; // 헤더가 1행이므로 스프레드시트 기준 행번호
    const title = String(cols[titleIdx] ?? '').trim();
    if (!title) { skipped++; continue; } // 세션명 없는 행은 건너뜀
    if (title.length > IMPORT_MAX_TITLE) {
      return fail(res, 400, `row_${rowNum}: 세션명이 최대 ${IMPORT_MAX_TITLE}자를 초과했습니다 (${title.length}자).`);
    }
    const speaker = cell(cols, iSpeaker);
    if (speaker && speaker.length > IMPORT_MAX_SPEAKER) {
      return fail(res, 400, `row_${rowNum}: 연사명이 최대 ${IMPORT_MAX_SPEAKER}자를 초과했습니다 (${speaker.length}자).`);
    }
    prepared.push({
      title, speaker,
      description: cell(cols, iDesc),
      trackName: iTrack >= 0 ? String(cols[iTrack] ?? '').trim() : '',
      isPublic: iPublic >= 0 ? parseBoolPublic(cols[iPublic]) : true,
      session_date: cell(cols, iDate),
      time_range: cell(cols, iTime),
      room: cell(cols, iRoom),
      trackId: null,
    });
  }
  if (!prepared.length) return fail(res, 400, 'no_valid_rows');

  // 2) 트랙: 기존(name 소문자 → id) 매핑 + 신규 자동 생성.
  //    이번 요청에서 새로 만든 트랙 id 를 추적해 세션 insert 실패 시 롤백한다.
  const { data: existingTracks } = await supabase.from('tracks').select('id, name').eq('project_id', projectId);
  const trackMap = new Map((existingTracks || []).map((t) => [t.name.trim().toLowerCase(), t.id]));
  const tracksCreated = [];
  const createdTrackIds = [];
  const rollbackTracks = async () => {
    if (createdTrackIds.length) await supabase.from('tracks').delete().in('id', createdTrackIds);
  };
  for (const p of prepared) {
    if (!p.trackName) continue;
    const key = p.trackName.toLowerCase();
    if (trackMap.has(key)) { p.trackId = trackMap.get(key); continue; }
    const { data: nt, error: te } = await supabase.from('tracks')
      .insert({ project_id: projectId, name: p.trackName, sort_order: trackMap.size })
      .select('id, name').single();
    if (te) { await rollbackTracks(); return fail(res, 400, te.message); }
    trackMap.set(key, nt.id); p.trackId = nt.id; tracksCreated.push(nt.name); createdTrackIds.push(nt.id);
  }

  // 3) 세션 batch insert. 실패 시 이번 요청에서 만든 트랙 정리(비원자성 방지).
  const insert = prepared.map((p) => ({
    project_id: projectId,
    title: p.title,
    speaker: p.speaker,
    description: p.description,
    track_id: p.trackId,
    is_public: p.isPublic,
    session_date: p.session_date,
    time_range: p.time_range,
    room: p.room,
  }));
  const { data, error } = await supabase.from('sessions').insert(insert).select('*');
  if (error) { await rollbackTracks(); return fail(res, 400, error.message); }
  ok(res, { imported: (data || []).length, skipped, tracksCreated, sessions: (data || []).map(mapSessionRow) });
}));

// 세션 업로드용 템플릿(.xlsx) 다운로드
app.get('/api/admin/projects/:projectId/sessions/import-template', wrap(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('sessions');
  ws.columns = [
    { header: '날짜', key: 'date', width: 12 },
    { header: '시간', key: 'time', width: 14 },
    { header: '세션명', key: 'title', width: 40 },
    { header: '연사', key: 'speaker', width: 20 },
    { header: '트랙', key: 'track', width: 18 },
    { header: '세션룸', key: 'room', width: 20 },
    { header: '공개여부', key: 'is_public', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ date: '8월 20일', time: '11:30~12:20', title: '오프닝 키노트', speaker: '홍길동', track: 'Main', room: 'Harmony Ballroom 1', is_public: '공개' });
  ws.addRow({ date: '8월 20일', time: '13:40~14:30', title: '언리얼 엔진 5 심화', speaker: '김에픽', track: 'Tech', room: 'Harmony Ballroom 2', is_public: '공개' });
  ws.addRow({ date: '8월 20일', time: '16:00~16:50', title: '비공개 스태프 세션', speaker: '', track: 'Staff', room: 'Atlas Hall', is_public: '비공개' });
  await sendXlsx(res, wb, 'sessions-template');
}));

// Poll 목록 (프로젝트 단위) — 응답수 포함. 설문(survey) 문항은 제외(survey_id is null).
async function listPollsWithCounts(filterCol, filterVal) {
  const { data: polls } = await supabase.from('polls')
    .select('*').eq(filterCol, filterVal).is('survey_id', null).order('created_at', { ascending: false });
  // 세션명 매핑
  const sessionIds = [...new Set((polls || []).map((p) => p.session_id).filter(Boolean))];
  const sessionName = {};
  if (sessionIds.length) {
    const { data: ss } = await supabase.from('sessions').select('id, title').in('id', sessionIds);
    (ss || []).forEach((s) => { sessionName[s.id] = s.title; });
  }
  const out = [];
  for (const p of polls || []) {
    const options = await fetchOptions(p.id);
    const response_count = await countResponses(p.id);
    out.push(mapPoll(p, options, { session_name: sessionName[p.session_id] || null, response_count }));
  }
  return out;
}

app.get('/api/admin/projects/:projectId/polls', wrap(async (req, res) => {
  ok(res, await listPollsWithCounts('project_id', req.params.projectId));
}));
app.get('/api/admin/sessions/:sessionId/polls', wrap(async (req, res) => {
  ok(res, await listPollsWithCounts('session_id', req.params.sessionId));
}));

// Poll 생성
app.post('/api/admin/projects/:projectId/polls', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.question || !POLL_TYPES.includes(b.poll_type)) return fail(res, 400, 'invalid_input');
  const status = POLL_STATUSES.includes(b.status) ? b.status : 'draft';
  const insert = {
    project_id: req.params.projectId,
    session_id: b.session_id || null,
    title: b.title,
    question: b.question,
    poll_type: b.poll_type,
    status,
    source_type: b.source_type === 'newsletter' ? 'newsletter' : 'live_event',
    is_public: !!b.is_public,
    show_results: !!b.show_results,
    allow_multiple_answers: !!b.allow_multiple_answers,
    internal_memo: b.internal_memo || null,
    starts_at: b.starts_at || null,
    ends_at: b.ends_at || null,
  };
  const { data: poll, error } = await supabase.from('polls').insert(insert).select('*').single();
  if (error) return fail(res, 400, error.message);

  // 선택지 (객관식만)
  let options = [];
  if (['single_choice', 'multiple_choice'].includes(b.poll_type) && Array.isArray(b.options)) {
    const rows = b.options
      .filter((o) => o && o.label)
      .map((o, i) => ({ poll_id: poll.id, label: o.label, value: o.value || o.label, sort_order: o.sort_order ?? i }));
    if (rows.length) {
      const { data: inserted } = await supabase.from('poll_options').insert(rows).select('*').order('sort_order');
      options = inserted || [];
    }
  }
  ok(res, mapPoll(poll, options, { response_count: 0 }));
}));

// Poll 수정 (선택지 전달 시 전체 교체)
app.patch('/api/admin/polls/:pollId', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ['title', 'question', 'poll_type', 'status', 'source_type', 'is_public', 'show_results', 'allow_multiple_answers', 'internal_memo', 'session_id', 'starts_at', 'ends_at']) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  if (patch.poll_type && !POLL_TYPES.includes(patch.poll_type)) return fail(res, 400, 'invalid_poll_type');
  if (patch.status && !POLL_STATUSES.includes(patch.status)) return fail(res, 400, 'invalid_status');

  const { data: poll, error } = await supabase.from('polls').update(patch).eq('id', req.params.pollId).select('*').single();
  if (error) return fail(res, 400, error.message);

  if (Array.isArray(b.options)) {
    await supabase.from('poll_options').delete().eq('poll_id', poll.id);
    const rows = b.options.filter((o) => o && o.label)
      .map((o, i) => ({ poll_id: poll.id, label: o.label, value: o.value || o.label, sort_order: o.sort_order ?? i }));
    if (rows.length) await supabase.from('poll_options').insert(rows);
  }
  const options = await fetchOptions(poll.id);
  const response_count = await countResponses(poll.id);
  ok(res, mapPoll(poll, options, { response_count }));
}));

// Poll 삭제
app.delete('/api/admin/polls/:pollId', wrap(async (req, res) => {
  const { error } = await supabase.from('polls').delete().eq('id', req.params.pollId);
  if (error) return fail(res, 400, error.message);
  ok(res, { success: true });
}));

// 상태 전환
async function setStatus(pollId, status) {
  const patch = { status };
  if (status === 'live') patch.starts_at = new Date().toISOString();
  if (status === 'closed') patch.ends_at = new Date().toISOString();
  const { data, error } = await supabase.from('polls').update(patch).eq('id', pollId).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}
app.post('/api/admin/polls/:pollId/start', wrap(async (req, res) => {
  const poll = await setStatus(req.params.pollId, 'live');
  ok(res, mapPoll(poll, await fetchOptions(poll.id), { response_count: await countResponses(poll.id) }));
}));
app.post('/api/admin/polls/:pollId/close', wrap(async (req, res) => {
  const poll = await setStatus(req.params.pollId, 'closed');
  ok(res, mapPoll(poll, await fetchOptions(poll.id), { response_count: await countResponses(poll.id) }));
}));

// Poll 복제 (draft 로)
app.post('/api/admin/polls/:pollId/duplicate', wrap(async (req, res) => {
  const { data: src } = await supabase.from('polls').select('*').eq('id', req.params.pollId).maybeSingle();
  if (!src) return fail(res, 404, 'poll_not_found');
  const copy = {
    project_id: src.project_id, session_id: src.session_id,
    title: `${src.title} (복제본)`, question: src.question, poll_type: src.poll_type,
    status: 'draft', source_type: src.source_type, is_public: false, show_results: false,
    allow_multiple_answers: src.allow_multiple_answers, internal_memo: src.internal_memo,
  };
  const { data: poll, error } = await supabase.from('polls').insert(copy).select('*').single();
  if (error) return fail(res, 400, error.message);
  const srcOptions = await fetchOptions(src.id);
  if (srcOptions.length) {
    await supabase.from('poll_options').insert(srcOptions.map((o) => ({
      poll_id: poll.id, label: o.label, value: o.value, sort_order: o.sort_order,
    })));
  }
  ok(res, mapPoll(poll, await fetchOptions(poll.id), { response_count: 0 }));
}));

// 관리자 결과 (항상 전체 반환)
app.get('/api/admin/polls/:pollId/results', wrap(async (req, res) => {
  const { data: poll } = await supabase.from('polls').select('*').eq('id', req.params.pollId).maybeSingle();
  if (!poll) return fail(res, 404, 'poll_not_found');
  const options = await fetchOptions(poll.id);
  const results = await computeResults(poll);
  ok(res, { poll: mapPoll(poll, options, { response_count: results.total_responses }), ...results });
}));

// ---------- 뉴스레터 대상자 ----------
app.get('/api/admin/projects/:projectId/recipients', wrap(async (req, res) => {
  const { data } = await supabase.from('poll_recipients')
    .select('id, email, name, company, title, token').eq('project_id', req.params.projectId)
    .order('created_at', { ascending: true });
  ok(res, data || []);
}));

// CSV 파싱 (간단): 첫 줄 헤더 email,name,company,title
function parseCsv(csv) {
  const parsed = parseCsvRows(csv); // RFC4180 + BOM 처리 공통 파서
  if (!parsed.length) return [];
  const header = parsed[0].map((h) => h.toLowerCase());
  const idx = (k) => header.indexOf(k);
  const iEmail = idx('email'), iName = idx('name'), iCompany = idx('company'), iTitle = idx('title');
  const rows = [];
  for (let i = 1; i < parsed.length; i++) {
    const cols = parsed[i];
    const email = iEmail >= 0 ? cols[iEmail] : cols[0];
    if (!email || !email.includes('@')) continue;
    rows.push({
      email,
      name: iName >= 0 ? cols[iName] || null : null,
      company: iCompany >= 0 ? cols[iCompany] || null : null,
      title: iTitle >= 0 ? cols[iTitle] || null : null,
    });
  }
  return rows;
}

// ExcelJS 셀 값 → 문자열 (리치텍스트/수식/하이퍼링크/날짜 대응)
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text || '').join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink != null) return String(v.hyperlink);
    return '';
  }
  return String(v);
}

// RFC4180 CSV 파서 — 따옴표 필드(내부 콤마/개행/이스케이프된 "") 지원 + 선행 BOM 제거.
// 반환: string[][] (셀 트림). 빈 줄은 제외.
function parseCsvRows(csv) {
  const text = String(csv || '').replace(/^﻿/, ''); // UTF-8 BOM 제거
  const rows = []; let row = []; let field = ''; let inQuotes = false; let started = false;
  const pushField = () => { row.push(field.trim()); field = ''; };
  const pushRow = () => { pushField(); if (row.some((c) => c !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // 이스케이프된 따옴표
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === ',') { pushField(); started = true; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { pushRow(); started = false; continue; }
    field += ch; started = true;
  }
  if (started || field !== '' || row.length) pushRow();
  return rows;
}

// CSV 텍스트 → { header, rows } (header 는 소문자)
function csvToTable(csv) {
  const rows = parseCsvRows(csv);
  if (!rows.length) return { header: [], rows: [] };
  return { header: rows[0].map((h) => h.toLowerCase()), rows: rows.slice(1) };
}

// 엑셀(.xlsx)/CSV 공통 표 파서 → { header: string[], rows: string[][] }
//  - fileBase64(+filename) 우선, 없으면 csv 텍스트.
async function parseSheet({ csv, fileBase64, filename } = {}) {
  if (fileBase64) {
    const buf = Buffer.from(fileBase64, 'base64');
    if ((filename || '').toLowerCase().endsWith('.csv')) return csvToTable(buf.toString('utf8'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return { header: [], rows: [] };
    const table = [];
    ws.eachRow((row) => { table.push((row.values || []).slice(1).map(cellText)); });
    if (!table.length) return { header: [], rows: [] };
    return { header: table[0].map((h) => String(h || '').trim().toLowerCase()), rows: table.slice(1) };
  }
  return csvToTable(csv);
}

app.post('/api/admin/projects/:projectId/recipients/import', wrap(async (req, res) => {
  const rows = parseCsv(req.body?.csv);
  if (!rows.length) return fail(res, 400, 'no_valid_rows');
  const insert = rows.map((r) => ({ project_id: req.params.projectId, ...r }));
  const { data, error } = await supabase.from('poll_recipients').insert(insert)
    .select('id, email, name, company, title, token');
  if (error) return fail(res, 400, error.message);
  ok(res, { imported: (data || []).length, recipients: data || [] });
}));

// 개인별 Poll 링크 목록 (CSV 다운로드)
app.get('/api/admin/projects/:projectId/recipients/export-links', wrap(async (req, res) => {
  const { data: recipients } = await supabase.from('poll_recipients')
    .select('email, name, company, token').eq('project_id', req.params.projectId);
  // 프로젝트의 newsletter Poll 들
  const { data: polls } = await supabase.from('polls')
    .select('code, title').eq('project_id', req.params.projectId).eq('source_type', 'newsletter');
  const base = `${req.protocol}://${req.get('host')}`;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('links');
  ws.columns = [
    { header: 'email', key: 'email', width: 28 },
    { header: 'name', key: 'name', width: 14 },
    { header: 'company', key: 'company', width: 20 },
    { header: 'poll_title', key: 'poll_title', width: 24 },
    { header: 'poll_link', key: 'poll_link', width: 60 },
  ];
  for (const r of recipients || []) {
    for (const p of polls || []) {
      ws.addRow({ email: r.email, name: r.name || '', company: r.company || '',
        poll_title: p.title, poll_link: `${base}/#/poll/${p.code}?token=${r.token}` });
    }
  }
  await sendXlsx(res, wb, 'poll-links');
}));

// ---------- 분석 리포트 (PRD 5.6.3) ----------
app.get('/api/admin/projects/:projectId/analysis', wrap(async (req, res) => {
  const projectId = req.params.projectId;
  const { data: polls } = await supabase.from('polls').select('*').eq('project_id', projectId);
  const pollIds = (polls || []).map((p) => p.id);
  let liveResp = 0, newsResp = 0;
  if (pollIds.length) {
    const { count: lc } = await supabase.from('poll_responses')
      .select('id', { count: 'exact', head: true }).in('poll_id', pollIds).eq('source', 'live_event');
    const { count: nc } = await supabase.from('poll_responses')
      .select('id', { count: 'exact', head: true }).in('poll_id', pollIds).eq('source', 'newsletter');
    liveResp = lc || 0; newsResp = nc || 0;
  }
  // 만족도 평균: rating Poll 들의 평균
  let satSum = 0, satN = 0;
  let topTopic = null, topCount = -1;
  for (const p of polls || []) {
    const r = await computeResults(p);
    if (p.poll_type === 'rating' && r.average_score !== null) { satSum += r.average_score; satN += 1; }
    r.options.forEach((o) => { if (o.count > topCount) { topCount = o.count; topTopic = o.label; } });
  }
  ok(res, {
    total_polls: (polls || []).length,
    total_responses: liveResp + newsResp,
    live_responses: liveResp,
    newsletter_responses: newsResp,
    avg_satisfaction: satN ? Math.round((satSum / satN) * 100) / 100 : null,
    top_topic: topTopic,
    consult_count: 0, // 후속 상담 희망 집계는 별도 Poll 매핑 필요(MVP: 0)
  });
}));

// ============================================================
// 📋 관리자 설문(survey) CRUD
// ============================================================
const mapSurvey = (row, extra = {}) => row ? ({
  id: row.id, code: row.code, project_id: row.project_id,
  title: row.title, intro: row.intro || '', status: row.status,
  source_type: row.source_type, is_public: row.is_public, show_results: row.show_results,
  starts_at: row.starts_at, ends_at: row.ends_at, created_at: row.created_at,
  question_count: extra.question_count ?? 0,
  response_count: extra.response_count ?? 0,
  questions: extra.questions,
  ...(extra.session_count !== undefined ? { session_count: extra.session_count } : {}),
  ...(extra.excluded_private_count !== undefined ? { excluded_private_count: extra.excluded_private_count } : {}),
}) : null;

// 설문 문항(poll)들의 응답자 수(중복 제거) = 설문 응답 수
async function surveyResponseCount(surveyId) {
  const { data: qpolls } = await supabase.from('polls').select('id').eq('survey_id', surveyId);
  const ids = (qpolls || []).map((p) => p.id);
  if (!ids.length) return 0;
  const resps = await fetchAllPaged((sb) => sb.from('poll_responses').select('id, respondent_key, recipient_id').in('poll_id', ids).order('id', { ascending: true }));
  const keys = new Set();
  resps.forEach((r) => keys.add(r.recipient_id || r.respondent_key || ('_' + r.id)));
  return keys.size;
}

// polls.required 컬럼이 아직 마이그레이션 안 된 DB(컬럼 부재)에서도 서버가 깨지지 않도록
// 한 번 감지하면 이후에는 required 없이 insert 하도록 캐시하는 폴백.
let pollsRequiredColMissing = false;
const stripRequired = (row) => { const { required, ...rest } = row; return rest; };
async function insertSurveyPoll(row) {
  const hasRequired = Object.prototype.hasOwnProperty.call(row, 'required');
  const payload = (pollsRequiredColMissing && hasRequired) ? stripRequired(row) : row;
  let resp = await supabase.from('polls').insert(payload).select('id').single();
  if (resp.error && hasRequired && !pollsRequiredColMissing) {
    const m = `${resp.error.message || ''} ${resp.error.code || ''}`;
    if (/required/i.test(m) && /(column|schema cache|does not exist|42703|PGRST204)/i.test(m)) {
      pollsRequiredColMissing = true; // 컬럼 부재 → 이후 요청부터 required 생략
      resp = await supabase.from('polls').insert(stripRequired(row)).select('id').single();
    }
  }
  return resp;
}

// 문항 poll insert helper
async function insertSurveyQuestions(survey, questions) {
  const rows = (questions || []).filter((q) => q && q.question && POLL_TYPES.includes(q.poll_type));
  for (let i = 0; i < rows.length; i++) {
    const q = rows[i];
    const row = {
      project_id: survey.project_id, session_id: null, survey_id: survey.id, sort_order: i,
      title: `${survey.title} - Q${i + 1}`, question: q.question, poll_type: q.poll_type,
      status: survey.status, source_type: survey.source_type,
      is_public: survey.is_public, show_results: survey.show_results, allow_multiple_answers: false,
    };
    // 필수 여부가 명시된 문항만 저장(미지정은 NULL 유지 → 공개 API 에서 '필수'로 폴백)
    if (typeof q.required === 'boolean') row.required = q.required;
    const { data: poll, error } = await insertSurveyPoll(row);
    if (error) throw new Error(error.message);
    if (['single_choice', 'multiple_choice'].includes(q.poll_type) && Array.isArray(q.options)) {
      const opts = q.options.filter((o) => o && o.label)
        .map((o, j) => ({ poll_id: poll.id, label: o.label, value: o.value || o.label, sort_order: o.sort_order ?? j }));
      if (opts.length) await supabase.from('poll_options').insert(opts);
    }
  }
}

// 설문 목록
app.get('/api/admin/projects/:projectId/surveys', wrap(async (req, res) => {
  const { data: surveys } = await supabase.from('surveys')
    .select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: false });
  const list = surveys || [];
  if (!list.length) return ok(res, []);
  const surveyIds = list.map((s) => s.id);
  // 문항 poll 일괄 (설문마다 개별 count 하던 N+1 제거)
  const { data: polls } = await supabase.from('polls').select('id, survey_id').in('survey_id', surveyIds);
  const qCountBySurvey = {}; const pollToSurvey = {};
  (polls || []).forEach((p) => { qCountBySurvey[p.survey_id] = (qCountBySurvey[p.survey_id] || 0) + 1; pollToSurvey[p.id] = p.survey_id; });
  const allPollIds = (polls || []).map((p) => p.id);
  // 응답 일괄 → 설문별 distinct 응답자
  const responses = allPollIds.length
    ? await fetchAllPaged((sb) => sb.from('poll_responses').select('id, poll_id, respondent_key, recipient_id').in('poll_id', allPollIds).order('id', { ascending: true }))
    : [];
  const respSetBySurvey = {};
  responses.forEach((r) => {
    const sid = pollToSurvey[r.poll_id]; if (!sid) return;
    (respSetBySurvey[sid] = respSetBySurvey[sid] || new Set()).add(r.recipient_id || r.respondent_key || ('_' + r.id));
  });
  ok(res, list.map((s) => mapSurvey(s, {
    question_count: qCountBySurvey[s.id] || 0,
    response_count: (respSetBySurvey[s.id] || new Set()).size,
  })));
}));

// 설문 상세 (문항 포함)
app.get('/api/admin/surveys/:surveyId', wrap(async (req, res) => {
  const { data: s } = await supabase.from('surveys').select('*').eq('id', req.params.surveyId).maybeSingle();
  if (!s) return fail(res, 404, 'survey_not_found');
  const questions = await fetchSurveyQuestions(s.id);
  ok(res, mapSurvey(s, {
    question_count: questions.length,
    response_count: await surveyResponseCount(s.id),
    questions: questions.map((q) => ({
      id: q.id, poll_type: q.poll_type, question: q.question,
      options: (q.options || []).map(mapOption),
    })),
  }));
}));

// 설문 생성 (+ 문항)
app.post('/api/admin/projects/:projectId/surveys', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return fail(res, 400, 'title_required');
  if (!Array.isArray(b.questions) || b.questions.length === 0) return fail(res, 400, 'questions_required');
  const status = ['draft', 'live', 'closed'].includes(b.status) ? b.status : 'draft';
  const { data: survey, error } = await supabase.from('surveys').insert({
    project_id: req.params.projectId,
    title: b.title.trim(), intro: b.intro || null, status,
    source_type: b.source_type === 'live_event' ? 'live_event' : 'newsletter',
    is_public: b.is_public !== false, show_results: !!b.show_results,
  }).select('*').single();
  if (error) return fail(res, 400, error.message);
  await insertSurveyQuestions(survey, b.questions);
  const questions = await fetchSurveyQuestions(survey.id);
  ok(res, mapSurvey(survey, { question_count: questions.length, response_count: 0 }));
}));

// 세션 기반 기본 설문 폼 자동 생성 (날짜별) — 이름/이메일/연락처 + 그날 전체 세션의 난이도·만족도(1-5)
app.post('/api/admin/projects/:projectId/surveys/generate-day', wrap(async (req, res) => {
  const projectId = req.params.projectId;
  const date = String((req.body || {}).date || '').trim();
  if (!date) return fail(res, 400, 'date_required');

  const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).maybeSingle();
  if (!proj) return fail(res, 404, 'project_not_found');

  const { data: tracks } = await supabase.from('tracks').select('id, sort_order').eq('project_id', projectId).order('sort_order');
  const trackOrder = {}; (tracks || []).forEach((t, i) => { trackOrder[t.id] = i; });

  // 공개(is_public=true) 세션만 설문 문항으로 노출 — 비공개 세션 제목이 참석자에게 새는 것을 방지
  const { data: allSessions } = await supabase.from('sessions')
    .select('id, title, track_id, time_range, is_public').eq('project_id', projectId).eq('session_date', date);
  const sessions = (allSessions || []).filter((s) => s.is_public === true);
  const excludedPrivateCount = (allSessions || []).length - sessions.length;
  if (!sessions.length) return fail(res, 400, 'no_sessions_for_date');

  const tKey = (s) => { const m = String(s.time_range || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : 99999; };
  sessions.sort((a, b) => (trackOrder[a.track_id] ?? 999) - (trackOrder[b.track_id] ?? 999) || tKey(a) - tKey(b) || String(a.title).localeCompare(String(b.title), 'ko'));

  // 문항: 개인정보(필수 단답) → 세션별 난이도/만족도(1-5 척도)
  const SCALE = '(1 매우 낮음 ~ 5 매우 높음)';
  // 개인정보는 필수, 세션 rating(난이도/만족도)은 참석한 세션만 평가 → 선택 응답.
  // required 를 문항 행에 명시 저장하여 이 설문에만 스코프 한정(다른 설문에 영향 없음).
  const questions = [
    { question: '이름', poll_type: 'short_text', required: true },
    { question: '이메일', poll_type: 'short_text', required: true },
    { question: '연락처(휴대폰 번호)', poll_type: 'short_text', required: true },
  ];
  for (const s of sessions) {
    questions.push({ question: `${s.title} — 난이도 ${SCALE}`, poll_type: 'rating', required: false });
    questions.push({ question: `${s.title} — 만족도 ${SCALE}`, poll_type: 'rating', required: false });
  }

  const { data: survey, error } = await supabase.from('surveys').insert({
    project_id: projectId,
    title: `${proj.title} · ${date} 세션 평가`,
    intro: `${date} 세션에 대한 난이도·만족도 설문입니다. 참석하신 세션만 1~5점으로 평가해주세요. ${SCALE} 이름·이메일·연락처는 필수 입력입니다.`,
    status: 'draft', source_type: 'live_event', is_public: true, show_results: false,
  }).select('*').single();
  if (error) return fail(res, 400, error.message);
  await insertSurveyQuestions(survey, questions);
  const qs = await fetchSurveyQuestions(survey.id);
  ok(res, mapSurvey(survey, { question_count: qs.length, response_count: 0, session_count: sessions.length, excluded_private_count: excludedPrivateCount }));
}));

// 설문 수정 (문항 전달 시 전체 교체)
app.patch('/api/admin/surveys/:surveyId', wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  for (const k of ['title', 'intro', 'status', 'source_type', 'is_public', 'show_results']) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  const { data: survey, error } = await supabase.from('surveys').update(patch).eq('id', req.params.surveyId).select('*').single();
  if (error) return fail(res, 400, error.message);
  // 결과 공개/상태 변경은 문항 poll 에도 반영
  if (b.status !== undefined || b.show_results !== undefined || b.is_public !== undefined) {
    const pp = {};
    if (b.status !== undefined) pp.status = b.status;
    if (b.show_results !== undefined) pp.show_results = b.show_results;
    if (b.is_public !== undefined) pp.is_public = b.is_public;
    await supabase.from('polls').update(pp).eq('survey_id', survey.id);
  }
  if (Array.isArray(b.questions)) {
    await supabase.from('polls').delete().eq('survey_id', survey.id); // cascade 로 옵션/응답 삭제
    await insertSurveyQuestions(survey, b.questions);
  }
  const questions = await fetchSurveyQuestions(survey.id);
  ok(res, mapSurvey(survey, { question_count: questions.length, response_count: await surveyResponseCount(survey.id) }));
}));

// 설문 삭제
app.delete('/api/admin/surveys/:surveyId', wrap(async (req, res) => {
  const { error } = await supabase.from('surveys').delete().eq('id', req.params.surveyId);
  if (error) return fail(res, 400, error.message);
  ok(res, { success: true });
}));

// 설문 시작/종료 (문항 poll 상태도 함께)
async function setSurveyStatus(surveyId, status) {
  const patch = { status };
  if (status === 'live') patch.starts_at = new Date().toISOString();
  if (status === 'closed') patch.ends_at = new Date().toISOString();
  const { data, error } = await supabase.from('surveys').update(patch).eq('id', surveyId).select('*').single();
  if (error) throw new Error(error.message);
  await supabase.from('polls').update({ status }).eq('survey_id', surveyId);
  return data;
}
app.post('/api/admin/surveys/:surveyId/start', wrap(async (req, res) => {
  const s = await setSurveyStatus(req.params.surveyId, 'live');
  ok(res, mapSurvey(s, { response_count: await surveyResponseCount(s.id) }));
}));
app.post('/api/admin/surveys/:surveyId/close', wrap(async (req, res) => {
  const s = await setSurveyStatus(req.params.surveyId, 'closed');
  ok(res, mapSurvey(s, { response_count: await surveyResponseCount(s.id) }));
}));

// 설문 결과 (문항별 집계) — 대량 배치 쿼리로 집계(문항 수와 무관하게 쿼리 ~5회).
app.get('/api/admin/surveys/:surveyId/results', wrap(async (req, res) => {
  // 설문 헤더 + 문항(옵션 포함)을 병렬로
  const [surveyRes, qpolls] = await Promise.all([
    supabase.from('surveys').select('*').eq('id', req.params.surveyId).maybeSingle(),
    fetchSurveyQuestions(req.params.surveyId),
  ]);
  const s = surveyRes.data;
  if (!s) return fail(res, 404, 'survey_not_found');
  const pollIds = qpolls.map((q) => q.id);
  if (!pollIds.length) return ok(res, { survey: mapSurvey(s, { question_count: 0 }), total_responses: 0, questions: [] });

  // 응답 헤더 + 답변 상세를 병렬로 (Vercel→Supabase 왕복 최소화)
  const [responses, answers] = await Promise.all([
    fetchAllPaged((sb) => sb.from('poll_responses')
      .select('id, poll_id, submitted_at, respondent_key, recipient_id').in('poll_id', pollIds).order('id', { ascending: true })),
    fetchAllPaged((sb) => sb.from('poll_response_answers')
      .select('id, option_id, answer_text, answer_number, poll_responses!inner(poll_id, submitted_at)').in('poll_responses.poll_id', pollIds).order('id', { ascending: true })),
  ]);
  const totalByPoll = {}; const respondentSet = new Set();
  responses.forEach((r) => {
    totalByPoll[r.poll_id] = (totalByPoll[r.poll_id] || 0) + 1;
    respondentSet.add(r.recipient_id || r.respondent_key || ('_' + r.id));
  });
  const ansByPoll = {};
  answers.forEach((a) => {
    const pid = a.poll_responses && a.poll_responses.poll_id; if (!pid) return;
    (ansByPoll[pid] = ansByPoll[pid] || []).push({
      option_id: a.option_id, answer_text: a.answer_text, answer_number: a.answer_number,
      submitted_at: a.poll_responses && a.poll_responses.submitted_at,
    });
  });

  const questions = qpolls.map((q) => {
    const opts = q.options || [];
    const ans = ansByPoll[q.id] || [];
    const total = totalByPoll[q.id] || 0;
    // 객관식
    const counts = {}; opts.forEach((o) => { counts[o.id] = 0; });
    ans.forEach((a) => { if (a.option_id && counts[a.option_id] !== undefined) counts[a.option_id] += 1; });
    const totalSel = Object.values(counts).reduce((n2, n) => n2 + n, 0) || 0;
    const options = opts.map((o) => ({
      option_id: o.id, label: o.label, value: o.value, count: counts[o.id] || 0,
      percent: totalSel ? Math.round((counts[o.id] / totalSel) * 1000) / 10 : 0,
    }));
    // 척도형
    let average_score = null, distribution = null;
    if (q.poll_type === 'rating') {
      const nums = ans.map((a) => a.answer_number).filter((n) => n !== null && n !== undefined).map(Number);
      if (nums.length) average_score = Math.round((nums.reduce((n2, n) => n2 + n, 0) / nums.length) * 100) / 100;
      const b = [0, 0, 0, 0, 0]; nums.forEach((n) => { if (n >= 1 && n <= 5) b[Math.round(n) - 1] += 1; });
      const rt = nums.length || 0;
      distribution = b.map((c, i) => ({ score: i + 1, count: c, percent: rt ? Math.round((c / rt) * 100) : 0 }));
    }
    // 주관식
    let text_answers = [];
    if (q.poll_type === 'short_text') {
      text_answers = ans.filter((a) => a.answer_text)
        .map((a) => ({ text: a.answer_text, submitted_at: a.submitted_at || null }))
        .sort((x, y) => new Date(y.submitted_at || 0) - new Date(x.submitted_at || 0));
    }
    return { id: q.id, question: q.question, poll_type: q.poll_type, total_responses: total, options, average_score, distribution, text_answers };
  });

  ok(res, {
    survey: mapSurvey(s, { question_count: qpolls.length }),
    total_responses: respondentSet.size,
    questions,
  });
}));

// ============================================================
// 📊 엑셀 다운로드 (PRD 5.7)
// ============================================================
async function sendXlsx(res, wb, name) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// 응답 상세 행 빌드 (PRD 5.7.2)
async function buildResponseRows(pollRow, ctx) {
  const options = await fetchOptions(pollRow.id);
  const optLabel = {}; options.forEach((o) => { optLabel[o.id] = o.label; });
  const { data: responses } = await supabase.from('poll_responses')
    .select('id, respondent_key, recipient_id, source, submitted_at').eq('poll_id', pollRow.id);
  const respIds = (responses || []).map((r) => r.id);
  let answers = [];
  if (respIds.length) {
    const { data } = await supabase.from('poll_response_answers')
      .select('response_id, option_id, answer_text, answer_number').in('response_id', respIds);
    answers = data || [];
  }
  // recipient 매핑
  const recIds = [...new Set((responses || []).map((r) => r.recipient_id).filter(Boolean))];
  const recById = {};
  if (recIds.length) {
    const { data: recs } = await supabase.from('poll_recipients')
      .select('id, email, name, company').in('id', recIds);
    (recs || []).forEach((r) => { recById[r.id] = r; });
  }
  const ansByResp = {};
  answers.forEach((a) => { (ansByResp[a.response_id] = ansByResp[a.response_id] || []).push(a); });

  const rows = [];
  for (const r of responses || []) {
    const rec = r.recipient_id ? recById[r.recipient_id] : null;
    const list = ansByResp[r.id] || [{}];
    for (const a of list) {
      const value = a.option_id ? (optLabel[a.option_id] || '') : (a.answer_text ?? (a.answer_number != null ? String(a.answer_number) : ''));
      rows.push({
        project_title: ctx.projectTitle || '',
        session_title: ctx.sessionTitle || '',
        poll_title: pollRow.title,
        poll_question: pollRow.question,
        poll_type: pollRow.poll_type,
        response_id: r.id,
        respondent_key: r.respondent_key || '',
        recipient_email: rec?.email || '',
        respondent_name: rec?.name || '',
        respondent_company: rec?.company || '',
        answer_value: value,
        answer_label: a.option_id ? (optLabel[a.option_id] || '') : '',
        submitted_at: r.submitted_at,
        source: r.source,
      });
    }
  }
  return rows;
}

function responseSheet(wb, rows) {
  const ws = wb.addWorksheet('responses');
  ws.columns = [
    'project_title', 'session_title', 'poll_title', 'poll_question', 'poll_type',
    'response_id', 'respondent_key', 'recipient_email', 'respondent_name', 'respondent_company',
    'answer_value', 'answer_label', 'submitted_at', 'source', 'exported_at',
  ].map((k) => ({ header: k, key: k, width: 18 }));
  const exportedAt = new Date().toISOString();
  rows.forEach((r) => ws.addRow({ ...r, exported_at: exportedAt }));
  return ws;
}

async function projectCtx(projectId) {
  const { data: p } = await supabase.from('projects').select('title').eq('id', projectId).maybeSingle();
  return { projectTitle: p?.title || '' };
}

// Poll별 다운로드
app.get('/api/admin/polls/:pollId/export', wrap(async (req, res) => {
  const { data: poll } = await supabase.from('polls').select('*').eq('id', req.params.pollId).maybeSingle();
  if (!poll) return fail(res, 404, 'poll_not_found');
  const ctx = await projectCtx(poll.project_id);
  if (poll.session_id) {
    const { data: s } = await supabase.from('sessions').select('title').eq('id', poll.session_id).maybeSingle();
    ctx.sessionTitle = s?.title || '';
  }
  const wb = new ExcelJS.Workbook();
  responseSheet(wb, await buildResponseRows(poll, ctx));
  await sendXlsx(res, wb, `poll-${poll.code}`);
}));

// 세션별 다운로드
app.get('/api/admin/sessions/:sessionId/polls/export', wrap(async (req, res) => {
  const { data: session } = await supabase.from('sessions').select('id, title, project_id').eq('id', req.params.sessionId).maybeSingle();
  if (!session) return fail(res, 404, 'session_not_found');
  const ctx = { ...(await projectCtx(session.project_id)), sessionTitle: session.title };
  const { data: polls } = await supabase.from('polls').select('*').eq('session_id', session.id);
  const wb = new ExcelJS.Workbook();
  let all = [];
  for (const p of polls || []) all = all.concat(await buildResponseRows(p, ctx));
  responseSheet(wb, all);
  await sendXlsx(res, wb, `session-${session.id}`);
}));

// 프로젝트 전체 다운로드
app.get('/api/admin/projects/:projectId/polls/export', wrap(async (req, res) => {
  const ctx = await projectCtx(req.params.projectId);
  const { data: polls } = await supabase.from('polls').select('*').eq('project_id', req.params.projectId);
  const { data: sessions } = await supabase.from('sessions').select('id, title').eq('project_id', req.params.projectId);
  const sName = {}; (sessions || []).forEach((s) => { sName[s.id] = s.title; });
  const wb = new ExcelJS.Workbook();
  let all = [];
  for (const p of polls || []) all = all.concat(await buildResponseRows(p, { ...ctx, sessionTitle: sName[p.session_id] || '' }));
  responseSheet(wb, all);
  await sendXlsx(res, wb, `project-${req.params.projectId}`);
}));

// 설문 응답 다운로드
app.get('/api/admin/surveys/:surveyId/export', wrap(async (req, res) => {
  const { data: s } = await supabase.from('surveys').select('*').eq('id', req.params.surveyId).maybeSingle();
  if (!s) return fail(res, 404, 'survey_not_found');
  const ctx = { ...(await projectCtx(s.project_id)), sessionTitle: s.title };
  const qpolls = await fetchSurveyQuestions(s.id);
  const wb = new ExcelJS.Workbook();
  let all = [];
  for (const p of qpolls) all = all.concat(await buildResponseRows(p, ctx));
  responseSheet(wb, all);
  await sendXlsx(res, wb, `survey-${s.code}`);
}));

// 분석 요약 다운로드 (PRD 5.7.3)
app.get('/api/admin/projects/:projectId/polls/summary-export', wrap(async (req, res) => {
  const ctx = await projectCtx(req.params.projectId);
  const { data: polls } = await supabase.from('polls').select('*').eq('project_id', req.params.projectId);
  const { data: sessions } = await supabase.from('sessions').select('id, title').eq('project_id', req.params.projectId);
  const sName = {}; (sessions || []).forEach((s) => { sName[s.id] = s.title; });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('summary');
  ws.columns = ['project_title', 'session_title', 'poll_title', 'poll_question', 'poll_type',
    'total_responses', 'option_label', 'option_count', 'option_percent', 'average_score', 'source']
    .map((k) => ({ header: k, key: k, width: 18 }));
  for (const p of polls || []) {
    const r = await computeResults(p);
    if (r.options.length) {
      r.options.forEach((o) => ws.addRow({
        project_title: ctx.projectTitle, session_title: sName[p.session_id] || '', poll_title: p.title,
        poll_question: p.question, poll_type: p.poll_type, total_responses: r.total_responses,
        option_label: o.label, option_count: o.count, option_percent: o.percent,
        average_score: r.average_score ?? '', source: p.source_type,
      }));
    } else {
      ws.addRow({
        project_title: ctx.projectTitle, session_title: sName[p.session_id] || '', poll_title: p.title,
        poll_question: p.question, poll_type: p.poll_type, total_responses: r.total_responses,
        option_label: '', option_count: '', option_percent: '', average_score: r.average_score ?? '', source: p.source_type,
      });
    }
  }
  await sendXlsx(res, wb, `summary-${req.params.projectId}`);
}));

// ============================================================
// 🖥️ 정적 페이지 서빙 (API 가 아닌 경로만)
// ============================================================
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// vendoring 된 서드파티 라이브러리(자체 서빙). admin.html 이 CDN(SRI 없음) 대신 동일 오리진에서 로드.
app.get('/vendor/qrcode.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'vendor', 'qrcode.js'));
});

// 그 외 비-API GET 은 참석자 페이지(index.html). 해시 라우팅이라 모든 경로 동일.
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ============================================================
app.listen(PORT, () => {
  console.log(`[server] Live Poll 서버 실행: http://localhost:${PORT}`);
  console.log(`[server]   참석자: http://localhost:${PORT}/  ·  관리자: http://localhost:${PORT}/admin`);
});

module.exports = app;
