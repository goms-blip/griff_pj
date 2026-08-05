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
