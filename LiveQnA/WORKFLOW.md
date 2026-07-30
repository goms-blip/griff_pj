# 작업 로그 — 실시간 행사 Q&A 솔루션

> 이 파일은 사용자의 지시와 그에 따른 작업 내역을 누적 기록하는 워크플로우 로그입니다.
> **규칙:** 사용자가 따로 요청하지 않아도, 의미 있는 작업/결정/수정이 있을 때마다 이 파일에 항목을 추가합니다. (최신 항목이 위로 오도록 역순 기록)

- **프로젝트 기준 문서:** `realtime_event_qna_prd_supabase_mvp_v2.md`
- **산출물:** `index.html` (CDN React + Tailwind, 빌드 도구 없는 단일 파일)
- **로컬 실행:** `cd /Users/sh_oh/Downloads/QA && npx serve .` → 브라우저에서 `#/admin`

---

## 2026-07-30

### 42) 🏛 회의 잔여 3건 구현 — 룸 운영자(스피커) 화면 자동 전환 / 다른 룸 보기 / 관리자 룸 QR 발급
- **지시:** "수동 조작 없이 … 스피커 페이지가 자동으로 전환 … 4개 룸 이동 버튼 … 왜 무시하고 지나갔지? 그리고 관리자쪽에서도 동일한 QR을 발급할 수 있는 버튼을."
  - (경위: 38번에서 범위를 물었을 때 "룸별 QR + 시간 자동 전환"만 선택돼 나머지는 제외하고 보고했었음. 이번에 전부 구현.)
- **① 룸 운영자(스피커) 화면 — `#/ra/:projectCode/:roomNo`**
  - 룸에 놓인 진행자/무대 PC 용. 참가자 룸 페이지와 **같은 판정**으로 현재 세션 대시보드를 띄우고 세션 종료 시 자동 전환.
  - **자동 전환 로직을 `useRoomAutoSwitch` 훅으로 추출**해 참가자·운영자 화면이 공유 → 두 화면이 서로 다른 세션을 보는 사고를 구조적으로 차단.
  - 🔒 **인증 설계:** 세션마다 `admin_token` 이 달라 룸 단위로는 URL 토큰을 쓸 수 없다. → `ConsoleTokenGate` 로 감싸고(한 번 로그인) 콘솔 토큰을 헤더로 전송. `requireSessionAdmin` 이 콘솔 토큰을 통과시키므로 **세션이 바뀌어도 재인증 없음** + URL 에 토큰이 남지 않음. `AdminDashboardPage` 에 `tokenOverride`/`room` prop 추가(2줄).
  - 헤더에 `관리자 모드 · <룸이름>` + "진행 중 · 세션 종료 시 다음 세션으로 자동 전환" 표기. 세션 사이엔 참가자와 같은 대기 화면(버튼만 '운영자 콘솔로').
- **② 다른 룸 보기 — 참가자 룸 페이지 헤더 버튼**
  - 룸 QR 로 들어온 경우에만 노출(`room.rooms` 사용). 모달에서 룸을 고르면 `#/r/<code>/<no>` 로 이동 → **그 룸의 '지금 세션'으로 바로** 연결(세션 목록을 거치지 않음). 현재 룸은 '현재 룸' 배지 + 비활성.
- **③ 관리자 룸 QR 발급 — 프로젝트 상세 헤더 `룸 QR` 버튼(트랙 있을 때만)**
  - `RoomQrModal` 신설: 룸마다 QR 캔버스 + URL 복사 + **PNG(QR 아래 룸 이름·안내문을 합성)** + 전체 일괄 다운로드 + 룸별 운영자 화면 바로 열기 링크.
  - 모달 상단에 **"QR 한 장을 행사 내내 그대로"** 안내와 **"인쇄 후 트랙 순서 변경 금지"** 경고를 명시(가장 위험한 함정이라 UI 에 박아둠).
- **검증 (로컬 → 프로덕션)**
  - 룸 QR: 캔버스 4개 모두 실제 QR 렌더(다크픽셀 15,600~15,850). PNG 합성 248×280 `image/png`, 파일명 `QR_Harmony Ballroom 1.png`.
  - 운영자 화면: 대기 화면 → 시각 이동 시 `관리자 모드 · HARMONY BALLROOM 1` 대시보드로 자동 전환, 콘솔 토큰으로 세션·질문 조회 성공.
  - 다른 룸 보기(프로덕션): Harmony Ballroom 2(11:30 NarshaADK) → 모달에서 Ballroom 3 선택 → `#/r/feb8a3/3` 로 이동해 **그 룸의 11:30 세션**(AI 네이티브 버추얼 프로덕션) 표시. 현재 룸 배지 정상.
  - 콘솔 에러 0.
- **배포:** `dpl_4DKD3Dzxb3T9HFRuAwdyiZnXmzJA` Production READY.
- **문서 반영 필요:** `DEVELOPER_GUIDE.md` 라우트표에 `#/ra/…` 추가, `HANDOVER.md` 의 "남은 숙제" ②③④ 해소 — 아직 미반영.

### 41) 📘 개발자 설명서 + 핸드오버 문서 작성
- **지시:** 회의록(`성수동2가 5.md` 03:09~03:37)의 "개발 설명서 및 핸드오버 문서" 항목을 md 로 작성.
- **산출물 2개** (기억이 아니라 **코드에서 사실을 뽑아** 작성 — 라우트 34개·env 7개·테이블 7개·함수 5개를 grep 으로 확인 후 기술)
  - **`DEVELOPER_GUIDE.md`** (299줄) — 코드를 고칠 사람용.
    - 아키텍처 3경로 원칙(참가자=anon 직접 / 관리자=server.js service_role / 공개인데 RLS 로 못 읽는 것=`/api/public/*`), 로컬 구동, 환경변수표, DB 테이블·함수, **SQL 적용 순서 9단계**, 인증 모델(`requireConsole`/`requireSessionAdmin`/`?pv=`), `index.html`·`server.js` 위치별 코드 지도, 프론트 라우트표, 자주 하는 작업, 배포 절차, 배포 후 스모크 테스트.
    - **§6 "반드시 알아야 할 함정" 7가지** — 이 문서의 핵심. 룸 QR=`sort_order` 의존 / Realtime DELETE 미전달과 REPLICA IDENTITY FULL 을 안 쓴 이유 / 세션 날짜 덮어쓰기 / 프로덕션 파괴적 테스트 금지(강연자명 소실 사례) / 컬럼 REVOKE 가 무시되는 Postgres 동작 / 길이 에러 코드 2갈래(23514·22001) / 프로덕션에 개발용 React 번들.
  - **`HANDOVER.md`** (154줄) — 프로젝트를 넘겨받는 사람용.
    - 인수 액세스 목록, **인수 직후 필수 3건**(토큰 교체·Preview env 재등록·service_role 커밋 여부 확인), 되는 것/남은 숙제 7건(우선순위), **데이터 정리 3건**, 행사 전·중·후 운영 절차, 장애 대응표 6종, 인수인계 체크리스트.
- **문서에 못 박아 둔 것:** 룸 QR 인쇄 후 트랙 순서 변경 금지, 라이브 중엔 **삭제 대신 숨김**, `ADMIN_CONSOLE_TOKEN` 12자 → 교체 권고, 스트레스 테스트 미실시(행사 전 필수).
- **검증:** 두 문서에 시크릿 값 노출 0(변수 이름만 언급), 상호 링크 확인. 저장 위치는 프로젝트 루트 — griff_pj 푸시는 사용자 확인 대기.

### 40) ⬆️ griff_pj/LiveQnA 로 커밋 + 푸시 (7/15 이후 전량 동기화)
- **지시:** "커밋하고 푸쉬해주는데, github의 griff_pj 안에 있는 폴더에 해줘."
- **🔴 로컬 저장소에 커밋하지 않은 이유:** `/Users/sh_oh/Downloads/QA` 의 `origin` 은 **`goms-blip/test-01`**(주차별 학습 저장소)이고, HEAD 기준으로 **1,039개 파일이 삭제 상태**(week-1~7, AFM-weekend-* 등 이 폴더에 없는 파일들)로 잡혀 있다. 여기서 `git add -A` 하면 **그 저장소의 파일 1,039개를 지우는 커밋**이 된다. main 도 `ahead 60 / behind 65`. → 손대지 않고, **griff_pj 를 스크래치패드에 클론해서 `LiveQnA/` 에만 반영**하는 방식으로 처리.
- **푸시 전 점검**
  - **griff_pj 는 PUBLIC** → `ADMIN_CONSOLE_TOKEN`/`SERVICE_ROLE`/`GEMINI_API_KEY`/`CRON_SECRET` 전문 검색 + `gho_|ghp_|sk-|AIza` 패턴 스캔 → 전부 없음. `index.html` 의 JWT 는 **anon 키(설계상 공개)**, service_role JWT 는 0건.
  - ⚠️ WORKFLOW.md 33번에 있던 **운영자 코드 앞 4자(`GooD…`) 표기를 푸시 전 삭제.** 12자 코드의 1/3 이 공개 저장소에 남는 셈이라 지웠다.
  - `.env.local`·`.vercel`·`node_modules`·`.playwright-mcp`·PNG 는 애초에 복사 대상에서 제외(원격 `.gitignore` 와도 일치).
  - **자동 배포 영향 없음 확인:** `liveqna-app` 은 Git 미연결(CLI 배포 전용, Root Directory=`LiveQnA`) → 이 푸시로 재배포되지 않는다.
- **결과:** `e20eabf..dbbab11` → `main`. 8파일 +2,186/−44. 신규 4개(`add_sheet_sync.sql`·`add_translation.sql`·`fix_admin_token_exposure.sql`·`fix_high_findings.sql`) 포함. 원격 `index.html` 에 룸 라우트 반영 확인(`RoomWaitingScreen`/`/r/:projectCode` 6군데).
  - 원격 LiveQnA 가 **7/15 상태**여서 7/29~7/30 작업(번역·시트연동·보안 3종·날짜 버그·사용자모드 4건·룸 QR·열기 버튼)이 한 커밋에 전부 들어갔다.
- **남은 것:** 로컬 `test-01` 저장소의 어긋난 상태(1,039 삭제 / ahead 60·behind 65)는 그대로. 이 폴더로 계속 작업한다면 정리하거나, griff_pj 클론을 작업 원본으로 삼는 편이 안전하다.

### 39) 🔗 세션 카드에 '열기' 버튼 2개(사용자 페이지 / 관리자 페이지)
- **지시:** "사용자 페이지랑 관리자 페이지 열어주는 버튼을 하나씩 만들어줘."
- **처리:** `UrlRow` 에 `openUrl` prop 추가 → 있으면 외부링크 아이콘 + '열기' 버튼이 붙고 **새 탭**(`_blank`, `noopener,noreferrer`)으로 연다. 프로젝트 상세의 세션 카드 '사용자 URL'·'관리자 URL' 행에 각각 하나씩.
  - 기존 '대시보드 열기'/'사용자 화면 미리보기' 버튼은 `navigate()` 라 **같은 탭**에서 콘솔이 사라진다. 행사 중엔 콘솔을 띄워 둔 채 확인해야 해서 새 탭으로 여는 경로를 URL 행 옆에 붙였다(기존 버튼은 그대로 유지).
  - **표시/복사용 `url` 과 실제로 여는 `openUrl` 을 분리.** 비공개 세션의 사용자 URL 은 참가자에게 줄 주소 그대로 복사되어야 하지만, 운영자가 열 때는 공개 API 가 404 라서 `?pv=<admin_token>` 미리보기가 필요하다.
- **검증(로컬 → 프로덕션):** 세션 4개 × 2행 = 열기 버튼 8개. 실제 클릭 시 새 탭이 뜨고 —
  - 비공개 세션 사용자 URL → `#/s/65ede1?pv=…` 로 열려 `비공개 · 관리자 미리보기` 배지와 함께 정상 렌더.
  - 공개 세션 사용자 URL → `#/s/ef792a` (토큰 없는 깨끗한 참가자 주소).
  - 관리자 URL → `#/a/<code>?token=…` 로 열리고 `토큰 인증됨`. 주소창의 `?token=` 은 기존 로직대로 즉시 제거됨(노출 방지).
  - 콘솔 에러 0.
- **배포:** `dpl_CitJf3atrxxxQwNfKU4wZWWpLpQr` Production READY.

