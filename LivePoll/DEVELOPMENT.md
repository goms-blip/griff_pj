# LivePoll — 개발 인수인계 문서

> 실시간 행사용 Live Poll / 설문 솔루션. 참석자 페이지 + 운영자 콘솔 + API 를 **하나의 Express 서버**가 같은 오리진에서 제공한다.
> 최종 갱신: 2026-07-31 · 대상 독자: 이 저장소를 처음 넘겨받는 개발자

관련 문서
- `live_poll_prd.md` — 제품 요구사항(기능 정의의 근거)
- `WORKFLOW.md` — 날짜별 작업/결정 로그 (왜 이렇게 됐는지 히스토리)
- 이 문서 — 지금 코드가 **어떻게 동작하는지** + 운영 방법

---

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 런타임 | Node.js (CommonJS) + Express 4 |
| DB | Supabase(PostgreSQL). 서버가 `service_role` 키로 단독 접근 |
| 프론트 | 빌드 도구 없음. `index.html` / `admin.html` 각각 단일 파일 + CDN React 18 + Babel standalone + Tailwind CDN |
| 배포 | Vercel (`vercel.json` → 모든 경로를 `server.js` 로) · GitHub `main` push 시 자동 배포 |
| 프로덕션 | https://livepoll-app.vercel.app |
| 인증 | 참석자: 없음(익명) · 운영자: `x-admin-token` 헤더 단일 토큰 |

> **빌드 단계가 없다.** `index.html` / `admin.html` 을 저장하면 그게 곧 배포물이다. 브라우저가 Babel 로 JSX 를 직접 컴파일한다.
> 따라서 문법 오류는 런타임에야 드러난다 → 수정 후 반드시 브라우저로 열어 콘솔 에러 0 을 확인할 것. (아래 8장 참고)

---

## 2. 로컬 실행

```bash
npm install
cp .env.example .env.local         # 템플릿이 없는 사본이라면 3장 키 목록대로 직접 생성
npm start                          # 기본 8787 포트, PORT 로 변경 가능
```

- 참석자: `http://localhost:8787/#/e/{프로젝트코드}`
- 운영자: `http://localhost:8787/admin` → 토큰(`ADMIN_CONSOLE_TOKEN`) 입력

로컬 서버도 **운영 Supabase 를 직접 본다.** 별도 개발 DB 가 없으므로 로컬에서의 쓰기 작업은 곧 운영 데이터 변경이다. 실험이 필요하면 별도 프로젝트(행사)를 하나 만들어서 그 안에서 하는 것을 권장.

---

## 3. 환경변수 (`.env.local`, Vercel 프로젝트 설정에도 동일하게 필요)

| 키 | 용도 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 키. **절대 클라이언트로 내보내지 말 것** (RLS 를 우회한다) |
| `SUPABASE_ANON_KEY` | 현재 서버 로직에서는 미사용(과거 잔재) |
| `ADMIN_CONSOLE_TOKEN` | 운영자 콘솔 단일 비밀번호. `x-admin-token` 헤더로 검증 |
| `PORT` | 로컬 포트(기본 8787). Vercel 에서는 무시 |

---

## 4. 저장소 구조

```
server.js              # 전부. API + 정적 파일 서빙 (약 1,600줄)
index.html             # 참석자 페이지 (해시 라우팅 SPA)
admin.html             # 운영자 콘솔 (해시 라우팅 SPA)
vendor/qrcode.js       # qrcode-generator 1.4.4 vendoring (CDN 대신 동일 오리진 서빙)
livepoll_schema.sql    # 통합 스키마 (신규 Supabase 프로젝트 부트스트랩용)
migrations/            # 이후 추가된 컬럼들. 날짜순으로 SQL Editor 에서 실행
poll_seed.sql          # 데모 데이터(선택)
vercel.json            # 모든 경로 → server.js
live_poll_prd.md       # PRD
WORKFLOW.md            # 작업 로그
DEVELOPMENT.md         # (이 문서)
```

---

## 5. 아키텍처

```
[참석자 브라우저]  index.html  ──┐
                                 ├─►  server.js  ──(service_role)──►  Supabase
[운영자 브라우저]  admin.html  ──┘     · /api/public/*  : 익명 접근
                                        · /api/admin/*   : x-admin-token 필수
                                        · 그 외 경로     : index.html (SPA fallback)
```

