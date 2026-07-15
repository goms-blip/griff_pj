# Live Poll 솔루션 — 작업 로그 (WORKFLOW.md)

PRD: `live_poll_prd.md` 기반. 기존 Q&A 솔루션(projects/sessions/tracks + Supabase + Express + Vercel) 위에 Live Poll 레이어를 얹는다.

---

## 사용자 요청 / 결정 기록

### 2026-06-12

1. **요청**: `live_poll_prd.md` 기반으로 작업 시작, "일단 프론트 페이지부터 구성".
   - **결정/실행**: 참석자(사용자)용 Live Poll 참여 페이지를 단일 `index.html`(CDN React + Tailwind, 해시 라우팅)로 구현.
   - 화면: 프로젝트 랜딩 `#/e/:code`, 세션 `#/s/:code`, Poll 참여 `#/poll/:code`(단일/복수/5점척도/주관식), 제출완료, 결과(공개 시), 뉴스레터 설문.
   - 중복응답 방지(localStorage), 결과 8~12초 폴링(WebSocket 미사용, PRD 6.1).

2. **요청**: "차례로 전부 진행해줘" (관리자 대시보드 + 백엔드 연동).
   - **결정/실행**:
     - `poll_schema.sql` — PRD 7장 테이블(polls/poll_options/poll_recipients/poll_responses/poll_response_answers) + 인덱스 + 중복방지 unique + `submit_poll_response` RPC(원자적 저장, PRD 8.1) + RLS + Realtime.
     - `poll_seed.sql` — 데모 데이터(Mendix Korea Seminar 2026, Poll 6개, 참여페이지 코드와 일치).
     - `server.js` — 기존 Q&A 백엔드 패턴 재사용(Supabase service_role 게이트웨이). 공개 API(랜딩/세션/Poll/제출/결과) + 관리자 API(Poll CRUD·시작/종료·복제·결과·대상자 CSV·분석·엑셀 4종). `x-admin-token` 인증.
     - `admin.html` — 관리자 대시보드(로그인, 홈, 프로젝트 상세 탭[Poll/뉴스레터/분석], Poll 생성·수정 모달, 결과 패널 2.5초 폴링, 엑셀 다운로드).
     - `index.html` mock API → 실제 `/api/public/*` 엔드포인트로 교체.
   - **검증**: 실제 Supabase 연결로 참여/관리자 화면 렌더 확인. **Poll 스키마(테이블·RPC)는 아직 DB 미적용** — 사용자가 Supabase SQL Editor에서 `poll_schema.sql` → `poll_seed.sql` 실행 필요(DDL은 클라이언트 자동 실행 불가).

3. **요청(디자인 피드백)**: "디자인이 좀 안이뻐. 차라리 QA 했던 디자인이 더 나은 거 같아. 다크 모드 토글도 넣어줘."
   - **결정/실행**: Live Poll 인디고/블루 톤 → **기존 Q&A 디자인 토큰**으로 리스타일.
     - 폰트: Pretendard
     - 팔레트: `ink`(차가운 무채색 뉴트럴) 베이스 + `accent`(딥 틸/시안, 보라·인디고 회피)
     - `darkMode: 'class'` + 깜빡임 방지 인라인 스크립트(`localStorage.lp_theme`) + 다크모드 토글 버튼
     - 부드러운 전환/페이드 애니메이션
   - 대상: `index.html`, `admin.html` 모두. 로직/API/동작은 유지, 스타일 + 다크모드만 변경.
   - **완료/검증(2026-06-12)**: 두 파일 모두 리스타일 + 다크모드 토글 적용. 브라우저로 라이트/다크 양쪽 검증 — 참석자 랜딩·세션, 관리자 홈·프로젝트 상세 모두 정상, 실 Supabase 데이터 유지, 콘솔 에러 0. 테마는 `localStorage.lp_theme`로 두 페이지 공유. 토글 위치: 참석자=EventHeader 우측, 관리자=상단 네비 우측(로그아웃 옆).

4. **요청**: "내가 얘기하는 거 전부 md 파일로 만들고 있는 거 맞지?"
   - **정정**: 그동안 기록 안 하고 있었음(코드 작업만). 이 `WORKFLOW.md`를 신설하고 소급 기록. 이후 결정사항 계속 추가.

---

