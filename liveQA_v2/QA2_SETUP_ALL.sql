-- ================================================================================
-- 실시간 행사 Q&A 솔루션 QA2 — 전체 스키마 일괄 설치 스크립트
-- --------------------------------------------------------------------------------
--  ⚠️ **새로 만든 빈 Supabase 프로젝트**에서 한 번만 실행하세요.
--     Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--
--  개별 SQL 파일 13개를 의존성 순서대로 이어 붙인 것입니다.
--  모든 문장이 멱등(if not exists / or replace)이라 두 번 실행해도 깨지지 않지만,
--  fix_admin_token_exposure 구간이 admin_token 을 전부 재발급하므로
--  이미 배포한 연사/스피커 링크가 있다면 다시 실행하지 마세요.
--
--  실행 후 마지막 확인 쿼리가 테이블 목록을 보여줍니다.
-- ================================================================================



-- ################################################################################
-- [01/13] supabase_schema.sql
--        기본 스키마 (projects/sessions/questions/votes + RLS + like_question RPC)
-- ################################################################################

-- ============================================================
-- 실시간 행사 Q&A 솔루션 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 전체 붙여넣고 [Run]
-- (PRD: realtime_event_qna_prd_supabase_mvp_v2.md 6~8장 기준)
-- ============================================================

-- 1) 테이블 ----------------------------------------------------

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title varchar(255) not null,
  client_name varchar(255),
  description text,
  start_date date,
  end_date date,
  -- UI 라벨과 1:1 매칭(내부 도구라 한글 그대로 저장): 준비중 / 진행중 / 종료
  status varchar(20) not null default '준비중',
  created_at timestamptz default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title varchar(255) not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_public boolean not null default true,
  -- 관리자 접근용 랜덤 토큰(자동 생성). 하이픈 제거한 uuid.
  admin_token text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  title varchar(50) not null,
  content text not null,
  -- 이름 필수 정책: default '익명' 제거하고 not null 로 강제
  author varchar(20) not null,
  like_count int not null default 0,
  is_answered boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  voter_key text not null,
  created_at timestamptz default now(),
  unique (question_id, voter_key)
);

-- 2) 인덱스 ----------------------------------------------------

create index if not exists idx_sessions_project
  on sessions (project_id, created_at asc);

create index if not exists idx_questions_session_sort
  on questions (session_id, is_hidden, like_count desc, created_at asc);

create index if not exists idx_votes_question_voter
  on votes (question_id, voter_key);

-- 3) 좋아요 RPC (원자적 처리 + 중복 방지) -----------------------

create or replace function like_question(
  p_question_id uuid,
  p_voter_key text
)
returns json
language plpgsql
security definer
as $$
declare
  inserted_count int;
  new_like_count int;
begin
  insert into votes (question_id, voter_key)
  values (p_question_id, p_voter_key)
  on conflict (question_id, voter_key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update questions
    set like_count = like_count + 1
    where id = p_question_id
    returning like_count into new_like_count;

    return json_build_object('success', true, 'liked', true, 'like_count', new_like_count);
  else
    select like_count into new_like_count from questions where id = p_question_id;
    return json_build_object('success', true, 'liked', false, 'reason', 'already_voted', 'like_count', new_like_count);
  end if;
end;
$$;

-- anon 키로 RPC 호출 허용
grant execute on function like_question(uuid, text) to anon;

-- 4) RLS 정책 -------------------------------------------------
-- 전략: 공개(사용자) 경로만 anon 키로 최소 허용.
--   관리자 경로(프로젝트/세션 생성·수정·삭제, 답변/숨김, 숨김질문 열람, 엑셀)는
--   server.js 가 service_role 키로 처리(RLS 우회) + admin_token 검증.

alter table projects  enable row level security;
alter table sessions  enable row level security;
alter table questions enable row level security;
alter table votes     enable row level security;

-- sessions: 공개 세션만 읽기 (사용자 페이지 진입용)
drop policy if exists sessions_public_read on sessions;
create policy sessions_public_read on sessions
  for select to anon
  using (is_public = true);

-- questions: 숨김이 아닌 질문만 읽기 (사용자 페이지 목록)
drop policy if exists questions_public_read on questions;
create policy questions_public_read on questions
  for select to anon
  using (is_hidden = false);

-- questions: 익명 사용자 질문 등록 허용 (등록 직후엔 숨김 아님)
drop policy if exists questions_public_insert on questions;
create policy questions_public_insert on questions
  for insert to anon
  with check (is_hidden = false and is_answered = false);

-- votes / projects: anon 직접 접근 정책 없음(= 차단). votes 는 위 RPC(security definer)로만.
-- projects 는 server.js(service_role) 로만 접근.

-- 5) Realtime (관리자 대시보드 변경 감지용) ---------------------
-- questions 테이블 변경을 Realtime publication 에 포함
alter publication supabase_realtime add table questions;

-- 끝.

-- ################################################################################
-- [02/13] banned_words.sql
--        금지어 사전 + questions 트리거
-- ################################################################################