설계 원칙(그대로 유지할 것)
1. **DB 직접 접근은 서버만.** 모든 테이블에 RLS 가 켜져 있고 anon 키로는 아무것도 못 읽는다. 클라이언트는 항상 `/api/*` 를 경유한다.
2. **DB row ↔ 앱 object 변환은 `map*Row` 헬퍼에 일원화** (`mapPoll`, `mapSessionRow` 등). 응답 스키마를 바꿀 땐 이 헬퍼만 고친다.
3. **응답 제출은 RPC 로 원자 처리.** `submit_poll_response`(security definer)가 상태 검증 + 중복 방지 + answers 저장을 한 트랜잭션에서 처리한다.

---

## 6. 데이터 모델

```
projects ─┬─ tracks
          ├─ sessions ──┐
          ├─ surveys ───┤
          └─ polls ◄────┘  (polls.session_id, polls.survey_id 는 nullable)
                │
                ├─ poll_options
                └─ poll_responses ── poll_response_answers
projects ─ poll_recipients (뉴스레터 대상자, 1인 1 token)
```

핵심 규약
- `polls.survey_id IS NULL` → **단건 Live Poll**, `NOT NULL` → **묶음 설문의 한 문항**. 집계/엑셀 로직을 한 벌로 재사용하기 위한 구조다.
- `polls.source_type` = `live_event` | `newsletter` — 관리자 콘솔의 탭 구분 기준.
- 세션의 일정 컬럼(`session_date`, `time_range`, `room`)은 **자유 텍스트**다. 엑셀에서 들어온 값을 그대로 담는다(`"8월 20일"`, `"11:30~12:20"`, `"Harmony Ballroom 1"`). 파싱은 화면단에서 한다(10장).
- 중복 응답 방지: `(poll_id, respondent_key)` / `(poll_id, recipient_id)` 부분 unique 인덱스. 참석자 식별자는 브라우저 `localStorage.lp_respondent_key` (UUID). 즉 **기기/브라우저 단위**이며 완전한 1인 1표는 아니다.

스키마 변경 절차: `migrations/YYYY-MM-DD_설명.sql` 파일을 추가하고 Supabase SQL Editor 에서 실행한다. `livepoll_schema.sql` 은 "새 프로젝트 부트스트랩용 통합본"이라 신규 컬럼도 함께 반영해 두면 좋다. 자동 마이그레이션 러너는 없다(수동 실행).

---

## 7. API 레퍼런스

