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