5. **요청(아이콘/심플화)**: "앞에 아이콘들도 빼고 심플하게. Fal image를 쓰던가 해서 심플하고 깔끔하게."
   - **확인 질문 → 사용자 선택**: 이모지 → **미니멀 SVG 라인 아이콘**(Lucide 스타일). (Fal AI 이미지는 UI 아이콘엔 부적합으로 보류.)
   - **결정/실행**: `index.html`·`admin.html`의 화면 이모지(Poll 유형 ◉☑★✎, 빈상태 🕓📊📭, 토글 🌗, 분석 🗳⚡✉⭐🤝🏆, 체크/경고/잠금/강연자/복사 등)를 통일된 라인 아이콘(viewBox 0 0 24 24, stroke currentColor, width 1.75)으로 교체. 재사용 아이콘 컴포넌트 세트로 정의. 로직/API 불변.
   - **완료/검증(2026-06-12)**: 두 파일 모두 화면 이모지 0개로 교체. 재사용 `Icon`/`Icons` 세트(viewBox 24, stroke 1.75, currentColor)로 통일. 참석자=Clock/Moon·Sun/CircleDot·CheckSquare·Star·Pencil/Chevron 등, 관리자=분석 카드 6종+award/inbox·mic·clipboard-list·mail/chevron 등. 빈 상태는 연한 ink 원형+라인 아이콘으로 차분하게. 라이트/다크 브라우저 검증, 콘솔 에러 0. 로직/API 불변.

6. **요청(PC 레이아웃)**: "사용자 페이지가 모바일 전용으로만 코딩됨. PC에서도 예쁘게."
   - **원인**: 전역 컨테이너 `max-w-lg` 단일 컬럼 고정, 반응형 분기 없음 → PC에서 가운데 좁은 띠.
   - **확인 질문 → 사용자 선택**: **좌우 분할(2패널)**. PC에서 왼쪽=행사/세션/강연자 브랜딩 패널, 오른쪽=투표 폼/콘텐츠. 모바일은 현재(상단 헤더+세로 스택) 동일.
   - **결정/실행**: `index.html`만 대상(관리자는 이미 데스크톱 우선). `Page`/`EventHeader` 셸을 반응형으로 리팩터 — `lg:` 이상 2패널, 미만 기존 스택. 로직/API/컴포넌트 불변.
   - **완료/검증(2026-06-12)**: `EventHeader`/`Page` 셸만 반응형 리팩터. 브레이크포인트 `lg`(1024px). PC=`max-w-5xl` 중앙 + `grid-cols-[5fr_7fr]`(좌 브랜딩 sticky 풀하이트 : 우 콘텐츠 넉넉한 패딩), 모바일=기존 가로 헤더+세로 스택 픽셀 동일. 토글: 모바일 헤더 우상단 / PC 좌 패널 하단. 브라우저로 1440·390 양쪽 + 라이트/다크 검증, 콘솔 에러 0, 로직/API 불변.

7. **요청(관리자 기능 보강)**: "프로젝트 생성/삭제 버튼이 없다. 설문조사 생성 + 통계 보기도 원함."
   - **확인 질문 → 사용자 선택(설문 형태)**: **둘 다(여러 문항 묶음 설문 + 단건 Poll 공존)**.
   - **결정/실행**:
     - 프로젝트 생성/삭제: server `POST/PATCH/DELETE /api/admin/projects[/:id]` 추가 + 관리자 UI. **server·실 DB 검증 완료(생성→삭제 OK)**.
     - 묶음 설문(survey): 스키마에 `surveys` 테이블 + `polls.survey_id/sort_order` 추가(문항=survey_id 가진 poll로 모델링, 기존 집계/응답 재사용). server에 설문 공개 조회/제출, 관리자 CRUD·시작/종료·결과·엑셀 엔드포인트 추가. 단건 Poll 목록은 `survey_id is null`로 분리.
     - 통계: 기존 분석 탭 유지(설문 응답도 project 기준 집계에 포함).
   - **완료/검증(2026-06-12)**:
     - admin.html: 홈 "+새 프로젝트" 모달, 프로젝트 상세 수정/삭제 버튼, "설문조사" 탭(`[Poll][뉴스레터 Poll][설문조사][분석]`), 다문항 설문 빌더(제목·안내문·발송유형·결과공개·시작상태 + 문항 추가/유형전환/선택지/순서이동/삭제), 설문 결과 패널(문항별 집계 2.5초 폴링). api 메서드 12개 추가.
     - index.html: `#/survey/:code` 라우트 + `getSurvey`/`submitSurvey`, NewsletterSurvey 재사용(문항별 question_id 부착 제출).
     - 브라우저 검증: 프로젝트 생성 모달·설문 탭·설문 빌더 렌더 정상, 라이트/다크, 콘솔 에러 0. **프로젝트 생성/삭제는 실 DB로 동작 확인.** 설문 쓰기는 surveys 테이블 적용 후 동작(현재 graceful 400).

