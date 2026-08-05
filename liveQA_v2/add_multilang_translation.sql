-- ============================================================
-- 다국어 번역(한/영/중/일) 캐시 컬럼 추가  — QA2
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.
-- 전제: supabase_schema.sql, add_translation.sql 을 먼저 실행해 둔 상태.
-- ------------------------------------------------------------
--  기존 add_translation.sql 은 "한국어 번역 1개"만 저장할 수 있었다.
--  QA2 는 운영자/연사가 한·영·중·일 중 아무 언어로나 번역을 눌러 볼 수 있어야 하므로
--  언어별 결과를 jsonb 한 컬럼에 모아 캐시한다.
--
--  questions.translations 형태:
--   {
--     "ko": { "title": "...", "content": "...", "at": "2026-08-04T…Z", "by": "gemini" },
--     "en": { ... }, "zh": { ... }, "ja": { ... }
--   }
--
--  questions.source_lang: 원문 감지 언어 (ISO 639-1. 판별 불가 시 'und')
--
--  ⚠️ 하위호환: 한국어(ko) 번역은 기존 translated_title/translated_content/
--     translated_lang/translated_at 에도 계속 함께 쓴다. 이 SQL 을 실행하지 않아도
--     server.js 는 "저장 없이 번역 결과만 반환"으로 폴백하므로 기능이 멈추지는 않는다.
-- ============================================================

alter table questions add column if not exists translations jsonb not null default '{}'::jsonb;
alter table questions add column if not exists source_lang  varchar(20);

-- 기존에 한국어 번역이 캐시돼 있던 행을 translations 로 옮긴다(1회성 백필).
--  이미 translations.ko 가 있으면 건드리지 않는다.
update questions
set translations = jsonb_set(
      coalesce(translations, '{}'::jsonb),
      '{ko}',
      jsonb_build_object(
        'title',   coalesce(translated_title, ''),
        'content', coalesce(translated_content, ''),
        'at',      coalesce(translated_at, now()),
        'by',      'legacy'
      ),
      true
    ),
    source_lang = coalesce(source_lang, translated_lang)
where translated_content is not null
  and translated_content <> ''
  and not (coalesce(translations, '{}'::jsonb) ? 'ko');

-- 번역이 있는 질문만 빠르게 훑기 위한 부분 인덱스(운영 콘솔 필터용, 선택).
create index if not exists idx_questions_translations
  on questions using gin (translations);

-- 확인용:
-- select id, title, source_lang, jsonb_object_keys(translations) as lang
--   from questions where translations <> '{}'::jsonb;
