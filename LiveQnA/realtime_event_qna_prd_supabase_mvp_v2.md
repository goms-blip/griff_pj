# 실시간 행사 Q&A 솔루션 PRD 및 개발 가이드 v2

## 1. 개요

### 1.1 제품명

실시간 행사 Q&A 솔루션

### 1.2 목적

오프라인 및 온라인 행사에서 청중이 QR코드를 통해 별도 가입 없이 질문을 등록하고, 다른 참가자의 질문에 좋아요를 눌러 주요 질문이 상단에 노출되도록 한다.

본 솔루션은 한 번만 사용하는 휘발성 Q&A 도구가 아니라, 여러 행사와 프로젝트에서 반복적으로 사용할 수 있는 지속형 내부 운영 도구로 설계한다.

관리자는 프로젝트를 생성하고, 프로젝트 하위에 행사 세션을 만들 수 있으며, 각 세션별 Q&A를 실시간으로 관리하고 행사 종료 후 질문 데이터를 엑셀 파일로 다운로드할 수 있어야 한다.

### 1.3 주요 사용자

| 구분 | 설명 |
|---|---|
| 최고 관리자 / 운영자 | 프로젝트 생성, 세션 생성, 관리자 토큰 관리, Q&A 데이터 다운로드 |
| 관리자 / 연사 | 관리자 페이지에서 실시간 질문 확인, 답변 완료 처리, 필요 시 질문 숨김 처리 |
| 행사 참가자 | QR코드를 통해 세션 페이지에 접속하여 질문 등록 및 좋아요 참여 |

---

## 2. 핵심 사용자 여정

### 2.1 최고 관리자 / 운영자

1. 관리자 홈 화면 접속
2. 신규 프로젝트 생성
3. 프로젝트 하위에 하나 이상의 세션 생성
4. 각 세션별 사용자용 QR URL 및 관리자 URL 확인
5. 행사 진행 중 Q&A 상태 모니터링
6. 행사 종료 후 세션별 또는 프로젝트별 Q&A 목록을 엑셀 파일로 다운로드

### 2.2 행사 참가자

1. 행사장 또는 온라인 화면의 QR코드 스캔
2. 특정 세션 질문 페이지로 이동
3. 별도 회원가입 없이 질문 목록 확인
4. 질문 등록 또는 기존 질문에 좋아요 클릭
5. 본인이 누른 좋아요는 중복 클릭 불가
6. 질문 목록은 좋아요 수 기준으로 자동 정렬

### 2.3 관리자 / 연사

1. 관리자 전용 URL 또는 로그인 방식으로 관리자 페이지 접속
2. 실시간으로 정렬되는 질문 목록 확인
3. 상단 인기 질문부터 답변
4. 답변 완료된 질문에 체크 표시
5. 부적절한 질문은 숨김 처리
6. 전체 / 답변 대기 / 답변 완료 / 숨김 질문 기준으로 필터링
7. 필요 시 현재 세션의 Q&A 목록을 엑셀로 다운로드

---

## 3. 핵심 아키텍처

Supabase 무료 요금제의 Realtime 동시 연결 수 제한을 고려하여 사용자 페이지와 관리자 페이지의 데이터 동기화 방식을 분리한다.

### 3.1 사용자 페이지

사용자 페이지는 Supabase Realtime WebSocket을 사용하지 않는다.

대신 다음 방식으로 처리한다.

| 항목 | 방식 |
|---|---|
| 최초 질문 목록 조회 | 일반 HTTP 요청 |
| 질문 목록 갱신 | 8~12초 랜덤 Polling |
| 질문 등록 | REST API 또는 Supabase RPC |
| 좋아요 등록 | Supabase RPC |
| 좋아요 UI 반영 | Optimistic UI 적용 |
| 중복 투표 방지 | localStorage UUID + votes 테이블 unique 제약 |

사용자 화면에서 WebSocket을 사용하지 않는 이유는 행사 참가자 수가 많아질 경우 Supabase 무료 요금제의 Realtime 연결 제한에 빠르게 도달할 수 있기 때문이다.

### 3.2 관리자 페이지

관리자 페이지는 Supabase Realtime WebSocket을 사용한다.

관리자는 일반적으로 1~3명 수준이므로 Realtime 연결 수에 큰 부담이 없다.

| 항목 | 방식 |
|---|---|
| 최초 질문 목록 조회 | 일반 HTTP 요청 |
| 실시간 변경 감지 | Supabase Realtime |
| 변경 반영 방식 | 이벤트 발생 시 전체 질문 목록 refetch |
| 답변 완료 처리 | 관리자 API 또는 Supabase update |
| 숨김 처리 | 관리자 API 또는 Supabase update |
| 엑셀 다운로드 | 관리자 API route에서 xlsx 생성 |

관리자 화면에서는 Realtime payload를 직접 복잡하게 병합하지 않고, 변경 이벤트가 발생하면 전체 질문 목록을 다시 조회하는 방식을 우선 적용한다.

MVP 단계에서는 이 방식이 더 안정적이고 구현이 단순하다.

### 3.3 프로젝트 / 세션 구조

이 솔루션은 매 프로젝트마다 새로 개발하거나 새 DB를 만드는 구조가 아니다.