-- ============================================================
-- 금지어 필터 — banned_words 테이블 + 기본 목록 + DB 차단 트리거
-- SQL Editor 에 붙여넣고 Run. (스키마 먼저 실행돼 있어야 함)
-- ============================================================

-- 1) 테이블 --------------------------------------------------
create table if not exists banned_words (
  id uuid primary key default gen_random_uuid(),
  word text not null unique,
  created_at timestamptz default now()
);

-- 2) RLS: anon 은 읽기만(사용자 폼이 목록 가져와 사전 차단). 추가/삭제는 server.js(service_role)만.
alter table banned_words enable row level security;
drop policy if exists banned_words_public_read on banned_words;
create policy banned_words_public_read on banned_words
  for select to anon using (true);

-- 3) 기본 금지어 목록(운영자가 콘솔에서 추가/삭제 가능) -----------
insert into banned_words (word) values
  ('씨발'),('시발'),('씨발년'),('씨발놈'),('개새끼'),('새끼'),('병신'),('지랄'),
  ('좆'),('좇'),('니미'),('엿먹어'),('썅'),('미친놈'),('미친년'),('등신'),
  ('멍청이'),('닥쳐'),('꺼져'),('호로'),('창녀'),('걸레'),('느금마')
on conflict (word) do nothing;

-- 4) DB 차단 트리거(클라이언트 우회 방지: 직접 insert 도 막음) -------
create or replace function reject_banned_words()
returns trigger
language plpgsql
security definer
as $$
declare
  bw text;
  haystack text;
begin
  -- 제목/본문/작성자명을 합쳐 소문자로(영문 대비) 검사
  haystack := lower(coalesce(new.title,'') || ' ' || coalesce(new.content,'') || ' ' || coalesce(new.author,''));
  for bw in select word from banned_words loop
    if position(lower(bw) in haystack) > 0 then
      raise exception 'BANNED_WORD: %', bw using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_reject_banned_words on questions;
create trigger trg_reject_banned_words
  before insert or update on questions
  for each row execute function reject_banned_words();

-- 끝.

-- ################################################################################
-- [03/13] add_tracks_speaker.sql
--        트랙(룸) 테이블 + sessions.track_id / speaker
-- ################################################################################

-- ============================================================
-- 트랙(Track) + 강연자(speaker) 추가
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--  - 한 행사(project) 아래 여러 트랙(최대 4개 등) 운영 지원
--  - 세션은 트랙에 소속(track_id), 세션 폼의 '설명' 대신 '강연자'(speaker) 사용
-- ============================================================

-- 1) 트랙 테이블 (프로젝트 하위)
create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name varchar(100) not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists idx_tracks_project on tracks(project_id, sort_order, created_at);

-- 트랙은 server.js(service_role) 경유로만 접근(랜딩 그룹핑/관리). anon 직접 정책 없음.
alter table tracks enable row level security;

-- 2) 세션: 트랙 소속 + 강연자
alter table sessions add column if not exists track_id uuid references tracks(id) on delete set null;
alter table sessions add column if not exists speaker varchar(100);
create index if not exists idx_sessions_track on sessions(track_id);

-- 확인용:
-- select id, name, sort_order from tracks order by sort_order;
-- select title, track_id, speaker from sessions;

-- ################################################################################
-- [04/13] add_short_codes.sql
--        짧은 코드 (projects.code / sessions.code)
-- ################################################################################

-- ============================================================
-- 짧은 코드(short code) 추가 — projects / sessions
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
-- URL 의 긴 UUID 대신 6자리 코드로 접근하기 위함.
-- ============================================================

-- 1) 코드 컬럼 추가
alter table projects add column if not exists code text;
alter table sessions add column if not exists code text;

-- 2) 기존 행 백필 (6자리 hex, 소문자). 몇 개 안 되므로 충돌 사실상 없음.
update projects
  set code = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 6)
  where code is null;
update sessions
  set code = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 6)
  where code is null;

-- 3) 유니크 인덱스
create unique index if not exists idx_projects_code on projects(code);
create unique index if not exists idx_sessions_code on sessions(code);

-- 4) anon 이 code 로 공개 세션을 조회할 수 있어야 함(이미 sessions select 정책 있음).
--    projects 는 anon 직접 조회 불가 → 랜딩은 server.js 공개 엔드포인트가 code 로 해석.

-- 확인용:
-- select id, code, title from projects;
-- select id, code, title, is_public from sessions;

-- ################################################################################
-- [05/13] add_track_codes.sql
--        트랙 코드 (룸 QR 고정 주소용)
-- ################################################################################

-- ============================================================
-- 트랙(룸) 고정 코드 추가 — tracks.code
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--
-- 왜 필요한가:
--   룸 QR(#/r/<행사코드>/<룸번호>) 의 '룸번호' 가 여태 tracks.sort_order 였다.
--   순서는 관리자가 언제든 바꿀 수 있는 값이라, **QR 을 인쇄한 뒤 트랙 순서를
--   바꾸면 인쇄물이 다른 룸을 가리킨다.** 현장에서 되돌릴 수 없는 사고다.
--   트랙마다 바뀌지 않는 코드를 부여해 QR 이 트랙 자체를 가리키게 한다.
--
-- 하위호환:
--   이미 뽑아 둔 #/r/<행사코드>/1 같은 숫자 주소도 계속 동작한다.
--   서버가 "숫자면 sort_order, 아니면 code" 로 해석한다.
--   (다만 숫자 주소는 여전히 순서 변경에 취약하므로, 재인쇄 시 code 주소를 쓸 것)
-- ============================================================

-- 1) 코드 컬럼
alter table tracks add column if not exists code text;