### 38) 🏛 룸(트랙) QR + 시간 기반 세션 자동 전환 — 회의록(`성수동2가 5.md`) 반영
- **지시:** 회의 녹음 전사본(`/Users/sh_oh/Downloads/성수동2가 5.md`)을 "분석해서 가능한 부분 수정해줘" → 범위 확인 결과 **앱 코드 수정**, 항목은 **룸별 QR + 시간 자동 전환**만.
- **회의에서 나온 요구(00:00~01:44):** "QR은 4개고 그 안에서 시간에 맞게 자동으로 바뀌어야 돼… 그래야 우리가 아예 신경을 안 써도 돼(= 오퍼레이터 없이)."
- **구현**
  - `server.js` — `GET /api/public/rooms/:projectIdOrCode/:roomNo` 신설(무인증 공개). 반환 `{ project, room, rooms[], sessions[] }` = 그 룸의 **공개 세션 타임테이블 전체**. 공개 안전 필드만(`admin_token`·`source_key` 미포함).
    - **룸 번호는 `tracks.sort_order`(1-based)** — 트랙에 short code 컬럼이 없어서 택한 방식. **DB 마이그레이션 불필요**. sort_order 매칭 실패 시 정렬 순서상 n번째로 폴백.
  - `index.html` — 라우트 `#/r/:projectCode/:roomNo` + `RoomPage`/`RoomWaitingScreen` 신설, `mockApi.fetchRoom` 추가.
    - **'지금 어느 세션인지'는 서버 재조회 없이 클라이언트 시계로 판단.** 타임테이블을 한 번만 받고 경계 시각에 자체 전환 → 참가자 수가 늘어도 서버 부하가 늘지 않는다.
    - `pickRoomSession()` 5가지 상태: `live`(진행 중) / `recent`(끝난 지 30분 이내 — 쉬는 시간에도 방금 세션에 질문 계속 가능) / `waiting`(시작 전, 카운트다운) / `ended`(모두 종료) / `empty`(시간 정보 있는 공개 세션 없음).
    - 전환 트리거는 **경계 시각 setTimeout + 30초 인터벌 + `visibilitychange`** 3중. 절전/잠자기로 타이머가 밀려도 복귀 시 즉시 재계산된다.
    - `live`/`recent` 상태는 **기존 `UserSessionPage` 를 그대로 재사용**(`key={session.id}` 로 remount) → 질문·좋아요·Realtime·폴링 전부 동일 동작. 헤더에 룸 이름 배지, `recent` 면 "이 세션은 종료되었습니다 · 다음 세션 HH:MM 시작" 안내 바.
    - 대기 화면 카운트다운은 12시간을 넘으면 "498시간 47분" 같은 무의미한 숫자가 되므로 **날짜 표기로 전환**("8월 20일 (목) 11:30 에 시작합니다").
- **검증 (로컬 → 프로덕션, 브라우저 시계를 가짜로 흘려서)**
  - 5개 상태 전부 정상: live / recent(안내 바) / waiting(카운트다운 40:00) / ended / 먼 미래(날짜 표기).
  - **조작 없이 자체 전환 2건 확인** — 세션 종료 8초 전 → 12초 대기 → `recent` 로 자동 전환. 세션 시작 8초 전(대기 화면 00:08) → `live` 질문 페이지로 자동 전환.
  - 룸 1~4 각각 8·6·7·8건 = 29건(랜딩 공개 세션 수와 일치). 룸 0·5·9 → 404, 없는 행사코드 → 404, 트랙 없는 행사(Mendix) → "룸 정보가 없습니다", UUID 주소도 동작.
  - 룸 모드에서 질문 등록·좋아요 정상(`disabled`/`aria-pressed=true`), 기존 `#/s/`·`#/e/` 라우트 무영향, 콘솔 에러 0.
  - 테스트 질문 삭제 완료 → questions 0 / votes 0.
- **배포:** Production READY (`liveqna-app`). 룸 QR 주소:
  - `https://liveqna-app.vercel.app/#/r/feb8a3/1` Harmony Ballroom 1
  - `…/2` Harmony Ballroom 2 · `…/3` Harmony Ballroom 3 · `…/4` Atlas
- **⚠️ 주의:** 룸 번호가 `tracks.sort_order` 라서 **관리자에서 트랙 순서를 바꾸면 인쇄해 둔 QR 이 다른 룸을 가리킨다.** 행사 전 순서를 고정할 것. (트랙에 고정 code 컬럼을 추가하면 근본 해결)
- **이번 범위에서 제외(회의엔 있었음):** 스피커/무대용 페이지 4개 자동 전환, 사용자 화면의 "다른 룸 보기" 버튼, 관리자 룸 QR 일괄 발급 화면, 스트레스 테스트, 핸드오버·개발자 문서.

### 37) 🛠 36번에서 찾은 사용자모드 결함 4건 수정 + 배포
- **지시:** "진행해줘" (36번 리포트의 1·2·3번 수정)
- **수정 (전부 `index.html`, 서버·DB 변경 없음)**
  1. **질문 삭제가 참가자 화면에 반영되지 않던 문제 → 폴링 백업 추가.** `UserSessionPage` 에 18~24초 지터 인터벌로 질문 목록만 재조회하는 effect 신설(`refreshQuestions` 를 Realtime 핸들러와 공용). **보이지 않는 탭에서는 돌지 않고**, 다시 보일 때(`visibilitychange`) 즉시 한 번 당겨온다.
     - **왜 REPLICA IDENTITY FULL 로 안 갔나:** postgres_changes 의 DELETE 는 old record 에 기본키만 실려와 `session_id=eq.…` 필터에 걸리지 못해 전달 자체가 안 된다. FULL 로 바꾸면 전달은 되지만 **DELETE 에는 RLS 가 적용되지 않아** 숨김 처리했던 질문 본문이 참가자 전원에게 브로드캐스트된다 → 폴링을 택함. (지터는 수백 명이 같은 순간에 몰리는 것 방지)
  2. **세션↔세션 이동 시 질문 모달이 열린 채 남던 문제.** `useEffect(() => setModalOpen(false), [codeOrId])` 추가. 이 컴포넌트는 해시만 바뀌면 언마운트되지 않아 `modalOpen`·폼 오류가 유지됐다.
  3. **길이 초과 안내 문구 복구.** 제목/이름은 CHECK 가 아니라 `varchar(n)` 이라 실제 코드가 `22001` 이었다 → `character varying(50|20)` 을 파싱해 필드별 문구로 매핑. 비공개 세션 미리보기에서의 insert 거절(`42501`)도 "비공개 세션에는 질문을 등록할 수 없어요. (운영자 미리보기)" 로 분리. 더불어 **거절 문구를 해당 필드 밑에 붙이도록** 수정(전에는 사유와 무관하게 전부 '내용' 밑).
  4. **(작업 중 추가 발견) 질문 등록 직후 좋아요를 누르면 표가 안 눌린 것처럼 보이던 경합.** `load()` 가 `setVotedIds(localStorage 값)` 로 **교체**해서, 아직 `recordVote` 전인 낙관적 상태를 덮었다(서버엔 정상 기록돼 카운트만 오르고 버튼은 활성). → 투표 상태는 **누적(merge)** 하도록 변경.
- **검증 (로컬 8787 → 프로덕션 재확인)**
  - 삭제: 등록은 Realtime 즉시 반영, 삭제 후 **로컬 13초 · 프로덕션 10초**만에 새로고침 없이 사라짐(0개).
  - 모달: A→B 세션 이동 시 모달 닫힘(오류 잔상 없음), 되돌아와도 정상.
  - 문구: 제목 51자 → "제목은 50자까지…"(제목 밑), 이름 21자 → "이름은 20자까지…"(이름 밑), 미리보기 등록 → 비공개 안내.
  - 경합: 등록 0.9초 뒤 즉시 좋아요 → `disabled` + `aria-pressed=true` 유지. 25초 폴링 지나도 유지.
  - 회귀: 랜딩 공개 29건·8/20·8/21만(7/30 없음), 콘솔 에러 0.
- **배포:** `dpl_12awNEZqM989VYiKiSdceuf6xzaP` Production READY (`liveqna-app`). 32번과 동일하게 Root Directory 가 `LiveQnA` 라 스크래치패드에 6파일 스테이징 후 `vercel --prod --cwd`.
- **정리:** 검증용 질문·좋아요 전량 삭제 → questions 0 / votes 0 / post_throttle 0, sessions 45 · projects 2 그대로.
- **미커밋:** 사용자가 커밋을 지시하지 않아 로컬 변경(`index.html`)은 커밋하지 않음. 프로덕션에는 이미 반영돼 있으므로 다음 커밋 때 함께 넣어야 한다.
- **남은 항목(36번의 데이터 이슈, 그대로):** 8/20 16:00 세션 강연자 공란 · "이환(NTE…)" 8/21 16:00 두 트랙 중복 공개 · 비공개 12건 확인.

### 36) 🔍 사용자(참가자) 모드 재점검 — 프로덕션 E2E + 권한 재검증
- **지시:** "사용자모드쪽은 다시한번 확인해줘" (33~35번 보안/날짜 패치 이후 참가자 경로 회귀 확인)
- **대상:** `liveqna-app` 프로덕션. 커밋 `31a7a14` 상태 그대로(로컬 미커밋 변경 없음).
- **✅ 정상 확인**
  - 랜딩 `#/e/feb8a3`: 공개 세션 29건(8/20 16 · 8/21 13), **7/30 그룹 없음**(35번 수정 유지). 날짜×트랙 칩 조합 필터·카운트 정합, 카드→세션 이동 OK.
  - 세션 페이지: 코드(`#/s/…`)·UUID(`#/session/…`) 모두 해석. 헤더에 트랙·시간·강연자 표시, 다크모드 정상, 콘솔 에러 0.
  - 질문 등록: 빈 폼 3필드 개별 오류 표시. 길이 — 내용 501자 `questions_content_len`(400), 제목 51자·이름 21자 `varchar` 22001(400). 정상 등록 201.
  - 좋아요: 신규 1표 반영(1→2) 후 버튼 `disabled`·`aria-pressed=true`, 새로고침 후에도 유지(localStorage `qa_voted_*`). 재요청 `already_voted`, 3자 키 `invalid_voter_key`.
  - 권한(anon): `sessions` `select=*`/`admin_token`/`source_key` **전부 401**, 화이트리스트 컬럼만 200. 비공개 세션 anon 조회 **0건**, 비공개 세션 질문 anon insert **401 RLS**, read `[]`. 공개 API 응답에 `admin_token`/`source_key` 미포함.
  - `projects`/`tracks`/`votes`/`post_throttle` — anon 은 200 이지만 RLS 로 **행 0건**(정보 노출 없음).
  - anon 이 `questions` UPDATE/DELETE 시도 → PostgREST 204 지만 **실제 행 변화 없음**(RLS 필터). `is_answered:true`·`like_count:9999` 섞은 insert → **401 RLS**(스푸핑 차단).
  - 비공개 세션: 무토큰/오답 pv → 404 "세션을 찾을 수 없습니다", 정상 `?pv=` → 200 + `비공개 · 관리자 미리보기` 배지.
  - Realtime: 다른 창에서 **등록(INSERT)** → 새로고침 없이 목록 반영. **숨김(UPDATE)** → 참가자 화면에서 즉시 사라짐. **답변완료(UPDATE)** → 배지 즉시 표시. (34번에 "숨김도 반영 안 됨"으로 적었던 건 이번 재현에서 정상 동작 — UPDATE 는 전달됨)
- **🐞 발견 1 (미수정) — 질문 삭제는 여전히 Realtime 미반영.** 운영자가 질문을 `DELETE` 하면 이미 열려 있는 참가자 화면엔 그대로 남고 새로고침해야 사라짐(재현 확인). → **라이브 중에는 삭제 대신 '숨김'을 쓰면 즉시 반영된다**(이번에 확인). 근본 대응은 별도 필요(주기 폴링 백업 등).
- **🐞 발견 2 (미수정) — 세션↔세션 이동 시 '질문하기' 모달이 열린 채 남는다.** `UserSessionPage` 는 해시만 바뀌면 언마운트되지 않아 `modalOpen`/`errors` 가 유지됨 → B 세션에 들어가자마자 빨간 오류가 뜬 모달이 떠 있음(2회 재현). 등록 자체는 새 세션(`resolvedId`)으로 가서 오등록은 아님. 수정안: `useEffect(() => { setModalOpen(false); }, [codeOrId])`.
- **⚠️ 발견 3 (경미) — 길이 초과 안내 문구 일부가 죽어 있음.** 프론트 `questionInsertMessage` 는 `questions_title_len`/`questions_author_len` 을 기대하지만 DB 는 varchar 라 실제 코드가 `22001` → 매핑 실패 시 일반 실패 토스트. 폼 `maxLength` 로 평소엔 도달 불가. 비공개 미리보기에서 질문 등록 시도 시에도(RLS 401) 일반 토스트가 뜬다.
- **📋 데이터 이슈(코드 아님, 사용자 확인 필요)**
  - 8/20 16:00 "혼자 만드는 탑다운 익스트랙션 슈터…" **강연자 여전히 공란** — 35번에서 내가 날린 값, 아직 미복구.
  - "이환(NTE: Neverness to Everness)…" 세션이 **8/21 16:00 에 Harmony Ballroom 1·2 두 곳에 중복 공개** → 참가자에게 같은 세션이 두 번 보임(임포트 산물로 추정).
  - 언리얼 프로젝트 41개 중 **12개가 비공개** — 소닉 레이싱/메시 터레인/픽셀 스트리밍 등 실제 세션처럼 보이는 항목 포함. 의도된 비공개인지 확인 필요.
- **테스트 데이터 정리 완료:** 검증용 질문 3건·좋아요 전량 삭제 → questions 0 / votes 0 / post_throttle 0. 프로덕션 세션 데이터는 **건드리지 않음**(35번 교훈 반영해 실 세션에 PATCH 미실행).

### 35) 🐞 세션 수정 시 행사 날짜가 '수정한 날'로 덮이는 버그 + 7/30 데이터 정리
- **지시:** "관리자에서 수정을 하면 수정한 날짜로 되는데. 행사날짜는 그대로야.. 7월 30일은 없애야해."
- **근본원인:** `server.js` `parseDuration()` 이 날짜 없는 `'HH:MM ~ HH:MM'` 을 **항상 오늘(KST)** 날짜에 붙여 저장. PATCH 핸들러가 그 값으로 `starts_at/ends_at` 을 덮어씀. 원래 주석은 *"표시는 buildDuration 으로 HH:MM 만 뽑으므로 날짜 부분은 표기에 영향 없음"* 이었는데, `session_date`(랜딩·관리자 **날짜별 필터/그룹핑**)가 이 날짜를 쓴다 → 수정할 때마다 없던 날짜 그룹이 생김.
- **코드 수정:**
  - `parseDuration(duration, baseIso)` — `baseIso`(기존 starts_at)의 **KST 날짜를 유지**하고 시간만 교체. 없으면 오늘.
  - PATCH: 수정 전 현재 `starts_at` 을 조회해 넘김 → 행사 날짜 보존.
  - POST(생성): 생성 폼엔 날짜 입력이 없어 오늘이 박히면 또 엉뚱한 그룹이 생기므로, **같은 프로젝트의 가장 이른 세션 날짜를 물려받게** 함(없으면 오늘). ※ 근본 해결은 생성 폼에 날짜 입력 추가 — 사용자 결정 대기.