하나의 시스템 안에서 다음 계층 구조를 가진다.

```text
Project
└── Session
    └── Questions
        └── Votes
```

예시:

```text
Mendix Korea Seminar 2026
├── Keynote Q&A
├── Customer Case Session Q&A
└── Closing Panel Q&A

Unreal Fest Seoul 2026
├── Opening Keynote Q&A
├── Game Track Q&A
└── Education Summit Q&A
```

---

## 4. 기능 요구사항

## 4.1 프로젝트 관리 페이지

본 솔루션은 매 행사마다 새로 만드는 1회성 페이지가 아니라, 관리자 화면에서 프로젝트와 세션을 생성하여 반복 사용할 수 있는 구조로 설계한다.

### 4.1.1 프로젝트 생성 기능

최고 관리자 또는 운영자는 관리자 홈에서 신규 프로젝트를 생성할 수 있다.

| 입력 필드 | 필수 여부 | 설명 |
|---|---:|---|
| 프로젝트명 | 필수 | 행사 또는 고객 프로젝트명 |
| 고객사 / 주최사명 | 선택 | 프로젝트 구분용 |
| 프로젝트 설명 | 선택 | 내부 운영 메모 |
| 시작일 | 선택 | 행사 시작일 |
| 종료일 | 선택 | 행사 종료일 |
| 상태 | 선택 | 준비중 / 진행중 / 종료 |

프로젝트 예시:

```text
Mendix Korea Seminar 2026
Unreal Fest Seoul 2026
KOBA 2026 Press Session
```

### 4.1.2 프로젝트 목록 기능

관리자 홈에서는 생성된 프로젝트 목록을 확인할 수 있다.

| 표시 항목 | 설명 |
|---|---|
| 프로젝트명 | 프로젝트 이름 |
| 고객사 / 주최사명 | 선택 입력값 |
| 생성일 | 프로젝트 생성일 |
| 세션 수 | 프로젝트에 연결된 Q&A 세션 수 |
| 전체 질문 수 | 프로젝트 전체 질문 수 |
| 상태 | 준비중 / 진행중 / 종료 |

### 4.1.3 프로젝트 상세 페이지

프로젝트 상세 페이지에서는 해당 프로젝트에 속한 세션 목록을 관리한다.

가능한 작업:

- 세션 생성
- 세션 제목 수정
- 사용자용 QR URL 확인
- 관리자용 URL 확인
- 세션별 Q&A 대시보드 진입
- 세션별 Q&A 엑셀 다운로드
- 프로젝트 전체 Q&A 엑셀 다운로드

---

## 4.2 세션 관리 기능

프로젝트 하위에 하나 이상의 세션을 생성할 수 있다.

### 4.2.1 세션 생성

| 입력 필드 | 필수 여부 | 설명 |
|---|---:|---|
| 세션명 | 필수 | 강연 또는 Q&A 세션 제목 |
| 세션 설명 | 선택 | 내부 참고용 설명 |
| 진행 시간 | 선택 | 세션 시작/종료 시간 |
| 공개 여부 | 선택 | 사용자 페이지 접근 가능 여부 |

세션 생성 시 다음 값이 자동 생성된다.

| 항목 | 설명 |
|---|---|
| session_id | 사용자 URL용 고유 ID |
| admin_token | 관리자 접근용 랜덤 토큰 |
| 사용자 URL | QR코드 연결용 URL |
| 관리자 URL | 연사 또는 운영자용 URL |

### 4.2.2 세션 목록

프로젝트 상세 화면에서는 세션 목록을 확인할 수 있다.

| 표시 항목 | 설명 |
|---|---|
| 세션명 | 세션 제목 |
| 질문 수 | 등록된 전체 질문 수 |
| 답변 대기 수 | 아직 답변 완료되지 않은 질문 수 |
| 답변 완료 수 | 답변 완료된 질문 수 |
| 숨김 질문 수 | 숨김 처리된 질문 수 |
| 사용자 URL | 복사 가능 |
| 관리자 URL | 복사 가능 |
| 엑셀 다운로드 | 해당 세션 Q&A 다운로드 |

---

## 4.3 사용자 페이지

### 4.3.1 진입 방식

| 항목 | 내용 |
|---|---|
| URL 예시 | `/session/:sessionId` |
| 접근 방식 | QR코드 스캔을 통한 직접 접속 |
| 로그인 여부 | 비회원 익명 참여 |
| 지원 환경 | 모바일 브라우저, iOS/Android 인앱 브라우저 포함 |

### 4.3.2 질문 목록 화면

질문 목록은 다음 기준으로 정렬한다.

```sql
ORDER BY like_count DESC, created_at ASC
```

정렬 기준은 다음과 같다.

1. 좋아요 수가 많은 질문이 상위
2. 좋아요 수가 같으면 먼저 등록된 질문이 상위

질문 카드에 표시되는 항목은 다음과 같다.

| 항목 | 설명 |
|---|---|
| 제목 | 질문 제목 |
| 질문자명 | 미입력 시 `익명` |
| 본문 | 질문 내용 |
| 좋아요 수 | 질문별 좋아요 수 |
| 답변 완료 여부 | 답변 완료된 경우 배지 표시 |

### 4.3.3 질문 작성 기능

