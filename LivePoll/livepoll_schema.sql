-- ============================================================
-- 실시간 행사 Live Poll 솔루션 — 통합 스키마 (단일 파일)
-- Live Poll 전용. Q&A 잔재(questions/votes/banned_words/admin_token) 없음.
-- 새 Supabase 프로젝트 → SQL Editor 에 전체 붙여넣고 [Run].
-- (PRD: live_poll_prd.md 7~9장 기준)
--   적용 순서: livepoll_schema.sql → poll_seed.sql(데모, 선택)
-- ============================================================

-- 0) 베이스 구조 (Poll/Survey 가 참조하는 행사 골격) -----------
-- projects ─ tracks ─ sessions. Q&A 전용 테이블은 두지 않는다.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 6),
  title varchar(255) not null,
  client_name varchar(255),
  description text,
  start_date date,
  end_date date,
  status varchar(20) not null default '준비중',  -- 준비중 / 진행중 / 종료
  created_at timestamptz default now()
);

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name varchar(100) not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 6),
  title varchar(255) not null,
  description text,
  speaker varchar(100),
  track_id uuid references tracks(id) on delete set null,
  is_public boolean not null default true,
  session_date text,   -- 날짜 (예: 8월 20일)
  time_range   text,   -- 시간 (예: 11:30~12:20)
  room         text,   -- 세션룸 (예: Harmony Ballroom 1)
  created_at timestamptz default now()
);

create index if not exists idx_tracks_project   on tracks (project_id, sort_order, created_at);
create index if not exists idx_sessions_project on sessions (project_id, created_at asc);
create index if not exists idx_sessions_track   on sessions (track_id);

-- 1) Poll 테이블 ----------------------------------------------
-- 7.1 polls — Poll 기본 정보
create table if not exists polls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  title varchar(255) not null,
  question text not null,
  poll_type varchar(30) not null,                 -- single_choice / multiple_choice / rating / short_text
  status varchar(20) not null default 'draft',    -- draft / scheduled / live / closed / archived
  source_type varchar(30) not null default 'live_event', -- live_event / newsletter
  is_public boolean not null default false,
  show_results boolean not null default false,
  allow_multiple_answers boolean not null default false,
  internal_memo text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz default now()
);

-- 7.2 poll_options — 객관식 선택지
create table if not exists poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null,
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- 7.3 poll_recipients — 행사 후 뉴스레터 대상자
create table if not exists poll_recipients (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  name varchar(100),
  company varchar(255),
  title varchar(255),
  token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz default now()
);

-- 7.4 poll_responses — Poll 응답 (1 제출 = 1 행)
create table if not exists poll_responses (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  respondent_key text,
  recipient_id uuid references poll_recipients(id) on delete set null,
  source varchar(30) not null default 'live_event',  -- live_event / newsletter
  submitted_at timestamptz default now()
);

-- 7.5 poll_response_answers — 답변 상세 (복수선택/주관식/척도 모두 처리)
create table if not exists poll_response_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references poll_responses(id) on delete cascade,
  option_id uuid references poll_options(id) on delete set null,
  answer_text text,
  answer_number numeric,
  created_at timestamptz default now()
);

-- 2) 중복 응답 방지 unique 인덱스 (PRD 7.4) ---------------------
create unique index if not exists uniq_poll_response_by_respondent
  on poll_responses (poll_id, respondent_key) where respondent_key is not null;
create unique index if not exists uniq_poll_response_by_recipient
  on poll_responses (poll_id, recipient_id) where recipient_id is not null;

-- 3) 인덱스 (PRD 7.6) -----------------------------------------
create index if not exists idx_polls_project        on polls (project_id, created_at desc);
create index if not exists idx_polls_session        on polls (session_id, created_at desc);
create index if not exists idx_polls_status         on polls (status, is_public);
create index if not exists idx_poll_options_poll    on poll_options (poll_id, sort_order asc);
create index if not exists idx_poll_responses_poll  on poll_responses (poll_id, submitted_at desc);
create index if not exists idx_poll_answers_response on poll_response_answers (response_id);
create index if not exists idx_poll_recipients_project on poll_recipients (project_id, email);