-- 2) 기존 행 백필 — 4자리 hex 소문자. 룸 수가 적어 충돌은 사실상 없고,
--    현장에서 사람이 눈으로 확인하기 좋게 짧게 둔다.
update tracks
   set code = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 4)
 where code is null;

-- 3) 유니크 인덱스 (프로젝트 경계 없이 전역 유니크 — 주소에 행사코드가 이미 있지만
--    코드만으로도 추적 가능하게 두는 편이 운영 시 헷갈리지 않는다)
create unique index if not exists idx_tracks_code on tracks(code);

-- 4) 앞으로 만들어지는 트랙에도 자동 부여
alter table tracks
  alter column code set default substr(md5(random()::text || clock_timestamp()::text), 1, 4);

-- 5) tracks 는 anon 직접 조회 불가(RLS, 정책 없음) → 룸 조회는 server.js 공개
--    엔드포인트가 service_role 로 대신 읽는다. 별도 정책 추가 없음.

-- 확인용:
-- select id, code, name, sort_order from tracks order by sort_order;

-- ################################################################################
-- [06/13] add_translation.sql
--        번역 캐시 구버전 컬럼 (하위호환용 — 아래 다국어의 폴백)
-- ################################################################################

-- ============================================================
-- 질문 번역(Gemini) 결과 저장 컬럼 추가
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--  - 관리자 대시보드에서 [번역] 버튼을 누르면 Gemini 가 한국어로 번역하고
--    결과를 여기에 캐시한다. 재조회/다른 운영자도 재번역 없이 바로 본다.
--  - 컬럼이 없어도 server.js 는 "저장 없이 번역 결과만" 반환하도록 폴백한다.
-- ============================================================

alter table questions add column if not exists translated_title   text;
alter table questions add column if not exists translated_content text;
-- 원문 감지 언어 (ISO 639-1: en / ja / zh / ko ... 판별 불가 시 und)
alter table questions add column if not exists translated_lang    varchar(20);
alter table questions add column if not exists translated_at      timestamptz;

-- 확인용:
-- select id, title, translated_lang, translated_title, translated_at from questions
--   where translated_at is not null order by translated_at desc;

-- ################################################################################
-- [07/13] add_sheet_sync.sql
--        구글 시트 연동
-- ################################################################################

-- ============================================================
-- 외부 시트(구글 스프레드시트) 연동 — 세션 자동 동기화
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--  - projects 에 연결된 시트 URL / 자동 동기화 여부 / 마지막 결과를 보관
--  - sessions.source_key: 시트의 "행 정체성". 이 키로 기존 세션을 찾아
--    변경분만 UPDATE 한다. → 세션 URL(code)·admin_token·접수된 질문이 보존됨.
-- ============================================================

-- 1) 프로젝트: 시트 연결 정보
alter table projects add column if not exists sheet_url        text;
alter table projects add column if not exists sheet_auto_sync  boolean not null default false;
alter table projects add column if not exists sheet_synced_at  timestamptz;
-- 마지막 동기화 요약(추가/수정/삭제 건수 등). 관리자 화면 표시용.
alter table projects add column if not exists sheet_last_result jsonb;

-- 2) 세션: 시트 행 매칭 키
alter table sessions add column if not exists source_key text;
create index if not exists idx_sessions_source_key on sessions(project_id, source_key);

-- projects/sessions 는 server.js(service_role) 경유로만 쓰기 → 추가 RLS 정책 불필요.
-- (sessions_public_read 는 is_public 만 보므로 새 컬럼 영향 없음)

-- 확인용:
-- select id, title, sheet_url, sheet_auto_sync, sheet_synced_at from projects;
-- select title, source_key from sessions order by created_at;

-- ################################################################################
-- [08/13] add_session_qa_merge.sql
--        Q&A 통합 (두 룸 병행 세션)
-- ################################################################################