| 입력 필드 | 필수 여부 | 제한 |
|---|---:|---|
| 제목 | 필수 | 최대 50자 |
| 질문자명 | 선택 | 최대 20자, 미입력 시 `익명` |
| 내용 | 필수 | 최대 500자 |

추가 처리 사항:

- 앞뒤 공백 제거
- 빈 문자열 등록 방지
- 간단한 금지어 필터 적용
- 너무 짧거나 의미 없는 질문 등록 방지 여부는 추후 결정

### 4.3.4 좋아요 기능

MVP에서는 싫어요 기능은 제외하고 좋아요만 제공한다.

이유는 다음과 같다.

- 행사 Q&A 분위기를 부정적으로 만들 수 있음
- 질문자가 민망함을 느낄 수 있음
- 집단적으로 특정 질문을 묻어버리는 문제가 생길 수 있음
- 정렬 점수에 반영할지 기준이 애매함

좋아요 기능은 다음 방식으로 처리한다.

| 항목 | 내용 |
|---|---|
| 클릭 제한 | 한 사용자당 한 질문에 1회 |
| 식별 방식 | localStorage에 저장한 voter_key |
| DB 중복 방지 | `votes` 테이블의 unique 제약 |
| UI 반영 | Optimistic UI |
| 서버 처리 | RPC 함수로 원자적 처리 |

### 4.3.5 사용자 Polling

사용자 페이지는 8~12초 사이의 랜덤 Polling을 사용한다.

고정 10초 Polling을 사용하지 않는 이유는 모든 사용자가 동시에 요청을 보내는 상황을 피하기 위해서다.

예시:

```text
사용자 A: 8.5초마다 요청
사용자 B: 10.2초마다 요청
사용자 C: 11.7초마다 요청
```

이 방식은 요청이 한 시점에 몰리는 현상을 줄인다.

---

## 4.4 관리자 페이지

### 4.4.1 접근 방식

관리자 페이지는 일반 사용자에게 노출되지 않아야 한다.

MVP에서는 아래 방식 중 하나를 선택한다.

| 방식 | 설명 | 권장도 |
|---|---|---:|
| 관리자 토큰 URL | `/admin/session/:sessionId?token=xxxxx` | MVP 권장 |
| Supabase Auth 로그인 | 관리자 계정 로그인 후 접근 | 정식 운영 권장 |

MVP에서는 세션별로 예측 불가능한 관리자 토큰을 발급한다.

예시:

```text
/admin/session/SESSION_ID?token=RANDOM_ADMIN_TOKEN
```

관리자 토큰은 프론트엔드에서만 체크하지 말고, 서버 또는 Supabase 정책에서도 검증해야 한다.

### 4.4.2 관리자 대시보드

관리자 화면은 사용자 화면과 유사한 질문 카드 UI를 사용하되, 관리 기능을 추가한다.

표시 항목:

| 항목 | 설명 |
|---|---|
| 질문자명 | 작성자명 또는 익명 |
| 제목 | 질문 제목 |
| 본문 | 질문 내용 |
| 좋아요 수 | 질문별 좋아요 수 |
| 등록 시간 | 질문 등록 시간 |
| 답변 상태 | 답변 대기 / 답변 완료 |
| 숨김 상태 | 숨김 여부 |

### 4.4.3 답변 상태 관리

관리자는 각 질문에 대해 답변 완료 여부를 변경할 수 있다.

| 기능 | 설명 |
|---|---|
| 답변 완료 체크 | `is_answered = true` |
| 답변 완료 해제 | `is_answered = false` |
| 상태 배지 | 사용자 화면에도 답변 완료 표시 |

### 4.4.4 질문 숨김 처리

부적절한 질문 또는 중복 질문을 관리자 화면에서 숨김 처리할 수 있다.

| 기능 | 설명 |
|---|---|
| 숨김 처리 | `is_hidden = true` |
| 숨김 해제 | `is_hidden = false` |
| 사용자 화면 | 숨김 질문은 표시하지 않음 |
| 관리자 화면 | 필터를 통해 숨김 질문 확인 가능 |

### 4.4.5 필터 기능

관리자 화면에는 다음 필터를 제공한다.

| 필터 | 조건 |
|---|---|
| 전체 질문 | 숨김을 제외한 모든 질문 |
| 답변 대기 | `is_answered = false` |
| 답변 완료 | `is_answered = true` |
| 숨김 질문 | `is_hidden = true` |

### 4.4.6 Q&A 엑셀 다운로드 기능

관리자는 세션별 또는 프로젝트별로 Q&A 목록을 엑셀 파일로 다운로드할 수 있다.

이 기능은 행사 종료 후 고객사 보고, 내부 리뷰, 연사 피드백, 후속 콘텐츠 제작에 활용한다.

#### 다운로드 범위

| 다운로드 범위 | 설명 |
|---|---|
| 세션별 다운로드 | 특정 세션에 등록된 질문만 다운로드 |
| 프로젝트 전체 다운로드 | 프로젝트 하위 모든 세션의 질문을 통합 다운로드 |

#### 엑셀 컬럼 구성

엑셀 파일에는 다음 컬럼을 포함한다.