### 7.1 공개 (`/api/public/*`) — 인증 없음
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/projects/:projectCode` | 행사 랜딩. 세션 목록(중복 제거됨) + 진행 중 Poll + `server_time` |
| GET | `/sessions/:sessionCode` | 세션 1건 + 그 세션의 live Poll |
| GET | `/polls/:pollCode` | Poll 1건 (`?token=` 이면 뉴스레터 대상자 식별) |
| POST | `/polls/:pollCode/responses` | 응답 제출 (IP당 분당 20회 제한) |
| GET | `/polls/:pollCode/results` | 결과 (poll.show_results 가 true 일 때만) |
| GET | `/surveys/:surveyCode` | 묶음 설문 문항 목록 |
| POST | `/surveys/:surveyCode/responses` | 묶음 설문 제출 |

### 7.2 운영자 (`/api/admin/*`) — `x-admin-token` 필수
프로젝트: `GET /projects`, `GET|PATCH|DELETE /projects/:id`, `POST /projects`
트랙: `POST /projects/:id/tracks`, `PATCH|DELETE /tracks/:id`
세션: `POST /projects/:id/sessions`, `PATCH|DELETE /sessions/:id`,
`POST /projects/:id/sessions/import` (엑셀·CSV 일괄 등록), `GET /projects/:id/sessions/import-template`,
**`DELETE /projects/:id/sessions/duplicates`** (숨겨진 중복 세션 영구 삭제 — 9장)
Poll: `GET /projects/:id/polls`, `GET /sessions/:id/polls`, `POST /projects/:id/polls`, `PATCH|DELETE /polls/:id`, `POST /polls/:id/start|close|duplicate`, `GET /polls/:id/results`
설문: `GET|POST /projects/:id/surveys`, `POST /projects/:id/surveys/generate-day`, `GET|PATCH|DELETE /surveys/:id`, `POST /surveys/:id/start|close`, `GET /surveys/:id/results`
대상자: `GET /projects/:id/recipients`, `POST /projects/:id/recipients/import`, `GET /projects/:id/recipients/export-links`
분석/엑셀: `GET /projects/:id/analysis`, `GET /polls/:id/export`, `GET /sessions/:id/polls/export`, `GET /projects/:id/polls/export`, `GET /surveys/:id/export`, `GET /projects/:id/polls/summary-export`

에러 규약: 실패는 `{ success: false, error: "코드" }` + 4xx/5xx. 클라이언트 `request()` 래퍼가 401/403 을 잡아 로그인 화면으로 보낸다.

---

## 8. 화면 라우트

참석자 (`index.html`, 해시 라우팅)
| 경로 | 화면 |
|---|---|
| `#/e/:projectCode` | 행사 랜딩 (진행 중 투표 · 세션룸 바로가기 · 세션 목록) |
| `#/e/:projectCode?room=세션룸` | **세션룸 화면** — 시간표 기반 자동 전환 (10장) |
| `#/s/:sessionCode` | 세션 상세 + 그 세션의 live Poll |
| `#/poll/:pollCode` | Poll 참여 |
| `#/survey/:code` | 묶음 설문 참여 |
| `#/results/:pollCode` | 결과 (공개된 경우, 8~12초 폴링) |

운영자 (`admin.html`)
| 경로 | 화면 |
|---|---|
| `#/` | 프로젝트 목록 |
| `#/project/:projectId` | 프로젝트 상세 — 탭: 세션 / Poll / 뉴스레터 Poll / 설문조사 / 분석 |

결과 패널은 열려 있는 동안 2.5초 간격으로 폴링한다(`POLL_INTERVAL`). WebSocket 은 쓰지 않는다.

---

## 9. 세션 중복 숨김 (2026-07-31 추가)

**문제**: 엑셀 세션 일괄 업로드는 항상 INSERT 다. 같은 일정표를 다시 올리면 세션이 2배로 쌓인다(실제로 41개 → 82개 발생).

**해결**: 삭제가 아니라 **읽는 쪽에서 최신 것만 보여준다.**
- `server.js` 의 `sessionDedupeKey(s)` / `splitDuplicateSessions(rows)`
  - 룸 값이 있으면 키 = `날짜|시간|룸` — 한 룸에서 동시에 두 세션이 열리지 않는다는 전제.
  - 룸이 없으면 키 = `날짜|시간|제목` — 같은 강연의 다른 회차를 잘못 지우지 않기 위해 제목까지 일치해야 한다.
  - 같은 키 그룹에서 `created_at` 이 가장 늦은 행만 남기고 나머지는 `duplicates` 로 분리.
- 적용 지점: `/api/public/projects/:code`(참석자 목록), `/api/admin/projects`(세션 카운트), `/api/admin/projects/:id`(세션 탭 · Poll 연결 드롭다운).
- 관리자 세션 탭에 `중복 세션 N개를 숨겼습니다` 카드가 뜬다 → 펼쳐보기 / 영구 삭제 가능.
- **숨김이지 삭제가 아니므로 이미 배포된 예전 QR(`/#/s/:code`)은 계속 열린다.**

`DELETE /api/admin/projects/:id/sessions/duplicates` 는 삭제 전에 중복 세션에 붙어 있던 Poll 을 **살아남는 최신 세션으로 옮긴다**(`moved_polls` 로 개수 반환).

> 근본 대책 후보(미구현): import 를 UPSERT 로 바꿔 같은 슬롯이면 갱신하도록. 현재는 읽기 단계 방어로 충분히 동작 중.

---

## 10. 세션룸 QR + 시간표 기반 자동 전환 (2026-07-31 추가)

행사 당일 운영자가 "지금 이 룸은 무슨 세션" 을 수동으로 바꿔주던 작업을 없애는 기능이다.

### 10.1 운영자: 룸 QR 만들기 (`admin.html` → 세션 탭 → **세션룸 QR**)
- 세션의 `room` 값에서 룸 목록을 자동으로 뽑는다.
- 룸별 버튼: `QR 보기`(모달) / `이미지`(고해상도 GIF 저장) / `인쇄`(A4 1장)
- 상단 `인쇄용 전체 다운로드` → 룸마다 A4 1장씩 새 창에 렌더 후 인쇄 대화상자 자동 오픈. 대상을 **PDF로 저장**으로 바꾸면 그대로 PDF.
- 포스터 구성: 행사명 / 룸 이름 / QR(92mm, 약 270dpi) / 안내문 / URL / 그 룸의 타임테이블(최대 14행).
- **QR 에는 날짜를 넣지 않는다** — 포스터 1장으로 행사 전 기간을 커버한다. 링크 형식: `/#/e/{projectCode}?room={룸이름}`

관련 코드: `admin.html` 의 `makeQR()`, `downloadQRImage()`, `openRoomQRPrint()`, `SessionsTab` 안의 `rooms` / `roomUrl` / `printRooms`.

### 10.2 참석자: 룸 화면 자동 전환 (`index.html` 의 `RoomStage`)
QR 로 들어오면 이 화면이 뜬다.
- **현재 세션** — 시간표상 지금 진행 중인 세션의 제목·연사·남은 시간. 세션이 끝나면 **자동으로 다음 세션으로 넘어간다**(새로고침 불필요).
- **세션룸 이동 버튼** — 다른 룸으로 즉시 전환(4개 룸이면 4개 버튼).
- **진행 중인 투표** — 현재 세션에 연결된 Poll + 세션 지정이 없는 행사 공통 Poll.
- **다음 세션 / 이 룸의 일정** — 진행 중·예정·종료 뱃지 표시.

동작 원리
| 요소 | 설명 |
|---|---|
| `sessionTimeWindow(s, baseYear)` | `"8월 20일"` + `"11:30~12:20"` → 실제 시작/종료 timestamp. `2026-08-20` 같은 ISO 형식도 인식. 종료 시각이 없으면 50분으로 간주 |
| `baseYear` | 자유 텍스트 날짜에는 연도가 없다 → `projects.start_date` 의 연도, 없으면 현재 연도 |
| `clock_skew_ms` | 공개 API 가 내려주는 `server_time` 과 단말 시계의 차이. 참석자 폰 시계가 틀어져 있어도 서버 기준으로 판정 |
| `useNow(skew)` | 15초마다 현재 시각을 흘려보낸다 → 세션 경계에서 늦어도 15초 안에 전환 |
| 60초 재조회 | 새로 시작된 Poll 이 새로고침 없이 뜨도록 조용히 refetch |
| 표시 날짜 | 진행 중 세션의 날짜 → 없으면 다음 세션의 날짜 → 없으면 마지막 날. **양일 행사에서 날짜를 자동으로 따라간다** |

### 10.3 리허설 / QA 방법 — `?now=` 오버라이드
행사 전에 자동 전환을 검증하려면 시각을 흉내낼 수 있다.

```
/#/e/fa089f?room=Atlas&now=2026-08-20T14:50
```
- 지정 시각에서 **실제 속도로** 시간이 흐른다(경계를 넘어가는 것까지 확인 가능).
- 룸 이동 버튼을 눌러도 `now` 가 유지된다.
- 값을 바꾼 뒤에는 **새로고침**해야 반영된다(해시만 바뀌면 문서가 다시 로드되지 않으므로).
- 참석자에게 나가는 QR 에는 절대 포함되지 않는다(운영자가 URL 을 직접 칠 때만 쓰는 도구).

검증 예: `?room=Atlas&now=2026-08-20T12:19:45` 로 열면 11:30~12:20 세션이 "진행 중"이고, 약 30초 뒤 화면이 스스로 "세션 준비 중 / 다음 세션 13:40" 으로 넘어간다.

---

## 11. 운영 런북 (행사 준비 → 당일)

**행사 2~3일 전**
1. 관리자 콘솔 → 프로젝트 생성 → 세션 탭에서 **엑셀 일괄 등록**. 컬럼: `날짜 / 시간 / 세션명 / 연사 / 트랙 / 세션룸 / 공개여부` (세션명만 필수, 템플릿 다운로드 버튼 제공).
2. 일정이 바뀌면 **수정된 엑셀을 다시 올리면 된다.** 이전 회차는 자동으로 숨겨지고 최신본만 노출된다(9장). 정리하고 싶으면 `영구 삭제`.
3. 세션룸 QR → `인쇄용 전체 다운로드` → PDF 저장 → 룸 입구용으로 출력.
4. `?now=` 로 각 룸의 자동 전환을 리허설(10.3).

**행사 당일**
- 룸별 QR 은 그대로 두면 된다. 세션 전환에 **운영자 개입이 필요 없다.**
- Poll 은 관리자 콘솔에서 `시작` → 참석자 화면(룸 화면 / 세션 화면)에 최대 60초 안에 뜬다. 즉시 띄우고 싶으면 참석자가 새로고침.
- 결과는 결과 패널에서 2.5초 간격으로 갱신된다. 참석자에게 결과를 보여주려면 Poll 의 `결과 공개` 를 켠다.

**행사 후**
- 분석 탭 / 엑셀 다운로드(문항별, 세션별, 프로젝트 전체, 설문별, 요약).

---

## 12. 알려진 제약 · 다음 작업 후보

| 항목 | 현황 |
|---|---|
| 세션 엑셀 재업로드 | INSERT 만 한다. 읽기 단계 dedupe 로 방어 중 → UPSERT 전환이 근본 대책 |
| 참석자 중복 응답 방지 | localStorage 기반(기기 단위). 시크릿 창/다른 기기면 재응답 가능 |
| 실시간성 | WebSocket 없이 폴링(참석자 결과 8~12초, 관리자 2.5초, 룸 화면 60초). Supabase Realtime 은 스키마에만 설정돼 있고 코드에서 미사용 |
| 운영자 인증 | 단일 토큰. 사용자별 계정/권한 없음 |
| 시간대 | 서버·브라우저 로컬 타임 기준. 해외 참석자가 다른 TZ 로 접속하면 룸 화면 판정이 어긋날 수 있다(현장 행사 전제) |
| 테스트 | 자동화 테스트 없음. 브라우저 수동 확인이 유일한 검증 수단 |
| 프론트 규모 | `admin.html` 약 2,900줄 단일 파일. 계속 커지면 분할/번들 도입을 검토 |

---

## 13. 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| 모든 API 가 500, 로그에 Supabase 오류 | Supabase 프로젝트가 **pause** 됐을 가능성(무료 플랜은 미사용 시 자동 정지). 대시보드에서 resume |
| 관리자 콘솔이 계속 로그인 화면 | `ADMIN_CONSOLE_TOKEN` 불일치. Vercel 환경변수와 입력값 확인. 토큰은 브라우저 `localStorage.lp_admin_token` 에 저장된다 |
| 화면이 하얗게 뜸 | JSX 문법 오류. 브라우저 콘솔에 Babel 에러가 찍힌다. 빌드가 없으므로 **저장 후 브라우저 확인이 필수** |
| 세션이 안 보임 | ① 세션 `공개여부`가 비공개 ② 같은 슬롯의 더 최신 세션에 밀려 중복으로 숨겨짐(관리자 세션 탭의 중복 카드 확인) |
| 룸 화면이 "세션 준비 중" 에서 안 바뀜 | 해당 룸 세션의 `날짜`/`시간` 값이 비었거나 파싱 불가 형식. `"8월 20일"` / `"11:30~12:20"` 또는 ISO 형식이어야 한다 |
| 인쇄 창이 안 뜸 | 브라우저 팝업 차단. 사이트 팝업 허용 후 재시도 |
| QR 이 안 찍힘 | `vendor/qrcode.js` 가 404 인지 확인(`vercel.json` 의 `includeFiles` 에 포함돼 있어야 한다) |

---

## 14. 배포

```bash
git push origin main      # → Vercel 자동 배포
```
- `vercel.json` 이 모든 요청을 `server.js` 로 보낸다. `includeFiles` 에 `index.html`, `admin.html`, `vendor/qrcode.js` 가 포함돼야 정적 파일이 함께 올라간다.
- 환경변수는 Vercel 프로젝트 설정에 등록되어 있어야 한다(3장). 로컬 `.env.local` 은 배포에 포함되지 않는다.
- 롤백은 Vercel 대시보드에서 이전 배포를 Promote.