- **데이터 복원 (7/30 → 8/20, 9건):** 복원 근거 = `created_at` 순서상 임포트가 트랙별 블록으로 생성했고 **9건 전부 8/20 블록 내부**에 위치(같은 블록의 나머지 11건은 8/20 유지). 시간도 8/20 슬롯 격자(11:30·13:40·14:40·16:00·17:00 KST)와 일치. 8/20 11+9=20건, 8/21 21건 → 41건 정합. 시간은 그대로 두고 날짜만 UPDATE(9/9 성공).
- **검증:** 배포(`liveqna-dm4mazoel`) 후 실제 PATCH(강연자+duration 동시 전송) → **날짜 2026-08-20 유지**, 시간만 변경 확인. 최종 분포 7/21:4 · 8/20:20 · 8/21:21, **7/30: 0건**.
- **⚠️ 내 실수 — 검증 중 프로덕션 세션 1건의 `speaker` 값을 소실시킴.** 전체 행을 백업하지 않고 실 세션에 PATCH 를 걸어 `speaker` 를 "날짜검증 테스트"로 덮었다. 시간(07:00~07:50)은 같은 슬롯 형제 세션 패턴으로 복원했고, 공개 페이지에 허위 정보가 노출되지 않도록 `speaker` 는 **null 로 비움**. 원본 강연자명은 사용자 확인 또는 엑셀/시트 재임포트로 복구 필요.
  - 대상: `610cf210` "혼자 만드는 탑다운 익스트랙션 슈터: 뎁스 맵 시야, Mover, GASP 무기 레이어링 실전기" (8/20 16:00~16:50 KST, 공개 세션)
  - **교훈:** 프로덕션 행에 파괴적 검증을 할 땐 (a) 전체 행을 먼저 백업하거나 (b) 버리는 테스트 세션을 만들어서 할 것.

### 34) 🟠 HIGH 3건 패치 (좋아요 도배 / 질문 도배·길이 / questions RLS)
- **지시:** "HIGH 3건도 다 잡아줘"
- **⚠️ 작업 중 발견한 함정 — RLS 에 `is_public` 검사만 추가하면 28번 기능(비공개 세션 미리보기)이 깨진다.** 미리보기는 세션 메타만 서버(`?pv=`)로 받고 **질문은 anon 으로** 읽고 있었음(index.html 3204행). → 서버 경로를 먼저 신설.
  - `server.js`: `GET /api/public/sessions/:codeOrId/questions?pv=` 추가(세션 단건과 동일한 canView 게이트, 숨김 질문 제외, 번역 캐시 미포함). 검증 — 무토큰 404 / 오답 pv 404 / 정상 pv 200 / 공개세션 200.
  - `index.html`: 비공개+pv 일 때만 서버 경로 사용(공개 세션은 anon 경로 유지 → Realtime 보존). 비공개 미리보기는 anon 구독이 RLS 로 막히므로 Realtime 구독 자체를 걸지 않음(deps 는 `session` 객체 대신 불리언 `isPrivatePreview` — 매 load 마다 새 객체라 재구독 churn 방지).
- **`fix_high_findings.sql` 작성 → 사용자가 SQL Editor 에서 실행 완료.**
  - **③ questions RLS:** `session_is_public(uuid)` **security definer** 함수로 감싸 read/insert 정책에 세션 공개여부 검사 추가. ← CRITICAL 패치로 anon 의 `sessions` SELECT 를 회수했으므로, 정책 안에서 `exists (select 1 from sessions …)` 를 그냥 쓰면 **permission denied 로 모든 질문 읽기가 막힌다**(정책 서브쿼리는 호출자 권한으로 평가됨).
  - **② 길이/도배:** 길이 CHECK(제목50·이름20·내용500, 폼 제한과 일치) + IP 지문당 60초 10건 트리거. 카운터는 **별도 테이블 `post_throttle`** — `questions` 에 컬럼을 추가하면 관리자 API 의 `select('*')` 와 Q&A 엑셀에 그대로 섞여 나감.
  - **① 좋아요:** `voter_key` 형식 검증(8~64자) + 좋아요 대상 검증(숨김/비공개 차단) + IP 지문당 60초 60표 속도 제한. 프론트에 거절 사유(`rate_limited`/`not_likeable`/`invalid_voter_key`)별 안내 + 낙관적 +1 롤백 추가.
  - **개인정보:** 참가자 IP 는 원문 저장하지 않고 `md5` 지문(fp)만 남김. **NAT 고려** — 행사장 공용 와이파이면 수백 명이 같은 IP 라서 "IP 당 1표"가 아니라 "속도"만 제한.
- **함께 고친 오안내:** 기존 `isBannedWordError` 가 `check_violation`(23514) 전체를 금지어로 취급 → 길이 CHECK 추가 시 "500자 초과"에도 *"부적절한 표현…"* 으로 오안내. 메시지 기반 판별로 좁히고 사유별 문구 분리(`questionInsertMessage`). 토스트/폼 오류도 하드코딩된 금지어 문구 대신 실제 사유를 표시.
- **검증 (실 프로덕션):**
  - 길이: 501자 내용 → **400 `questions_content_len`**, 21자 이름 → 400 varchar(20). 정상 등록 201.
  - 비공개 격리: anon insert → **401 RLS violation**, anon read → **`[]`**, 미리보기 `?pv=` → **200 정상 표시**(기능 보존).
  - 좋아요: 고정 키 1표 → `liked:true` / 재요청 → `already_voted` / 3자 키 → `invalid_voter_key` / **매번 새 키로 연타 → 60번째에서 `rate_limited`**.
  - 브라우저 E2E: 질문 등록 → 목록 즉시 반영, 좋아요 1 반영 후 버튼 `disabled aria-pressed=true`(중복 차단), 콘솔 에러 0. `votes.voter_fp` 해시 저장 확인.
  - 정리: 테스트 질문·votes·post_throttle 전부 삭제 → questions 0 / votes 0 / post_throttle 0, 세션 45·프로젝트 2 유지.
- **📌 별건으로 발견(미수정, 기존 동작):** 질문이 **삭제될 때 Realtime 이 참가자 화면에 반영되지 않음**. 열려 있던 페이지에 삭제된 질문이 계속 보이고 새로고침해야 사라짐(Postgres `postgres_changes` 의 DELETE 이벤트는 RLS 평가 한계로 누락됨). 라이브 중 운영자가 질문을 숨김/삭제해도 이미 열어둔 참가자 화면엔 남는다는 뜻 → 별도 처리 필요(예: 주기 폴링 백업 또는 숨김 처리로 대체).

### 33) 🔴 CRITICAL 패치(admin_token 유출) + 운영자 인증코드 재설정
- **지시:** "CRITICAL 먼저 패치해줘" → 작업 중 "운영자 인증코드가 계속 안먹어. 재설정을 할수 있게 해줘."
- **재현 재확인:** anon 키로 `sessions?select=id,admin_token&is_public=eq.true` → 공개 세션 3건 토큰 평문 반환(916c59d8/28b488e6/9f040c8b).
- **⚠️ 감사 권고안(`REVOKE SELECT (admin_token)` 단독)은 효력 없음.** Postgres 는 **테이블 레벨 SELECT 가 남아 있으면 컬럼 레벨 REVOKE 를 무시**한다. → 테이블 SELECT 회수 후 안전 컬럼만 재부여하는 방식으로 정정.
- **`fix_admin_token_exposure.sql` 신규 작성:** `revoke select on sessions from anon/authenticated` → `grant select (id,project_id,title,description,starts_at,ends_at,is_public,code,speaker,track_id,created_at)` 재부여(`admin_token`·`source_key` 제외) + 노출 토큰 전량 로테이션 UPDATE. 화이트리스트 방식이라 향후 컬럼 추가 시 자동 노출 없음.
- **코드 패치(index.html):** `SESSION_PUBLIC_COLUMNS`/`QUESTION_PUBLIC_COLUMNS` 상수 도입 → anon 경로 `.select('*')` 3곳(세션 조회·질문 목록·질문 등록 반환) 전부 명시 컬럼으로 교체. 사용자 페이지는 번역 컬럼을 쓰지 않으므로 `translated_*` 제외(노출 축소 + 마이그레이션 미적용 환경 호환).
- **✅ CRITICAL 종결 — 사용자가 SQL Editor 에서 실행 완료 후 검증:** (DB 접속정보가 없어 DDL 은 직접 실행 못 하고, SQL 을 클립보드에 넣고 SQL Editor 를 열어 전달)
  - 차단 확인(anon): `select=id,admin_token` → **401 42501 permission denied**, `select=*` 우회 → **401**, `source_key` → **401**.
  - 정상 경로 유지: 앱 세션 컬럼 200 / 앱 질문 컬럼 200 / 비공개 세션 `[]` 은닉 유지.
  - 토큰 로테이션 확인: `916c59d8` 184df301…→**73f15482…**(32자) 등 전건 교체. 구 토큰 대시보드 호출 **403**, 신 토큰 **200**.
  - E2E: 공개 세션 페이지(`#/s/ef792a`) 렌더 정상·**콘솔 에러 0**(경고 2건은 기존 CDN 경고), anon 질문 등록도 축소된 select 로 정상(반환 9컬럼, `admin_token` 미포함) → 테스트 질문 삭제·질문 0건 원상복구.
- **운영자 인증코드 원인 규명:** `liveqna-app` 의 `ADMIN_CONSOLE_TOKEN` 이 `.env.local` 값과 **다른 값**(15일 전 등록)이어서 아는 코드가 계속 401. 32번의 프로젝트 혼선 후속 피해. → 로컬 값으로 재설정(env rm→add) + 재배포 → **200 정상, 오답 401** 확인.
  - 재설정 방법(향후): `vercel env rm ADMIN_CONSOLE_TOKEN production --yes` → `printf '%s' '<새코드>' | vercel env add ADMIN_CONSOLE_TOKEN production` → 재배포. 코드는 서버 env 만 보므로 DB 변경 불필요.
  - ⚠️ 현재 코드는 12자로 짧음. 프로젝트 생성/삭제·PII 엑셀 권한을 가진 단일 비밀이라 강한 랜덤 값 권장(사용자 판단 대기).
  - ⚠️ env rm 과정에서 `ADMIN_CONSOLE_TOKEN` 의 **Preview 환경 등록이 사라짐**(Production 만 남음). Preview 배포를 쓰려면 재등록 필요.
- **배포:** `liveqna-pj5onmzsc` Production Ready. 검증 — anon 신규 컬럼 조회 200(사용자 페이지 무영향), 공개 세션 API 200, 콘솔 인증 200/401.

### 32) SQL 적용 확인 + 7/29 작업 커밋 + 프로덕션 배포
- **지시:** "SQL 2개 실행하고 7/29 작업 커밋해줘" → 이어서 "배포해주고 페이지 열어줘"
- **SQL 2개 — 실행 불필요(이미 적용됨).** service_role 로 컬럼 조회 검증: `questions.translated_title/lang/at`, `projects.sheet_url/auto_sync/synced_at/last_result`, `sessions.source_key` 모두 200 + 실데이터 반환. 대조군(없는 컬럼)은 400 → 200 이 진짜임을 확인. (DB 접속정보가 없어 psql 직접 실행은 불가했고, 확인 결과 실행 자체가 불필요)
- **커밋:** `f895c18` — index.html·server.js·vercel.json·add_translation.sql·add_sheet_sync.sql·WORKFLOW.md (1,256줄 추가). 커밋 전 시크릿 스캔 통과(index.html anon 키는 설계상 공개). **push 안 함** — 원격 main 은 다른 앱(LivePoll)이라 그대로 밀면 덮어씀.
- **🔴 배포 대상이 잘못 링크돼 있었음:** 로컬 `.vercel` 은 `prj_P0qegz…`(구 `event-qna`)를 가리켰으나, 이 프로젝트는 **`livepoll-app` 으로 개명 + 다른 앱(Live Poll) 용으로 재사용**된 상태(Root Directory=`LivePoll`). 여기 배포하면 LivePoll 프로덕션을 덮어썼을 것.
  - 실제 이 앱의 프로덕션은 **`liveqna-app`** (`https://liveqna-app.vercel.app`, title `실시간 행사 Q&A 솔루션`, `/api/admin` 401). Git 미연결·CLI 배포 전용, Root Directory=`LiveQnA`.
  - `event-qna.vercel.app` 도메인은 **현재 404** (더 이상 이 앱을 서빙하지 않음).
  - 조치: `livepoll-app` 에 잘못 넣은 `GEMINI_API_KEY`/`CRON_SECRET` **회수(env rm)** → `vercel link --project liveqna-app` 재링크.