| 컬럼명 | 설명 |
|---|---|
| project_title | 프로젝트명 |
| session_title | 세션명 |
| question_id | 질문 ID |
| author | 질문자명 |
| title | 질문 제목 |
| content | 질문 본문 |
| like_count | 좋아요 수 |
| is_answered | 답변 완료 여부 |
| is_hidden | 숨김 여부 |
| created_at | 질문 등록 시간 |
| answered_status | 답변 상태 텍스트 |
| exported_at | 다운로드 생성 시간 |

#### 정렬 기준

엑셀 다운로드 시 기본 정렬은 다음과 같다.

```sql
ORDER BY session_title ASC, like_count DESC, created_at ASC
```

세션별 다운로드에서는 다음 정렬을 사용한다.

```sql
ORDER BY like_count DESC, created_at ASC
```

#### 파일명 규칙

```text
프로젝트명_QA_YYYYMMDD.xlsx
프로젝트명_세션명_QA_YYYYMMDD.xlsx
```

예시:

```text
Mendix_Korea_Seminar_2026_QA_20260610.xlsx
Mendix_Korea_Seminar_2026_Keynote_QA_20260610.xlsx
```

#### 구현 방식

MVP에서는 서버 API route에서 엑셀 파일을 생성하여 다운로드한다.

예시:

```text
GET /api/admin/projects/:projectId/questions/export?token=ADMIN_TOKEN
GET /api/admin/sessions/:sessionId/questions/export?token=ADMIN_TOKEN
```

권장 라이브러리:

| 환경 | 라이브러리 |
|---|---|
| Node.js / Next.js | exceljs 또는 xlsx |
| Python 서버 | openpyxl 또는 pandas |

엑셀 다운로드 API는 반드시 관리자 토큰 또는 관리자 로그인 권한을 검증한 후 실행한다.

---

## 5. 비기능 요구사항

### 5.1 실시간성

| 화면 | 요구사항 |
|---|---|
| 사용자 화면 | 8~12초 Polling으로 질문 목록 갱신 |
| 관리자 화면 | Supabase Realtime으로 변경 감지 후 즉시 refetch |
| 좋아요 클릭 후 사용자 본인 화면 | Optimistic UI로 즉시 반영 |
| 관리자 화면 반영 | 0.5~2초 이내 반영 목표 |

### 5.2 사용성

- 모바일 우선 반응형 웹
- iOS Safari 테스트
- Android Chrome 테스트
- 카카오톡 인앱 브라우저 테스트
- QR 스캔 후 바로 질문 작성 가능
- 글자 크기와 버튼 크기는 현장 사용성을 고려하여 크게 설계
- 관리자 홈에서 프로젝트와 세션을 쉽게 생성할 수 있어야 함
- 행사 종료 후 Q&A 다운로드 버튼을 쉽게 찾을 수 있어야 함

### 5.3 트래픽 대응

- 사용자 페이지 WebSocket 미사용
- Polling interval 랜덤화
- 좋아요는 RPC 함수에서 원자적으로 처리
- votes 테이블 unique 제약으로 중복 투표 방지
- 관리자 Realtime 연결 수 최소화

### 5.4 보안

- 사용자 페이지에서는 관리자 기능 접근 불가
- 관리자 토큰은 세션별로 랜덤 생성
- Supabase RLS 정책 적용
- 질문 수정, 삭제, 답변 완료, 숨김 처리는 관리자만 가능
- 엑셀 다운로드는 관리자만 가능
- 클라이언트에서만 권한 체크하지 않음

### 5.5 지속 운영성

- 프로젝트 단위로 데이터가 누적되어야 함
- 프로젝트가 종료되어도 Q&A 데이터는 보관되어야 함
- 과거 프로젝트를 다시 조회할 수 있어야 함
- 프로젝트별 Q&A 데이터를 엑셀로 추출할 수 있어야 함
- 향후 통계 기능 확장을 고려하여 DB를 설계함

---

## 6. 데이터베이스 설계

Supabase는 PostgreSQL 기반이므로 PostgreSQL 문법을 기준으로 작성한다.

## 6.1 projects

반복 사용을 위한 프로젝트 단위 정보를 저장한다.

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  title varchar(255) not null,
  client_name varchar(255),
  description text,
  start_date date,
  end_date date,
  status varchar(20) not null default 'draft',
  created_at timestamptz default now()
);
```

| 컬럼명 | 타입 | 설명 |
|---|---|---|
| id | uuid | 프로젝트 고유 ID |
| title | varchar(255) | 프로젝트명 |
| client_name | varchar(255) | 고객사 또는 주최사명 |
| description | text | 내부 운영 메모 |
| start_date | date | 프로젝트 시작일 |
| end_date | date | 프로젝트 종료일 |
| status | varchar(20) | draft / active / closed |
| created_at | timestamptz | 생성일 |

---

## 6.2 sessions

프로젝트 하위의 행사 세션 정보를 저장한다.

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title varchar(255) not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_public boolean not null default true,
  admin_token text not null,
  created_at timestamptz default now()
);
```

| 컬럼명 | 타입 | 설명 |
|---|---|---|
| id | uuid | 세션 고유 ID |
| project_id | uuid | 소속 프로젝트 ID |
| title | varchar(255) | 세션 또는 강연 제목 |
| description | text | 세션 설명 |
| starts_at | timestamptz | 세션 시작 시간 |
| ends_at | timestamptz | 세션 종료 시간 |
| is_public | boolean | 사용자 페이지 공개 여부 |
| admin_token | text | 관리자 접근용 랜덤 토큰 |
| created_at | timestamptz | 생성일 |

