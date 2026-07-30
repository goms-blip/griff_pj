# 개발자 설명서 — 실시간 행사 Q&A 솔루션 (LiveQnA)

이 문서는 **코드를 이어받아 수정할 사람**을 위한 것입니다.
운영·인수인계 관점은 [HANDOVER.md](./HANDOVER.md) 를 보세요.

- 기준 문서: `realtime_event_qna_prd_supabase_mvp_v2.md` (PRD)
- 작업 로그: `WORKFLOW.md` — **왜 그렇게 짰는지**가 전부 여기에 있습니다. 이상해 보이는 코드를 만나면 먼저 검색해 보세요.
- 최종 갱신: 2026-07-30

---

## 1. 한눈에 보는 구조

```
                    ┌──────────────────────────────┐
   참가자 (모바일)   │  index.html  (단일 파일 SPA)  │
   ────────────────▶│  CDN React 18 + Babel + TW   │
                    └───────┬──────────────┬───────┘
                            │ anon key     │ fetch
                            │ (직접)        │
                            ▼              ▼
                 ┌────────────────┐  ┌──────────────────┐
                 │   Supabase     │◀─│   server.js      │
                 │  Postgres+RLS  │  │  Express         │
                 │  Realtime      │  │  service_role    │
                 └────────────────┘  └────────┬─────────┘
                                              │
                                     Gemini API (질문 번역)
                                     Google Sheets (세션 동기화)
```

**핵심 원칙 하나만 기억하면 됩니다:**

| 경로 | 누가 | 어떻게 |
|---|---|---|
| 참가자(공개) 읽기·쓰기 | 브라우저 | **anon 키로 Supabase 직접 호출** (RLS가 방어) |
| 관리자 전부 | 브라우저 → `server.js` | **service_role** (RLS 우회), 토큰 검증은 서버가 |
| 공개인데 RLS로 못 읽는 것 | 브라우저 → `server.js` | 세션 단건·랜딩·룸 (`/api/public/*`) |

> ⚠️ **service_role 키는 절대 프론트에 두지 마세요.** `index.html` 에 들어가는 키는 anon 키뿐이고, 이건 설계상 공개입니다.

### 기술 선택의 이유 (그리고 그 대가)

- **빌드 도구 없음.** `index.html` 하나에 CDN React + Babel standalone + Tailwind CDN. 파일 하나만 열면 수정되고 배포도 복사만 하면 됩니다.
  - 대가: 브라우저가 매 로드마다 Babel로 트랜스파일합니다(초기 로딩 지연). 콘솔에 뜨는 Tailwind/Babel CDN 경고 2건은 **정상**이며 무시해도 됩니다.
  - 대가: 파일이 22만 자를 넘겼습니다. 더 커지면 빌드 도구 도입을 고민할 시점입니다.
- **얇은 Express 서버.** service_role 키를 숨기고 토큰을 검증할 곳이 필요해서 존재합니다. 그 이상은 하지 않습니다.

---

## 2. 로컬에서 띄우기

작업 원본은 **`goms-blip/griff_pj` 클론의 `LiveQnA/` 폴더**입니다.

```bash
git clone https://github.com/goms-blip/griff_pj.git
cd griff_pj/LiveQnA
cp .env.example .env.local     # 값 채우기 (아래 표 참고)
npm install
npm start                      # → http://localhost:8787
```

`.env.local` 은 `LiveQnA/` 안에 둡니다(서버가 `__dirname` 기준으로 읽습니다). `.vercel/` 은 **리포 루트**에 둡니다(§8 참고). 둘 다 `.gitignore` 대상입니다.

`server.js` 가 API와 `index.html` 을 **같은 오리진**으로 서빙합니다(CORS 없음). API가 아닌 모든 GET은 `index.html` 로 폴백합니다(해시 라우팅).

### 환경변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `SUPABASE_URL` | ✅ | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **서버 전용.** RLS를 우회합니다. 노출 시 전 데이터 유출 |
| `ADMIN_CONSOLE_TOKEN` | ✅ | `/admin` 콘솔과 `/api/admin/*` 전체를 여는 마스터 토큰 |
| `PORT` | | 기본 8787 |
| `GEMINI_API_KEY` | | 질문 번역용. 없으면 번역 기능만 비활성 |
| `GEMINI_MODEL` | | 기본 `gemini-3.6-flash` |
| `CRON_SECRET` | | 시트 동기화 크론 인증(`Authorization: Bearer …`) |