-- ============================================================
-- 세션 Q&A 통합 — sessions.qa_parent_id
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--
-- 왜 필요한가:
--   같은 강연을 두 룸에서 동시에 진행하는 경우가 있다(예: 2026-08-21 16:00 NTE
--   — Harmony Ballroom 1·2 병행). 룸마다 타임테이블이 필요하니 세션 레코드는
--   룸 수만큼 있어야 하는데, 그러면 **질문 목록과 좋아요가 룸별로 갈라진다.**
--   Ballroom 1 참가자와 Ballroom 2 참가자가 서로의 질문을 못 보고, 진행자가
--   한쪽만 보면 다른 룸 질문이 통째로 묻힌다.
--
-- 방식:
--   세션 레코드는 그대로 두고(타임테이블·룸 배치는 각자 유지),
--   **질문을 읽고 쓰는 대상만** 원본 세션 하나로 모은다.
--     Ballroom 2 세션.qa_parent_id → Ballroom 1 세션.id
--   참가자 화면은 세션 메타(제목·시간·룸)는 자기 것을 쓰고,
--   질문/좋아요는 원본 세션 것을 쓴다.
--
-- 설계 메모:
--   - 한 단계만 허용한다(원본이 또 다른 세션을 가리키지 않도록 서버가 막는다).
--     체인을 허용하면 순환 참조와 무한 해석이 생긴다.
--   - on delete set null: 원본 세션이 지워지면 미러는 자기 Q&A 로 되돌아간다
--     (질문이 통째로 사라지는 것보다 낫다).
--   - questions.session_id 자체는 건드리지 않는다. 통합은 '읽고 쓰는 대상'을
--     바꾸는 것이지 데이터를 옮기는 게 아니다 → 언제든 해제할 수 있다.
-- ============================================================

alter table sessions
  add column if not exists qa_parent_id uuid references sessions(id) on delete set null;

-- 미러 → 원본 조회 인덱스(원본 하나에 미러가 여럿 붙을 수 있다)
create index if not exists idx_sessions_qa_parent on sessions(qa_parent_id)
  where qa_parent_id is not null;

-- 자기 자신을 가리키지 못하게
alter table sessions drop constraint if exists sessions_qa_parent_not_self;
alter table sessions add constraint sessions_qa_parent_not_self
  check (qa_parent_id is null or qa_parent_id <> id);

-- anon 은 sessions 를 컬럼 화이트리스트로만 읽는다(fix_admin_token_exposure.sql).
--  qa_parent_id 는 화이트리스트에 넣지 않는다 — 참가자 경로는 서버가 해석해서
--  내려주므로 클라이언트가 이 컬럼을 직접 볼 필요가 없다.

-- 확인용:
-- select id, code, title, track_id, qa_parent_id from sessions where qa_parent_id is not null;

-- ################################################################################
-- [09/13] fix_admin_token_exposure.sql
--        🔴 admin_token 유출 차단 (컬럼 단위 권한) — code/speaker/track_id 이후에 실행해야 함
-- ################################################################################

-- ============================================================
-- 🔴 CRITICAL 패치 — anon 키로 sessions.admin_token 유출 차단
-- Supabase SQL Editor 에 붙여넣고 Run.
--
-- [문제]
--   sessions_public_read 정책은 "행(row)"만 is_public=true 로 제한한다.
--   Postgres RLS 는 컬럼 단위 제어를 하지 않으므로, 공개 세션이면
--   anon 키로 admin_token 까지 SELECT 할 수 있었다.
--     GET /rest/v1/sessions?select=id,admin_token&is_public=eq.true  → 평문 반환
--   유출된 토큰은 실제로 인가되어(세션 대시보드 200) 질문 삭제/숨김,
--   세션 수정·비공개화, Q&A 엑셀(PII) 유출까지 가능했다.
--
-- [왜 REVOKE SELECT (admin_token) 만으로는 안 되는가]
--   테이블 레벨 SELECT 권한이 남아 있으면 컬럼 레벨 REVOKE 는 효력이 없다.
--   따라서 테이블 권한을 먼저 회수하고, 안전한 컬럼만 다시 GRANT 한다.
--   (컬럼 목록 방식이라 앞으로 새 컬럼이 추가돼도 자동 노출되지 않는다.)
-- ============================================================

-- 1) sessions: 테이블 전체 SELECT 회수 → 안전 컬럼만 재부여
--    admin_token(비밀) 과 source_key(시트 내부 키) 는 제외한다.
revoke select on sessions from anon;
revoke select on sessions from authenticated;

grant select (
  id, project_id, title, description,
  starts_at, ends_at, is_public,
  code, speaker, track_id, created_at
) on sessions to anon;

grant select (
  id, project_id, title, description,
  starts_at, ends_at, is_public,
  code, speaker, track_id, created_at
) on sessions to authenticated;

-- 2) 노출된 admin_token 전량 로테이션
--    기존 토큰은 이미 공개적으로 조회 가능했으므로 전부 무효화한다.
--    ⚠️ 이미 배포한 연사 대시보드 링크(?token=...)는 모두 무효가 된다.
--       콘솔에서 새 링크를 다시 배포해야 한다. (세션 URL/code 는 그대로 유지)
update sessions
set admin_token = replace(gen_random_uuid()::text, '-', '');

-- ============================================================
-- 확인용 (SQL Editor 에서 실행하면 service_role 이라 다 보이는 게 정상.
--          실제 검증은 anon 키로 REST 호출해서 400 이 나오는지 봐야 한다.)
--
--   curl "$SUPABASE_URL/rest/v1/sessions?select=id,admin_token&is_public=eq.true" \
--     -H "apikey: $SUPABASE_ANON_KEY"
--   → 기대: 42501 permission denied for column admin_token (400)
--
--   curl "$SUPABASE_URL/rest/v1/sessions?select=id,title,code&is_public=eq.true" \
--     -H "apikey: $SUPABASE_ANON_KEY"
--   → 기대: 200 (공개 정보는 그대로 조회됨)
--
-- 컬럼 권한 확인:
--   select grantee, column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'sessions' and grantee in ('anon','authenticated')
--    order by grantee, column_name;
-- ============================================================