8. **요청(DB 구성 방향)**: "새 Supabase 프로젝트(`oixdfkwpkmjrbhonzqxt`)에 만들자. QA와 다르게 깔끔하게."
   - **결정/실행**: 새 전용 프로젝트로 전환. Q&A 잔재(questions/votes/banned_words/session admin_token) 제거하고 **Live Poll 전용 단일 통합 스키마** `livepoll_schema.sql` 신설(린 projects/tracks/sessions + poll/survey 레이어 + RPC + RLS). 기존 5개 QA SQL + poll_schema.sql 제거(이력은 git). 적용 = `livepoll_schema.sql` → `poll_seed.sql` 2개.
   - server.js 호환 확인: questions/votes/admin_token 미참조.
   - **완료(2026-06-12)**: `.env.local`을 새 프로젝트(`oixdfkwpkmjrbhonzqxt`) URL/anon/service_role 로 교체. 사용자가 SQL Editor에서 `livepoll_schema.sql` → `poll_seed.sql` 적용.
     - 적용 중 PostgREST `PGRST002` 발생 → 원인은 **Data API 노출 스키마에 `public` 누락**(placeholder `pg_pgrst_no_exposed_schemas`). 사용자가 Settings→API에서 `public` 노출 후 회복.
     - **실 DB 전체 플로우 검증 완료**: 투표 제출→중복방지(already_submitted)→집계(AI 1표 100%); 3문항 묶음 설문 생성→공개 조회→응답(만족도5·관심2·상담예)→결과(평균5, AI:1/클라우드:1, 예:1). 검증 데이터는 정리(surveys 0, responses 0).
     - 브라우저: 데모 행사 `mendix2026` 참여 화면에 live Poll 5개 + 세션 실데이터 렌더, 콘솔 에러 0.
   - **상태: 전체 완료. 앱이 새 전용 프로젝트에서 end-to-end 동작.**

9. **요청(제출 후 이동 + 미진한 부분 보강)**: "참석자 응답 제출하면 자동으로 리스트로 넘어가야. WORKFLOW.md 참조해 미진한 부분 같이 적용."
   - **제출 후 자동 이동(완료/검증)**: server 공개 Poll/설문 응답에 `project_code`/`session_code` 추가. index.html `api.getPoll` reshape에 project_code 포함. PollPage·NewsletterSurvey 제출 완료 후 2초 뒤 `/e/{project_code}`(행사 랜딩=리스트)로 자동 이동 + "목록으로 돌아가기" 버튼. '결과 보기' 누르면 자동이동 취소(stay). 이메일 토큰 설문은 돌아갈 목록 없어 자동이동 제외. **브라우저 검증: topic2026 투표 → 2초 후 `/e/mendix2026` 이동, 해당 Poll "참여 완료" 배지 표시, 응답 정리 완료.**
   - **세션/트랙 관리(미진 갭 보강)**: 새 프로젝트에서 세션을 만들 수 없던 문제 → server에 세션/트랙 CRUD(`POST/PATCH/DELETE /api/admin/projects/:id/sessions|tracks`, `/sessions|tracks/:id`) 추가(실 DB 생성/삭제 검증). admin.html "세션" 탭 + 세션 생성/수정 모달 + 트랙 관리는 에이전트 작업 중.
   - **세션/트랙 관리 완료/검증(2026-06-12)**: admin "세션" 탭(트랙 칩 추가/삭제 + 세션 목록·생성/수정 모달·삭제, `?tab=sessions`). Poll 생성 모달 세션 드롭다운 자동 연동. server getProject 세션에 `is_public` 추가(공개 배지 정확도). **브라우저 검증: 세션 탭 렌더(Track A/B, 세션 3개), 콘솔 에러 0. API 체인 검증: 신규 프로젝트→세션 생성→세션에 Poll 연결→세션별 목록 확인 OK.** 검증용 프로젝트/응답 모두 정리(데모=mendix2026만, polls 6, responses 0).
   - 상태: **전체 완료.**