---

## 6.3 questions

사용자가 등록한 질문을 저장한다.

```sql
create table questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  title varchar(50) not null,
  content text not null,
  author varchar(20) default '익명',
  like_count int not null default 0,
  is_answered boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz default now()
);
```

| 컬럼명 | 타입 | 설명 |
|---|---|---|
| id | uuid | 질문 고유 ID |
| session_id | uuid | 소속 세션 ID |
| title | varchar(50) | 질문 제목 |
| content | text | 질문 본문 |
| author | varchar(20) | 질문자명 |
| like_count | int | 좋아요 수 |
| is_answered | boolean | 답변 완료 여부 |
| is_hidden | boolean | 숨김 여부 |
| created_at | timestamptz | 등록 시간 |

---

## 6.4 votes

좋아요 중복 방지를 위한 테이블이다.

```sql
create table votes (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  voter_key text not null,
  created_at timestamptz default now(),
  unique (question_id, voter_key)
);
```

| 컬럼명 | 타입 | 설명 |
|---|---|---|
| id | uuid | 투표 고유 ID |
| question_id | uuid | 투표 대상 질문 ID |
| voter_key | text | 사용자 브라우저별 식별 키 |
| created_at | timestamptz | 투표 시간 |

중복 투표 방지는 다음 제약으로 처리한다.

```sql
unique (question_id, voter_key)
```

동일한 `voter_key`는 같은 질문에 한 번만 좋아요를 누를 수 있다.

---

## 6.5 인덱스

프로젝트, 세션, 질문 목록 정렬과 조회 성능을 위해 인덱스를 추가한다.

```sql
create index idx_sessions_project
on sessions (project_id, created_at asc);

create index idx_questions_session_sort
on questions (session_id, is_hidden, like_count desc, created_at asc);

create index idx_votes_question_voter
on votes (question_id, voter_key);
```

---

## 7. RPC 함수 설계

좋아요 등록은 클라이언트에서 단순 update로 처리하지 않는다.

반드시 DB 함수 또는 서버 API에서 원자적으로 처리한다.

## 7.1 좋아요 등록 함수

```sql
create or replace function like_question(
  p_question_id uuid,
  p_voter_key text
)
returns json
language plpgsql
security definer
as $$
declare
  inserted_count int;
  new_like_count int;
begin
  insert into votes (question_id, voter_key)
  values (p_question_id, p_voter_key)
  on conflict (question_id, voter_key) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update questions
    set like_count = like_count + 1
    where id = p_question_id
    returning like_count into new_like_count;

    return json_build_object(
      'success', true,
      'liked', true,
      'like_count', new_like_count
    );
  else
    select like_count
    into new_like_count
    from questions
    where id = p_question_id;

    return json_build_object(
      'success', true,
      'liked', false,
      'reason', 'already_voted',
      'like_count', new_like_count
    );
  end if;
end;
$$;
```

이 함수는 다음 문제를 방지한다.

- 동시에 여러 명이 좋아요를 눌렀을 때 count가 꼬이는 문제
- 같은 사용자가 같은 질문에 여러 번 좋아요를 누르는 문제
- 클라이언트 조작으로 like_count를 직접 변경하는 문제

---

## 8. RLS 정책 방향

Supabase 사용 시 RLS 정책을 반드시 설정한다.

상세 정책은 실제 인증 방식에 따라 달라질 수 있으나, 기본 방향은 다음과 같다.

### 8.1 사용자 권한

| 대상 | 권한 |
|---|---|
| projects | 직접 조회 불가 또는 필요한 최소 정보만 조회 |
| sessions | 공개 세션 읽기 가능 |
| questions | 숨김이 아닌 질문 읽기 가능 |
| questions | 질문 등록 가능 |
| questions | 직접 update/delete 불가 |
| votes | RPC를 통한 insert만 허용 |

### 8.2 관리자 권한

| 대상 | 권한 |
|---|---|
| projects | 생성, 조회, 수정 가능 |
| sessions | 생성, 조회, 수정 가능 |
| questions | 읽기 가능 |
| questions | 답변 완료 상태 변경 가능 |
| questions | 숨김 상태 변경 가능 |
| questions | 엑셀 다운로드 가능 |

MVP에서 관리자 토큰 방식을 사용할 경우, 관리자 작업은 별도 API route를 통해 처리하는 것이 더 단순하다.

예시:

```text
POST /api/admin/projects
POST /api/admin/projects/:projectId/sessions
POST /api/admin/questions/:id/answered
POST /api/admin/questions/:id/hide
GET /api/admin/projects/:projectId/questions/export
GET /api/admin/sessions/:sessionId/questions/export
```

각 요청에서 `admin_token` 또는 관리자 인증 정보를 검증한 후 DB 작업을 수행한다.

---

## 9. 엑셀 다운로드 API 구현 가이드

## 9.1 세션별 Q&A 엑셀 다운로드 API

