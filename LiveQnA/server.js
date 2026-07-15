// ============================================================
// 실시간 행사 Q&A 솔루션 — 관리자 백엔드 (server.js)
// -----------------------------------------------------------------------
//  - 사용자(공개) 경로는 index.html 이 Supabase anon 으로 직접 처리(미변경).
//  - 관리자 경로(프로젝트/세션 CRUD, 답변/숨김 토글, 숨김질문 열람, 엑셀)는
//    이 서버가 service_role 키로 RLS 를 우회해서 처리한다.
//  - DB 컬럼명과 앱(프론트) 객체 필드명이 다르므로, 서버가 "앱 객체 형태"로
//    변환해서 응답한다(프론트 컴포넌트 수정 최소화).
//      projects:  title→name, client_name→client
//      sessions:  title→name, starts_at/ends_at→duration ('HH:MM ~ HH:MM')
//      questions: content→body, like_count→likes
//  - 인증: ADMIN_CONSOLE_TOKEN(운영자 콘솔) + 세션별 admin_token(연사 대시보드)
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');

// ---------- 환경변수 (.trim() 으로 trailing newline 방지) ----------
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

// ---------- Supabase service_role 클라이언트 (RLS 우회) ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
// 엑셀 일괄 업로드는 파일을 base64 로 JSON body 에 실어 보내므로 한도를 넉넉히.
app.use(express.json({ limit: '15mb' }));

// 같은 오리진에서 프론트(index.html)와 API 를 함께 제공 → CORS 불필요
// ⚠️ 보안: 디렉토리 전체 정적 서빙 금지(.env.local/*.sql 등 노출 방지).
//    index.html 은 아래 비-API catch-all 라우트에서만 내보낸다.

// ============================================================
// 🗺️ DB(row) ↔ 앱(object) 변환 헬퍼
// ============================================================
const pad2 = (n) => String(n).padStart(2, '0');