> 🔴 **`SUPABASE_ANON_KEY` 는 `.env.local` 이 아니라 `index.html` 상단(약 110행)에 하드코딩되어 있습니다.**
> 정적 파일이라 서버 환경변수를 읽을 수 없기 때문입니다. **Supabase 프로젝트를 갈아끼우면 `.env.local` 과 `index.html` 두 곳을 모두 고쳐야 합니다.** 가장 흔한 실수 지점입니다.

---

## 3. DB

### 테이블

| 테이블 | 용도 | 주의 |
|---|---|---|
| `projects` | 행사 | `code` = 6자리 짧은 코드 |
| `tracks` | 룸(트랙) | **`sort_order` 가 룸 QR 번호입니다** (§6 주의사항) |
| `sessions` | 세션 | `admin_token` = 세션 단위 권한. `code` = 짧은 코드. `source_key` = 시트 동기화 내부 키 |
| `questions` | 질문 | `is_hidden` / `is_answered`, `translated_*` (운영자 전용) |
| `votes` | 좋아요 1인 1표 | `voter_key`(브라우저 생성) + `voter_fp`(IP의 md5) |
| `banned_words` | 금지어 | 프론트 사전 차단 + DB 트리거 이중 |
| `post_throttle` | 도배 방지 카운터 | **일부러 `questions` 와 분리했습니다.** 컬럼으로 넣으면 관리자 API의 `select('*')` 와 엑셀 export에 그대로 섞여 나갑니다 |

### 함수

| 함수 | 하는 일 |
|---|---|
| `like_question(question_id, voter_key)` | 원자적 1인 1표. `{success, liked, like_count, reason}` 반환. reason: `already_voted` / `rate_limited` / `not_likeable` / `invalid_voter_key` |
| `session_is_public(uuid)` | **security definer.** questions RLS 정책이 세션 공개 여부를 볼 때 씁니다 |
| `client_fp()` | 참가자 IP의 md5 지문. **원문 IP는 저장하지 않습니다** |
| `questions_rate_limit()` | 지문당 60초 10건 제한 트리거 |
| `reject_banned_words()` | `BANNED_WORD: <단어>` 로 raise |

> ⚠️ `session_is_public` 이 **security definer** 인 이유: RLS 정책 안의 서브쿼리는 **호출자 권한**으로 평가됩니다. CRITICAL 패치로 anon의 `sessions` SELECT 권한을 회수했기 때문에, 정책에서 `exists (select 1 from sessions …)` 를 그냥 쓰면 **모든 질문 읽기가 permission denied 로 막힙니다.** 반드시 이 함수를 거치세요.

### SQL 적용 순서

새 Supabase 프로젝트를 만들 때 **이 순서대로** SQL Editor에 붙여넣고 Run:

1. `supabase_schema.sql` — 테이블 4종 + `like_question` + RLS + Realtime publication
2. `banned_words.sql` — 금지어 테이블·트리거
3. `add_short_codes.sql` — `projects.code` / `sessions.code`
4. `add_tracks_speaker.sql` — `tracks` 테이블 + `sessions.speaker` / `track_id`
5. `add_translation.sql` — `questions.translated_*`
6. `add_sheet_sync.sql` — `projects.sheet_*` + `sessions.source_key`
7. `fix_admin_token_exposure.sql` — 🔴 **필수 보안 패치**
8. `fix_high_findings.sql` — 🟠 **필수 보안 패치**
9. `fix_question_rate_limit.sql` — 🐞 8번의 도배 제한이 무효였던 버그 수정 (§6 ⑨)
10. `add_track_codes.sql` — 룸 QR용 `tracks.code` (§6 ①)
11. `add_session_qa_merge.sql` — 두 룸 병행 시 Q&A 통합용 `sessions.qa_parent_id` (§6 ⑩)
12. (선택) `supabase_seed.sql` — 데모 데이터

**Supabase 신규 프로젝트는 Data API(PostgREST)가 기본 off 입니다.** 켜지 않으면 전부 `503 PGRST002` 가 납니다.
→ 대시보드 → Integrations → Data API → Enable (Exposed schemas에 `public` 포함)

