-- ============================================================
-- 트랙(룸) 고정 코드 추가 — tracks.code
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--
-- 왜 필요한가:
--   룸 QR(#/r/<행사코드>/<룸번호>) 의 '룸번호' 가 여태 tracks.sort_order 였다.
--   순서는 관리자가 언제든 바꿀 수 있는 값이라, **QR 을 인쇄한 뒤 트랙 순서를
--   바꾸면 인쇄물이 다른 룸을 가리킨다.** 현장에서 되돌릴 수 없는 사고다.
--   트랙마다 바뀌지 않는 코드를 부여해 QR 이 트랙 자체를 가리키게 한다.
--
-- 하위호환:
--   이미 뽑아 둔 #/r/<행사코드>/1 같은 숫자 주소도 계속 동작한다.
--   서버가 "숫자면 sort_order, 아니면 code" 로 해석한다.
--   (다만 숫자 주소는 여전히 순서 변경에 취약하므로, 재인쇄 시 code 주소를 쓸 것)
-- ============================================================

-- 1) 코드 컬럼
alter table tracks add column if not exists code text;

-- 2) 기존 행 백필 — 4자리 hex 소문자. 룸 수가 적어 충돌은 사실상 없고,
--    현장에서 사람이 눈으로 확인하기 좋게 짧게 둔다.
update tracks
   set code = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 4)
 where code is null;

-- 3) 유니크 인덱스 (프로젝트 경계 없이 전역 유니크 — 주소에 행사코드가 이미 있지만
--    코드만으로도 추적 가능하게 두는 편이 운영 시 헷갈리지 않는다)
create unique index if not exists idx_tracks_code on tracks(code);

-- 4) 앞으로 만들어지는 트랙에도 자동 부여
alter table tracks
  alter column code set default substr(md5(random()::text || clock_timestamp()::text), 1, 4);

-- 5) tracks 는 anon 직접 조회 불가(RLS, 정책 없음) → 룸 조회는 server.js 공개
--    엔드포인트가 service_role 로 대신 읽는다. 별도 정책 추가 없음.

-- 확인용:
-- select id, code, name, sort_order from tracks order by sort_order;
