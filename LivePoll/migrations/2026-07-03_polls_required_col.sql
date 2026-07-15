-- polls.required — 설문 문항의 필수 응답 여부를 문항 단위로 저장
-- 배경: 공개 설문 API 가 required 를 poll_type !== 'rating' 로 전역 계산하던 탓에
--       기존 뉴스레터/NPS 등 무관한 rating 문항까지 소급 "선택 응답" 으로 바뀌는 회귀가 있었음.
--       필수 여부를 문항 행에 명시적으로 저장해 스코프를 격리한다.
-- 값 규약:
--   true  = 필수 응답
--   false = 선택 응답 (예: generate-day 로 만든 세션 난이도/만족도 rating)
--   NULL  = 미지정 → 서버는 폴백으로 '필수(true)' 로 간주 (기존 설문 동작 보존)
alter table polls
  add column if not exists required boolean;