-- ################################################################################
-- [10/13] fix_high_findings.sql
--        보안 패치 (질문 길이 제한 · 도배 방지 · 좋아요 RPC 강화)
-- ################################################################################

-- ============================================================
-- 🟠 HIGH 3건 패치 — Supabase SQL Editor 에 붙여넣고 Run.
--   ① 좋아요 무한 투표(voter_key 클라이언트 생성) → 정렬 왜곡
--   ② 질문 insert 서버측 길이/횟수 제한 없음 → 수MB 도배 / DoS
--   ③ questions RLS 가 세션 is_public 미검사 → 비공개 세션 질문 read/write 여지
--
-- 설계 메모
--   - 참가자 IP 는 원문으로 저장하지 않고 md5 지문(fp)만 남긴다(개인정보 최소화).
--   - 질문 도배 카운터는 별도 테이블(post_throttle)에 둔다. questions 에 컬럼을
--     추가하면 관리자 API(`select('*')`)와 Q&A 엑셀에 그대로 섞여 나가기 때문.
--   - 행사장 공용 와이파이(NAT)면 수백 명이 같은 IP 다. 그래서 "IP 당 1표"가 아니라
--     "IP 당 속도"만 제한한다. 정상 관객은 통과, 스크립트 도배는 차단.
-- ============================================================

-- ------------------------------------------------------------
-- 0) 공통 헬퍼
-- ------------------------------------------------------------

-- 요청 IP 지문. PostgREST 가 넘겨주는 request.headers 에서 첫 홉만 사용.
--  헤더가 없으면(SQL Editor 등) 'unknown' → 제한을 적용하지 않는다.
create or replace function client_fp()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h json;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  if h is null then return 'unknown'; end if;

  ip := btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1));
  if ip = '' then ip := btrim(coalesce(h->>'cf-connecting-ip', '')); end if;
  if ip = '' then return 'unknown'; end if;

  return md5(ip);   -- 원문 IP 는 저장하지 않는다
end;
$$;

-- 세션 공개 여부. anon 은 이제 sessions 를 직접 못 읽으므로(CRITICAL 패치)
--  RLS 정책 안에서 쓰려면 security definer 함수로 감싸야 한다.
create or replace function session_is_public(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_public from sessions where id = p_session_id), false);
$$;