```ts
// 예시: Next.js API Route 또는 Route Handler
// GET /api/admin/sessions/:sessionId/questions/export?token=ADMIN_TOKEN

export async function GET(request: Request, { params }: { params: { sessionId: string } }) {
  const token = new URL(request.url).searchParams.get('token');

  // 1. sessionId와 token 검증
  // 2. questions 조회
  // 3. exceljs 또는 xlsx로 파일 생성
  // 4. xlsx 파일 response 반환
}
```

세션별 다운로드 쿼리 기준:

```sql
select
  p.title as project_title,
  s.title as session_title,
  q.id as question_id,
  q.author,
  q.title,
  q.content,
  q.like_count,
  q.is_answered,
  q.is_hidden,
  q.created_at
from questions q
join sessions s on q.session_id = s.id
join projects p on s.project_id = p.id
where q.session_id = :session_id
order by q.like_count desc, q.created_at asc;
```

## 9.2 프로젝트 전체 Q&A 엑셀 다운로드 API

```text
GET /api/admin/projects/:projectId/questions/export?token=ADMIN_TOKEN
```

프로젝트 전체 다운로드 쿼리 기준:

```sql
select
  p.title as project_title,
  s.title as session_title,
  q.id as question_id,
  q.author,
  q.title,
  q.content,
  q.like_count,
  q.is_answered,
  q.is_hidden,
  q.created_at
from questions q
join sessions s on q.session_id = s.id
join projects p on s.project_id = p.id
where p.id = :project_id
order by s.title asc, q.like_count desc, q.created_at asc;
```

## 9.3 엑셀 다운로드 보안

엑셀 다운로드는 일반 사용자에게 노출되면 안 된다.

반드시 다음 중 하나로 보호한다.

| 방식 | 설명 |
|---|---|
| 관리자 토큰 검증 | MVP 권장 |
| Supabase Auth + admin role | 정식 운영 권장 |

엑셀 다운로드 API에서는 다음 데이터를 검증한다.

1. 요청한 projectId 또는 sessionId가 존재하는지
2. 전달된 token이 해당 프로젝트 또는 세션의 관리자 권한과 일치하는지
3. 권한이 없는 경우 403을 반환하는지

---

## 10. 프론트엔드 구현 가이드

## 10.1 사용자 페이지 Polling 예시

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Question = {
  id: string;
  title: string;
  content: string;
  author: string;
  like_count: number;
  is_answered: boolean;
  created_at: string;
};

function getRandomPollingMs() {
  return 8000 + Math.floor(Math.random() * 4000);
}

export function UserQuestionList({ sessionId }: { sessionId: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);

  const fetchQuestions = async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('is_hidden', false)
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: true });

    if (!error && data) {
      setQuestions(data);
    }
  };

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const loop = async () => {
      await fetchQuestions();
      timeoutId = setTimeout(loop, getRandomPollingMs());
    };

    loop();

    return () => clearTimeout(timeoutId);
  }, [sessionId]);

  return (
    <div>
      {/* 질문 목록 렌더링 */}
    </div>
  );
}
```

---

## 10.2 사용자 좋아요 처리 예시

```tsx
async function handleLike(questionId: string) {
  const voterKey = getOrCreateVoterKey();

  // Optimistic UI
  setQuestions((prev) =>
    prev.map((q) =>
      q.id === questionId
        ? { ...q, like_count: q.like_count + 1 }
        : q
    )
  );

  const { data, error } = await supabase.rpc('like_question', {
    p_question_id: questionId,
    p_voter_key: voterKey,
  });

  if (error || !data?.success) {
    // 실패 시 refetch로 정합성 회복
    await fetchQuestions();
    return;
  }

  if (data.liked === false) {
    // 이미 투표한 경우 서버 값을 기준으로 복구
    await fetchQuestions();
    return;
  }

  // 성공 후에도 정렬 반영을 위해 refetch 권장
  await fetchQuestions();
}

function getOrCreateVoterKey() {
  const storageKey = 'event_qna_voter_key';
  let voterKey = localStorage.getItem(storageKey);

  if (!voterKey) {
    voterKey = crypto.randomUUID();
    localStorage.setItem(storageKey, voterKey);
  }

  return voterKey;
}
```

---

## 10.3 관리자 페이지 Realtime 예시

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function AdminDashboard({ sessionId }: { sessionId: string }) {
  const [questions, setQuestions] = useState([]);

  const fetchQuestions = async () => {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('session_id', sessionId)
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: true });

    if (!error && data) {
      setQuestions(data);
    }
  };

  useEffect(() => {
    fetchQuestions();

    const channel = supabase
      .channel(`admin-session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'questions',
          filter: `session_id=eq.${sessionId}`,
        },
        async () => {
          await fetchQuestions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return (
    <div>
      {/* 관리자 질문 목록 렌더링 */}
    </div>
  );
}
```

---

## 11. 텍스트 와이어프레임

## 11.1 관리자 홈 화면

```text
[ Q&A 관리자 홈 ]
==================================================
[ + 새 프로젝트 만들기 ]