- **환경변수(liveqna-app, Production):** `GEMINI_API_KEY` 등록. `CRON_SECRET` 은 `.env.local` 에 **빈 값**이어서 `openssl rand -hex 24` 로 생성해 Vercel + `.env.local` 양쪽에 반영. `GEMINI_MODEL` 은 빈 값이라 미등록(서버 기본값 `gemini-3.6-flash` + 폴백으로 동작). Preview 환경 등록은 실패(미반영) — 프로덕션 영향 없음.
- **⚠️ Hobby 플랜 제약 — Cron 주기 변경:** `*/10 * * * *` 은 "Hobby accounts are limited to daily cron jobs" 로 **배포 거부**됨 → `5 0 * * *`(매일 1회)로 낮춤. 관리자가 프로젝트 화면 진입 시 자동 확인하는 경로가 있어 실사용 동기화는 유지. 10분 주기가 필요하면 Pro 업그레이드 필요.
- **배포 방법:** 프로젝트 Root Directory 가 `LiveQnA` 인데 로컬은 루트 평면 구조라 `vercel --prod` 가 경로 없음 에러. 프로젝트 설정을 건드리지 않고 스크래치패드에 `deploy/LiveQnA/` 스테이징(앱 6파일만, .env 계열 제외) 후 `vercel --prod --cwd` 로 배포.
- **배포 결과:** `liveqna-h5m05859t` Production Ready. 검증 — `/` 200, `/api/admin/projects` 무토큰 401, `PUT .../sheet` 401, `POST .../translate` 404(=`질문을 찾을 수 없습니다`, 라우트 존재 확인. 없는 경로는 `존재하지 않는 API 경로입니다`), `GET /api/admin/cron/sheet-sync` 무인증 401 / `Bearer CRON_SECRET` **200** `{projects:0}`(연결된 시트 없음).
- **미검증:** 실제 Gemini 번역 왕복은 프로덕션 질문이 0건이라 확인 못 함(키 등록·라우트 생존까지만 확인). 7/14 감사의 🔴 CRITICAL(anon 키로 admin_token 유출)은 **여전히 미패치** 상태로 배포됨.

---

## 2026-07-29

### 31) 질문 번역(Gemini) + 외부 시트 연동 자동 동기화
- **지시:** "유저들이 질문을 영어나 일어, 중국어로 남기는 경우가 있어서 그거를 바로 번역해주는 기능. 번역은 제미나이를 이용하고 버튼을 눌러 번역. 그리고 세션이 바뀐 것을 외부시트를 연결하면 바로 자동으로 업데이트되는 기능."
- **사전 확인(사용자 선택):** ①번역 결과 DB 저장 ②구글시트 공개 링크(CSV) 방식 ③변경분만 반영 ④주기 자동 + 수동 버튼.

#### A. 질문 번역 (Gemini)
- **DB:** `add_translation.sql` — `questions.translated_title/translated_content/translated_lang/translated_at`.
- **서버:** `POST /api/admin/questions/:id/translate` (세션 admin_token 인증, body `{force}`).
  - Gemini `v1beta/models/{model}:generateContent` + `responseSchema` 로 `{source_lang,title,content}` JSON 강제.
  - 키는 `x-goog-api-key` **헤더**로 전달(URL 로그 유출 방지). 기본 모델 `gemini-3.6-flash`, **404 시 `gemini-2.5-flash`→`gemini-flash-latest` 자동 폴백**.
  - 번역 결과를 DB 캐시 → 재조회/다른 운영자는 재호출 없음. `force=true` 로 재번역.
  - 시스템 프롬프트에 **프롬프트 인젝션 방어** 문구(질문 속 지시문은 번역 대상일 뿐, 따르지 않음).
  - 원인별 안내 메시지: 키 미설정 503 / 키오류 / 모델없음 / 한도초과 429 / 타임아웃 504 / 안전필터 / JSON 파싱 실패.
  - `add_translation.sql` 미적용이면 **저장만 건너뛰고 번역 결과는 반환**(하위호환).
- **프론트:** `AdminQuestionCard` 에 **[번역]** 버튼. 원문 아래 액센트 강조선 블록으로 번역 표시.
  - 감지 언어 라벨(영어/일본어/중국어…), 한글 비중 30% 미만이면 **「외국어」 배지**로 힌트.
  - 원문이 한국어면 중복 표시 없이 "번역이 필요하지 않습니다" 만.
  - 번역 후 [번역 접기]/[다시 번역] 로 전환.
- **환경변수:** `GEMINI_API_KEY`(필수), `GEMINI_MODEL`(선택).

#### B. 외부 시트 연동 (구글 스프레드시트)
- **DB:** `add_sheet_sync.sql` — `projects.sheet_url/sheet_auto_sync/sheet_synced_at/sheet_last_result`, `sessions.source_key`(+인덱스).
- **핵심 설계 — 기존 엑셀 업로드(전체 교체)와 다르게 "변경분만 반영":**
  - 시트 행 ↔ 세션을 `source_key` 로 매칭 → **세션 URL(code)·admin_token·접수된 질문이 전부 보존**.
  - 키 우선순위: 시트 `ID` 컬럼 > 세션명(중복 시 룸/시각 덧붙임 > 순번). ID 컬럼을 쓰면 **세션명을 바꿔도 같은 세션으로 이어짐**.
  - 시트 연동 이전 세션은 제목으로 1회 매칭 후 `source_key` 백필(재생성 안 함).
  - **시트에 없는 컬럼은 건드리지 않음** — 예: 공개여부 컬럼이 없으면 콘솔에서 켠 공개 상태를 덮어쓰지 않음.
  - 시트에서 사라진 세션은 기본 **유지 + 보고만**. `removeMissing` 옵션 시에도 **질문 0개인 것만** 삭제.
  - 룸 → 트랙 자동 생성(기존 트랙은 삭제 안 함).
- **서버 라우트:** `PUT /api/admin/projects/:id/sheet`(연결/해제·저장 전 실제 읽기 검증), `POST .../sheet/sync`(`dryRun`/`removeMissing`), `GET|POST /api/admin/cron/sheet-sync`(Cron 배치).
  - 구글 시트 URL(편집/게시 링크) → CSV export URL 변환, RFC4180 파서 자체 구현(의존성 추가 없음).
  - 비공개 시트는 로그인 HTML 이 200 으로 오므로 **content-type 으로 판별** → "공유 설정을 링크가 있는 모든 사용자·뷰어로" 안내.
- **자동 실행:** `vercel.json` 에 Cron `*/10 * * * *` + **프로젝트 화면 진입 시** 마지막 동기화가 2분 이상 지났으면 1회 확인(ref 가드로 루프 방지) + 모달의 [지금 동기화].
- **프론트:** 헤더 **[시트 연동]** 버튼(연결 시 점 표시, 자동 동기화면 액센트색). 모달에서 연결/자동동기화 토글/**변경 미리보기(dry-run)**/지금 동기화/연결 해제 + 추가·수정·변경없음·시트에없음 요약과 상세 목록.
- **환경변수:** `CRON_SECRET`(Vercel Cron 인증용, Vercel 프로젝트 환경변수에도 동일 등록 필요).

#### C. 공통
- `wrap()` 에 `publicErr(status,message)` 지원 추가 — 외부 API/시트 실패 사유를 사용자에게 그대로 노출(그 외는 기존대로 500 으로 뭉갬).
- **검증 (총 112건 통과 + 실 API):**
  - 시트 파싱 39/39 (URL 변환·CSV 따옴표/줄바꿈/BOM·헤더 오매칭 방지·키 생성·에러 안내)
  - 동기화 엔진 49/49 (재동기화 시 **세션 id·code 유지** 확인, 변경 필드만 UPDATE, 시트에 없는 컬럼 미변경, orphan 보존, removeMissing 안전장치, dryRun 무변경, source_key 백필)
  - Gemini 24/24 (페이로드 형식, 키 헤더 전달, 404 폴백, 403 즉시 중단, 에러 분기)
  - **실제 Gemini 호출**: 영어/일본어/중국어 → 한국어 정상 번역, 한국어는 원문 통과, **프롬프트 인젝션 시도는 지시를 따르지 않고 번역만** 함.
  - 실서버 엔드포인트 인증(401/403/404) 및 마이그레이션 미적용 시 안내 메시지 확인.
  - 브라우저(Playwright): 번역 버튼·번역 블록·외국어 배지·시트 모달·에러 표시 정상, 콘솔 에러 없음.
- **⚠️ 사용 전 필수 준비:**
  1. Supabase SQL Editor 에서 `add_translation.sql`, `add_sheet_sync.sql` 실행
  2. `.env.local` + Vercel 환경변수에 `GEMINI_API_KEY`, `CRON_SECRET` 등록

---

## 2026-07-14

### 30) 프로덕션 QA 전수 점검 (수정 없음 — 전부 정상)
- **지시:** "현재 qa작동이 제대로 이루어지고 있는지 확인해줘."
- **점검 대상:** 프로덕션 `event-qna.vercel.app` (Vercel 프로젝트 `livepoll-app`, 최신 Production 배포 7일 전 · Ready).
- **점검 결과 (전 항목 통과):**
  - 사이트 응답: `/` 200 (~2.1s cold), favicon 200.
  - 인증: `/api/admin/*` 무토큰·오답 토큰 → 401 정상 차단. `x-admin-token` 헤더로 정상 접근 확인.
  - 데이터: 프로젝트 2건(Mendix Webinar 7/21 세션 4개, 언리얼 페스트 서울 26 8/20~21 세션 41개) 정상 조회.
  - 공개 API: 공개 세션(ef792a) 200 / 비공개 세션(65ede1) 404(존재 은닉) / 프로젝트 랜딩 200 — 28~29번 설계대로 동작.
  - E2E(Playwright, 프로덕션): `#/s/ef792a` 렌더 정상·콘솔 에러 0 → 질문 등록(제목/이름/내용) → 목록 즉시 표시 → 좋아요 1 반영(DB likes=1 확인) → 관리자 questions API에서 동일 데이터 확인.
  - 엑셀 다운로드: 세션 export 200, 정상 xlsx(7KB) 생성.
  - 정리: 테스트 질문 DELETE로 삭제 → 프로덕션 데이터 원상복구(질문 0건) 확인.
- **특이사항:** Vercel 프로젝트명이 `event-qna` → `livepoll-app` 으로 변경되어 있음(도메인 event-qna.vercel.app 은 유지). Vercel CLI 구버전(51.7.0) 업그레이드 권장 안내 있음. 콘솔 warning 2건은 기존과 동일한 CDN 아키텍처 경고로 동작 무관.

### 34) QA 작업폴더를 event-qna 브랜치로 업로드 + main README 삭제
- **지시:** "qa작업폴더를 올려줘. github에 있는 readme.md파일은 삭제해주고."
- **판단:** 로컬 QA 폴더(event-qna, 단일 index.html 3448줄)와 GitHub main(LivePoll, index.html 1233 + admin.html 분리 + poll/migrations, 프로덕션 배포본)은 **서로 다른 앱**. 그대로 올리면 배포본 덮어씀 → 사용자에게 방식 질문 → **"별도 브랜치에 올리기"** 선택.
- **처리:**
  - 로컬 HEAD(da74de0) 기준 새 워크트리에서 `event-qna` 브랜치 생성. QA 무관 항목 제거(week-*/AFM-weekend-* 폴더, .playwright-mcp 스냅샷) → 30파일.
  - **🔐 시크릿 방지:** da74de0 커밋본 WORKFLOW.md 엔 콘솔토큰 평문이 있으므로, 마스킹된 워킹트리 버전으로 교체. 추가로 로그 항목 #32 에 인용돼 있던 토큰도 `<<REDACTED>>` 처리. 푸시 전 worktree 전체 grep 로 토큰 0건 확인.
  - README.md 는 삭제 요청 대상이라 브랜치에서도 제외.
  - 커밋 `43aa1b7` → `origin/event-qna` push(신규 브랜치). main 미변경.
  - **main README 삭제:** origin/main(0a40a43) 기준 워크트리에서 `git rm README.md` → 커밋 `e96eb6d` → fast-forward push(LivePoll 히스토리 보존).
- **검증(GitHub 실측):** event-qna 브랜치 페이지 200, 앱파일(index/server/schema) 200, README **404**, WORKFLOW.md 토큰 **0건**. main/README.md **404**(삭제됨), main admin.html 200(LivePoll 유지). 원격 브랜치=main+event-qna. 워크트리 정리 완료.

### 33) GitHub 에서 AFM/week 연습 폴더 전량 삭제
- **지시:** "github에 있는 파일들중에 AFM으로 들어간 것들과 week로 들어간 폴더는 모두 삭제하고 싶어. 지워줘"
- **대상:** origin/main 최상위 13개 폴더 — `AFM-weekend-2th~7th`(6개) + `week-1~7`(7개), **총 976 파일**. (전체 1067 → 잔존 91)
- **안전 처리:** 로컬(`da74de0`)이 원격(LivePoll, `bf5100a`)과 diverged + 미커밋 1043줄이라, 로컬에서 push 시 강제푸시로 LivePoll 히스토리 소실 위험. → **origin/main 기준 별도 워크트리**(`/tmp/qa-cleanup-wt`)에서 `git rm -r` 후 커밋(`0a40a43`, 부모=bf5100a)해 **fast-forward push**. LivePoll 앱/히스토리 보존.
- **검증(GitHub 실측):** `AFM-weekend-2th/7th`·`week-1/7` → HTTP **404**(삭제됨), API 최상위에 AFM/week 없음. 앱 파일(index.html·server.js·admin.html·package.json) → **200** 정상 잔존. 워크트리 정리 완료.
- **참고:** 현재 트리에서만 제거(파일 브라우저에 안 보임). git **히스토리엔 잔존**(레포 용량 그대로) — 완전 말소(용량 축소/시크릿 파기)가 필요하면 `git filter-repo` + force-push 별도 진행 필요. 로컬 작업본은 여전히 diverged 상태(동기화 미실행).

