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
