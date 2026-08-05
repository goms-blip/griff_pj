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