### 32) GitHub(원격 저장소) 데이터 점검
- **지시:** "github에 있는 데이타들 체크해줘."
- **원격:** `github.com/goms-blip/test-01` — **public 저장소**(HTTP 200). 여러 주차 과제(week-3~7, AFM-weekend) + 이 앱이 한 레포 루트에 공존하는 대형 모노레포.
- **로컬↔원격 갈라짐:** 로컬 HEAD `da74de0`(옛 event-qna QA 앱, 1커밋)와 원격 `origin/main bf5100a`(6커밋 앞섬)가 **diverged**. 원격 main 이 실제 프로덕션 배포본 = **LivePoll 앱**(`admin.html`·`livepoll_schema.sql`·`migrations/`·`vendor/`·`poll_seed.sql` 등 로컬에 없는 파일 다수). 원격엔 이미 "Fix QA/security findings from 고길동 review (High+Medium)" 등 보안수정 커밋 존재.
- **시크릿 노출 점검(원격 히스토리 전체 스캔):**
  - ✅ `SUPABASE_SERVICE_ROLE_KEY`: 원격 어디에도 없음(role:service_role JWT 미검출). 안전.
  - ✅ `ADMIN_CONSOLE_TOKEN`(`<<REDACTED>>`): 원격(origin/main) 히스토리·현재 raw 파일 **어디에도 없음**. GitHub 노출 아님.
  - ⚠️ 단, **로컬 미푸시 커밋 `da74de0` 의 WORKFLOW.md 에 콘솔토큰이 평문**으로 있었음 → 본 점검에서 `<<CONSOLE_TOKEN_REDACTED>>` 로 마스킹함. diverged 라 일반 push 는 거부되나 force/merge 시 GitHub 유출 위험이었음.
  - ⚪ `SUPABASE_ANON_KEY`: `index.html` 에 커밋(공개 키라 설계상 정상). 단 고길동 CRITICAL(admin_token 유출)의 공격 벡터가 이 키.
  - ✅ `.env.local`/`.env` gitignore 정상. 추적되는 env 는 `.env.example`(플레이스홀더만, 실제값 없음)뿐.
  - ✅ 하드코딩 비밀번호/secret 문자열 없음.
- **결론:** GitHub 원격에 새어나간 시크릿 **없음**. 다만 (1) 로컬 작업본이 프로덕션 배포본과 크게 diverged 되어 있어 감사 대상 정합성 주의 필요, (2) 로컬 WORKFLOW.md 토큰은 마스킹 완료, (3) 저장소가 public 이므로 향후 커밋 시 시크릿 유입 주의.

### 31) 고길동(gogildong-qa-security) QA·보안 감사 — 🔴 CRITICAL 1건 발견 (프로덕션 재현 확정)
- **지시:** ".claude/gogildong-qa-security.md 를 이용해서 검증해줘."
- **🔴 CRITICAL: anon 키로 공개 세션 `admin_token` 유출 → 세션 관리 권한 탈취.**
  - 근본원인: `supabase_schema.sql:114-118` `sessions_public_read` 정책이 **행(row)만** `is_public=true` 로 제한하고 **컬럼 접근을 막지 않음**(Postgres RLS는 컬럼 단위 제어 안 함). anon 이 `sessions` 의 모든 컬럼(admin_token 포함)을 SELECT 가능. `index.html:582-584`/`662` 의 `.select('*')` 가 악화.
  - **직접 재현(프로덕션):** `GET /rest/v1/sessions?select=id,admin_token&is_public=eq.true` (anon 키, index.html:111 하드코딩) → 전 공개세션 admin_token 평문 반환(예 916c59d8 → `184df301...`). 그 토큰으로 `GET /api/admin/sessions/916c59d8.../questions` → **HTTP 200**(오답 토큰은 403). 유출 토큰이 실제 인가됨 확인.
  - 영향: 공개 행사 접속자 누구나 각 세션 연사 대시보드 권한 → 숨김질문 열람, 질문 삭제/숨김/답변 토글, 세션 수정·비공개화, Q&A 엑셀(PII) 유출. 라이브 사보타주 가능.
  - **권장 즉시조치:** `REVOKE SELECT (admin_token) ON sessions FROM anon;` + 노출된 admin_token 전량 로테이션. `index.html` 의 `.select('*')` → 필요한 컬럼만 명시. 근본: admin_token 을 별도 테이블 분리 또는 공개조회를 `/api/public/sessions/:codeOrId` 로 일원화.