-- 4) 응답 제출 RPC (원자적 저장 + 중복 방지, PRD 8.1) ----------
create or replace function submit_poll_response(
  p_poll_id      uuid,
  p_respondent_key text,
  p_recipient_id uuid,
  p_source       text,
  p_answers      jsonb
)
returns json
language plpgsql
security definer
as $$
declare
  v_poll          polls%rowtype;
  v_response_id   uuid;
  v_existing_id   uuid;
  v_answer        jsonb;
  v_option_id     uuid;
  v_opt_count     int;
begin
  select * into v_poll from polls where id = p_poll_id;
  if not found then
    return json_build_object('success', false, 'error', 'poll_not_found');
  end if;
  if v_poll.status <> 'live' then
    return json_build_object('success', false, 'error', 'poll_not_live');
  end if;
  if v_poll.starts_at is not null and now() < v_poll.starts_at then
    return json_build_object('success', false, 'error', 'poll_not_started');
  end if;
  if v_poll.ends_at is not null and now() > v_poll.ends_at then
    return json_build_object('success', false, 'error', 'poll_ended');
  end if;

  if p_recipient_id is not null then
    select id into v_existing_id from poll_responses
      where poll_id = p_poll_id and recipient_id = p_recipient_id limit 1;
  elsif p_respondent_key is not null then
    select id into v_existing_id from poll_responses
      where poll_id = p_poll_id and respondent_key = p_respondent_key limit 1;
  end if;
  if v_existing_id is not null and not v_poll.allow_multiple_answers then
    return json_build_object('success', true, 'already_submitted', true, 'response_id', v_existing_id);
  end if;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    if (v_answer ->> 'option_id') is not null then
      v_option_id := (v_answer ->> 'option_id')::uuid;
      select count(*) into v_opt_count from poll_options
        where id = v_option_id and poll_id = p_poll_id;
      if v_opt_count = 0 then
        return json_build_object('success', false, 'error', 'invalid_option');
      end if;
    end if;
  end loop;

  begin
    insert into poll_responses (poll_id, respondent_key, recipient_id, source)
    values (p_poll_id, p_respondent_key, p_recipient_id, coalesce(p_source, v_poll.source_type))
    returning id into v_response_id;
  exception when unique_violation then
    return json_build_object('success', true, 'already_submitted', true);
  end;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    insert into poll_response_answers (response_id, option_id, answer_text, answer_number)
    values (
      v_response_id,
      nullif(v_answer ->> 'option_id', '')::uuid,
      nullif(v_answer ->> 'answer_text', ''),
      nullif(v_answer ->> 'answer_number', '')::numeric
    );
  end loop;

  return json_build_object('success', true, 'already_submitted', false, 'response_id', v_response_id);
end;
$$;

-- 5) 묶음 설문(survey) — 여러 문항을 한 설문으로 ----------------
-- 각 문항은 survey_id 를 가진 poll 로 저장 → 집계/응답/엑셀 로직 재사용.
-- survey_id 가 null 인 poll = 단건 Live Poll. null 아니면 = 설문 문항.
create table if not exists surveys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  title varchar(255) not null,
  intro text,
  status varchar(20) not null default 'draft',          -- draft / live / closed
  source_type varchar(30) not null default 'newsletter', -- newsletter / live_event
  is_public boolean not null default true,
  show_results boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz default now()
);

alter table polls add column if not exists survey_id uuid references surveys(id) on delete cascade;
alter table polls add column if not exists sort_order int not null default 0;
create index if not exists idx_polls_survey    on polls (survey_id, sort_order);
create index if not exists idx_surveys_project on surveys (project_id, created_at desc);

-- 6) RLS 정책 -------------------------------------------------
-- 전략: 모든 데이터 접근은 server.js(service_role) 게이트웨이로 처리(잠금).
--   사용자 페이지(index.html)도 anon 직접 접근이 아닌 /api/public/* 경유.
alter table projects              enable row level security;
alter table tracks                enable row level security;
alter table sessions              enable row level security;
alter table polls                 enable row level security;
alter table poll_options          enable row level security;
alter table poll_recipients       enable row level security;
alter table poll_responses        enable row level security;
alter table poll_response_answers enable row level security;
alter table surveys               enable row level security;

-- submit RPC 는 security definer 이므로 RLS 와 무관하게 동작.
-- (anon 직접 호출도 열려면 아래 grant 해제)
-- grant execute on function submit_poll_response(uuid, text, uuid, text, jsonb) to anon;

-- 7) Realtime (관리자 대시보드 실시간 결과 갱신용) -------------
alter publication supabase_realtime add table poll_responses;

-- 끝.
