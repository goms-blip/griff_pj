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