`server.js` 는 3~6번이 미적용이어도 컬럼을 줄여 재시도하며 **하위호환으로 동작**합니다. 7·8번은 하위호환이 아니라 **보안 필수**입니다.

---

## 4. 인증 모델

토큰은 `x-admin-token` 헤더 **또는** `?token=` 쿼리로 받습니다.

| 검사 | 통과 조건 | 실패 |
|---|---|---|
| `requireConsole` | `ADMIN_CONSOLE_TOKEN` 일치 | 401 |
| `requireSessionAdmin(sessionId)` | 콘솔 토큰 **또는** 그 세션의 `admin_token` | 401(없음) / 403(불일치) / 404(세션 없음) |
| `/api/public/*` | 없음. 단, 비공개 세션은 `?pv=` 로 콘솔/세션 토큰을 주면 미리보기 허용 | 404 (존재 여부까지 숨김) |

**세션 `admin_token` 의 의미** — 강연자/진행자에게 그 세션 대시보드만 열어주는 URL 키입니다. 콘솔 토큰과 달리 다른 세션에는 못 씁니다. 대시보드 진입 후 주소창의 `?token=` 은 `history.replaceState` 로 즉시 제거됩니다(어깨너머 노출 방지).

---

## 5. 코드 지도

### `index.html` (프론트 전체)