grant execute on function session_is_public(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- ③ questions RLS — 세션 공개 여부까지 검사
-- ------------------------------------------------------------
-- 읽기: 숨김 아님 + 소속 세션이 공개일 때만.
--  (비공개 세션 미리보기는 서버 /api/public/sessions/:id/questions?pv= 경로로 처리)
drop policy if exists questions_public_read on questions;
create policy questions_public_read on questions
  for select to anon
  using (is_hidden = false and session_is_public(session_id));

-- 등록: 공개 세션에만. 비공개 세션에 질문을 심는 경로를 막는다.
drop policy if exists questions_public_insert on questions;
create policy questions_public_insert on questions
  for insert to anon
  with check (
    is_hidden = false
    and is_answered = false
    and session_is_public(session_id)
  );

-- ------------------------------------------------------------
-- ② 질문 길이 제한 + 도배 제한
-- ------------------------------------------------------------
-- 길이: 클라이언트 폼 제한(제목 50 / 이름 20 / 내용 500)과 동일하게 DB 에서도 강제.
--  content 는 text 라 지금까지 무제한이었다.
alter table questions drop constraint if exists questions_title_len;
alter table questions add  constraint questions_title_len
  check (char_length(btrim(title)) between 1 and 50);

alter table questions drop constraint if exists questions_author_len;
alter table questions add  constraint questions_author_len
  check (char_length(btrim(author)) between 1 and 20);

alter table questions drop constraint if exists questions_content_len;
alter table questions add  constraint questions_content_len
  check (char_length(btrim(content)) between 1 and 500);

-- 도배: IP 지문당 60초 10건. 카운터는 questions 밖에 둔다.
create table if not exists post_throttle (
  id         bigserial primary key,
  fp         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_post_throttle_fp on post_throttle (fp, created_at desc);

alter table post_throttle enable row level security;
-- 정책 없음 = anon 직접 접근 차단. 아래 트리거(security definer)만 기록한다.

create or replace function questions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp     text;
  v_recent int;
begin
  -- 서버(service_role) 경유 쓰기는 제한 대상이 아니다. 브라우저 직접 insert 만 본다.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  v_fp := client_fp();
  if v_fp = 'unknown' then
    return new;
  end if;

  select count(*) into v_recent
    from post_throttle
   where fp = v_fp
     and created_at > now() - interval '60 seconds';

  if v_recent >= 10 then
    -- 금지어(BANNED_WORD)와 구분되는 메시지. 프론트가 이 문자열로 안내를 띄운다.
    raise exception 'QUESTION_RATE_LIMITED';
  end if;

  insert into post_throttle (fp) values (v_fp);
  -- 오래된 카운터 정리(테이블 무한 증가 방지)
  delete from post_throttle where created_at < now() - interval '1 hour';

  return new;
end;
$$;

drop trigger if exists trg_questions_rate_limit on questions;
create trigger trg_questions_rate_limit
  before insert on questions
  for each row execute function questions_rate_limit();

-- ------------------------------------------------------------
-- ① 좋아요 — voter_key 검증 + 대상 검증 + IP 속도 제한
-- ------------------------------------------------------------
alter table votes add column if not exists voter_fp text;
create index if not exists idx_votes_fp on votes (voter_fp, created_at desc);

create or replace function like_question(
  p_question_id uuid,
  p_voter_key   text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key    text := btrim(coalesce(p_voter_key, ''));
  v_fp     text;
  v_recent int;
  v_ok     boolean;
  v_likes  int;
  inserted_count int;
  new_like_count int;
begin
  -- 현재 좋아요 수는 어떤 분기로 끝나도 함께 돌려준다(프론트가 이 값으로 UI 를 맞춘다).
  select like_count into v_likes from questions where id = p_question_id;
  v_likes := coalesce(v_likes, 0);

  -- voter_key 형식 검증. 앱은 localStorage UUID(36자)를 보낸다.
  if char_length(v_key) < 8 or char_length(v_key) > 64 then
    return json_build_object('success', false, 'liked', false,
                             'reason', 'invalid_voter_key', 'like_count', v_likes);
  end if;

  -- 좋아요 대상이 참가자에게 실제로 보이는 질문인지 확인
  --  (숨김 질문 / 비공개 세션 질문에 표를 넣는 경로 차단)
  select (q.is_hidden = false and s.is_public = true)
    into v_ok
    from questions q
    join sessions s on s.id = q.session_id
   where q.id = p_question_id;

  if not coalesce(v_ok, false) then
    return json_build_object('success', false, 'liked', false,
                             'reason', 'not_likeable', 'like_count', v_likes);
  end if;

  -- 속도 제한: 같은 IP 지문에서 60초 60표 초과면 차단.
  --  NAT 로 관객 수백 명이 한 IP 인 상황을 감안해 상한을 넉넉히 두되,
  --  키를 새로 만들어 무한 연타하는 스크립트는 여기서 걸린다.
  v_fp := client_fp();
  if v_fp <> 'unknown' then
    select count(*) into v_recent
      from votes
     where voter_fp = v_fp
       and created_at > now() - interval '60 seconds';

    if v_recent >= 60 then
      return json_build_object('success', false, 'liked', false,
                               'reason', 'rate_limited', 'like_count', v_likes);
    end if;
  end if;

  insert into votes (question_id, voter_key, voter_fp)
  values (p_question_id, v_key, v_fp)
  on conflict (question_id, voter_key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update questions
       set like_count = like_count + 1
     where id = p_question_id
    returning like_count into new_like_count;

    return json_build_object('success', true, 'liked', true, 'like_count', new_like_count);
  else
    select like_count into new_like_count from questions where id = p_question_id;
    return json_build_object('success', true, 'liked', false,
                             'reason', 'already_voted', 'like_count', coalesce(new_like_count, v_likes));
  end if;
end;
$$;

grant execute on function like_question(uuid, text) to anon;

-- ============================================================
-- 확인용 (anon 키로 REST 호출해서 확인해야 의미가 있다)
--
--  ③ 비공개 세션 질문 읽기 → 빈 배열이어야 정상
--     curl "$SUPABASE_URL/rest/v1/questions?select=id&session_id=eq.<비공개세션id>" \
--       -H "apikey: $SUPABASE_ANON_KEY"
--
--  ② 501자 내용 등록 → 23514 check 위반이어야 정상
--     curl -X POST "$SUPABASE_URL/rest/v1/questions" -H "apikey: $SUPABASE_ANON_KEY" \
--       -H "Content-Type: application/json" \
--       -d '{"session_id":"<공개세션id>","title":"t","author":"a","content":"'"$(python3 -c 'print("가"*501)')"'"}'
--
--  ① 새 voter_key 로 같은 질문 반복 좋아요 → 60표 근처에서 rate_limited
-- ============================================================

-- ################################################################################
-- [11/13] fix_question_rate_limit.sql
--        질문 도배 제한 최신판 (위 파일의 함수를 덮어씀 — 반드시 뒤에)
-- ################################################################################

-- ============================================================
-- 🐞 질문 도배 제한이 동작하지 않던 버그 수정
-- Supabase SQL Editor 에 붙여넣고 Run.
--
-- 증상 (2026-07-30 부하 테스트에서 발견):
--   anon 으로 질문을 20건 연속 등록해도 전부 통과하고, post_throttle 에
--   기록이 한 건도 남지 않았다. 즉 "60초 10건" 제한이 처음부터 무효였다.
--
-- 원인:
--   questions_rate_limit() 는 security definer 함수인데, 그 안에서
--     if current_user not in ('anon','authenticated') then return new; end if;
--   로 호출자를 판별했다. **security definer 함수 안의 current_user 는
--   호출자가 아니라 함수 소유자(postgres/supabase_admin)** 라서 이 조건이
--   항상 참이 되고, 트리거는 매번 곧바로 return new 로 빠져나갔다.
--   → 같은 파일의 like_question() 은 이 가드가 없어서 정상 동작했다.
--     (좋아요 60표 제한은 실제로 61번째에서 차단되는 것을 확인)
--
-- 수정:
--   PostgREST 는 요청마다 JWT 에 맞춰 SET LOCAL ROLE 을 건다. security definer
--   진입은 current_user 만 바꾸고 `role` GUC 는 그대로 두므로, 이 값으로 판별한다.
--     anon 키        → 'anon'
--     service_role   → 'service_role'   (서버 경유 → 제한 대상 아님)
--     SQL Editor 등  → 'none'           (제한 대상 아님)
-- ============================================================

create or replace function questions_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_fp     text;
  v_recent int;
begin
  -- ⚠️ current_user 를 쓰면 안 된다(= 함수 소유자). SET LOCAL ROLE 로 잡히는 role GUC 를 본다.
  v_role := coalesce(current_setting('role', true), 'none');
  if v_role not in ('anon', 'authenticated') then
    return new;   -- 서버(service_role)·관리 도구 경유 쓰기는 제한하지 않는다
  end if;

  v_fp := client_fp();
  if v_fp = 'unknown' then
    return new;   -- IP 를 알 수 없으면(헤더 없음) 제한하지 않는다
  end if;

  select count(*) into v_recent
    from post_throttle
   where fp = v_fp
     and created_at > now() - interval '60 seconds';

  -- ⚠️ 한도를 10 → 60 으로 올렸다. 원래 값 10 은 "한 사람"을 가정한 숫자인데,
  --    이 제한은 IP 지문 단위이고 행사장 공용 와이파이는 NAT 라 **룸 전체가 한 IP** 다.
  --    60초 10건이면 관객 수백 명의 정상 질문이 막힌다(제한이 여태 무효였던 탓에
  --    지금까지 드러나지 않았을 뿐이다). 60건/분이면 스크립트 도배(초당 수십~수백 건)는
  --    여전히 막으면서 사람 손으로 쓰는 질문은 통과한다.
  if v_recent >= 60 then
    -- 금지어(BANNED_WORD)와 구분되는 메시지. 프론트가 이 문자열로 안내를 띄운다.
    raise exception 'QUESTION_RATE_LIMITED';
  end if;

  insert into post_throttle (fp) values (v_fp);
  delete from post_throttle where created_at < now() - interval '1 hour';

  return new;
end;
$$;

drop trigger if exists trg_questions_rate_limit on questions;
create trigger trg_questions_rate_limit
  before insert on questions
  for each row execute function questions_rate_limit();

-- ------------------------------------------------------------
-- 적용 확인
--   1) anon 키로 질문을 1건 등록한 뒤:
--        select count(*) from post_throttle;   -- 0 이 아니라 1 이상이어야 정상
--      (수정 전에는 여기가 계속 0 이었다 = 트리거가 아무 일도 안 하고 있었다는 뜻)
--   2) 60초 안에 61건을 넣으면 61번째가 QUESTION_RATE_LIMITED 로 막힌다.
-- ------------------------------------------------------------

-- ################################################################################
-- [12/13] add_multilang_translation.sql
--        ✨ QA2 신규 — 한/영/중/일 번역 캐시 (translations jsonb)
-- ################################################################################

-- ============================================================
-- 다국어 번역(한/영/중/일) 캐시 컬럼 추가  — QA2
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
-- 전제: supabase_schema.sql, add_translation.sql 을 먼저 실행해 둔 상태.
-- ------------------------------------------------------------
--  기존 add_translation.sql 은 "한국어 번역 1개"만 저장할 수 있었다.
--  QA2 는 운영자/연사가 한·영·중·일 중 아무 언어로나 번역을 눌러 볼 수 있어야 하므로
--  언어별 결과를 jsonb 한 컬럼에 모아 캐시한다.
--
--  questions.translations 형태:
--   {
--     "ko": { "title": "...", "content": "...", "at": "2026-08-04T…Z", "by": "gemini" },
--     "en": { ... }, "zh": { ... }, "ja": { ... }
--   }
--
--  questions.source_lang: 원문 감지 언어 (ISO 639-1. 판별 불가 시 'und')
--
--  ⚠️ 하위호환: 한국어(ko) 번역은 기존 translated_title/translated_content/
--     translated_lang/translated_at 에도 계속 함께 쓴다. 이 SQL 을 실행하지 않아도
--     server.js 는 "저장 없이 번역 결과만 반환"으로 폴백하므로 기능이 멈추지는 않는다.
-- ============================================================

alter table questions add column if not exists translations jsonb not null default '{}'::jsonb;
alter table questions add column if not exists source_lang  varchar(20);

-- 기존에 한국어 번역이 캐시돼 있던 행을 translations 로 옮긴다(1회성 백필).
--  이미 translations.ko 가 있으면 건드리지 않는다.
update questions
set translations = jsonb_set(
      coalesce(translations, '{}'::jsonb),
      '{ko}',
      jsonb_build_object(
        'title',   coalesce(translated_title, ''),
        'content', coalesce(translated_content, ''),
        'at',      coalesce(translated_at, now()),
        'by',      'legacy'
      ),
      true
    ),
    source_lang = coalesce(source_lang, translated_lang)
where translated_content is not null
  and translated_content <> ''
  and not (coalesce(translations, '{}'::jsonb) ? 'ko');

-- 번역이 있는 질문만 빠르게 훑기 위한 부분 인덱스(운영 콘솔 필터용, 선택).
create index if not exists idx_questions_translations
  on questions using gin (translations);

-- 확인용:
-- select id, title, source_lang, jsonb_object_keys(translations) as lang
--   from questions where translations <> '{}'::jsonb;

-- ################################################################################
-- [13/13] add_survey.sql
--        ✨ QA2 신규 — 세션 종료 설문 3문항
-- ################################################################################

-- ============================================================
-- 세션 종료 설문조사(고정 3문항)  — QA2
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
-- 전제: supabase_schema.sql 을 먼저 실행해 둔 상태.
-- ------------------------------------------------------------
--  참가자는 Q&A 가 끝나면 사용자 페이지에서 설문 3문항을 자동으로 받는다.
--   Q1. 세션 만족도            (1~5점)
--   Q2. 연사 전달력 / 추천 의향 (1~5점)
--   Q3. 자유 의견              (주관식, 500자)
--
--  노출 트리거는 두 가지이고 둘 중 하나만 만족해도 뜬다(index.html):
--   1) 자동 — 세션 ends_at 이 지나면 참가자 브라우저가 스스로 띄운다.
--   2) 수동 — 운영자가 관리자 대시보드에서 [설문 열기] → sessions.survey_open = true.
--
--  ⚠️ 응답 쓰기는 server.js(service_role) 만 한다. anon 정책을 열지 않는 이유:
--     - 익명 다중 응답/스팸을 서버에서 검증(점수 범위·길이·중복)해야 하고
--     - respondent_key 로 1인 1응답(수정 가능)을 강제하기 위함.
-- ============================================================