### 2026-07-03

1. **고길동(fable) 코드 검수 → 수정 → 기록 사이클**: 대상 `2027b5c..HEAD`(세션 스케줄/엑셀 업로드, 일자별 설문 생성, 날짜·트랙 필터).
   - **검수 요약**: 결함 7건 발견(조치대상 4건). 비공개 세션 제목이 day-survey로 공개 노출(High) 1건, 무순서 페이지네이션 집계 왜곡·CSV 따옴표 파싱 파손·8MB 바디 상향 남용(Medium) 3건, 비원자 import·required 회귀·SRI 없는 CDN(Low) 3건. 수식 인젝션/XSS/IDOR/service_role 노출은 반박 후 이상 없음 확인.
   - **발견 결함**:
     1. [High/Security] `generate-day` 설문이 `is_public=false`(비공개) 세션 제목을 공개 설문 문항으로 노출 — `server.js`
     2. [Medium/QA] `fetchAllPaged`가 ORDER BY 없이 range 페이지네이션 → 1000행 초과 시 응답 중복/누락으로 집계 왜곡 — `server.js`
     3. [Medium/QA] 세션 CSV 파서(`csvToTable`)가 따옴표 필드·BOM 미지원 → 콤마 포함 세션명 파손 및 유령 트랙 자동 생성 — `server.js`
     4. [Medium/Security] JSON 바디 한도 1MB→8MB 전역 상향 + 공개 제출 API의 `answer_text` 길이 미검증·레이트리밋 부재 → 스토리지 남용 8배 증폭 — `server.js`
     5. [Low/QA] 세션 일괄 업로드 비원자성(트랙 먼저 생성 후 세션 insert 실패 시 트랙만 잔존), 행 수·셀 길이 상한 없음 — `server.js`
     6. [Low/QA] 공개 설문 API의 `required`가 모든 rating 문항에 전역 적용 → 기존 설문(뉴스레터 NPS 등) 필수 응답 회귀 — `server.js`
     7. [Low/Security] 관리자 콘솔에 SRI 없는 서드파티 CDN 스크립트(qrcode-generator) 추가 — admin 토큰이 있는 페이지 — `admin.html`
   - **수정(opus/max)**: 결함 1~4 조치. `node --check server.js` 통과, 워킹트리 반영(미커밋).
     - 결함1: 세션 조회 시 `is_public`도 select해 공개 세션만 문항화(`sessions.filter(is_public===true)`), 제외 건수를 `excluded_private_count`로 응답에 포함(`mapSurvey` 옵셔널 패스스루로 기존 API 계약 불변).
     - 결함2: `fetchAllPaged` 호출 5곳(poll_options, surveyResponseCount, 설문 목록, results의 poll_responses·poll_response_answers)에 안정 정렬키 `.order('id')` 강제.
     - 결함3: RFC4180 파서 `parseCsvRows` 신규 추가(따옴표 내 콤마/개행, `""` 이스케이프, BOM 제거, 빈 줄 제외)로 `csvToTable`·`parseCsv`(recipients) 통일.
     - 결함4: 바디 한도를 라우트별 분기(전역 1mb, `sessions/import`만 8mb) + `normalizePublicAnswers`로 `answer_text` 200자·`answers` 200개 상한 + IP 기반 레이트리밋(분당 20회)을 공개 제출 2개 라우트에 부착. 참고: 서버리스 인메모리 리미터라 완전한 분산 방어는 아님(범위 외).
   - **재검수(실행 확인, E2E)**: 4건 모두 실효적으로 해결, 새 회귀 없음.
     - 결함1: 스키마상 `is_public not null default true`라 null 케이스 없음, strict 비교 안전. `mapSurvey` 패스스루로 다른 호출부 API 계약 불변 확인.
     - 결함2: 호출부 5곳 전부 `.order('id')` 적용 확인, dev Supabase 대상 관련 엔드포인트 3종 모두 200 + 정상 데이터.
     - 결함3: `parseCsvRows` 단위테스트 8케이스 전부 통과(BOM, 따옴표 내 콤마/개행, `""` 이스케이프, CRLF 등).
     - 결함4: 실측 — 공개 제출 2MB→413, `sessions/import` 2MB→401(8MB 경로 정상)/9MB→413, 동일 IP 25회 제출 시 21번째부터 429(분당 20회 정확).
   - **잔여 사항(Low, 미조치)**: XFF 첫 항목 기반 리미터가 직접 노출 배포에서 우회 가능(Vercel 프로덕션은 플랫폼이 XFF 덮어써 실질 위험 낮음, `server.js:52`); `excluded_private_count`가 서버 응답엔 있으나 admin UI 토스트에 미표시(`admin.html:1984`).