| 위치(대략) | 내용 |
|---|---|
| ~110 | `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `sb` 클라이언트 |
| ~160 | 금지어·에러 메시지 매핑 (`questionInsertMessage`) |
| ~420 | `SESSION_PUBLIC_COLUMNS` / `QUESTION_PUBLIC_COLUMNS` **← anon 경로 컬럼 화이트리스트** |
| ~606 | `mockApi` — **모든 데이터 접근이 여기 한 곳에 모여 있습니다** |
| ~1230 | URL 빌더 (`buildUserUrl` / `buildAdminUrl` / `buildEventUrl` / `buildRoomUrl` / `buildRoomAdminUrl`) |
| ~1349 | `QrCodeModal` (행사 QR) |
| ~1465 | `RoomQrModal` (룸별 QR 발급 — 캔버스 + 룸 이름 합성 PNG) |
| ~1160 | 해시 라우터 (직접 구현, 의존성 없음) |
| ~1770 | 관리자 홈 |
| ~2050 | 프로젝트 상세 |
| ~3148 | 공개 랜딩 |
| ~3388 | 사용자(참가자) 페이지 |
| ~3783 | `useRoomAutoSwitch` **← 룸 자동 전환 판정(참가자·운영자 공용)** |
| ~3828 | 룸 페이지(참가자) |
| ~3889 | 룸 운영자(스피커) 페이지 |
| ~3936 | 룸 대기 화면 |
| ~4134 | 관리자 Q&A 대시보드 |

> `mockApi` 라는 이름은 목업 시절의 잔재입니다. 지금은 실제 API 레이어입니다.
> **데이터 접근을 추가할 땐 컴포넌트에서 직접 fetch 하지 말고 여기에 메서드를 추가하세요.**

> 🔴 anon 경로에서 `.select('*')` 를 쓰지 마세요. 반드시 `*_PUBLIC_COLUMNS` 상수를 쓰세요.
> 예전에 `select('*')` 때문에 `admin_token` 이 공개 세션 전체에서 유출된 적이 있습니다(WORKFLOW 33번).

### `server.js`

| 위치(대략) | 내용 |
|---|---|
| ~80 | KST 날짜/시간 파싱 (`fmtDate`, `parseDuration`) |
| ~210 | 인증 헬퍼 |
| ~336 | `resolveProject` / `resolveSession` — code↔uuid 해석 |
| ~450 | 프로젝트 / 트랙 / 세션 CRUD |
| ~774 | 엑셀 세션 일괄 등록 |
| ~1300 | 구글 시트 연동 + 크론 |
| ~1463 | 질문 관리(답변/숨김/삭제) |
| ~1659 | Gemini 번역 |
| ~1785 | **공개 라우트** (`/api/public/*`) |
| ~2061 | 엑셀 export |

### 프론트 라우트

| 경로 | 화면 | 대상 |
|---|---|---|
| `#/admin` | 콘솔 홈 | 운영자(콘솔 토큰 게이트) |
| `#/admin/project/:projectId` | 프로젝트 상세 | 운영자 |
| `#/a/:code?token=` · `#/admin/session/:id?token=` | 세션 Q&A 대시보드 | 강연자·진행자 |
| `#/e/:projectCode` · `#/event/:projectId` | 행사 랜딩(세션 목록) | 참가자 |
| `#/s/:sessionCode` · `#/session/:id` | 세션 Q&A | 참가자 |
| `#/r/:projectCode/:roomNo` | **룸 QR** — 지금 세션으로 자동 연결·자동 전환 | 참가자 |
| `#/ra/:projectCode/:roomNo` | **룸 운영자(스피커) 화면** — 같은 판정으로 대시보드 자동 전환 | 룸 진행자(콘솔 토큰 게이트) |

**룸 화면 두 개는 판정 로직을 공유합니다.** `useRoomAutoSwitch(projectIdOrCode, roomNo)` 하나가 타임테이블 로드 + 현재 세션 판정 + 경계 타이머를 담당하고, `RoomPage`(참가자)와 `RoomAdminPage`(운영자)가 이걸 그대로 씁니다. 판정 규칙을 바꿀 땐 이 훅과 `pickRoomSession` 만 고치면 두 화면이 함께 바뀝니다 — **한쪽만 고쳐서 두 화면이 다른 세션을 보게 만들지 마세요.**

`#/ra/…` 의 인증이 다른 이유: 세션마다 `admin_token` 이 달라 룸 단위로는 URL 토큰을 쓸 수 없습니다. 그래서 `ConsoleTokenGate` 로 감싸고 콘솔 토큰을 `AdminDashboardPage` 의 `tokenOverride` prop 으로 넘깁니다. `requireSessionAdmin` 이 콘솔 토큰을 무조건 통과시키므로 세션이 바뀌어도 재인증이 없고, URL 에 토큰이 남지 않습니다.

---

## 6. 반드시 알아야 할 함정

작업하다 반드시 마주치는 것들입니다. 순서는 위험도 순.

### ① 룸 주소는 **코드 우선**, 숫자는 하위호환

`#/r/<행사코드>/<룸>` 의 마지막 세그먼트는 두 가지를 받습니다.

- **`tracks.code`(4자리, 권장)** — 트랙 자체에 붙는 고정값. 순서를 바꿔도 안 깨져서 **인쇄물에 쓰는 주소**입니다. 콘솔의 룸 QR이 이걸 생성합니다.
- **숫자(`1`, `2`…)** — 예전 주소. `sort_order` 로 해석되므로 **트랙 순서를 바꾸면 다른 룸을 가리킵니다.** 이미 뿌려진 QR을 살리기 위해서만 남겨 뒀습니다.

> ⚠️ 서버 해석 순서는 **반드시 코드 먼저**입니다. 코드는 4자리 hex라 `4809` 처럼 전부 숫자인 경우가 흔한데(약 15%), 숫자 판정을 먼저 하면 그런 코드가 룸 번호로 해석돼 404가 납니다. 실제로 이 순서 때문에 한 번 깨졌습니다.

### ② Realtime은 DELETE를 전달하지 않는다

`postgres_changes` 의 DELETE는 old record에 **기본키만** 실려 오므로 `session_id=eq.…` 필터에 걸리지 못해 구독자에게 아예 안 옵니다.
- `REPLICA IDENTITY FULL` 로 바꾸면 전달되지만, **DELETE에는 RLS가 적용되지 않아** 숨김 처리했던 질문 본문이 참가자 전원에게 브로드캐스트됩니다. 그래서 안 씁니다.
- 대신 사용자 페이지에 **18~24초 지터 폴링 백업**이 있습니다(안 보이는 탭에서는 안 돎).
- **INSERT/UPDATE는 정상 전달됩니다.** 라이브 중 부적절한 질문은 *삭제*보다 **숨김**을 쓰세요. 즉시 사라집니다.

### ③ 세션 수정 시 날짜가 오늘로 덮이던 버그

`parseDuration()` 이 `'HH:MM ~ HH:MM'` 을 오늘 날짜에 붙이던 문제였습니다. 지금은 기존 `starts_at` 의 KST 날짜를 유지합니다.
**세션 생성 폼에는 아직 날짜 입력이 없어서**, 같은 프로젝트의 가장 이른 세션 날짜를 물려받습니다. 근본 해결은 생성 폼에 날짜 필드 추가입니다.

### ④ 프로덕션 데이터로 파괴적 테스트 금지

실제 세션에 PATCH를 걸었다가 강연자명을 날린 적이 있습니다(WORKFLOW 35번, 아직 미복구 1건).
→ **버리는 테스트 세션을 만들어서 하거나, 전체 행을 먼저 백업**하세요. 테스트로 만든 질문·좋아요는 반드시 지우고 끝내세요.

### ⑤ Postgres 컬럼 REVOKE는 테이블 SELECT가 남아 있으면 무시된다

`REVOKE SELECT (admin_token)` 만으로는 막히지 않습니다. **테이블 SELECT를 회수한 뒤 안전 컬럼만 다시 GRANT** 하는 화이트리스트 방식이어야 합니다(`fix_admin_token_exposure.sql` 참고).

### ⑥ 길이 제한 에러 코드가 두 갈래

`content` 는 CHECK(`23514`, `questions_content_len`), `title`/`author` 는 `varchar(n)`(`22001`). 프론트가 둘 다 매핑하고 있으니, 제한을 바꿀 땐 `questionInsertMessage` 도 같이 고치세요.

### ⑦ 개발용 React 번들이 프로덕션에 나간다

`react.development.js` 를 그대로 씁니다. 성능을 더 짜야 한다면 **`react.production.min.js` 로 교체**가 가장 싼 개선입니다.

### ⑧ 함수 리전은 반드시 DB 와 같은 곳에

`vercel.json` 의 `"regions": ["icn1"]` 을 지우지 마세요. 기본값은 `iad1`(미국 동부)인데 Supabase 가 서울이라, **쿼리 한 번마다 태평양을 왕복**합니다. 랜딩처럼 순차 쿼리가 4번 있는 엔드포인트는 그대로 1초가 됩니다.

2026-07-30 부하 테스트 실측(p50, 동시성 10):

| | iad1 (기본) | icn1 (수정 후) |
|---|---:|---:|
| index.html | 572ms | **53ms** |
| 룸 타임테이블 API | 947ms | **92ms** |
| 행사 랜딩 API | 1111ms | **106ms** |
| 세션 단건 API | 891ms | **83ms** |

확인 방법: 응답 헤더 `x-vercel-id` 가 `icn1::icn1` 이어야 합니다. `icn1::iad1` 이면 잘못된 상태입니다.

> `vercel.json` 에 `//주석` 같은 임의 키를 넣으면 스키마 검증에서 **배포가 거부**됩니다.

### ⑨ SECURITY DEFINER 안에서 `current_user` 로 호출자를 판별하지 말 것

**definer 함수 안의 `current_user` 는 호출자가 아니라 함수 소유자입니다.** 이것 때문에 질문 도배 제한이 작성 시점부터 무효였고(항상 조기 return), 부하 테스트에서야 발견됐습니다 — anon 으로 20건을 연속 등록해도 전부 통과하고 `post_throttle` 이 계속 비어 있었습니다.

호출자 role 이 필요하면 `current_setting('role', true)` 를 쓰세요. PostgREST 가 요청마다 `SET LOCAL ROLE` 을 걸고, definer 진입은 이 GUC 를 바꾸지 않습니다. (`anon` / `service_role` / SQL Editor 는 `none`)

같은 파일의 `like_question()` 은 이 가드가 없어서 정상 동작했습니다. **비슷한 함수 사이에 동작 차이가 나면 role 판별부터 의심하세요.**

### ⑩ 세션의 "Q&A 대상"은 자기 id 가 아닐 수 있다

같은 강연을 두 룸에서 병행할 때(예: 8/21 16:00 NTE), 룸마다 세션 레코드가 필요하지만 질문은 하나로 모아야 합니다. `sessions.qa_parent_id` 가 그 연결이고, **질문을 읽고 쓰는 대상은 `qa_parent_id || id`** 입니다.

- 서버 헬퍼: `qaSessionId(session)`. 공개 세션 응답에 `qa_session_id` / `qa_merged` 로 실려 나갑니다.
- 프론트: `UserSessionPage` 의 `resolvedId` 에 이 값을 넣습니다. **`resolvedId` 하나만 바꾸면** 질문 목록·등록·좋아요·Realtime 구독·폴링이 전부 따라옵니다.
- 이미 반영된 곳: 참가자 질문 경로, 관리자 질문 목록, 세션 통계, 세션 엑셀 export.

> **질문 데이터를 옮기지 않습니다.** `questions.session_id` 는 그대로 두고 "어디를 보느냐"만 바꾸는 구조라, 통합을 해제하면 각 세션이 자기 질문으로 되돌아갑니다.
> 서버가 막는 것: 자기 자신 지정 / 다른 행사 세션 / **체인**(원본이 또 미러인 경우 — 해석이 여러 단계가 되고 순환이 생김) / 원본이 비공개인데 미러가 공개인 경우(RLS로 참가자에게 안 보임).
> **새 세션 경로를 추가할 때 `session.id` 를 그대로 질문 조회에 쓰면 통합이 깨집니다.** 반드시 `qaSessionId()` 를 거치세요.

---

## 7. 자주 하는 작업

### 새 API 추가

1. `server.js` 에 라우트 추가 — 관리자면 `requireConsole` 또는 `requireSessionAdmin` 을 **반드시** 통과시키세요.
2. 공개 라우트라면 반환 필드를 직접 나열하세요. `select('*')` 금지(`admin_token`·`source_key` 유출).
3. `index.html` 의 `mockApi` 에 대응 메서드 추가.
4. 컴포넌트에서 호출.

### 새 화면 추가

`routes` 배열(파일 맨 아래)에 `{ path, component }` 추가. 파라미터는 `:name`. 쿼리는 `useRouter().query`.

### 참가자 화면을 건드렸다면 반드시 확인할 것

- anon 경로에 `select('*')` 가 없는지
- 비공개 세션에서 여전히 404인지
- Realtime 등록/숨김이 즉시 반영되는지
- 좋아요 중복 차단(`disabled` + `aria-pressed`)이 유지되는지
- 콘솔 에러 0 (CDN 경고 2건은 정상)

---

## 8. 배포

Vercel 프로젝트 **`liveqna-app`** (팀 `384's projects`).

- **Git 미연결입니다.** GitHub에 푸시해도 자동 배포되지 않습니다. CLI로만 배포합니다.
- 프로젝트의 **Root Directory 가 `LiveQnA`** 입니다. 그래서 `.vercel/` 은 **리포 루트**에 두고, 배포도 **리포 루트에서** 실행합니다.

```bash
cd <griff_pj 클론 루트>     # LiveQnA/ 의 부모
vercel --prod --yes
```

`LiveQnA/` 안에서 실행하면 Vercel 이 `LiveQnA/LiveQnA` 를 찾으며 경로 오류가 납니다.

> 예전에는 작업 폴더가 평면 구조(파일이 루트에 흩어져 있음)라 임시 디렉터리에 `LiveQnA/` 를 만들어 스테이징한 뒤 배포했습니다. 리포 구조를 그대로 쓰는 지금은 그 단계가 필요 없습니다.

`.env.local` 은 배포에 포함되지 않습니다(`.vercelignore`). 환경변수는 Vercel 프로젝트 설정에 등록합니다.

```bash
# 운영자 토큰 교체
vercel env rm ADMIN_CONSOLE_TOKEN production --yes
printf '%s' '<새코드>' | vercel env add ADMIN_CONSOLE_TOKEN production
# 그 뒤 재배포 (코드는 서버 env 만 보므로 DB 변경 불필요)
```

**Hobby 플랜은 크론이 하루 1회로 제한**됩니다. `vercel.json` 의 `5 0 * * *` 을 더 촘촘하게 바꾸면 배포가 거부됩니다.

---

## 9. 배포 후 스모크 테스트

```bash
BASE=https://liveqna-app.vercel.app
curl -s -o /dev/null -w "%{http_code}\n" $BASE/                              # 200
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/admin/projects            # 401
curl -s $BASE/api/public/projects/<projectCode>/landing | head -c 200        # 200
curl -s $BASE/api/public/rooms/<projectCode>/1 | head -c 200                 # 200

# anon 키로 민감 컬럼이 막혀 있는지 (401 이어야 정상)
curl -s -o /dev/null -w "%{http_code}\n" \
  "$SUPABASE_URL/rest/v1/sessions?select=id,admin_token&limit=1" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

브라우저로는 참가자 페이지에서 **질문 등록 → Realtime 즉시 반영 → 좋아요 1표 후 버튼 비활성 → 콘솔 에러 0** 까지 확인하면 충분합니다.