프로젝트 목록
┌────────────────────────────────────┐
│ Mendix Korea Seminar 2026          │
│ 고객사: Mendix                     │
│ 세션 3개 | 전체 질문 128개 | 진행중 │
│ [상세보기] [전체 Q&A 엑셀 다운로드] │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ Unreal Fest Seoul 2026             │
│ 고객사: Epic Games                 │
│ 세션 5개 | 전체 질문 342개 | 준비중 │
│ [상세보기] [전체 Q&A 엑셀 다운로드] │
└────────────────────────────────────┘
```

## 11.2 프로젝트 상세 화면

```text
[ 프로젝트: Mendix Korea Seminar 2026 ]
────────────────────────────────────
[ + 세션 만들기 ] [프로젝트 전체 Q&A 엑셀 다운로드]

세션 목록

┌────────────────────────────────────┐
│ Keynote Q&A                        │
│ 질문 42개 | 답변대기 12개          │
│ 사용자 URL [복사] | 관리자 URL [복사]│
│ [대시보드] [엑셀 다운로드]          │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ Panel Talk Q&A                     │
│ 질문 86개 | 답변대기 20개          │
│ 사용자 URL [복사] | 관리자 URL [복사]│
│ [대시보드] [엑셀 다운로드]          │
└────────────────────────────────────┘
```

## 11.3 사용자 모바일 웹 화면

```text
[ 세션 제목: AI 트렌드와 미래 강연 ]
==================================================
[ + 질문하기 ]
==================================================

▼ 인기 질문 목록

┌────────────────────────────────────┐
│ [익명] 2분 전              답변완료 │
│ Q. 생성형 AI의 저작권 문제는?       │
│ 실제 기업에서 도입할 때 가장 큰...  │
│                                    │
│                         ▲ 좋아요 42 │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ [홍길동] 5분 전                    │
│ Q. 다음 세션 스케줄이 궁금합니다.  │
│ 브레이크 타임 안내 부탁드립니다.   │
│                                    │
│                         ▲ 좋아요 15 │
└────────────────────────────────────┘
```

## 11.4 관리자 Q&A 대시보드

```text
[ 관리자 모드: AI 트렌드와 미래 강연 ]
────────────────────────────────────
필터:
[전체] [답변대기] [답변완료] [숨김]

[현재 세션 Q&A 엑셀 다운로드]
────────────────────────────────────

■ 실시간 질문 대시보드

[□ 답변완료] [숨김]
┌────────────────────────────────────┐
│ [익명] 좋아요 42개 | 2분 전        │
│ 제목: 생성형 AI의 저작권 문제는?   │
│ 본문: 실제 기업에서 도입할 때...   │
└────────────────────────────────────┘