-- 1) 세션에 설문 수동 오픈 플래그 -------------------------------
alter table sessions add column if not exists survey_open      boolean not null default false;
alter table sessions add column if not exists survey_opened_at timestamptz;

-- 2) 응답 테이블 ------------------------------------------------
create table if not exists survey_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  -- 참가자 기기 식별자(localStorage UUID). 좋아요의 voter_key 와 같은 값을 쓴다.
  respondent_key text not null,
  -- Q1 세션 만족도 / Q2 연사 전달력·추천 의향 (1~5). 건너뛰면 null.
  q1_score smallint check (q1_score is null or (q1_score between 1 and 5)),
  q2_score smallint check (q2_score is null or (q2_score between 1 and 5)),
  -- Q3 자유 의견 (선택). 길이는 서버에서도 자르지만 DB 에서도 백스톱.
  q3_text text check (q3_text is null or char_length(q3_text) <= 500),
  -- 응답자가 설문을 본 언어 (ko / en / zh / ja) — 나중에 언어별 집계에 쓴다.
  lang varchar(5) not null default 'ko',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- 1인 1응답. 다시 제출하면 서버가 upsert 로 덮어쓴다(응답 수정 허용).
  unique (session_id, respondent_key)
);

-- 3) 인덱스 -----------------------------------------------------
create index if not exists idx_survey_responses_session
  on survey_responses (session_id, created_at desc);