- **🟠 HIGH:** ① 좋아요 `voter_key` 클라이언트 생성 → 매번 새 키로 무한 좋아요(정렬 왜곡). ② 질문 insert 서버측 길이제한 없음(`content text` 무제한) — anon 직접 insert 로 수MB 도배/DoS. ③ questions RLS 가 세션 `is_public` 미검사 → 비공개 세션 질문 read/write 여지.
- **🟡 MEDIUM:** 엑셀 export 수식 인젝션(`server.js:1249-1264`, `=`/`+`/`-`/`@` 셀 이스케이프 없음), 좋아요 조작.
- **🟢 LOW:** 토큰을 `?token=` 쿼리로 전달(로그/Referer 잔류), 토큰 `!==` 비교 non-constant-time, `track_id` 교차프로젝트 배정, 잘못된 UUID → 500, 금지어 부분문자열 매칭 우회.
- **문제없음 확인:** 콘솔 API 인증 게이트 정상(무토큰/오답 401·403), 세션 간 IDOR 차단(토큰-세션 바인딩), service_role/콘솔토큰 클라이언트 미노출, 정적파일(.env.local/*.sql) 미노출(catch-all 이 index.html 반환), XSS 없음(dangerouslySetInnerHTML 미사용), PostgREST 파라미터화(주입 없음), 비공개 세션 공개 API 404 은닉.
- **정리:** 감사 중 생성한 테스트 질문 삭제·0건 재확인. 프로덕션 데이터 원상복구.
- **주의:** 라이브 Supabase ref 는 `dxnmroyjqklbuughassw`(index.html:110-111 기준). 아직 코드 수정은 안 함 — CRITICAL 패치는 사용자 확인 후 진행 예정.

---

## 2026-07-07

### 29-1) 후속 — 콘솔 로그 문의 (수정 없음)
- **지시:** 콘솔 로그 붙여넣음(Tailwind CDN 경고 / Babel 경고 / React DevTools 안내 / f0c81c 404).
- **판단:** 404는 **토글 전** 시점의 로그 — 사용자가 29번 토글로 f0c81c 를 직접 공개 전환했고, 현재 프로덕션에서 무토큰 API 200 + `#/s/f0c81c` 사용자 페이지 정상 렌더 확인(is_public: true). 나머지 3건은 단일 index.html(빌드 없는 CDN React+Tailwind+in-browser Babel) 아키텍처의 정상 경고로 동작 무관. 코드 수정 없음.

### 29) 세션 공개/비공개 토글
- **지시:** "공개, 비공개 토글을 만들어줘."
- **처리(index.html, ProjectDetailPage):**
  - 세션 카드의 정적 공개/비공개 Badge → **클릭형 토글 스위치**(role=switch)로 교체. 공개=액센트 필+점, 비공개=회색 필+점, hover 시 테두리 강조 + title 안내.
  - `handleTogglePublic`: 기존 `PATCH /api/admin/sessions/:id`(is_public) 재사용. **낙관적 갱신**(즉시 UI 반영) + 실패 시 롤백 + 토스트("세션을 공개/비공개로 전환했습니다").
  - 서버 변경 없음(PATCH가 이미 is_public 지원).
- **검증(로컬 + Playwright, 뉴코어 f0c81c):** 비공개→공개 클릭: 스위치 [checked]·토스트·공개 API 무토큰 **200** / 다시 클릭(원복): 비공개 표시·무토큰 **404** — 실데이터 원상복구 완료. 콘솔 에러 0.
- **배포:** `vercel deploy --prod` → event-qna.vercel.app.
- **효과:** 비공개 세션 공개 전환이 수정 모달 없이 원클릭. 28-1의 "공개 전환 방법"이 더 간단해짐.

### 28-1) 후속 — "#/s/f0c81c 세션을 찾을 수 없다" 문의
- **지시:** "https://event-qna.vercel.app/#/s/f0c81c 세션을 찾을수 없다고 뜨네."
- **판단:** 버그 아님 — f0c81c 는 **비공개 세션**이라 토큰 없는 사용자 URL 접근은 의도적으로 404(참가자 차단·존재 은닉, 28번 설계 그대로). 관리자 열람은 "사용자 화면 미리보기" 버튼(?pv= 자동 첨부)을 사용해야 함.
- **UX 보완:** 관리자 세션 카드의 사용자 URL 라벨을 비공개 세션일 때 "사용자 URL ⚠ 비공개 — 공개 전환 전엔 접속 불가"로 표시 + 복사 토스트에도 동일 안내. 프로덕션 배포.
- **공개 전환 방법:** 세션 카드 연필(수정) → "공개 세션 (사용자에게 노출)" 체크.

### 28) "사용자 화면이 뜨지 않는" 버그 — 비공개 세션 미리보기 404 수정
- **지시:** "사용자 화면이 뜨지 않는데. 전체적으로 오류 체크해줘."
- **전체 오류 체크(프로덕션, Playwright+curl):** 랜딩(#/e/feb8a3·b06a42) OK / 세션 페이지(#/s/72b559·65ede1) OK / 구형 긴 라우트(#/event/:uuid·#/session/:uuid) OK / 관리자 콘솔·프로젝트 상세 OK / 질문 모달 OK. 콘솔 에러 0.
- **재현된 버그 1건:** 관리자 상세 → **비공개 세션**의 "사용자 화면 미리보기" 클릭 → `/api/public/sessions/:code`가 `publicOnly`라 **404** → "세션을 찾을 수 없습니다" 화면. (언리얼 41세션 중 14개가 비공개라 자주 발생. 첫 재현: f0c81c "뉴코어 게임즈 Or 린반")
- **수정:**
  - server.js: 공개 세션 단건 API가 `?pv=`(또는 `?token=`) 미리보기 토큰(해당 세션 admin_token 또는 콘솔 토큰)이 맞으면 비공개 세션도 반환. 무토큰/오답은 기존대로 404(존재 여부 은닉). 응답에 `is_public` 필드 추가.
  - index.html: `fetchPublicSession(codeOrId, previewToken)`, UserSessionPage 가 `?pv=` 쿼리 전달 + 비공개면 헤더에 **"비공개 · 관리자 미리보기"** 앰버 배지. 관리자 미리보기 버튼이 비공개 세션일 때 `?pv=<admin_token>` 자동 첨부.
- **검증:** 로컬 API(무토큰 404/오답 404/세션토큰 200/공개세션 무토큰 200) + 브라우저(비공개 미리보기 → 배지+세션정보+질문모달 정상, 콘솔 에러 0) → 프로덕션 배포 후 동일 3케이스 재확인.
- **참고:** 참가자 입장은 변화 없음(비공개 세션은 여전히 404·랜딩 미노출). 미리보기에서 질문 등록도 가능(관리자 테스트용).

### 27) 관리자 프로젝트 상세 — 날짜/트랙 필터 (스크린샷 피드백)
- **지시:** "뭔가 잘 안되는거 같은데" + 관리자 트랙 패널 스크린샷 — "위에 날짜를 넣어서 선택을 하게 하고 트랙을 선택하면 아래쪽에 리스트가 뜨면 보는 사람이 편할꺼 같은데."
- **맥락:** 26번 필터는 공개 랜딩에만 추가했었음. 사용자가 보던 화면은 **관리자 프로젝트 상세** — 여긴 트랙 칩이 삭제 전용이었고 날짜 선택도 없었음.
- **처리(index.html, ProjectDetailPage):**
  - 트랙 패널 위에 "날짜" 필터 줄 추가([전체]+날짜별+날짜 미정, 날짜 2개 이상일 때만).
  - 트랙 칩을 **클릭=필터 선택(재클릭 해제) / 휴지통=삭제**로 이원화. [전체]·[미지정] 칩 추가. 칩 개수는 반대편 필터 반영(패싯). 날짜+트랙 AND 조합.
  - 세션 카운트 필터 반영, 결과 0건 시 EmptyState. 특정 트랙 선택 시 룸 헤더 없이 평평한 목록(`layout.flat`).
  - **트랙 삭제에 window.confirm 추가**(칩이 클릭 가능해져 오클릭 위험 ↑, "세션은 미지정으로 이동" 안내). 삭제된 트랙이 현재 필터면 필터 해제.
- **검증(로컬 + Playwright, 언리얼 41세션):** 날짜 줄(전체41/20/21)+트랙 줄(10×4+미지정1) 렌더 → 8/21 선택(21개, 트랙별 섹션 5·5·5·5·1) → HB2 추가 선택(5개 평평, 날짜 칩 5/5로 갱신) → 휴지통 클릭 시 confirm 표시·취소 시 무변화(stopPropagation 정상). 콘솔 에러 0.
- **배포:** `vercel deploy --prod` → event-qna.vercel.app 반영 확인.

### 26) 공개 랜딩 날짜별 필터 추가 (트랙과 조합 선택)
- **지시:** "날짜별 트랙별 선택이 가능한지 체크해주고 안되면 가능하도록 기능을 넣어줘."
- **체크 결과:** 트랙 필터(25번)만 있고 날짜 선택은 없었음(날짜는 섹션 구분만) → 기능 추가.
- **처리(index.html, EventLandingPage):**
  - `dateFilter` 상태(null=전체 / 'nodate'=날짜 미정 / 'YYYY-MM-DD') 추가, 트랙 필터와 **AND 조합**.
  - 칩 2줄: 날짜 줄([전체 날짜]+날짜별, 날짜 2개 이상일 때만) + 트랙 줄([전체 트랙]+트랙별+기타). 칩 노출은 전체 세션 기준(사라졌다 생겼다 방지), **개수 표시는 반대편 필터 반영(패싯 방식)**. 공용 `renderChip` 헬퍼로 통합.
  - 필터 결과 0건이면 "조건에 맞는 세션이 없습니다" EmptyState.
  - 날짜 1개로 좁혀지면 자연히 단일날짜 레이아웃(트랙 전체 선택 시 룸 섹션 유지, 특정 트랙 선택 시 평평).
- **검증(로컬 + Playwright, feb8a3):** 칩 2줄 렌더 → 8/21 선택(13개, 트랙 칩 3·3·3·4로 갱신) → Atlas 추가 선택(정확히 4개, 시간순, 날짜 칩도 8·4·4로 갱신). 콘솔 에러 0.
- **배포:** `vercel deploy --prod` → event-qna.vercel.app 반영 확인.

### 25) 공개 랜딩 트랙별 필터 칩
- **지시:** "트랙이 있는것들은 트랙별로 선택이 가능하도록 해야할듯해."
- **처리(index.html, EventLandingPage만):**
  - 트랙 필터 상태(`trackFilter`: null=전체 / 'unassigned'=기타 / track id) 추가.
  - 세션 목록 위에 가로 스크롤 칩 바: [전체 N] + 공개 세션이 있는 트랙별 칩(개수 표시) + 미배정 세션 있으면 [기타]. **공개 세션이 있는 트랙이 2개 이상일 때만 노출**(트랙 없는 행사(Mendix 등)는 기존 그대로).
  - 특정 트랙 선택 시: 해당 트랙 세션만 표시하고 룸 섹션 헤더는 생략(1개뿐이라 무의미) — 멀티데이면 날짜 섹션은 유지. "공개 세션 N개" 카운트도 필터 반영.
- **검증(로컬 + Playwright, 라이브 DB):**
  - 언리얼 페스트(feb8a3, 룸 4·공개 27): 칩 5개(전체 27/HB1 6/HB2 6/HB3 7/Atlas 8) 렌더 → Atlas 클릭 시 8개만, 날짜(8/20·8/21) 섹션 유지 + 룸 헤더 제거 확인. 콘솔 에러 0.
  - Mendix(b06a42, 트랙 없음): 칩 미노출, 기존 평평한 목록 그대로.
- **배포:** `vercel deploy --prod` → event-qna.vercel.app 반영 확인(새 코드 표식 + 랜딩 API 트랙 4).
- **참고:** 라이브 feb8a3 에는 41개 엑셀 데이터(공개 27, 8/20·8/21)가 이미 업로드되어 있음(사용자가 프로덕션 콘솔에서 교체한 것으로 보임 — 22번의 '남은 결정' 해소됨).

### 24) 관리자 대시보드 질문 삭제 기능
- **지시:** "관리자쪽에서 질문이 올라온거중에 필요없는거는 삭제하는 기능을 넣어야 할꺼 같아."
- **처리:**
  - server.js: `DELETE /api/admin/questions/:id`(requireSessionAdmin — 세션토큰 or 콘솔토큰). 질문 영구 삭제, `votes`는 FK `on delete cascade`로 자동 정리.
  - index.html: `mockApi.deleteQuestion(id, sessionToken)` 추가. `AdminQuestionCard` 액션줄 우측에 빨간 "삭제" 버튼(TrashIcon, `ml-auto`). 클릭 → 확인 모달(질문 제목·작성자·좋아요 요약 + "되돌릴 수 없습니다" 경고 + 취소/삭제) → 삭제 성공 시 목록 즉시 제거 + 토스트.
- **검증(로컬 서버, 라이브 DB — 테스트 질문 생성 후 그걸 삭제하는 방식으로 실데이터 무손상):**
  - API: 무토큰 401 / 오답토큰 403 / 없는 질문 404 / 콘솔토큰 삭제 200.
  - 브라우저(Playwright): 대시보드에 삭제 버튼 렌더 → 모달 표시 → 확인 → 카운트 1→0, "질문을 삭제했어요" 토스트, 콘솔 에러 0.
  - DB: 질문 row·votes row 모두 삭제 확인(service_role 직조회).
- **배포:** `vercel deploy --prod` → event-qna.vercel.app aliased, 프로덕션에서 라우트 존재 확인.
- **참고:** questions insert 시 본문 컬럼은 `body`가 아니라 `content`(테스트 중 재확인).

### 23) 행사 사이트 URL → 세션 자동 추출·등록 (MendixConnect)
- **지시:** "사이트 주소를 주면 자동으로 이벤트 시간이랑 세션명 생성이 가능한가?" → `https://www.mendixconnect.com/#how-it-works` 전달 → "라이브 Mendix Webinar에 등록" 선택.
- **처리:**
  - 사이트가 정적 HTML이라 curl + 텍스트 추출로 아젠다 원문 파싱(웨비나 2026-07-21 화 14:00, 온라인, 세션 4개: 오프닝&웰컴 / Intelligence Center X 와 Mendix 11 소개 / Maia 기반 Agent Coding 데모 / 사례 및 웨비나 이벤트 공유. 연사: 박준상 본부장·비써르 마우리츠 · 지멘스).
  - 프로덕션 프로젝트 확인: Mendix Webinar(b06a42, id 36ff23d1…)는 start_date 2026-07-21에 **기존 세션 0개** → replace 무해 확인 후 진행.
  - 스크래치 스크립트(`mendix_import.js`)로 import 형식 xlsx(시트 sessions, 날짜·시간·세션명·연사·세션룸·공개여부) 생성 → `POST /api/admin/projects/:id/sessions/import` (mode=replace, year=2026) 호출.
- **결과:** created 4 / failed 0, 날짜 2026-07-21 단일, 룸 없음(온라인이라 세션룸 빈칸 = 평평한 목록).
- **검증(라이브):** 공개 랜딩 `#/e/b06a42` — "Mendix Webinar" 제목 + 공개 세션 4개, KST 시간 14:00~15:35 정상 표시(DB엔 UTC 저장, 프론트 `toLocaleTimeString('ko-KR')` 변환), 연사 노출, 콘솔 에러 0.
- **메모:** 일회성 URL→세션 등록은 이 방식(추출→xlsx→import API)으로 재사용 가능. 앱 내장 기능(관리자 콘솔 "URL로 가져오기")은 LLM 파싱 필요라 별도 결정 사항.

## 2026-07-06

### 22) 프로덕션 DB 불일치 해결 (A안: env 교체 + 재배포) ✅
- **지시:** "a" (21번의 A안 선택 — 프로덕션 env를 우리 DB로 교체).
- **처리:**
  - `vercel env rm` × 3 (SUPABASE_URL·ANON·SERVICE_ROLE, production) 후 로컬 `.env.local` 값으로 `vercel env add` × 3 → 프로덕션이 `dxnmroyjqklbuughassw`(우리 개발/데이터 DB) 사용하도록 교체. (ADMIN_CONSOLE_TOKEN 은 그대로)
  - pull 대조로 URL/ANON/SR 3개 모두 로컬과 일치 확인.
  - `vercel --prod --yes` 재배포(새 env 반영).
- **검증(라이브):**
  - 관리자 프로젝트 목록 **500 → 200**: "언리얼 페스트 서울 26"(feb8a3, 세션5) / "Mendix Webinar"(b06a42).
  - 공개 랜딩 feb8a3: 공개세션 5·트랙 4·날짜 그룹 정상.
  - 공개 세션 f59b26: 트랙 "Harmonyball Room 3" 노출. (단, `/api/public/sessions/:code` 단건 응답엔 session_date 미포함 — 사용자 단일세션 페이지는 날짜 그룹 불필요라 무영향.)
- **결과:** event-qna.vercel.app = 우리 최신 Q&A 앱 + 우리 DB/데이터 + 엑셀 업로드 기능으로 **완전 동작**.
- **참고:** 현재 라이브 feb8a3 는 기존 수동 세션 5건(단일 날짜 2026-06-11, 트랙=Harmonyball Room…). 41개 멀티데이 엑셀 데이터를 라이브에 넣으려면 프로덕션 콘솔에서 해당 xlsx 업로드(교체) 하면 됨(사용자 판단).

### 21) 프로덕션 배포 실행 → 코드 반영 성공, 그러나 DB 불일치 발견 (결정 대기)
- **지시:** "프로덕션에 배포해줘."
- **처리:** `vercel --prod --yes` 실행 → 성공. `event-qna.vercel.app` 에 우리 최신 코드 aliased.
  - 검증: `/` = 우리 index.html(qa_theme 등 표식 4), 관리자 API 무토큰 → 한글 message(우리 코드), import 엔드포인트 401(존재), 공개세션 조회 시 한글 message.
- **⚠️ 발견 — 프로덕션 Vercel 프로젝트/DB 불일치:**
  - 링크된 프로젝트(prj_P0qeg, `.vercel/project.json`엔 "event-qna")가 실제로는 **`livepoll-app`으로 개명**됨. alias는 event-qna.vercel.app 유지. (별도 event-qna 프로젝트는 없음)
  - 이 프로젝트 env(Supabase)가 21일 전 **다른 DB로 교체**돼 있었음:
    - 프로덕션: `oixdfkwpkmjrbhonzqxt` — **다른 앱(livepoll) 스키마**. `polls` 테이블 존재, 우리 앱 필수 `questions`/`votes`/`banned_words` **없음**(PGRST205). sessions/tracks/projects는 있으나 tracks가 '게임:아트'(주제)로 채워짐, 세션 비어있음. 프로젝트 "언리얼 페스트 서울 26"(code fa089f) 1건.
    - 로컬(개발): `dxnmroyjqklbuughassw` — Q&A 완전 스키마 + 우리 데이터(트랙=룸, 세션, 업로드 검증).
  - ADMIN_CONSOLE_TOKEN·ANON 접두는 동일(`<<CONSOLE_TOKEN_REDACTED>>` / eyJhbGci…) 이나 URL/DB가 다름.
  - **결과:** 사이트는 열리나 관리자 목록 API **500**(그 DB에 questions 테이블 없음). 즉 코드는 최신이지만 프로덕션 DB가 우리 앱과 호환 안 됨.
- **결정 대기(사용자 부재):** env 교체/롤백은 영향 큰 인프라 변경 + livepoll 앱 얽힘 가능성 → 확인 없이 미진행. 3안 제시:
  - (A·권장) 프로덕션 env 3개(SUPABASE_URL/ANON/SERVICE_ROLE)를 로컬과 동일한 `dxnmroyjqklbuughassw`로 교체 후 재배포 → 프로덕션이 우리 앱+데이터+업로드로 완전 동작.
  - (B) 프로덕션 DB(oixdf…)에 questions/votes/banned_words + SQL 마이그레이션 적용(데이터 비어있어 업로드로 채움). livepoll과 DB 공유.
  - (C) 이번 배포 롤백 → 이전 배포본으로 alias 복구.
- **미결:** 위 A/B/C 중 택1 필요. (A면 `vercel env rm/add` 3건 + `vercel --prod`)

### 20) 세션 엑셀 일괄 업로드 + 날짜/룸별 소트
- **지시:** "샘플_세션목록1.xlsx 처럼 파일 업로드하면 세션 자동 등록. 날짜 분리 시 분리해서 소트, 룸별 소트도."
- **결정(clarify):** ① 세션룸만 룸으로 사용('트랙'(주제) 컬럼은 무시) ② 기존 삭제 후 전체 교체(replace) ③ 연도 2026(프로젝트 start_date 우선).
- **샘플 구조:** 시트 `sessions`, 컬럼 `날짜·시간·세션명·연사·트랙·세션룸·공개여부`. 41행, 날짜 2개(8/20·8/21), 룸 4개(Harmony Ballroom 1~3·Atlas), 빈 줄로 룸 구분.
- **처리 — server.js:**
  - `express.json({ limit:'15mb' })`(base64 업로드용).
  - `fmtDate`(timestamptz→'YYYY-MM-DD' KST) + `parseKoreanDateTime`('8월 20일'+'11:30~12:20'+연도→실제 날짜 보존 starts_at/ends_at). 기존 `parseDuration`은 '오늘' 날짜만 써서 멀티데이 불가 → import는 실제 날짜 저장.
  - `mapSessionRow`/`mapPublicSessionRow`에 `session_date` 노출(그룹핑용).
  - 신규 `POST /api/admin/projects/:pid/sessions/import`[콘솔]: base64 xlsx 파싱(exceljs), 헤더 유연 매칭, 세션룸→트랙 생성(등장순 sort_order), replace 시 기존 세션(질문 cascade)·트랙 삭제 후 재구성, 공개여부('공개'=true, '비공개' 부분포함 배제), 세션별 code 발급. 결과 요약(created/날짜별/룸별/실패) 반환. 스키마 미적용 42703 폴백 유지.
- **처리 — index.html:**
  - `mockApi.importSessions`, `bufToBase64`(청크), `BulkUploadModal`(파일선택+빨간 교체경고+컬럼 형식 안내→업로드→결과 요약 화면), `UploadIcon`/`CalendarIcon`, `fmtDateLabel`('YYYY-MM-DD'→'8월 20일 (목)'), `sortByTime`.
  - 프로젝트 상세: 헤더 "세션 업로드" 버튼 + 모달. 세션 렌더를 `layout`으로 재구성 — **날짜 2개 이상이면 날짜 섹션→룸 섹션 2단**, 단일 날짜면 기존 룸 그룹, 트랙 없으면 평평. `renderRoomGroups` 헬퍼.
  - 공개 랜딩: 동일하게 날짜(멀티데이)→룸 2단 그룹(`renderRooms`), starts_at 정렬.
- **검증(로컬 서버 + Playwright, 실데이터 무손상):**
  - 임시 프로젝트에 샘플 import → **41개 생성**, 날짜 20/21 분리, 룸 sort 1~4, 공개 27·비공개 14, 룸없음 1(샘플 R50 세션룸 빈칸=원본 그대로), tracksApplied true. 랜딩 공개세션 27.
  - 관리자 화면: 날짜 헤더 '8월 20일 (목)'·'8월 21일 (금)'(요일 정확) + 룸 4섹션 + 업로드 버튼 렌더, 콘솔 에러 0.
  - 공개 랜딩: 동일 2단 그룹 렌더 확인. 임시 프로젝트 2개 모두 삭제 정리 → 실데이터(언리얼 페스트 서울 26/Mendix)만 남김.
- **미배포:** 로컬만 검증. 프로덕션(event-qna.vercel.app)은 여전히 구버전(19번 참조) → 실사용하려면 재배포 필요.
- **주의:** replace 는 대상 프로젝트 세션/트랙을 전부 지움(되돌리기 불가). 실제 a1 에 올릴 때 기존 수동 세션 교체됨.

### 19) 트랙/SQL 실제 적용 여부 검증 (+ 프로덕션 코드 불일치 발견)
- **지시:** "트랙/SQL 실제 적용 여부 검증해줘."
- **검증 방법:** 라이브 Supabase(`dxnmroyjqklbuughassw`)에 anon/service_role REST 직접 질의(코드 폴백에 가려지지 않도록).
- **결과 — SQL 2건 모두 적용·실데이터로 채워짐 ✅**
  - `add_tracks_speaker.sql`: `tracks` 테이블 4행(Harmonyball Room 1~3 / Atlas Hall, project a1) + `sessions.track_id`·`sessions.speaker` 존재·채워짐(심성민·김지교·Ari Arnbjörnsson·강성구·김정욱 등 실강연자).
  - `add_short_codes.sql`: `sessions.code`(f59b26·6ab014·5d6eb7…)·`projects.code`(feb8a3=언리얼 페스트 서울 26, b06a42=Mendix Webinar) 존재.
  - 과거 테스트 트랙(Track A·메인홀/Track B·세미나실)은 실데이터로 교체 완료(잔여 없음).
- **부수 발견 — ⚠️ 프로덕션(event-qna.vercel.app)이 이 repo 코드가 아님:**
  - 프로덕션 API 404/401 응답이 `{"success":false,"error":"session_not_found"|"unauthorized"}`(영문 slug)인데, 이 repo `server.js`는 `{success:false, message:'세션을 찾을 수 없습니다.'|'토큰이 필요합니다.'}`(한글). `error:` 형태는 repo·git 히스토리 어디에도 없음.
  - `/api/public/projects/:id/landing` 프로덕션 404(Express 기본) = 배포본에 라우트 없음. `/api/public/sessions/:code`도 공개 코드(f59b26)에 session_not_found = 배포본 resolveSession이 code 조회 미지원.
  - 프로덕션 `/` = 69,188 bytes인데 repo `index.html` = 150,348 bytes. repo 고유 표식(`qa_theme` 다크모드·`EVENT Q&A CONSOLE`·`LIVE Q&A`)이 프로덕션엔 0건.
  - **결론:** DB 스키마는 최신(트랙/코드 적용)이나, **event-qna.vercel.app에 서빙 중인 프론트+서버는 트랙/short-code 이전의 다른/구버전**. 최신 HEAD(4e3c533)가 이 alias로 배포되지 않았음(또는 다른 URL로 배포됨). DB는 공유하므로 트랙 데이터는 보이지만 프로덕션 앱은 트랙/단축URL 기능 미노출.
  - **다음 조치(대기):** `vercel --prod`로 재배포해 alias를 최신 HEAD로 맞추거나, 실제 배포 URL 확인 필요. (미실행 — 사용자 확인 대기)

### 18) 트랙(Track) + 강연자(speaker)
- **지시:** 멀티 트랙(최대 4 등) 운영 지원, 사용자도 트랙별로 보기, 세션 폼 '설명'→'강연자'.
- **처리:**
  - `add_tracks_speaker.sql`: `tracks` 테이블(project 하위, RLS on·anon 정책 없음=server 전용) + `sessions.track_id`(FK set null)·`sessions.speaker`.
  - server.js: 트랙 CRUD(`GET/POST /api/admin/projects/:pid/tracks`, `PATCH/DELETE /api/admin/tracks/:id`, 콘솔 보호). 세션 생성/수정이 track_id·speaker 저장. 매퍼에 speaker/track_id/track_name. 랜딩이 tracks 배열+세션 track_id/speaker 반환. 공개 세션 단건에 speaker/track_name. SQL 미실행 폴백(PGRST205/42703 방어).
  - index.html: 프로젝트 상세에 "트랙 추가" 버튼+트랙 칩(삭제), 세션을 트랙별 섹션으로. 세션 모달 '세션 설명'→'강연자' + 트랙 드롭다운. 랜딩(사용자) 트랙 2개+ 시 트랙별 섹션(같은 시간대 구분), 카드에 강연자 표시.
- **검증:** 트랙 2개 생성→세션 배정→랜딩/관리자 모두 트랙별 그룹핑+강연자 표시, 세션 모달 강연자/트랙 확인. 프로덕션 재배포.
- **주의:** 테스트로 트랙 2개(Track A·메인홀/Track B·세미나실)·강연자 2명을 실데이터에 넣음 → 사용자가 실제 값으로 교체/삭제 가능.

### 17) 짧은 코드 URL + 사용자 페이지 "전체 세션 보기" 버튼
- **지시:** "긴 UUID 안 보이게 짧게" + "사용자 페이지에 전체(목록)로 가는 버튼 추가."
- **처리:**
  - `add_short_codes.sql`: projects/sessions에 `code`(6 hex, unique) 컬럼 + 백필.
  - server.js: code 생성(생성 시 발급)·해석(uuid면 id, 아니면 code) 헬퍼. 신규 `GET /api/public/sessions/:codeOrId`(공개 세션+project_code). 랜딩·관리자 세션 라우트가 code/uuid 모두 수용. 매퍼에 code 추가.
  - index.html: 단축 라우트 `#/s/:code`·`#/e/:code`·`#/a/:code`(기존 긴 라우트 유지). URL 생성부(사용자 URL/관리자 URL/행사 QR)가 code 사용(없으면 UUID 폴백). UserSessionPage에 "전체 세션 보기" 버튼 → `#/e/<project_code>`.
  - SQL 미실행이어도 UUID 폴백으로 안 깨짐(42703 방어).
- **검증:** 코드 발급(프로젝트 feb8a3, 세션 5d6eb7/6ab014), 로컬·라이브 단축 라우트 200, "전체 세션" 버튼 랜딩 이동 확인. 프로덕션 재배포.

### 16) 관리자 대시보드 URL에서 토큰 숨김
- **지시:** "주소 뒤쪽 토큰값 안 보이게 삭제 가능하면 해줘."
- **처리:** `AdminDashboardPage`가 진입 시 `?token=`을 `sessionStorage(qa_admin_token_:id)`에 저장 후 `history.replaceState`로 주소창에서 토큰 제거. 새로고침 시 sessionStorage에서 복원. `sessionToken`은 useMemo(URL 우선, 없으면 sessionStorage). tokenInfo도 sessionToken 기준.
- **검증:** 토큰 URL 진입 → 주소 깨끗(토큰 없음)+sessionStorage 보관, 클린 URL 새로고침해도 "토큰 인증됨" 정상. 프로덕션 배포.

### 15) 관리자 대시보드 403 무한루프 버그 수정
- **증상:** 대시보드에서 `403 세션 접근 권한이 없습니다` 콘솔 폭주(수백 회).
- **원인 2가지:**
  1. (무한루프) `AdminDashboardPage`의 `load` useCallback deps에 `toast` 포함 → 에러 시 `toast.show` → 리렌더 → `useToast()` 새 객체 → load 재생성 → effect 재실행 → 무한 반복. (12번 모달과 동일 패턴)
  2. (403 자체) 사용자가 **옛/잘못된 토큰**(토큰 변경 전 구 콘솔토큰)이 든 대시보드 URL을 열었음. 라이브 API는 정상(세션토큰/콘솔토큰 200, 무토큰 401).
- **수정:** `toastRef = useRef(toast)` 안정화 + load deps에서 toast 제거 → 잘못된 토큰이어도 403 **단 1회**, "주소를 확인해 주세요" 안내 화면 표시(루프 없음). 올바른 토큰이면 정상 렌더 확인. 프로덕션 재배포.

### 14) Vercel 프로덕션 배포
- **지시:** "배포 들어가자."
- **보안 선수정(중요):** `server.js`의 `express.static(__dirname)` 제거 → 디렉토리 전체 정적 노출(`/.env.local`로 service_role 키 유출) 차단. 비-API GET은 catch-all `app.get('*')`로 index.html만 반환. 검증: `/.env.local`·`/server.js` 요청 시 시크릿 대신 HTML.
- **배포 구성:** `vercel.json`(@vercel/node, server.js로 라우팅, includeFiles index.html), `.vercelignore`(.env.local·*.sql·*.md·.claude 등 제외).
- **실행:** vercel CLI(로그인됨: seunghunoh-1757) → `vercel link`(384s-projects/event-qna) → 환경변수 4개(SUPABASE_URL·SERVICE_ROLE·ANON·ADMIN_CONSOLE_TOKEN) production 등록 → `vercel --prod`.
- **프로덕션 URL:** https://event-qna.vercel.app
- **검증(curl+브라우저):** `/` 200, 관리자 API 무토큰 401/토큰 200, 공개 랜딩 API 200, `/.env.local` 시크릿 0건, 사용자 페이지 실데이터 3단 렌더.
- **보안 TODO:** 공개 배포되었으므로 `ADMIN_CONSOLE_TOKEN`은 강한 값으로 유지(실제 값은 `.env.local`·Vercel 환경변수에만 보관, 저장소에 기록 금지).

### 13) 테스트 데이터 정리 (시드 상태 복구)
- **지시:** "테스트 질문 정리부터 해줘."
- **처리(service_role REST):** 테스트 질문 "Supabase 연동 테스트 질문입니다" 삭제 / 테스트 중 누른 좋아요 복구(한지원 18→17, 박매니저 10→9) / votes 0건 초기화.
- **결과:** b1 세션 좋아요 24·17·9·5·2(숨김), 질문 5건, votes 0 — 시드 상태 복구 확인.

### 12) 금지어 필터 (기본 목록 + 등록 차단 + 운영자 관리)
- **지시:** "추천 조합(기본 목록+등록 차단)으로 + 운영자 콘솔에서 추가/삭제도 가능하게."
- **처리:**
  - `banned_words.sql` 작성: 테이블 `banned_words(id,word unique,created_at)` + RLS(anon select만) + 기본 금지어 23개 + `questions` 트리거 `reject_banned_words`(제목/본문/작성자에 금지어 시 insert/update 거부, security definer).
  - server.js(single-server-specialist): 콘솔 보호 라우트 `GET/POST/DELETE /api/admin/banned-words`(중복 409, 빈값 400).
  - index.html: 사용자 폼 사전 차단(anon `banned_words` 조회·세션 캐시, 제목+내용+이름 부분매칭 → "부적절한 표현…" 오류) + 백스톱(insert가 트리거로 거부되면 동일 메시지 처리). 관리자 홈에 "금지어 관리" 모달(목록/추가/삭제, 콘솔 토큰).
  - 사전검사(빠른 UX) + DB 트리거(우회 방지) 2중.
  - 에이전트가 모달 무한 refetch 버그 발견·수정(toast useRef 안정화).
- **검증 완료(SQL 실행 후):** banned_words 23개 anon 조회 / 트리거 차단(직접 insert "병신" → 400 `BANNED_WORD`) / 사용자 폼 사전 차단("부적절한 표현…" + 등록 막힘) / 운영자 콘솔 "금지어 관리" 모달(목록 23·추가·삭제) 정상.

### 11) 공개 페이지 데스크탑 반응형 (모바일 무변경)
- **지시:** "핸드폰 위주로 짠 것 같다. 노트북/PC에선 여러 질문이 보이게 조정해줘. 모바일은 지금이 딱 맞음."
- **처리(single-react-dev):** 공개 페이지만 수정.
  - 사용자 질문 목록: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3`, 컨테이너 `max-w-7xl mx-auto`. 일반 CSS Grid(행 우선)로 인기순 좌상단→우 유지(`columns-*` 금지).
  - 랜딩 세션 목록: `grid md:grid-cols-2`, `max-w-6xl`.
  - "질문하기": 모바일 하단 고정 바 유지(`md:hidden`), 데스크탑은 헤더 우측 일반 버튼(`hidden md:inline-flex`).
- **검증:** 1440px 3단(24·17·10 / 5·0 순서 유지), 414px 단일 컬럼+하단 고정 버튼 무변경.

### 10) 행사용 단일 QR + 공개 랜딩 페이지
- **지시:** "QR 하나로 참가자가 세션을 골라서 진행하고 싶다."
- **처리(single-server-specialist):**
  - server.js: `GET /api/public/projects/:projectId/landing`(인증 불필요, 공개) — `{project:{id,title}, sessions:[공개 세션만 {id,title,description,starts_at,ends_at,questionCount}]}`. admin_token 등 민감필드 미노출.
  - index.html: 공개 랜딩 `#/event/:projectId`(`EventLandingPage`, 토큰 게이트 밖) — 행사 제목 + 공개 세션 카드, 탭 시 `#/session/:id` 이동.
  - 재사용 `QrCodeModal`(url prop) — 캔버스 QR + URL 복사 + PNG 다운로드, 다크모드에서도 흰배경/검은모듈. 프로젝트 상세 헤더에 `행사 QR` 버튼.
  - QR 라이브러리: 요청한 qrcode@1.5.3 UMD가 404라 글로벌 `QRCode` 제공하는 `qrcode@1.5.1/build/qrcode.min.js` 사용.
- **데모 QR URL:** `{origin}/#/event/00000000-0000-0000-0000-0000000000a1`
- **검증:** API 200(공개 세션 2, admin_token 미포함)/404, 브라우저 랜딩·세션이동·QR 렌더/다운로드 OK.

### 9) 관리자 백엔드 server.js 구축 + 관리자 프론트 연동
- **지시:** "server.js 작업을 해줘." (single-server-specialist 활용)
- **처리:**
  - `.env.local`에 `ADMIN_CONSOLE_TOKEN`(운영자 콘솔 보호용 글로벌 토큰) + `PORT=8787` 추가.
  - `server.js`(Express) + `package.json`(express·@supabase/supabase-js·exceljs·dotenv) 생성. service_role 클라이언트로 RLS 우회, index.html 같은 오리진 서빙.
  - 인증 2단계: `requireConsole`(=ADMIN_CONSOLE_TOKEN), `requireSessionAdmin`(콘솔 토큰 OR 해당 세션 admin_token). 토큰은 `x-admin-token` 헤더 또는 `?token=`.
  - 라우트: 프로젝트 CRUD+통계, 세션 CRUD+통계, 관리자 질문조회(숨김 포함), 답변/숨김 토글, 세션·프로젝트 엑셀 export(exceljs, PRD 컬럼/파일명).
  - index.html 관리자 mock 메서드 전부 → server API fetch로 교체. 콘솔 토큰 게이트(`ConsoleTokenGate`, sessionStorage). 세션 대시보드는 URL `?token=` 사용. 엑셀 버튼 실연결. 관리자 대시보드 anon Realtime 구독→refetch.
- **검증(curl+브라우저):** 무토큰 401 / 콘솔토큰 200(프로젝트 세션2·질문6) / 세션토큰 숨김포함 6건 좋아요순 / 오답토큰 403 / 엑셀 200(xlsx) / 답변·숨김 토글 DB 영속 / 콘솔 게이트 인증 후 실데이터 렌더.
- **실행:** `npm install && npm start` → `http://localhost:8787` (콘솔 `#/admin`, 토큰은 `.env.local`).

### 9-1) 비공개 세션 대시보드 버그 수정
- **문제:** 관리자 대시보드가 세션 메타를 anon `fetchSession`으로 가져와 비공개 세션은 "세션을 찾을 수 없음".
- **수정:** server.js에 `GET /api/admin/sessions/:sessionId`(requireSessionAdmin) 추가. index.html에 `fetchAdminSession(id, token)` 추가하고 `AdminDashboardPage`가 이걸 쓰도록 교체(사용자 페이지 anon fetchSession은 유지).
- **검증:** curl 200/401/403, 브라우저 대시보드 정상 렌더(전체5·대기4·완료1·숨김1).

### 8) 사용자(공개) 페이지 Supabase 실연동
- **지시:** URL/anon/service_role 키 3개 전달받음.
- **처리:**
  - `.env.local`에 키 3개 저장(gitignore됨). `supabase_seed.sql`(고정 UUID 데모 데이터) 작성.
  - `index.html`: supabase-js UMD CDN 추가, 설정 상수 + 클라이언트 `sb` 생성(anon만, service_role 미포함).
  - 사용자 경로 mockApi 4종을 Supabase 호출로 교체: `fetchSession`(maybeSingle, 실패 시 mock 폴백), `fetchQuestions(...,'user')`(is_hidden=false, like DESC/created ASC), `createQuestion`(insert, content↔body 매핑), `likeQuestion`(rpc `like_question`). 필드 매퍼 `mapSessionRow`/`mapQuestionRow`.
  - 관리자 경로(프로젝트/세션 CRUD·답변/숨김·대시보드 조회·통계·엑셀)는 mock 유지 + "TODO: server.js(service_role)" 주석. → 과도기 하이브리드.
- **블로커→해결:** REST가 `503 PGRST002` 반환 → 원인은 **Data API(PostgREST) 비활성화**(신규 프로젝트 기본 off)였음. Supabase 대시보드 Integrations → Data API → Overview에서 **Enable** 후 해결. (Exposed schemas에 `public` 필요.)
- **검증 완료(브라우저 + curl):**
  - 공개 세션 2건 anon 조회 / 질문 4건 좋아요순(24·17·9·5) 로드 ✅
  - RLS: 숨김 질문("점심 메뉴")은 anon에 미노출 ✅
  - 좋아요 RPC: 9→10 DB 반영, 클릭 후 버튼 disabled(1인1표) ✅
  - 질문 등록: DB 저장 + 목록 카운트 4→5 ✅
- 테스트 URL: `#/session/00000000-0000-0000-0000-0000000000b1`
- **남은 것:** 관리자 경로는 아직 mock. 다음 단계 = server.js(service_role) 로 프로젝트/세션 CRUD·답변/숨김·엑셀 이전 + 관리자 Realtime.

### 7) Supabase 셋업 시작 — 아키텍처 확정 + 스키마 작성
- **지시:** "supabase 셋업 들어가자. 필요한 거 알려줘." / "single-server-specialist 에이전트 활용하면 되지?"
- **결정(아키텍처):** 정적 프론트(`index.html`) + Supabase(DB·Realtime·like RPC) + 얇은 **server.js**(single-server-specialist) 하이브리드.
  - **Supabase**: 데이터 저장, 좋아요 RPC(원자적), 관리자 Realtime 변경감지. anon 키는 공개(사용자) 경로만 최소 허용.
  - **server.js**: `service_role` 키 보관, `admin_token` 서버 검증, 프로젝트/세션 CRUD·답변/숨김·숨김질문 열람·엑셀 export 담당(RLS 우회). → single-server-specialist가 적임.
  - **index.html**: 사용자 페이지는 Supabase 직접(anon), 관리자 페이지는 server.js 경유.
- **처리:** `supabase_schema.sql` 생성(테이블 4종 + 인덱스 + `like_question` RPC + RLS 정책 + questions Realtime publication). author는 not null(이름 필수 반영), status는 UI와 1:1로 한글 저장.
- **사용자에게 요청한 것:** Supabase 프로젝트 생성(Region: Seoul 권장) → SQL Editor에 스키마 실행 → Project URL / anon key / service_role key 전달.
- **상태:** 진행 중(자격증명 대기).

### 6) 질문자 이름 필수화
- **지시:** "질문자의 이름은 무조건 넣도록 수정해줘. 익명/별명보다 실명이 낫다."
- **처리:** `index.html` 직접 수정.
  - `QuestionFormModal` 검증에 `if (!form.author.trim()) errs.author = '이름을 입력해 주세요';` 추가 → 이름 미입력 시 등록 차단.
  - 입력 필드 라벨 `질문자명`(선택) → **`이름 *`(필수)**, 플레이스홀더 `미입력 시 '익명'으로 표시됩니다` → `실명 또는 소속을 입력해 주세요`, `error={errors.author}` 연결.
  - 데모 일관성: 시드 데이터의 빈 author/`익명` 5건을 실명으로 교체(한지원·윤서연·강민호·오세훈·배수진).
  - 참고: 표시 폴백 `q.author || '익명'`은 안전망으로 유지(신규 등록은 항상 이름 보유).
- **검증:** localStorage 초기화 후 재시드 → 사용자 페이지 질문 모달에서 이름 빈 채 등록 시 빨간 오류 표시·차단 확인(라이트/다크 정상).
- **후속 메모:** Supabase 연동 시 `questions.author`를 `not null`로 두고(또는 서버 검증), PRD의 author default '익명' 정책은 본 변경에 맞춰 제거 검토.

---

## 2026-06-10

### 5) 작업 과정 자동 기록 도입 (이 파일 생성)
- **지시:** "내가 따로 얘기하지 않아도 무조건 과정을 md파일로 같은 폴더에 저장해줘. 그래야 기억하고 다른 것에도 적용할 수 있다."
- **처리:**
  - `WORKFLOW.md`(이 파일)를 `/Users/sh_oh/Downloads/QA/`에 생성하고 지금까지의 전 과정을 소급 기록.
  - 앞으로 모든 작업 턴에서 이 파일을 자동 갱신하기로 함(별도 지시 불필요).
  - 동일 선호를 장기 메모리(feedback)로 저장하여 세션이 바뀌어도 유지되도록 함.

### 4) 세션(Session) 수정/삭제 기능 추가
- **지시:** "세션 수정/삭제도 (프로젝트와) 똑같이 추가해줘."
- **처리:** `single-react-dev` 에이전트로 프로젝트 수정/삭제 패턴을 1:1로 세션에 적용.
  - `mockApi.updateSession(id, fields)` — `id`/`project_id`/`admin_token`/`created_at` 보존(→ URL 유지), 나머지 필드만 갱신.
  - `mockApi.deleteSession(id)` — 세션 + 하위 질문 + 관련 votes(`qa_voted_*`) cascade 삭제, `{ removedQuestions }` 반환.
  - 세션 생성 모달을 생성/수정 겸용으로 리팩터(`mode`/`session` props).
  - `DeleteSessionModal` — confirm-by-typing(세션명 입력 시에만 삭제 활성), 삭제될 질문 수 집계, red 경고 박스.
  - 진입점: 프로젝트 상세 페이지의 각 세션 카드 우상단 연필/휴지통 `IconButton`.
- **검증:** 브라우저에서 콘솔 JS 에러 없음(CDN 경고/favicon 404만), 세션 삭제 모달 정상 표시 확인. 실제 삭제는 미실행.

### 3) 프로젝트(Project) 수정/삭제 기능 추가
- **지시:** "프로젝트 삭제/수정 기능이 없다. 잘못 기입하거나 취소된 프로젝트를 삭제할 수 있어야 한다."
- **처리:**
  - `mockApi.updateProject(id, fields)`, `mockApi.deleteProject(id)`(세션·질문·votes cascade) 추가.
  - 생성 모달을 생성/수정 겸용으로 리팩터.
  - `DeleteProjectModal` — confirm-by-typing(프로젝트명 정확 입력 시 활성), **삭제될 세션 수·질문 수** 집계, red 경고("되돌릴 수 없습니다").
  - 진입점: 관리자 홈 행(hover 시 연필/휴지통) + 프로젝트 상세 헤더.
  - 삭제 후: 상세→`#/admin` 이동, 홈→목록 제거 + 토스트.
  - 공용 컴포넌트 `IconButton`/`PencilIcon`/`TrashIcon` 도입.
- **검증:** 삭제 확인 모달 정상(세션 3·질문 8 집계, 타이핑 확인) — 다크모드 가독성 포함 확인.

### 2) 디자인 리뉴얼 + 다크모드 토글
- **지시:** "디자인이 너무 AI가 만든 것 같다. 그 느낌을 없애고, 야간(다크)모드 전환 스위치를 추가해줘."
- **처리:**
  - "AI 느낌" 제거: 인디고/보라 그라데이션·제목 이모지(🔥 등)·과한 라운드/그림자 전부 제거.
  - 팔레트 교체: 무채색 잉크(ink) 베이스 + 차분한 틸(teal) 액센트 1색. primary 버튼은 잉크 솔리드(검정/흰색).
  - 레이아웃: border/divider 기반 에디토리얼(밀도 있는 행 리스트, stat 스트립), `EVENT Q&A CONSOLE`/`LIVE Q&A` 소형 라벨로 위계 표현.
  - 다크모드: Tailwind `darkMode:'class'`, `<head>` 인라인 스크립트로 FOUC 방지, `ThemeProvider`(Context) + 전 화면 우상단 해/달 토글, `localStorage('qa_theme')` 저장, 최초엔 `prefers-color-scheme` 따름.
- **검증:** 라이트/다크 토글·페이지 이동 간 유지 확인, 4개 화면 dark: 변형 적용.

### 1) 프론트엔드 UI 셸 1차 구축
- **지시:** "PRD 기반으로 QA 솔루션 개발. 프론트 페이지부터 하나씩 진행."
- **처리:** `single-react-dev` 에이전트로 **목업 데이터 기반 단일 `index.html`** 생성(백엔드 연결 전 단계).
  - 해시 라우트 4개: 관리자 홈 `#/admin`, 프로젝트 상세 `#/admin/project/:id`, 사용자 페이지(모바일) `#/session/:id`, 관리자 대시보드 `#/admin/session/:id?token=`.
  - 모든 데이터 접근을 `mockApi` 객체 한 곳에 모음(추후 Supabase로 본문만 교체 가능). localStorage 키 `qa_mock_db_v1`.
  - 핵심 동작: 좋아요순 정렬(like DESC, created_at ASC), 좋아요 1인1표(voter_key + Optimistic UI), 글자수 제한(제목50/이름20/내용500), 필터 탭(전체/답변대기/답변완료/숨김), 세션 생성 시 session_id·admin_token 자동 발급, URL 복사.
  - 시드: 프로젝트 2개(Mendix/Unreal), 세션 5개, 질문 14개.
- **다음 단계(예정):** Supabase 셋업 → `mockApi` 실연동(사용자 Polling 8~12초) → 관리자 Realtime 구독 → 엑셀 다운로드 API/QR.

---

### 다음에 할 일 (백로그)
- [ ] Supabase 프로젝트/DB 스키마(projects·sessions·questions·votes)·`like_question` RPC·RLS 구축
- [ ] `mockApi` → Supabase 실연동 (사용자 페이지 랜덤 Polling 포함)
- [ ] 관리자 대시보드 Realtime 구독 + 변경 시 refetch
- [ ] 세션별/프로젝트별 Q&A 엑셀 다운로드 API + 관리자 토큰 검증
- [ ] QR 코드 생성, 현장 시나리오 테스트