[□ 답변완료] [숨김]
┌────────────────────────────────────┐
│ [홍길동] 좋아요 15개 | 5분 전      │
│ 제목: 다음 세션 스케줄이 궁금합니다│
│ 본문: 브레이크 타임 안내 부탁...   │
└────────────────────────────────────┘
```

---

## 12. MVP 개발 일정

총 3주 기준으로 진행한다.

## Week 1. 백엔드 및 DB 구축

| 일차 | 작업 |
|---:|---|
| 1일차 | Supabase 프로젝트 생성, DB 스키마 작성 |
| 2일차 | projects, sessions, questions, votes 테이블 생성 및 인덱스 설정 |
| 3일차 | 프로젝트 생성/목록 API, 세션 생성/목록 API 구현 |
| 4일차 | 질문 목록 조회 API, 질문 등록 API, like_question RPC 구현 |
| 5일차 | 관리자 답변 완료 / 숨김 처리 API 구현, 기본 RLS 정책 점검 |

---

## Week 2. 프론트엔드 UI 및 데이터 동기화

| 일차 | 작업 |
|---:|---|
| 6일차 | 관리자 홈, 프로젝트 목록, 프로젝트 생성 UI 구현 |
| 7일차 | 프로젝트 상세, 세션 생성/목록 UI 구현 |
| 8일차 | 사용자 모바일 페이지, 질문 등록 모달, 사용자 Polling 구현 |
| 9일차 | 관리자 Q&A 대시보드, Realtime 구독 및 refetch 연동 |
| 10일차 | 사용자/관리자 통합 테스트, 정렬 및 상태 변경 검증 |

---

## Week 3. 예외 처리, 테스트 및 배포

| 일차 | 작업 |
|---:|---|
| 11일차 | 금지어 필터, 글자 수 제한, 중복 클릭 방지 UI 적용 |
| 12일차 | 관리자 토큰 검증, 숨김 처리, 답변 상태 필터 안정화 |
| 13일차 | 세션별/프로젝트별 Q&A 엑셀 다운로드 기능 구현 |
| 14일차 | 동시 투표 스트레스 테스트, Vercel 배포, Supabase 환경변수 설정 |
| 15일차 | QR코드 생성, 현장 시나리오 테스트 및 최종 점검 |

---

## 13. 테스트 시나리오

### 13.1 기능 테스트

| 테스트 항목 | 기대 결과 |
|---|---|
| 프로젝트 생성 | 프로젝트 목록에 정상 표시 |
| 프로젝트 수정 | 프로젝트명, 고객사명, 상태 정상 변경 |
| 세션 생성 | 프로젝트 하위에 세션 정상 표시 |
| 사용자 URL 복사 | 올바른 세션 URL 복사 |
| 관리자 URL 복사 | 관리자 토큰 포함 URL 복사 |
| 질문 등록 | 목록에 정상 표시 |
| 제목 50자 초과 | 등록 불가 |
| 내용 500자 초과 | 등록 불가 |
| 이름 미입력 | 익명으로 표시 |
| 좋아요 클릭 | 즉시 +1 표시 후 서버 반영 |
| 같은 질문에 좋아요 재클릭 | 중복 반영되지 않음 |
| 좋아요 수 동점 | 먼저 등록된 질문이 상위 |
| 답변 완료 체크 | 사용자 화면에 답변 완료 배지 표시 |
| 숨김 처리 | 사용자 화면에서 사라짐 |
| 세션별 엑셀 다운로드 | 해당 세션의 Q&A만 다운로드 |
| 프로젝트별 엑셀 다운로드 | 프로젝트 하위 모든 세션의 Q&A 다운로드 |
| 권한 없는 다운로드 요청 | 403 또는 접근 거부 처리 |

### 13.2 환경 테스트

| 환경 | 테스트 내용 |
|---|---|
| iPhone Safari | QR 접속, 질문 등록, 좋아요 |
| Android Chrome | QR 접속, 질문 등록, 좋아요 |
| 카카오톡 인앱 브라우저 | QR 접속 및 localStorage 동작 |
| PC Chrome | 관리자 화면 Realtime 동작 |
| 행사장 Wi-Fi | 다중 접속 및 Polling 부하 |

### 13.3 부하 테스트

| 상황 | 기대 결과 |
|---|---|
| 50명 동시 좋아요 클릭 | like_count 누락 없이 증가 |
| 100명 동시 질문 목록 조회 | 사용자 화면 정상 표시 |
| 관리자 화면 Realtime 연결 | 변경 발생 시 0.5~2초 내 목록 갱신 |
| 프로젝트별 엑셀 다운로드 | 데이터 누락 없이 파일 생성 |
| 네트워크 일시 끊김 | 복구 후 목록 재조회 |

---

## 14. MVP에서 제외할 기능

아래 기능은 MVP 이후 고도화 단계에서 검토한다.

| 기능 | 제외 사유 |
|---|---|
| 싫어요 | 행사 분위기 저하 및 악용 가능성 |
| 질문 신고 | 숨김 처리로 1차 대응 가능 |
| 사용자 로그인 | 진입 장벽 증가 |
| 질문 수정 | MVP 복잡도 증가 |
| 질문 댓글 | Q&A 목적에서 벗어날 수 있음 |
| 고급 통계 대시보드 | MVP 이후 분석 기능으로 분리 |
| 프로젝트별 관리자 권한 세분화 | MVP 이후 조직/권한 관리 기능으로 확장 |

---

## 15. 개발팀 전달용 핵심 메모

이 프로젝트에서 가장 중요한 것은 다음 7가지다.

1. 이 솔루션은 1회성 Q&A가 아니라 여러 프로젝트에서 반복 사용하는 지속형 도구로 설계한다.
2. 관리자에서 프로젝트를 생성하고, 프로젝트 하위에 여러 세션을 생성할 수 있어야 한다.
3. 사용자 페이지는 WebSocket을 사용하지 않고 Polling으로 처리한다.
4. 관리자 페이지에만 Supabase Realtime을 적용한다.
5. 좋아요는 클라이언트에서 직접 count를 update하지 않는다.
6. 좋아요는 `votes` 테이블 unique 제약과 `like_question` RPC 함수로 처리한다.
7. 세션별/프로젝트별 Q&A 목록을 엑셀로 다운로드할 수 있어야 한다.

특히 좋아요 기능은 반드시 DB 레벨에서 중복 방지와 원자적 증가 처리를 해야 한다.

이 부분이 빠지면 행사 당일 동시 클릭 상황에서 좋아요 숫자가 꼬일 수 있다.

또한 프로젝트/세션 구조를 반드시 분리해야 한다.

그렇지 않으면 향후 여러 프로젝트에서 재사용할 때 데이터가 섞이고, 엑셀 다운로드나 과거 프로젝트 조회가 어려워진다.

---

## 16. 최종 MVP 구조 요약

```text
관리자 홈
- 프로젝트 생성
- 프로젝트 목록 조회
- 프로젝트 상세 진입
- 프로젝트 전체 Q&A 엑셀 다운로드

프로젝트 상세
- 세션 생성
- 세션 목록 조회
- 사용자 URL 복사
- 관리자 URL 복사
- 세션별 Q&A 대시보드 진입
- 세션별 Q&A 엑셀 다운로드

사용자 페이지
- QR 접속
- 질문 목록 조회
- 8~12초 랜덤 Polling
- 질문 등록
- 좋아요 클릭
- Optimistic UI
- WebSocket 미사용

관리자 Q&A 페이지
- 관리자 토큰 URL 또는 로그인
- 질문 목록 조회
- Supabase Realtime 구독
- 변경 감지 시 전체 refetch
- 답변 완료 처리
- 질문 숨김 처리
- 세션별 Q&A 엑셀 다운로드

DB
- projects
- sessions
- questions
- votes

핵심 안정성 장치
- projects/sessions 계층 분리
- votes unique 제약
- like_question RPC
- RLS 정책
- Polling interval 랜덤화
- 관리자 다운로드 API 권한 검증
```
