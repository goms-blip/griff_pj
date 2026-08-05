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
