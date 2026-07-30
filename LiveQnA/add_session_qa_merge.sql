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