2. **고길동 Low 3건 후속 정리**: 직전 사이클의 Low 3건(L1 세션 일괄 업로드 비원자성, L2 required 전역적용 회귀, L3 SRI 없는 CDN) 수정.
   - **수정(opus/max)**: 3건 모두 적용·검증 완료.
     - L1: 행 수/셀 길이 상한 도입(`IMPORT_MAX_ROWS`/`TITLE`/`SPEAKER`), 트랙 생성 전 전 행 사전검증, 세션 insert 실패 시 신규 트랙 롤백(`rollbackTracks`)으로 원자성 확보 — `server.js`.
     - L2: `polls.required` 컬럼 추가 마이그레이션 신설, generate-day만 명시 기록(이름/이메일/연락처 필수, rating 선택), 공개 API는 NULL/컬럼부재 시 필수로 폴백(회귀 방지), 컬럼 부재 시 무손상 재시도 — `server.js`, `migrations/2026-07-03_polls_required_col.sql`(신규, **프로덕션 Supabase `oixdfkwpkmjrbhonzqxt`에 수동 적용 필요**).
     - L3: SRI 해시 추측 대신 `qrcode-generator@1.4.4`를 `vendor/qrcode.js`로 vendoring, admin.html이 동일 오리진에서 로드하도록 교체, server.js에 전용 라우트(catch-all보다 앞) 추가, `vercel.json` includeFiles 반영 — `vendor/qrcode.js`(신규), `admin.html`, `server.js`, `vercel.json`.
   - **검증**: `node --check server.js` 통과, `vercel.json` 유효, vendored qrcode.js 로드 및 QR 매트릭스 생성 확인, `/vendor/qrcode.js` 라우트가 catch-all보다 먼저 등록됨, admin.html에 CDN qrcode 참조 잔존 없음.
   - **잔여 사항(Low, 미조치)**: 관리자 콘솔에서 generate-day 설문 편집 시 관리자 상세 응답/저장 payload에 `required`가 왕복되지 않아 rating의 `required=false`가 유실되고 전부 필수로 회귀(`server.js:1184`, `admin.html:2235`).
   - 커밋 안 함(워킹트리만).

## 산출물

| 파일 | 역할 |
|---|---|
| `index.html` | 참석자 Live Poll 페이지 (랜딩/세션/Poll/결과/설문, 제출 후 자동 복귀) |
| `admin.html` | 관리자 대시보드 (프로젝트·세션·트랙·Poll·설문·분석·엑셀) |
| `server.js` | Supabase 게이트웨이(공개/관리자 API + 엑셀) |
| `livepoll_schema.sql` | Live Poll 전용 통합 스키마(projects/tracks/sessions + poll/survey + RPC + RLS) |
| `poll_seed.sql` | 데모 시드(Mendix 행사 + Poll 6개) |
| `package.json` / `vercel.json` / `.vercelignore` | 배포 설정 |

## 환경
- Supabase: 전용 프로젝트 `oixdfkwpkmjrbhonzqxt` (`.env.local`). Data API 노출 스키마 `public` 필요.
- 로컬: `npm start` → http://localhost:8787 (참석자 `/`, 관리자 `/admin`, 토큰 `.env.local`의 ADMIN_CONSOLE_TOKEN).

## 다음 단계 후보 (미요청)
- [ ] QR 코드 생성(행사/세션/Poll 링크) — PRD 5.3.1
- [ ] 분석 `consult_count`(상담 희망 집계) 실제 매핑 — 현재 0 placeholder
- [ ] `?tab=sessions` 등 탭 딥링크 신규진입 시 활성화(현재 클릭은 정상, 일부 딥링크는 기본탭 표시)