-- 4) RLS -------------------------------------------------------
--  정책을 하나도 만들지 않는다 = anon 은 읽기/쓰기 모두 차단.
--  service_role(server.js)만 RLS 를 우회해 접근한다.
alter table survey_responses enable row level security;

-- 혹시 이전 실행에서 열어둔 정책이 있으면 정리
drop policy if exists survey_responses_public_insert on survey_responses;
drop policy if exists survey_responses_public_read   on survey_responses;

-- 5) 확인용 ----------------------------------------------------
-- select s.title,
--        count(*)                       as 응답수,
--        round(avg(r.q1_score), 2)      as 만족도평균,
--        round(avg(r.q2_score), 2)      as 연사평균
--   from survey_responses r
--   join sessions s on s.id = r.session_id
--  group by s.title
--  order by 응답수 desc;


-- ################################################################################
-- ✅ 설치 확인 — 아래가 모두 나오면 성공
-- ################################################################################

select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by table_name;
-- 기대: banned_words, post_throttle, projects, questions, sessions, survey_responses, tracks, votes  (8개)

select column_name
  from information_schema.columns
 where table_name = 'questions' and column_name in ('translations','source_lang')
 order by column_name;
-- 기대: source_lang, translations  (2개)

select column_name
  from information_schema.columns
 where table_name = 'sessions' and column_name in ('survey_open','survey_opened_at','code','speaker','qa_parent_id')
 order by column_name;
-- 기대: code, qa_parent_id, speaker, survey_open, survey_opened_at  (5개)
