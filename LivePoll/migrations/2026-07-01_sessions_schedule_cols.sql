-- 세션에 스케줄 컬럼 추가 (날짜 / 시간 / 세션룸)
-- 엑셀 일괄 업로드의 날짜·시간·세션룸 컬럼을 정식 필드로 저장하기 위함.
-- 값은 "8월 20일", "11:30~12:20", "Harmony Ballroom 1" 같은 자유 텍스트라 text 타입 사용.
alter table sessions
  add column if not exists session_date text,   -- 날짜 (예: 8월 20일)
  add column if not exists time_range   text,   -- 시간 (예: 11:30~12:20)
  add column if not exists room         text;   -- 세션룸 (예: Harmony Ballroom 1)