// timestamptz → 'HH:MM' (Asia/Seoul 기준 표시)
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // 한국 시간대로 표시 (DB 에 +09 로 저장됨)
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value || '00';
  const m = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${h}:${m}`;
};

const buildDuration = (startsAt, endsAt) => {
  const s = fmtTime(startsAt);
  const e = fmtTime(endsAt);
  if (s && e) return `${s} ~ ${e}`;
  return s || e || '';
};

// timestamptz → 'YYYY-MM-DD' (Asia/Seoul 기준). 멀티데이 날짜별 그룹핑/정렬용.
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // en-CA 로케일은 YYYY-MM-DD 형식으로 포맷.
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const da = parts.find((p) => p.type === 'day')?.value;
  return (y && m && da) ? `${y}-${m}-${da}` : '';
};

// '8월 20일'(또는 'YYYY-MM-DD','MM/DD') + '11:30~12:20' (+연도) → { starts_at, ends_at }
//  parseDuration 과 달리 실제 날짜를 보존한다(멀티데이 정렬을 위해). 파싱 실패 값은 null.
const parseKoreanDateTime = (dateStr, timeStr, year) => {
  const out = { starts_at: null, ends_at: null };
  const ds = (dateStr || '').toString();
  let mo = null, da = null, yr = year;
  const kr = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(ds);
  const iso = /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/.exec(ds);
  const md = /(\d{1,2})[-.\/](\d{1,2})/.exec(ds);
  if (kr) { mo = parseInt(kr[1], 10); da = parseInt(kr[2], 10); }
  else if (iso) { yr = parseInt(iso[1], 10); mo = parseInt(iso[2], 10); da = parseInt(iso[3], 10); }
  else if (md) { mo = parseInt(md[1], 10); da = parseInt(md[2], 10); }
  if (!mo || !da) return out; // 날짜 없으면 timestamp 미생성
  const y = yr || new Date().getFullYear();
  const toIso = (hhmm) => {
    const m = /(\d{1,2}):(\d{2})/.exec((hhmm || '').toString());
    if (!m) return null;
    return `${y}-${pad2(mo)}-${pad2(da)}T${pad2(parseInt(m[1], 10))}:${pad2(parseInt(m[2], 10))}:00+09:00`;
  };
  const parts = (timeStr || '').toString().split(/[~\-–—]/);
  out.starts_at = toIso(parts[0] || '');
  if (parts.length >= 2) out.ends_at = toIso(parts[1] || '');
  return out;
};

// 'HH:MM ~ HH:MM' (또는 단일 'HH:MM') → { starts_at, ends_at } (timestamptz, KST 기준)
// duration 문자열은 날짜 정보가 없으므로 '오늘(KST)' 날짜에 시간을 붙여 저장한다.
// 표시는 다시 buildDuration 으로 HH:MM 만 뽑으므로 날짜 부분은 표기에 영향 없음.
const parseDuration = (duration) => {
  const result = { starts_at: null, ends_at: null };
  if (!duration || typeof duration !== 'string') return result;
  const today = new Date();
  const y = today.getFullYear();
  const mo = pad2(today.getMonth() + 1);
  const da = pad2(today.getDate());
  const toIso = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const hh = pad2(parseInt(m[1], 10));
    const mm = pad2(parseInt(m[2], 10));
    // +09:00 (KST) 로 명시 저장
    return `${y}-${mo}-${da}T${hh}:${mm}:00+09:00`;
  };
  const parts = duration.split('~');
  if (parts.length >= 2) {
    result.starts_at = toIso(parts[0]);
    result.ends_at = toIso(parts[1]);
  } else {
    result.starts_at = toIso(parts[0]);
  }
  return result;
};

const mapProjectRow = (row) => row ? ({
  id: row.id,
  code: row.code || '',                     // 짧은 코드(short code) — URL/QR 용
  name: row.title,                          // title(DB) → name(앱)
  client: row.client_name || '',            // client_name(DB) → client(앱)
  description: row.description || '',
  start_date: row.start_date || '',
  end_date: row.end_date || '',
  status: row.status || '준비중',
  created_at: row.created_at,
}) : null;

const mapSessionRow = (row) => row ? ({
  id: row.id,
  code: row.code || '',                     // 짧은 코드(short code) — URL/QR 용
  project_id: row.project_id,
  name: row.title,                          // title(DB) → name(앱)
  description: row.description || '',
  speaker: row.speaker || '',               // 강연자 (add_tracks_speaker.sql)
  track_id: row.track_id || null,           // 소속 트랙 (없으면 null)
  track_name: row.track_name || '',         // 조인/조회로 채워질 수 있음
  duration: buildDuration(row.starts_at, row.ends_at),
  session_date: fmtDate(row.starts_at),      // 'YYYY-MM-DD' (KST) — 멀티데이 그룹핑용
  is_public: !!row.is_public,
  admin_token: row.admin_token,
  created_at: row.created_at,
}) : null;

const mapQuestionRow = (row) => row ? ({
  id: row.id,
  session_id: row.session_id,
  author: row.author,
  title: row.title,
  body: row.content,                        // content(DB) → body(앱)
  likes: row.like_count,                    // like_count(DB) → likes(앱)
  is_answered: !!row.is_answered,
  is_hidden: !!row.is_hidden,
  created_at: row.created_at,
}) : null;

// ============================================================
// 🔐 인증 헬퍼 & 미들웨어
// ============================================================
// 요청에서 토큰 추출: x-admin-token 헤더 또는 ?token= 쿼리
const extractToken = (req) =>
  (req.get('x-admin-token') || req.query.token || '').toString().trim();

// 운영자 콘솔 토큰 검증 (프로젝트/세션 관리 등 콘솔 작업)
const requireConsole = (req, res, next) => {
  const token = extractToken(req);
  if (!token || token !== ADMIN_CONSOLE_TOKEN) {
    return res.status(401).json({ success: false, message: '운영자 콘솔 토큰이 필요합니다.' });
  }
  next();
};

// 세션 범위 권한 검증: 콘솔 토큰 OR 해당 세션의 admin_token
// sessionId 가 유효하지 않으면 404. 토큰 불일치면 403.
async function requireSessionAdmin(req, res, sessionId) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: '토큰이 필요합니다.' });
    return false;
  }
  // 콘솔 토큰이면 무조건 통과
  if (token === ADMIN_CONSOLE_TOKEN) return true;

  const { data, error } = await supabase
    .from('sessions')
    .select('id, admin_token')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, message: 'DB 조회 중 오류가 발생했습니다.' });
    return false;
  }
  if (!data) {
    res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
    return false;
  }
  if (data.admin_token !== token) {
    res.status(403).json({ success: false, message: '세션 접근 권한이 없습니다.' });
    return false;
  }
  return true;
}

// 라우트 핸들러를 try/catch 로 감싸는 래퍼
const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[server] route error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
  });
};

// ============================================================
// 🔑 짧은 코드(short code) — 생성 & 해석 헬퍼
// ------------------------------------------------------------
//  projects.code / sessions.code (6자리 hex, unique). add_short_codes.sql 로
//  컬럼/유니크 인덱스가 추가됨. 생성 시 유니크 충돌이면 재시도한다.
//  코드가 uuid 처럼 보이면 id 로 간주하고, 6자리 hex 면 code 로 해석한다.
// ============================================================
// 6자리 소문자 hex 코드 생성
const genCode = () => {
  let out = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < 6; i++) out += hex[Math.floor(Math.random() * 16)];
  return out;
};

// 표준 UUID 형태인지 (id vs code 구분용)
const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((s || '').toString());

// table 에 유니크한 새 code 를 생성한다(충돌 시 재시도). 컬럼이 없으면 null 반환(SQL 미실행 대비).
async function generateUniqueCode(table, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const code = genCode();
    const { data, error } = await supabase
      .from(table).select('id').eq('code', code).maybeSingle();
    if (error) {
      // code 컬럼이 없으면(SQL 미실행) 코드 발급을 건너뜀 — 기능은 계속 동작
      if (error.code === '42703') return null;
      throw error;
    }
    if (!data) return code;
  }
  return null;
}

// codeOrId → 실제 session row(또는 null). uuid 면 id, 아니면 code 로 조회.
//  옵션 publicOnly=true 면 is_public=true 인 세션만 매칭(공개 엔드포인트용).
//  ⚠️ add_short_codes.sql 미실행 시 code 컬럼이 없을 수 있다(42703):
//     - uuid 입력은 code 와 무관하므로 select 에서 code 를 빼고 재시도 → 정상 동작(하위호환).
//     - code 입력은 해석 불가 → null(404).
async function resolveSession(codeOrId, { publicOnly = false } = {}) {
  const v = (codeOrId || '').toString().trim();
  if (!v) return null;
  const byUuid = isUuid(v);
  const run = async (cols) => {
    let q = supabase.from('sessions').select(cols);
    q = byUuid ? q.eq('id', v) : q.eq('code', v);
    if (publicOnly) q = q.eq('is_public', true);
    return q.maybeSingle();
  };
  let { data, error } = await run('*');
  if (error && error.code === '42703') {
    // code 컬럼 없음. uuid 면 code 제외 컬럼으로 재시도, code 입력이면 해석 불가.
    if (!byUuid) return null;
    ({ data, error } = await run('id, project_id, title, description, starts_at, ends_at, is_public, admin_token, created_at'));
  }
  if (error) throw error;
  return data || null;
}

// codeOrId → 실제 project row(또는 null). uuid 면 id, 아니면 code 로 조회.
//  cols: 선택할 컬럼 목록(공개 라우트에서 민감필드 제외용).
//  SQL 미실행으로 code 컬럼이 없으면(42703): uuid 는 code 제외하고 재시도, code 입력은 null.
async function resolveProject(codeOrId, cols = '*') {
  const v = (codeOrId || '').toString().trim();
  if (!v) return null;
  const byUuid = isUuid(v);
  let q = supabase.from('projects').select(cols);
  q = byUuid ? q.eq('id', v) : q.eq('code', v);
  let { data, error } = await q.maybeSingle();
  if (error && error.code === '42703') {
    if (!byUuid) return null;
    // cols 에서 code 를 제거하고 재시도(* 면 code 가 어차피 빠진 명시 컬럼으로 대체).
    const fallbackCols = cols === '*'
      ? '*'
      : cols.split(',').map((c) => c.trim()).filter((c) => c !== 'code').join(', ');
    let q2 = supabase.from('projects').select(fallbackCols).eq('id', v);
    ({ data, error } = await q2.maybeSingle());
  }
  if (error) throw error;
  return data || null;
}

// ============================================================
// 🎫 트랙(Track) 헬퍼 — add_tracks_speaker.sql 미실행 시 방어(42703)
// ------------------------------------------------------------
//  tracks 테이블/sessions.track_id/speaker 컬럼이 없을 수 있다. 이 경우
//  트랙 기능은 "비어있게" 동작하고 기존 기능은 안 깨지도록 폴백한다.
// ============================================================
// "스키마 미적용(add_tracks_speaker.sql 미실행)"으로 간주할 에러:
//  - 42703 = undefined_column (sessions.track_id/speaker 없음)
//  - 42P01 = undefined_table  (tracks 테이블 없음, raw Postgres)
//  - PGRST205 = PostgREST 가 테이블을 스키마 캐시에서 못 찾음(tracks 미존재)
//  - PGRST204 = PostgREST 가 컬럼을 스키마 캐시에서 못 찾음(track_id/speaker 미존재)
const isSchemaMissing = (err) =>
  !!err && (err.code === '42703' || err.code === '42P01'
    || err.code === 'PGRST205' || err.code === 'PGRST204');

// 특정 프로젝트의 트랙 목록(sort_order, created_at 순). 스키마 미적용이면 [] 반환.
async function fetchTracksForProject(projectId) {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, project_id, name, sort_order, created_at')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (isSchemaMissing(error)) return [];
    throw error;
  }
  return data || [];
}

// 트랙 단건 조회(id). 스키마 미적용이면 null.
async function fetchTrackById(trackId) {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, project_id, name, sort_order, created_at')
    .eq('id', trackId)
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error)) return null;
    throw error;
  }
  return data || null;
}

// 세션 목록을 select 하되 track_id/speaker 컬럼이 없으면(42703) 해당 컬럼을 빼고 재시도.
//  baseCols: 항상 존재하는 컬럼들. withExtra=true 면 track_id, speaker 를 덧붙여 시도.
async function selectSessionsTolerant(applyQuery, baseCols) {
  const tryRun = (cols) => applyQuery(supabase.from('sessions').select(cols));
  let { data, error } = await tryRun(`${baseCols}, track_id, speaker`);
  if (error && isSchemaMissing(error)) {
    ({ data, error } = await tryRun(baseCols));
  }
  if (error) throw error;
  return data || [];
}

// 트랙 id 목록 → { id: name } 매핑. 스키마 미적용이면 빈 객체.
async function trackNameMap(trackIds) {
  const ids = [...new Set((trackIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('tracks').select('id, name').in('id', ids);
  if (error) {
    if (isSchemaMissing(error)) return {};
    throw error;
  }
  const map = {};
  (data || []).forEach((t) => { map[t.id] = t.name; });
  return map;
}

// 파일명 안전 처리 (공백/특수문자 → _)
const safeFileName = (s) =>
  (s || '').toString().trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || 'untitled';

const yyyymmdd = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
};

// ============================================================
// 📊 통계 헬퍼
// ============================================================
const computeSessionStats = (questions) => ({
  total: questions.length,
  pending: questions.filter((q) => !q.is_answered && !q.is_hidden).length,
  answered: questions.filter((q) => q.is_answered && !q.is_hidden).length,
  hidden: questions.filter((q) => q.is_hidden).length,
});

// ============================================================
// 🛣️ 라우트: 프로젝트 (콘솔)
// ============================================================

// GET /api/admin/projects — 목록 + 프로젝트별 sessionCount, questionCount, status
app.get('/api/admin/projects', requireConsole, wrap(async (req, res) => {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const list = projects || [];

  // 세션/질문 카운트를 한 번에 조회
  const { data: sessions, error: sErr } = await supabase
    .from('sessions')
    .select('id, project_id');
  if (sErr) throw sErr;

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, session_id');
  if (qErr) throw qErr;

  // session_id → project_id 매핑
  const sessByProject = {};
  const projBySession = {};
  (sessions || []).forEach((s) => {
    sessByProject[s.project_id] = (sessByProject[s.project_id] || 0) + 1;
    projBySession[s.id] = s.project_id;
  });
  const questByProject = {};
  (questions || []).forEach((q) => {
    const pid = projBySession[q.session_id];
    if (pid) questByProject[pid] = (questByProject[pid] || 0) + 1;
  });

  const result = list.map((row) => ({
    ...mapProjectRow(row),
    sessionCount: sessByProject[row.id] || 0,
    questionCount: questByProject[row.id] || 0,
  }));

  res.json({ success: true, data: result });
}));

// POST /api/admin/projects — 생성
app.post('/api/admin/projects', requireConsole, wrap(async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: '프로젝트명을 입력해 주세요.' });
  }
  const insert = {
    title: name,
    client_name: (b.client || '').trim() || null,
    description: (b.description || '').trim() || null,
    start_date: b.start_date || null,
    end_date: b.end_date || null,
    status: b.status || '준비중',
  };
  // 짧은 코드 발급(유니크 충돌 시 재시도). SQL 미실행이면 null → code 없이 생성.
  const code = await generateUniqueCode('projects');
  if (code) insert.code = code;
  const { data, error } = await supabase
    .from('projects').insert(insert).select().single();
  if (error) throw error;
  res.status(201).json({ success: true, data: mapProjectRow(data) });
}));

// GET /api/admin/projects/:id
app.get('/api/admin/projects/:id', requireConsole, wrap(async (req, res) => {
  const { data, error } = await supabase
    .from('projects').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });
  res.json({ success: true, data: mapProjectRow(data) });
}));

// PATCH /api/admin/projects/:id — 수정
app.patch('/api/admin/projects/:id', requireConsole, wrap(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  if (b.name !== undefined) {
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '프로젝트명을 입력해 주세요.' });
    fields.title = name;
  }
  if (b.client !== undefined) fields.client_name = (b.client || '').trim() || null;
  if (b.description !== undefined) fields.description = (b.description || '').trim() || null;
  if (b.start_date !== undefined) fields.start_date = b.start_date || null;
  if (b.end_date !== undefined) fields.end_date = b.end_date || null;
  if (b.status !== undefined) fields.status = b.status || '준비중';

  const { data, error } = await supabase
    .from('projects').update(fields).eq('id', req.params.id).select().maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });
  res.json({ success: true, data: mapProjectRow(data) });
}));

// DELETE /api/admin/projects/:id — 삭제 (FK on delete cascade 로 하위 정리)
app.delete('/api/admin/projects/:id', requireConsole, wrap(async (req, res) => {
  // 삭제 전 하위 카운트 집계 (응답 메시지용)
  const { data: sessions } = await supabase
    .from('sessions').select('id').eq('project_id', req.params.id);
  const sessionIds = (sessions || []).map((s) => s.id);
  let removedQuestions = 0;
  if (sessionIds.length) {
    const { count } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .in('session_id', sessionIds);
    removedQuestions = count || 0;
  }

  const { data, error } = await supabase
    .from('projects').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });

  res.json({
    success: true,
    data: { removedSessions: sessionIds.length, removedQuestions },
  });
}));

// ============================================================
// 🛣️ 라우트: 트랙 (콘솔)
// ------------------------------------------------------------
//  한 행사(project) 아래 멀티 트랙(최대 4개 등) 운영 지원.
//  트랙은 service_role 경유로만 접근(anon RLS 정책 없음).
//  add_tracks_speaker.sql 미실행이면 tracks 테이블이 없으므로(42P01)
//  GET 은 빈 배열, 쓰기 작업은 안내 메시지로 방어한다.
// ============================================================
const mapTrackRow = (row) => row ? ({
  id: row.id,
  project_id: row.project_id,
  name: row.name,
  sort_order: row.sort_order,
  created_at: row.created_at,
}) : null;

// 스키마 미적용(트랙 테이블 없음) 시 쓰기 요청에 대한 공통 안내
const TRACKS_SCHEMA_MSG = '트랙 기능을 사용하려면 add_tracks_speaker.sql 을 먼저 실행해 주세요.';

// GET /api/admin/projects/:projectId/tracks — 트랙 목록 [콘솔]
app.get('/api/admin/projects/:projectId/tracks', requireConsole, wrap(async (req, res) => {
  // projectId 는 code/uuid 모두 수용.
  const project = await resolveProject(req.params.projectId, 'id');
  if (!project) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });
  const list = await fetchTracksForProject(project.id);
  res.json({ success: true, data: list.map(mapTrackRow) });
}));

// POST /api/admin/projects/:projectId/tracks — body { name } 생성 [콘솔]
//  sort_order 는 현재 max+1.
app.post('/api/admin/projects/:projectId/tracks', requireConsole, wrap(async (req, res) => {
  const project = await resolveProject(req.params.projectId, 'id');
  if (!project) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });

  const name = ((req.body && req.body.name) || '').toString().trim();
  if (!name) return res.status(400).json({ success: false, message: '트랙 이름을 입력해 주세요.' });

  // 현재 max(sort_order) → +1
  const existing = await fetchTracksForProject(project.id);
  const maxSort = existing.reduce((m, t) => Math.max(m, t.sort_order || 0), 0);

  const { data, error } = await supabase
    .from('tracks')
    .insert({ project_id: project.id, name, sort_order: maxSort + 1 })
    .select('id, project_id, name, sort_order, created_at')
    .single();
  if (error) {
    if (isSchemaMissing(error)) {
      return res.status(400).json({ success: false, message: TRACKS_SCHEMA_MSG });
    }
    throw error;
  }
  res.status(201).json({ success: true, data: mapTrackRow(data) });
}));

// PATCH /api/admin/tracks/:id — 이름 수정 [콘솔]
app.patch('/api/admin/tracks/:id', requireConsole, wrap(async (req, res) => {
  const fields = {};
  if (req.body && req.body.name !== undefined) {
    const name = (req.body.name || '').toString().trim();
    if (!name) return res.status(400).json({ success: false, message: '트랙 이름을 입력해 주세요.' });
    fields.name = name;
  }
  if (req.body && req.body.sort_order !== undefined) {
    const n = parseInt(req.body.sort_order, 10);
    if (!Number.isNaN(n)) fields.sort_order = n;
  }
  if (!Object.keys(fields).length) {
    return res.status(400).json({ success: false, message: '수정할 내용이 없습니다.' });
  }
  const { data, error } = await supabase
    .from('tracks').update(fields).eq('id', req.params.id)
    .select('id, project_id, name, sort_order, created_at').maybeSingle();
  if (error) {
    if (isSchemaMissing(error)) {
      return res.status(400).json({ success: false, message: TRACKS_SCHEMA_MSG });
    }
    throw error;
  }
  if (!data) return res.status(404).json({ success: false, message: '트랙을 찾을 수 없습니다.' });
  res.json({ success: true, data: mapTrackRow(data) });
}));

// DELETE /api/admin/tracks/:id — 삭제 [콘솔]
//  세션의 track_id 는 FK on delete set null 로 자동 비워짐.
app.delete('/api/admin/tracks/:id', requireConsole, wrap(async (req, res) => {
  const { data, error } = await supabase
    .from('tracks').delete().eq('id', req.params.id)
    .select('id').maybeSingle();
  if (error) {
    if (isSchemaMissing(error)) {
      return res.status(400).json({ success: false, message: TRACKS_SCHEMA_MSG });
    }
    throw error;
  }
  if (!data) return res.status(404).json({ success: false, message: '트랙을 찾을 수 없습니다.' });
  res.json({ success: true, data: { id: data.id } });
}));

// ============================================================
// 🛣️ 라우트: 세션
// ============================================================

// GET /api/admin/projects/:projectId/sessions — 목록 + 세션별 통계 [콘솔]
app.get('/api/admin/projects/:projectId/sessions', requireConsole, wrap(async (req, res) => {
  const { projectId } = req.params;
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const list = sessions || [];
  const sessionIds = list.map((s) => s.id);

  let questions = [];
  if (sessionIds.length) {
    const { data: qs, error: qErr } = await supabase
      .from('questions')
      .select('id, session_id, is_answered, is_hidden')
      .in('session_id', sessionIds);
    if (qErr) throw qErr;
    questions = qs || [];
  }

  const bySession = {};
  questions.forEach((q) => {
    (bySession[q.session_id] = bySession[q.session_id] || []).push(q);
  });

  // 트랙 이름 매핑(스키마 미적용이면 빈 객체). row.track_id 는 select('*') 결과에 포함될 수 있음.
  const nameMap = await trackNameMap(list.map((s) => s.track_id));

  const result = list.map((row) => ({
    ...mapSessionRow({ ...row, track_name: nameMap[row.track_id] || '' }),
    stats: computeSessionStats(bySession[row.id] || []),
  }));

  res.json({ success: true, data: result });
}));

// POST /api/admin/projects/:projectId/sessions — 생성 (admin_token 은 DB default) [콘솔]
app.post('/api/admin/projects/:projectId/sessions', requireConsole, wrap(async (req, res) => {
  const { projectId } = req.params;
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: '세션명을 입력해 주세요.' });

  // 프로젝트 존재 확인
  const { data: proj } = await supabase
    .from('projects').select('id').eq('id', projectId).maybeSingle();
  if (!proj) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });

  const { starts_at, ends_at } = parseDuration(b.duration);
  const insert = {
    project_id: projectId,
    title: name,
    description: (b.description || '').trim() || null,
    starts_at,
    ends_at,
    is_public: b.is_public === undefined ? true : !!b.is_public,
    // admin_token 은 DB default(replace(gen_random_uuid()...)) 가 생성
  };
  // 트랙/강연자 (add_tracks_speaker.sql 적용 시). 미적용이면 아래 42703 폴백.
  const trackId = (b.track_id || '').toString().trim() || null;
  const speaker = (b.speaker || '').toString().trim() || null;
  insert.track_id = trackId;
  insert.speaker = speaker;

  // 짧은 코드 발급(유니크 충돌 시 재시도). SQL 미실행이면 null → code 없이 생성.
  const code = await generateUniqueCode('sessions');
  if (code) insert.code = code;

  // track_id/speaker 컬럼이 없으면(42703) 해당 키를 빼고 재시도 → 기존 기능 유지.
  let { data, error } = await supabase
    .from('sessions').insert(insert).select().single();
  if (error && isSchemaMissing(error)) {
    const { track_id, speaker: _sp, ...fallback } = insert;
    ({ data, error } = await supabase.from('sessions').insert(fallback).select().single());
  }
  if (error) throw error;

  const nameMap = await trackNameMap([data && data.track_id]);
  res.status(201).json({ success: true, data: mapSessionRow({ ...data, track_name: nameMap[data && data.track_id] || '' }) });
}));

// POST /api/admin/projects/:projectId/sessions/import — 엑셀 일괄 업로드 [콘솔]
//   body: { fileBase64, mode='replace', year }
//   컬럼(헤더 기준·유연 매칭): 날짜 / 시간 / 세션명 / 연사 / 세션룸 / 공개여부  ('트랙' 컬럼은 무시)
//    - '세션룸' → 트랙(룸)으로 매핑하고 세션을 해당 트랙에 배정.
//    - mode=replace: 대상 프로젝트의 기존 세션(+질문 cascade)·트랙을 지우고 새로 구성.
app.post('/api/admin/projects/:projectId/sessions/import', requireConsole, wrap(async (req, res) => {
  const project = await resolveProject(req.params.projectId, 'id, start_date');
  if (!project) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });

  const b = req.body || {};
  const b64 = (b.fileBase64 || '').toString();
  if (!b64) return res.status(400).json({ success: false, message: '엑셀 파일이 필요합니다.' });
  const mode = (b.mode || 'replace').toString();

  // 연도: body.year → 프로젝트 start_date 의 연도 → 현재 연도 순으로 결정.
  let year = parseInt(b.year, 10);
  if (!year && project.start_date) { const m = /(\d{4})/.exec(project.start_date); if (m) year = parseInt(m[1], 10); }
  if (!year) year = new Date().getFullYear();

  // base64(data URL 접두 허용) → 워크북
  let wb;
  try {
    const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64');
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
  } catch (e) {
    return res.status(400).json({ success: false, message: '엑셀 파일을 읽을 수 없습니다. (.xlsx 형식인지 확인해 주세요)' });
  }
  const ws = wb.worksheets.find((s) => /session|세션/i.test(s.name)) || wb.worksheets[0];
  if (!ws) return res.status(400).json({ success: false, message: '시트를 찾을 수 없습니다.' });

  // 셀 텍스트 추출(리치텍스트/하이퍼링크/수식 대응)
  const cellText = (cell) => {
    let v = cell && cell.value;
    if (v == null) return '';
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) v = v.richText.map((r) => r.text).join('');
      else if (v.text != null) v = v.text;
      else if (v.result != null) v = v.result;
      else if (v.hyperlink != null) v = v.text || v.hyperlink;
      else v = '';
    }
    return v.toString().trim();
  };

  // 헤더(1행) → 컬럼 인덱스 매핑(공백 제거 후 alias 포함매칭)
  const header = ws.getRow(1);
  const colOf = (aliases) => {
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = cellText(header.getCell(c)).replace(/\s+/g, '');
      if (h && aliases.some((a) => h === a || h.includes(a))) return c;
    }
    return 0;
  };
  const cName = colOf(['세션명', '세션', '제목', 'title', 'name']);
  if (!cName) return res.status(400).json({ success: false, message: "헤더에서 '세션명' 컬럼을 찾지 못했습니다. 첫 행에 컬럼명이 있는지 확인해 주세요." });
  const cDate = colOf(['날짜', '일자', 'date']);
  const cTime = colOf(['시간', 'time']);
  const cSpeaker = colOf(['연사', '강연자', 'speaker']);
  const cRoom = colOf(['세션룸', '룸', 'room', '장소', '홀']);
  const cPublic = colOf(['공개여부', '공개', 'public', '노출']);

  // 데이터 행 파싱(빈 구분행/세션명 없는 행 스킵)
  const rows = [];
  const roomOrder = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const g = (c) => (c ? cellText(row.getCell(c)) : '');
    const name = g(cName);
    const room = g(cRoom);
    const dateStr = g(cDate);
    if (!name && !room && !dateStr) continue; // 빈 구분행
    if (!name) continue;                       // 세션명 없으면 스킵
    const publicText = g(cPublic);
    // '비공개' 는 '공개' 를 부분포함하므로 명시적으로 배제.
    const is_public = /공개/.test(publicText) && !/비공개/.test(publicText);
    rows.push({ name, room, speaker: g(cSpeaker), dateStr, timeStr: g(cTime), is_public });
    if (room && !roomOrder.includes(room)) roomOrder.push(room);
  }
  if (!rows.length) return res.status(400).json({ success: false, message: '등록할 세션 데이터가 없습니다.' });

  // replace: 기존 세션(질문 cascade)·트랙 삭제
  if (mode === 'replace') {
    const delS = await supabase.from('sessions').delete().eq('project_id', project.id);
    if (delS.error) throw delS.error;
    const delT = await supabase.from('tracks').delete().eq('project_id', project.id);
    if (delT.error && !isSchemaMissing(delT.error)) throw delT.error;
  }

  // 룸 → 트랙 생성(등장 순서대로 sort_order). tracks 스키마 미적용이면 트랙 없이 진행.
  const roomToTrack = {};
  let tracksApplied = true;
  for (let i = 0; i < roomOrder.length; i++) {
    const { data, error } = await supabase.from('tracks')
      .insert({ project_id: project.id, name: roomOrder[i], sort_order: i + 1 })
      .select('id').single();
    if (error) {
      if (isSchemaMissing(error)) { tracksApplied = false; break; }
      throw error;
    }
    roomToTrack[roomOrder[i]] = data.id;
  }

  // 세션 삽입 — 배치 내 코드 충돌 방지용 로컬 Set.
  const usedCodes = new Set();
  const nextCode = async () => {
    for (let i = 0; i < 10; i++) {
      const code = await generateUniqueCode('sessions');
      if (code === null) return null;               // code 컬럼 없음(SQL 미적용)
      if (!usedCodes.has(code)) { usedCodes.add(code); return code; }
    }
    return null;
  };

  let created = 0; const failed = [];
  const byDate = {}, byRoom = {};
  for (const e of rows) {
    const { starts_at, ends_at } = parseKoreanDateTime(e.dateStr, e.timeStr, year);
    const insert = {
      project_id: project.id,
      title: e.name,
      description: null,
      speaker: e.speaker || null,
      is_public: e.is_public,
      starts_at, ends_at,
    };
    if (tracksApplied && e.room && roomToTrack[e.room]) insert.track_id = roomToTrack[e.room];
    const code = await nextCode();
    if (code) insert.code = code;

    let { error } = await supabase.from('sessions').insert(insert);
    if (error && isSchemaMissing(error)) {
      const { track_id, speaker, code: _c, ...fb } = insert;
      ({ error } = await supabase.from('sessions').insert(fb));
    }
    if (error) { failed.push({ name: e.name, message: error.message }); continue; }
    created++;
    const dkey = fmtDate(starts_at) || '(날짜없음)';
    byDate[dkey] = (byDate[dkey] || 0) + 1;
    const rkey = e.room || '(룸없음)';
    byRoom[rkey] = (byRoom[rkey] || 0) + 1;
  }

  res.json({ success: true, data: {
    mode, project_id: project.id, year,
    created, failedCount: failed.length, failed: failed.slice(0, 10),
    rooms: roomOrder.map((n) => ({ name: n, count: byRoom[n] || 0 })),
    dates: Object.keys(byDate).sort().map((d) => ({ date: d, count: byDate[d] })),
    tracksApplied,
  } });
}));

// GET /api/admin/sessions/:sessionId — 세션 단건 조회 [세션admin]
//   공개/비공개 무관하게 service_role 로 조회 → 앱 객체 형태로 반환.
//   관리자 대시보드 메타(제목 등) 로드용. (anon RLS 우회)
app.get('/api/admin/sessions/:sessionId', wrap(async (req, res) => {
  // code 또는 uuid → 실제 세션으로 해석. 없으면 404.
  const session = await resolveSession(req.params.sessionId);
  if (!session) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
  // 해석된 실제 id 로 권한 검증.
  const ok = await requireSessionAdmin(req, res, session.id);
  if (!ok) return;
  const nameMap = await trackNameMap([session.track_id]);
  res.json({ success: true, data: mapSessionRow({ ...session, track_name: nameMap[session.track_id] || '' }) });
}));

// PATCH /api/admin/sessions/:id — 수정 [세션admin]
app.patch('/api/admin/sessions/:id', wrap(async (req, res) => {
  const ok = await requireSessionAdmin(req, res, req.params.id);
  if (!ok) return;

  const b = req.body || {};
  const fields = {};
  if (b.name !== undefined) {
    const name = (b.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: '세션명을 입력해 주세요.' });
    fields.title = name;
  }
  if (b.description !== undefined) fields.description = (b.description || '').trim() || null;
  if (b.duration !== undefined) {
    const { starts_at, ends_at } = parseDuration(b.duration);
    fields.starts_at = starts_at;
    fields.ends_at = ends_at;
  }
  if (b.is_public !== undefined) fields.is_public = !!b.is_public;
  // 트랙/강연자 (add_tracks_speaker.sql 적용 시). 미적용이면 아래 42703 폴백.
  if (b.track_id !== undefined) fields.track_id = (b.track_id || '').toString().trim() || null;
  if (b.speaker !== undefined) fields.speaker = (b.speaker || '').toString().trim() || null;

  // track_id/speaker 컬럼이 없으면(42703) 해당 키를 빼고 재시도 → 기존 기능 유지.
  let { data, error } = await supabase
    .from('sessions').update(fields).eq('id', req.params.id).select().maybeSingle();
  if (error && isSchemaMissing(error)) {
    const { track_id, speaker, ...fallback } = fields;
    ({ data, error } = await supabase
      .from('sessions').update(fallback).eq('id', req.params.id).select().maybeSingle());
  }
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
  const nameMap = await trackNameMap([data.track_id]);
  res.json({ success: true, data: mapSessionRow({ ...data, track_name: nameMap[data.track_id] || '' }) });
}));

// DELETE /api/admin/sessions/:id — 삭제 [콘솔]
app.delete('/api/admin/sessions/:id', requireConsole, wrap(async (req, res) => {
  const { count } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', req.params.id);

  const { data, error } = await supabase
    .from('sessions').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });

  res.json({ success: true, data: { removedQuestions: count || 0 } });
}));

// ============================================================
// 🛣️ 라우트: 질문 (관리자, 숨김 포함)
// ============================================================

// GET /api/admin/sessions/:sessionId/questions — 세션 전체 질문(숨김 포함) [세션admin]
//   정렬: like_count desc, created_at asc
app.get('/api/admin/sessions/:sessionId/questions', wrap(async (req, res) => {
  // code 또는 uuid → 실제 세션으로 해석.
  const session = await resolveSession(req.params.sessionId);
  if (!session) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
  const sessionId = session.id;
  const ok = await requireSessionAdmin(req, res, sessionId);
  if (!ok) return;

  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('session_id', sessionId)
    .order('like_count', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  res.json({ success: true, data: (data || []).map(mapQuestionRow) });
}));

// 질문 id 로 세션 id 조회 (세션admin 검증용 헬퍼)
async function getQuestionSessionId(questionId) {
  const { data, error } = await supabase
    .from('questions').select('session_id').eq('id', questionId).maybeSingle();
  if (error) throw error;
  return data ? data.session_id : null;
}

// POST /api/admin/questions/:id/answered — body { value: boolean } [세션admin]
app.post('/api/admin/questions/:id/answered', wrap(async (req, res) => {
  const sessionId = await getQuestionSessionId(req.params.id);
  if (!sessionId) return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
  const ok = await requireSessionAdmin(req, res, sessionId);
  if (!ok) return;

  const value = !!(req.body && req.body.value);
  const { data, error } = await supabase
    .from('questions').update({ is_answered: value }).eq('id', req.params.id).select().maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
  res.json({ success: true, data: mapQuestionRow(data) });
}));

// POST /api/admin/questions/:id/hide — body { value: boolean } [세션admin]
app.post('/api/admin/questions/:id/hide', wrap(async (req, res) => {
  const sessionId = await getQuestionSessionId(req.params.id);
  if (!sessionId) return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
  const ok = await requireSessionAdmin(req, res, sessionId);
  if (!ok) return;

  const value = !!(req.body && req.body.value);
  const { data, error } = await supabase
    .from('questions').update({ is_hidden: value }).eq('id', req.params.id).select().maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
  res.json({ success: true, data: mapQuestionRow(data) });
}));

// DELETE /api/admin/questions/:id — 질문 영구 삭제 (votes 는 FK cascade) [세션admin]
app.delete('/api/admin/questions/:id', wrap(async (req, res) => {
  const sessionId = await getQuestionSessionId(req.params.id);
  if (!sessionId) return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
  const ok = await requireSessionAdmin(req, res, sessionId);
  if (!ok) return;

  const { data, error } = await supabase
    .from('questions').delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '질문을 찾을 수 없습니다.' });
  res.json({ success: true, data: { id: data.id } });
}));

// ============================================================
// 🛣️ 라우트: 금지어 관리 (콘솔)
// ------------------------------------------------------------
//  banned_words 테이블을 service_role 로 관리(RLS 우회).
//   - anon 은 select 만 가능(사용자 폼이 목록 가져와 사전 차단).
//   - 추가/삭제는 이 콘솔 라우트(requireConsole)로만.
//  questions 트리거(reject_banned_words)가 직접 insert/update 도 백스톱으로 막음.
// ============================================================

// GET /api/admin/banned-words — 전체 목록 (word 오름차순) [콘솔]
app.get('/api/admin/banned-words', requireConsole, wrap(async (_req, res) => {
  const { data, error } = await supabase
    .from('banned_words')
    .select('id, word, created_at')
    .order('word', { ascending: true });
  if (error) throw error;
  res.json({ success: true, data: data || [] });
}));

// POST /api/admin/banned-words — body { word } 추가 [콘솔]
//  trim, 빈값 거부, unique 충돌(이미 있음)이면 409 로 안내.
app.post('/api/admin/banned-words', requireConsole, wrap(async (req, res) => {
  const word = ((req.body && req.body.word) || '').toString().trim();
  if (!word) {
    return res.status(400).json({ success: false, message: '금지어를 입력해 주세요.' });
  }
  const { data, error } = await supabase
    .from('banned_words')
    .insert({ word })
    .select('id, word, created_at')
    .single();
  if (error) {
    // unique 위반(이미 등록된 금지어) → 409
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: '이미 등록된 금지어입니다.' });
    }
    throw error;
  }
  res.status(201).json({ success: true, data });
}));

// DELETE /api/admin/banned-words/:id — 삭제 [콘솔]
app.delete('/api/admin/banned-words/:id', requireConsole, wrap(async (req, res) => {
  const { data, error } = await supabase
    .from('banned_words')
    .delete()
    .eq('id', req.params.id)
    .select('id, word, created_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ success: false, message: '금지어를 찾을 수 없습니다.' });
  res.json({ success: true, data });
}));

// ============================================================
// 🛣️ 라우트: 공개 랜딩 (인증 불필요 — 행사 단일 QR → 세션 선택)
// ------------------------------------------------------------
//  행사(=프로젝트) 단위 단일 QR 이 가리키는 공개 랜딩 페이지용.
//  토큰 없이 service_role 로 조회하되 "공개 안전 데이터만" 반환한다.
//   - project: { id, title } (내부 정보 노출 금지)
//   - sessions: is_public=true 만, { id, title, description, starts_at, ends_at, questionCount }
//   - ⚠️ admin_token / client_name / status 등 민감·내부 필드는 절대 포함 금지.
// ============================================================

// 공개용 세션 매핑 — admin_token 등 민감 필드 제외. 프론트가 쓰기 좋은 앱 객체 형태.
const mapPublicSessionRow = (row) => ({
  id: row.id,
  code: row.code || '',                     // 짧은 코드 — 카드 탭 시 #/s/<code> 이동용
  title: row.title,
  description: row.description || '',
  speaker: row.speaker || '',               // 강연자 (공개 안전 필드)
  track_id: row.track_id || null,           // 트랙별 그룹핑용(프론트가 처리)
  starts_at: row.starts_at || null,
  ends_at: row.ends_at || null,
  session_date: fmtDate(row.starts_at),      // 'YYYY-MM-DD' (KST) — 멀티데이 그룹핑용
});

// GET /api/public/sessions/:codeOrId — 공개(무인증) 세션 단건
// ------------------------------------------------------------
//  사용자 페이지(#/s/:code | #/session/:id)가 세션 메타 + project_code 를 얻기 위해 호출.
//  공개(is_public=true) 세션만 반환. 비공개/없음 → 404.
//  단, 비공개 세션이라도 관리자 미리보기 토큰(?pv= 또는 ?token= = 세션 admin_token
//  또는 콘솔 토큰)이 맞으면 반환 — "사용자 화면 미리보기"가 비공개 세션에서도 동작하도록.
//  ⚠️ 공개 안전 필드만: admin_token / client_name / status 등 절대 금지.
app.get('/api/public/sessions/:codeOrId', wrap(async (req, res) => {
  const session = await resolveSession(req.params.codeOrId);
  const previewToken = ((req.query.pv || req.query.token) || '').toString().trim();
  const canView = !!session && (session.is_public === true || (
    previewToken && (
      previewToken === session.admin_token ||
      (ADMIN_CONSOLE_TOKEN && previewToken === ADMIN_CONSOLE_TOKEN)
    )
  ));
  if (!canView) {
    // 비공개 세션은 존재 여부도 숨김(무토큰/오답 → 동일 404)
    return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
  }
  // 소속 행사의 code 도 함께 반환(사용자 페이지 "전체 세션 보기" → 랜딩 이동용).
  let projectCode = '';
  if (session.project_id) {
    const { data: proj } = await supabase
      .from('projects').select('code').eq('id', session.project_id).maybeSingle();
    projectCode = (proj && proj.code) || '';
  }
  // 트랙 이름(공개 안전). 스키마 미적용이거나 미지정이면 빈 문자열.
  const nameMap = await trackNameMap([session.track_id]);
  res.json({
    success: true,
    data: {
      id: session.id,
      code: session.code || '',
      title: session.title,
      description: session.description || '',
      speaker: session.speaker || '',
      track_id: session.track_id || null,
      track_name: nameMap[session.track_id] || '',
      starts_at: session.starts_at || null,
      ends_at: session.ends_at || null,
      is_public: session.is_public === true, // 미리보기 시 프론트가 '비공개' 배지 표시용
      project_id: session.project_id,
      project_code: projectCode,
    },
  });
}));

// GET /api/public/projects/:projectId/landing — 공개(토큰 불필요)
//   프로젝트 없음 → 404. 공개 세션 0개면 빈 배열(200).
app.get('/api/public/projects/:projectId/landing', wrap(async (req, res) => {
  // code 또는 uuid → 실제 프로젝트로 해석. 공개 안전 필드(id, title, code)만 선택.
  const project = await resolveProject(req.params.projectId, 'id, title, code');
  if (!project) {
    return res.status(404).json({ success: false, message: '행사를 찾을 수 없습니다.' });
  }
  const projectId = project.id;

  // 공개 세션만 — admin_token 은 select 에서 아예 제외(노출 차단). code 는 카드 링크용.
  //  SQL 미실행으로 일부 컬럼이 없으면(42703) 점진적으로 컬럼을 줄여 재시도(하위호환).
  //   1) code + track_id/speaker 모두 → 2) code 제외(짧은코드 미적용) →
  //   3) track_id/speaker 제외(트랙 미적용) → 4) 둘 다 제외.
  const selectSessions = (cols) => supabase
    .from('sessions')
    .select(cols)
    .eq('project_id', projectId)
    .eq('is_public', true)
    .order('starts_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });
  const baseCols = 'id, title, description, starts_at, ends_at, created_at';
  const candidates = [
    `id, code, ${baseCols.replace('id, ', '')}, track_id, speaker`,
    `${baseCols}, track_id, speaker`,
    `id, code, ${baseCols.replace('id, ', '')}`,
    baseCols,
  ];
  let sessions = null, sErr = null;
  for (const cols of candidates) {
    ({ data: sessions, error: sErr } = await selectSessions(cols));
    if (!sErr) break;
    if (!isSchemaMissing(sErr)) break; // 스키마 외 오류면 즉시 중단
  }
  if (sErr) throw sErr;

  const list = sessions || [];
  const sessionIds = list.map((s) => s.id);

  // 숨김 제외 질문 수(questionCount) 집계
  const countMap = {};
  if (sessionIds.length) {
    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('session_id')
      .in('session_id', sessionIds)
      .eq('is_hidden', false);
    if (qErr) throw qErr;
    (questions || []).forEach((q) => {
      countMap[q.session_id] = (countMap[q.session_id] || 0) + 1;
    });
  }

  // 프로젝트의 트랙 목록(공개 안전 필드만). 스키마 미적용이면 빈 배열.
  const tracks = await fetchTracksForProject(projectId);

  const result = {
    project: { id: project.id, title: project.title, code: project.code || '' },
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, sort_order: t.sort_order })),
    sessions: list.map((row) => ({
      ...mapPublicSessionRow(row),
      questionCount: countMap[row.id] || 0,
    })),
  };

  res.json({ success: true, data: result });
}));

// ============================================================
// 🛣️ 라우트: 엑셀 (exceljs)
// ============================================================
const EXCEL_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const EXCEL_COLUMNS = [
  { header: 'project_title', key: 'project_title', width: 28 },
  { header: 'session_title', key: 'session_title', width: 24 },
  { header: 'question_id', key: 'question_id', width: 38 },
  { header: 'author', key: 'author', width: 14 },
  { header: 'title', key: 'title', width: 36 },
  { header: 'content', key: 'content', width: 50 },
  { header: 'like_count', key: 'like_count', width: 10 },
  { header: 'is_answered', key: 'is_answered', width: 12 },
  { header: 'is_hidden', key: 'is_hidden', width: 10 },
  { header: 'created_at', key: 'created_at', width: 22 },
  { header: 'answered_status', key: 'answered_status', width: 14 },
  { header: 'exported_at', key: 'exported_at', width: 22 },
];

const answeredStatus = (q) => {
  if (q.is_hidden) return '숨김';
  return q.is_answered ? '답변완료' : '답변대기';
};

const buildWorkbook = async (rows, projectTitle, sessionTitleMap) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Event Q&A Admin';
  const ws = wb.addWorksheet('Q&A');
  ws.columns = EXCEL_COLUMNS;
  ws.getRow(1).font = { bold: true };
  const exportedAt = new Date().toISOString();

  rows.forEach((q) => {
    ws.addRow({
      project_title: projectTitle,
      session_title: sessionTitleMap[q.session_id] || '',
      question_id: q.id,
      author: q.author,
      title: q.title,
      content: q.content,
      like_count: q.like_count,
      is_answered: q.is_answered,
      is_hidden: q.is_hidden,
      created_at: q.created_at,
      answered_status: answeredStatus(q),
      exported_at: exportedAt,
    });
  });
  return wb;
};

const sendWorkbook = async (res, wb, fileName) => {
  res.setHeader('Content-Type', EXCEL_CONTENT_TYPE);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  await wb.xlsx.write(res);
  res.end();
};

// GET /api/admin/sessions/:sessionId/questions/export?token=... [세션admin]
//   정렬: like_count desc, created_at asc
app.get('/api/admin/sessions/:sessionId/questions/export', wrap(async (req, res) => {
  // code 또는 uuid → 실제 세션으로 해석.
  const session = await resolveSession(req.params.sessionId);
  if (!session) return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
  const sessionId = session.id;
  const ok = await requireSessionAdmin(req, res, sessionId);
  if (!ok) return;

  const { data: project } = await supabase
    .from('projects').select('title').eq('id', session.project_id).maybeSingle();
  const projectTitle = project ? project.title : '';

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .eq('session_id', sessionId)
    .order('like_count', { ascending: false })
    .order('created_at', { ascending: true });
  if (qErr) throw qErr;

  const sessionTitleMap = { [sessionId]: session.title };
  const wb = await buildWorkbook(questions || [], projectTitle, sessionTitleMap);

  const fileName = `${safeFileName(projectTitle)}_${safeFileName(session.title)}_QA_${yyyymmdd()}.xlsx`;
  await sendWorkbook(res, wb, fileName);
}));

// GET /api/admin/projects/:projectId/questions/export?token=... [콘솔]
//   정렬: session_title asc, like_count desc, created_at asc
app.get('/api/admin/projects/:projectId/questions/export', requireConsole, wrap(async (req, res) => {
  const { projectId } = req.params;

  const { data: project, error: pErr } = await supabase
    .from('projects').select('*').eq('id', projectId).maybeSingle();
  if (pErr) throw pErr;
  if (!project) return res.status(404).json({ success: false, message: '프로젝트를 찾을 수 없습니다.' });

  const { data: sessions, error: sErr } = await supabase
    .from('sessions').select('id, title').eq('project_id', projectId);
  if (sErr) throw sErr;

  const sessionTitleMap = {};
  (sessions || []).forEach((s) => { sessionTitleMap[s.id] = s.title; });
  const sessionIds = (sessions || []).map((s) => s.id);

  let questions = [];
  if (sessionIds.length) {
    const { data: qs, error: qErr } = await supabase
      .from('questions')
      .select('*')
      .in('session_id', sessionIds);
    if (qErr) throw qErr;
    questions = qs || [];
  }

  // 정렬: session_title asc, like_count desc, created_at asc
  questions.sort((a, b) => {
    const ta = sessionTitleMap[a.session_id] || '';
    const tb = sessionTitleMap[b.session_id] || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.like_count !== b.like_count) return b.like_count - a.like_count;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const wb = await buildWorkbook(questions, project.title, sessionTitleMap);
  const fileName = `${safeFileName(project.title)}_QA_${yyyymmdd()}.xlsx`;
  await sendWorkbook(res, wb, fileName);
}));

// ============================================================
// 정적 라우트 & 에러 핸들링
// ============================================================
// API 미정의 경로 → JSON 404 (catch-all 보다 먼저)
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: '존재하지 않는 API 경로입니다.' });
});

// 그 외 모든 비-API GET 경로 → index.html (SPA, hash 라우팅)
// 실제 파일 경로 매핑이 아니라 항상 index.html 을 내보내므로 민감 파일 노출 없음.
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 전역 에러 핸들러 (JSON)
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 서버 기동 (로컬) / export (서버리스)
// ============================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] Event Q&A admin server running on http://localhost:${PORT}`);
  });
}
module.exports = app;
