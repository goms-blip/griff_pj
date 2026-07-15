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
