-- ============================================================
-- 질문 번역(Gemini) 결과 저장 컬럼 추가
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--  - 관리자 대시보드에서 [번역] 버튼을 누르면 Gemini 가 한국어로 번역하고
--    결과를 여기에 캐시한다. 재조회/다른 운영자도 재번역 없이 바로 본다.
--  - 컬럼이 없어도 server.js 는 "저장 없이 번역 결과만" 반환하도록 폴백한다.
-- ============================================================

alter table questions add column if not exists translated_title   text;
alter table questions add column if not exists translated_content text;
-- 원문 감지 언어 (ISO 639-1: en / ja / zh / ko ... 판별 불가 시 und)
alter table questions add column if not exists translated_lang    varchar(20);
alter table questions add column if not exists translated_at      timestamptz;

-- 확인용:
-- select id, title, translated_lang, translated_title, translated_at from questions
--   where translated_at is not null order by translated_at desc;
