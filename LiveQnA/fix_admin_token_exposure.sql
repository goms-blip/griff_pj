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
