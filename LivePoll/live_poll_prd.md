# 실시간 행사 Live Poll 솔루션 PRD 및 개발 가이드

## 1. 개요

### 1.1 제품명

실시간 행사 Live Poll 솔루션

### 1.2 목적

기존 실시간 행사 Q&A 솔루션을 확장하여, 행사 중에는 참석자가 QR코드 또는 세션 페이지를 통해 실시간 Poll에 참여하고, 행사 종료 후에는 뉴스레터 또는 후속 이메일을 통해 참석자에게 Poll/Survey를 발송하여 추가 응답을 수집한다.

관리자는 프로젝트별, 세션별, Poll별 응답 결과를 실시간으로 확인하고, 행사 종료 후 결과를 분석하여 엑셀 다운로드 및 요약 리포트로 활용할 수 있어야 한다.

본 기능은 1회성 투표 도구가 아니라, 기존 Q&A 시스템과 동일하게 여러 프로젝트와 행사에서 반복적으로 사용할 수 있는 지속형 내부 운영 도구로 설계한다.

### 1.3 기존 Q&A 시스템과의 관계

Live Poll 기능은 기존 Q&A 솔루션의 프로젝트/세션 구조를 그대로 사용한다.

```text
Project
├── Tracks
├── Sessions
│   ├── Q&A
│   └── Live Polls
└── Post-event Surveys
```

기존 Q&A 시스템에서 이미 구현 또는 설계된 다음 요소를 재사용한다.

| 재사용 요소 | 설명 |
|---|---|
| 프로젝트 관리 | 프로젝트 생성, 수정, 삭제, 상태 관리 |
| 세션 관리 | 프로젝트 하위 세션 생성, 트랙 배정, 강연자 정보 |
| 짧은 URL | 사용자용 짧은 코드 URL |
| QR 진입 | 행사 단일 QR 또는 세션별 QR |
| 관리자 인증 | 콘솔 토큰 / 세션 관리자 토큰 |
| Supabase 기반 DB | PostgreSQL, RPC, RLS 정책 |
| 관리자 Realtime | 관리자 화면 실시간 갱신 |
| 사용자 Polling | 대규모 참가자 대응을 위한 Polling 방식 |
| 엑셀 다운로드 | 프로젝트/세션별 데이터 다운로드 구조 |

---

## 2. 주요 사용자

| 구분 | 설명 |
|---|---|
| 최고 관리자 / 운영자 | 프로젝트 생성, 세션 생성, Poll 생성, 후속 설문 링크 생성, 분석 결과 다운로드 |
| 현장 관리자 / 연사 | 행사 중 Live Poll 결과 확인, 투표 시작/종료, 결과 공개 여부 제어 |
| 행사 참가자 | 행사 중 QR 또는 세션 페이지에서 Poll 참여 |
| 행사 후 참석자 | 뉴스레터 또는 이메일 링크를 통해 후속 Poll/Survey 참여 |

---

## 3. 핵심 사용자 여정

### 3.1 행사 전 운영자 여정

1. 관리자 홈 접속
2. 프로젝트 생성 또는 기존 프로젝트 선택
3. 프로젝트 하위에 트랙/세션 생성
4. 세션별 Live Poll 생성
5. Poll 유형 선택
6. 질문과 선택지 작성
7. 공개 방식 설정
8. 행사 QR 또는 세션 URL 확인
9. 필요 시 Poll 미리보기

### 3.2 행사 중 참석자 여정

1. 행사장 QR코드 스캔
2. 프로젝트 랜딩 페이지 또는 세션 페이지 접속
3. 현재 진행 중인 Poll 확인
4. 선택지 클릭 또는 주관식 응답 입력
5. 제출 완료 화면 확인
6. Poll이 공개 설정된 경우 실시간 결과 확인

### 3.3 행사 중 관리자 / 연사 여정

1. 관리자 대시보드 접속
2. 현재 세션의 Poll 목록 확인
3. Poll 시작
4. 참석자 응답 현황 실시간 확인
5. 필요 시 결과를 화면에 공개
6. Poll 종료
7. 다음 Poll로 이동

### 3.4 행사 후 뉴스레터 Poll 여정

1. 운영자가 행사 종료 후 후속 Poll/Survey 생성
2. 참석자 이메일 목록 업로드 또는 외부 뉴스레터 툴에서 링크 삽입
3. 참석자가 뉴스레터의 Poll 링크 클릭
4. 행사 후 만족도, 관심도, 후속 문의 여부 등을 응답
5. 운영자가 응답 결과와 분석 리포트 확인
6. 엑셀 다운로드 또는 요약 리포트 생성

---

## 4. Poll 유형

### 4.1 MVP Poll 유형

| 유형 | 설명 | 예시 |
|---|---|---|
| 단일 선택 | 하나의 선택지만 선택 가능 | 가장 관심 있는 세션은? |
| 복수 선택 | 여러 선택지 선택 가능 | 관심 있는 제품/주제는? |
| 5점 척도 | 1~5점 평가 | 세션 만족도는? |
| 주관식 단문 | 짧은 텍스트 응답 | 추가로 듣고 싶은 주제는? |

### 4.2 이후 확장 가능 유형

| 유형 | 설명 |
|---|---|
| NPS | 추천 의향 점수 |
| 순위형 투표 | 선택지를 순서대로 배열 |
| 퀴즈형 Poll | 정답/오답 표시 |
| 이미지 선택형 | 이미지 기반 선택지 |
| 조건 분기형 설문 | 답변에 따라 다음 질문 변경 |

MVP에서는 조건 분기형 설문은 제외한다.

---

## 5. 기능 요구사항

## 5.1 프로젝트 / 세션 연동

Live Poll은 기존 Q&A 시스템의 프로젝트와 세션 구조를 그대로 따른다.

| 항목 | 설명 |
|---|---|
| 프로젝트 | 행사 또는 고객 프로젝트 단위 |
| 트랙 | 멀티 트랙 행사 구분 |
| 세션 | Poll이 연결되는 강연 또는 프로그램 |
| Poll | 세션 하위에 생성되는 투표 또는 설문 |
| 응답 | 참석자가 제출한 Poll 답변 |

Poll은 반드시 프로젝트에 속해야 하며, 가능하면 특정 세션에 연결한다.

단, 행사 후 뉴스레터 Poll은 특정 세션이 아닌 프로젝트 전체에 연결될 수 있다.

---

## 5.2 Poll 생성 기능

관리자는 프로젝트 상세 또는 세션 상세 화면에서 Poll을 생성할 수 있다.

### 5.2.1 입력 필드

| 입력 필드 | 필수 여부 | 설명 |
|---|---:|---|
| Poll 제목 | 필수 | 관리자 식별용 제목 |
| 질문 문구 | 필수 | 참석자에게 표시되는 질문 |
| Poll 유형 | 필수 | 단일 선택 / 복수 선택 / 5점 척도 / 주관식 |
| 연결 대상 | 필수 | 프로젝트 전체 또는 특정 세션 |
| 선택지 | 조건부 필수 | 객관식 유형일 때 필수 |
| 공개 여부 | 선택 | 사용자 페이지 노출 여부 |
| 결과 공개 여부 | 선택 | 참석자에게 결과 표시 여부 |
| 시작 상태 | 선택 | draft / live / closed |
| 응답 기간 | 선택 | 행사 후 Poll에 사용 |
| 내부 메모 | 선택 | 운영자 참고용 |

### 5.2.2 Poll 상태

| 상태 | 설명 |
|---|---|
| draft | 작성 중, 사용자에게 보이지 않음 |
| scheduled | 예약됨 |
| live | 현재 응답 가능 |
| closed | 응답 종료 |
| archived | 보관됨 |

### 5.2.3 Poll 시작 / 종료

관리자는 Poll을 수동으로 시작하거나 종료할 수 있다.

행사 중 Poll은 관리자가 직접 `시작` 버튼을 눌러 live 상태로 전환한다.

행사 후 Poll은 응답 기간을 설정하여 자동 종료할 수 있다.

---

## 5.3 행사 중 Live Poll 사용자 기능

### 5.3.1 사용자 진입

| 진입 방식 | 설명 |
|---|---|
| 행사 단일 QR | 프로젝트 랜딩 페이지에서 현재 세션 또는 Poll 선택 |
| 세션별 QR | 해당 세션 페이지로 직접 진입 |
| 짧은 URL | `/e/:projectCode`, `/s/:sessionCode` 방식 |
| 뉴스레터 링크 | 행사 후 Poll 전용 링크 |

### 5.3.2 Poll 표시

| 표시 항목 | 설명 |
|---|---|
| 세션명 | 연결된 세션명 |
| Poll 질문 | 투표 질문 |
| 선택지 | 유형별 선택지 |
| 제출 버튼 | 응답 제출 |
| 응답 완료 상태 | 이미 응답한 Poll 표시 |
| 결과 | 관리자가 공개한 경우에만 표시 |

### 5.3.3 중복 응답 방지

비회원 기반이므로 다음 방식으로 중복 응답을 방지한다.

| 방식 | 설명 |
|---|---|
| localStorage respondent_key | 브라우저별 UUID 저장 |
| poll_responses unique 제약 | `poll_id + respondent_key` 중복 방지 |
| 이메일 링크 토큰 | 뉴스레터 Poll의 경우 recipient_token으로 중복 방지 |

행사 중 Live Poll은 localStorage 기반으로 1차 방지한다.

행사 후 뉴스레터 Poll은 이메일별 고유 토큰을 사용하는 것이 더 적합하다.

---

## 5.4 관리자 Live Poll 대시보드

관리자 대시보드는 세션별 Poll 목록과 응답 현황을 보여준다.

### 5.4.1 표시 항목

| 항목 | 설명 |
|---|---|
| Poll 제목 | 관리자용 제목 |
| 질문 문구 | 참석자에게 표시되는 질문 |
| Poll 유형 | 단일 선택 / 복수 선택 / 척도 / 주관식 |
| 상태 | draft / live / closed |
| 총 응답 수 | 현재까지 응답 수 |
| 선택지별 응답 수 | 객관식 결과 |
| 선택지별 비율 | 백분율 |
| 평균 점수 | 척도형 Poll일 때 표시 |
| 주관식 응답 목록 | 단문 응답 리스트 |
| 결과 공개 여부 | 참석자에게 결과를 보여줄지 여부 |

### 5.4.2 관리자 제어 기능

| 기능 | 설명 |
|---|---|
| Poll 시작 | 상태를 live로 변경 |
| Poll 종료 | 상태를 closed로 변경 |
| 결과 공개 | 참석자 화면에 결과 표시 |
| 결과 비공개 | 참석자 화면에서 결과 숨김 |
| Poll 수정 | draft 상태에서 수정 가능 |
| Poll 복제 | 비슷한 Poll을 빠르게 생성 |
| Poll 삭제 | 응답이 없을 때만 삭제 권장 |
| 응답 다운로드 | Poll 응답 엑셀 다운로드 |

---

## 5.5 행사 후 뉴스레터 Poll 기능

행사 종료 후 참석자에게 뉴스레터 또는 후속 이메일을 보내 Poll/Survey 응답을 받을 수 있어야 한다.

### 5.5.1 활용 목적

| 목적 | 설명 |
|---|---|
| 행사 만족도 조사 | 전체 행사 만족도, 세션 만족도 확인 |
| 관심 주제 수집 | 후속 콘텐츠나 세일즈 주제 파악 |
| 리드 분류 | 제품 관심도, 상담 희망 여부 확인 |
| 후속 세미나 기획 | 참석자가 원하는 주제 파악 |
| 고객 보고 | 행사 결과 리포트에 활용 |

### 5.5.2 발송 방식

MVP에서는 직접 이메일 발송 기능을 필수로 구현하지 않는다.

대신 Poll 링크를 생성하여 기존 뉴스레터 툴에 삽입하는 방식을 우선 지원한다.

| 방식 | MVP 포함 여부 | 설명 |
|---|---:|---|
| Poll 공유 링크 생성 | 포함 | 뉴스레터 본문에 삽입 |
| 참석자별 토큰 링크 생성 | 포함 권장 | 이메일별 중복 응답 방지 |
| 시스템 직접 이메일 발송 | 제외 | Mailchimp, 스티비, HubSpot 등 외부 툴 사용 권장 |
| 응답자 이메일 매핑 | 선택 | 참석자 CSV 업로드 시 가능 |

### 5.5.3 뉴스레터용 Poll 링크

뉴스레터용 Poll은 다음 링크 형태를 가진다.

```text
/poll/:pollCode
/poll/:pollCode?token=:recipientToken
```

토큰이 있는 경우:

- 응답자 식별 가능
- 중복 응답 방지 가능
- 응답률 추적 가능

토큰이 없는 경우:

- 익명 응답으로 처리
- localStorage 기반 중복 방지

### 5.5.4 참석자 목록 업로드

운영자는 참석자 이메일 CSV를 업로드할 수 있다.

MVP에서 필수는 아니지만, 행사 후 Poll 분석 정확도를 높이기 위해 포함을 권장한다.

CSV 예시:

```csv
email,name,company,title
hong@example.com,홍길동,ABC Corp,Manager
kim@example.com,김지현,XYZ Inc,Director
```

업로드 후 시스템은 각 참석자에게 고유 recipient_token을 발급한다.

직접 발송은 하지 않더라도, 다운로드 가능한 링크 목록을 제공한다.

---

## 5.6 결과 분석 기능

### 5.6.1 실시간 분석

행사 중 관리자 화면에서는 Poll 결과를 실시간 또는 준실시간으로 확인한다.

| 분석 항목 | 설명 |
|---|---|
| 총 응답 수 | 현재까지 제출된 응답 수 |
| 응답률 | 참석자 수 입력 시 계산 가능 |
| 선택지별 응답 수 | 객관식 결과 |
| 선택지별 비율 | 객관식 비율 |
| 평균 점수 | 5점 척도형 결과 |
| 주관식 응답 | 최신순 또는 키워드별 표시 |

사용자 화면은 대규모 접속을 고려해 WebSocket을 사용하지 않고 Polling으로 갱신한다.

관리자 화면은 Realtime 또는 짧은 Polling으로 결과를 갱신한다.

### 5.6.2 행사 후 분석

행사 후 Poll/Survey에 대해 다음 분석을 제공한다.

| 분석 항목 | 설명 |
|---|---|
| 전체 응답 수 | Poll별 총 응답 수 |
| 응답률 | 발송 대상 대비 응답 비율 |
| 문항별 결과 | 선택지별 응답 수/비율 |
| 만족도 평균 | 척도 문항 평균 |
| 관심 주제 순위 | 선택지 기반 관심도 순위 |
| 상담 희망자 수 | 후속 문의 여부 |
| 회사별 응답 분포 | 참석자 CSV가 있는 경우 |
| 주관식 키워드 요약 | 키워드 빈도 또는 수동 분류 |

### 5.6.3 분석 리포트 화면

관리자 화면에서 프로젝트별 Poll 분석 리포트를 확인할 수 있다.

```text
[프로젝트 Poll 분석 리포트]

전체 Poll 수: 8개
전체 응답 수: 342건
행사 중 응답: 210건
행사 후 뉴스레터 응답: 132건

만족도 평균: 4.3 / 5
가장 관심 높은 주제: AI 자동화
상담 희망 응답자: 28명
```

---

## 5.7 다운로드 기능

관리자는 Poll 결과를 엑셀로 다운로드할 수 있다.

### 5.7.1 다운로드 범위

| 다운로드 범위 | 설명 |
|---|---|
| Poll별 다운로드 | 특정 Poll의 응답만 다운로드 |
| 세션별 다운로드 | 특정 세션에 연결된 모든 Poll 응답 다운로드 |
| 프로젝트 전체 다운로드 | 프로젝트 전체 Poll 응답 다운로드 |
| 뉴스레터 Poll 다운로드 | 행사 후 Poll 응답만 다운로드 |

### 5.7.2 Poll 응답 엑셀 컬럼

| 컬럼명 | 설명 |
|---|---|
| project_title | 프로젝트명 |
| session_title | 세션명 |
| poll_title | Poll 제목 |
| poll_question | Poll 질문 |
| poll_type | Poll 유형 |
| response_id | 응답 ID |
| respondent_key | 익명 응답자 키 |
| recipient_email | 뉴스레터 토큰이 있는 경우 |
| respondent_name | 참석자 목록이 있는 경우 |
| respondent_company | 참석자 목록이 있는 경우 |
| answer_value | 선택지 또는 주관식 답변 |
| answer_label | 선택지 라벨 |
| submitted_at | 응답 제출 시간 |
| source | live_event / newsletter |
| exported_at | 다운로드 생성 시간 |

### 5.7.3 분석 요약 엑셀 컬럼

| 컬럼명 | 설명 |
|---|---|
| project_title | 프로젝트명 |
| session_title | 세션명 |
| poll_title | Poll 제목 |
| poll_question | Poll 질문 |
| poll_type | Poll 유형 |
| total_responses | 총 응답 수 |
| option_label | 선택지 |
| option_count | 선택지 응답 수 |
| option_percent | 선택지 응답 비율 |
| average_score | 척도형 평균 |
| source | live_event / newsletter / all |

---

## 6. 비기능 요구사항

### 6.1 실시간성

| 화면 | 요구사항 |
|---|---|
| 사용자 Poll 화면 | 8~12초 랜덤 Polling 또는 제출 후 refetch |
| 관리자 Poll 대시보드 | Supabase Realtime 또는 2~3초 Polling |
| 결과 공개 화면 | 3~5초 이내 갱신 |
| 행사 후 Poll | 실시간성보다 안정성 우선 |

### 6.2 트래픽 대응

- 사용자 페이지는 WebSocket을 사용하지 않는다.
- 행사 중 응답 제출은 HTTP POST 또는 RPC로 처리한다.
- 중복 응답은 DB unique 제약으로 방지한다.
- 관리자 화면만 Realtime을 사용한다.
- Poll 결과 집계는 매번 전체 응답을 계산하지 않고 집계 테이블 또는 view를 활용할 수 있다.

### 6.3 보안

- 관리자 기능은 콘솔 토큰 또는 관리자 로그인으로 보호한다.
- 응답 데이터 다운로드는 관리자만 가능하다.
- 뉴스레터 Poll의 recipient_token은 예측 불가능한 랜덤 값이어야 한다.
- 참석자 이메일은 일반 사용자 화면에 노출하지 않는다.
- 주관식 응답에는 금지어 필터 또는 관리자 숨김 기능을 적용할 수 있다.

### 6.4 개인정보

행사 후 뉴스레터 Poll에서 이메일과 회사명을 수집할 경우 개인정보에 해당할 수 있다.

| 항목 | 요구사항 |
|---|---|
| 개인정보 수집 고지 | 뉴스레터 또는 Poll 페이지에 목적 고지 |
| 응답자 식별 여부 | 익명/식별 응답 구분 |
| 데이터 보관 기간 | 프로젝트별 보관 정책 |
| 삭제 요청 대응 | 특정 이메일 응답 삭제 가능성 고려 |
| 다운로드 권한 | 관리자만 가능 |

MVP에서는 최소한 Poll 페이지 하단에 수집 목적을 표시하는 것을 권장한다.

---

## 7. 데이터베이스 설계

기존 Q&A 시스템의 다음 테이블을 유지한다.

- projects
- tracks
- sessions
- questions
- votes

Live Poll 기능을 위해 다음 테이블을 추가한다.

## 7.1 polls

Poll 기본 정보를 저장한다.

```sql
create table polls (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  code text unique not null,
  title varchar(255) not null,
  question text not null,
  poll_type varchar(30) not null,
  status varchar(20) not null default 'draft',
  source_type varchar(30) not null default 'live_event',
  is_public boolean not null default false,
  show_results boolean not null default false,
  allow_multiple_answers boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz default now()
);
```

| 컬럼명 | 타입 | 설명 |
|---|---|---|
| id | uuid | Poll 고유 ID |
| project_id | uuid | 소속 프로젝트 |
| session_id | uuid | 연결 세션, 행사 후 Poll은 null 가능 |
| code | text | 짧은 Poll URL용 코드 |
| title | varchar(255) | 관리자용 Poll 제목 |
| question | text | 사용자에게 표시되는 질문 |
| poll_type | varchar(30) | single_choice / multiple_choice / rating / short_text |
| status | varchar(20) | draft / scheduled / live / closed / archived |
| source_type | varchar(30) | live_event / newsletter |
| is_public | boolean | 사용자 페이지 노출 여부 |
| show_results | boolean | 사용자에게 결과 표시 여부 |
| allow_multiple_answers | boolean | 동일 응답자 반복 제출 허용 여부 |
| starts_at | timestamptz | 응답 시작 시간 |
| ends_at | timestamptz | 응답 종료 시간 |
| created_at | timestamptz | 생성일 |

---

## 7.2 poll_options

객관식 Poll의 선택지를 저장한다.

```sql
create table poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null,
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
```

## 7.3 poll_recipients

행사 후 뉴스레터 Poll 대상자를 저장한다.

```sql
create table poll_recipients (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  name varchar(100),
  company varchar(255),
  title varchar(255),
  token text unique not null,
  created_at timestamptz default now()
);
```

## 7.4 poll_responses

Poll 응답을 저장한다.

```sql
create table poll_responses (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  respondent_key text,
  recipient_id uuid references poll_recipients(id) on delete set null,
  source varchar(30) not null default 'live_event',
  submitted_at timestamptz default now()
);
```

권장 unique 제약:

```sql
create unique index uniq_poll_response_by_respondent
on poll_responses (poll_id, respondent_key)
where respondent_key is not null;

create unique index uniq_poll_response_by_recipient
on poll_responses (poll_id, recipient_id)
where recipient_id is not null;
```

## 7.5 poll_response_answers

복수 선택과 주관식 응답을 모두 처리하기 위한 답변 상세 테이블이다.

```sql
create table poll_response_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references poll_responses(id) on delete cascade,
  option_id uuid references poll_options(id) on delete set null,
  answer_text text,
  answer_number numeric,
  created_at timestamptz default now()
);
```

## 7.6 인덱스

```sql
create index idx_polls_project
on polls (project_id, created_at desc);

create index idx_polls_session
on polls (session_id, created_at desc);

create index idx_polls_status
on polls (status, is_public);

create index idx_poll_options_poll
on poll_options (poll_id, sort_order asc);

create index idx_poll_responses_poll
on poll_responses (poll_id, submitted_at desc);

create index idx_poll_answers_response
on poll_response_answers (response_id);

create index idx_poll_recipients_project
on poll_recipients (project_id, email);
```

---

## 8. RPC / API 설계

## 8.1 Poll 응답 제출 API

Poll 응답은 클라이언트에서 여러 테이블을 직접 insert하지 않고, 서버 API 또는 RPC로 처리한다.

목표:

- 중복 응답 방지
- Poll 상태 확인
- 응답 기간 확인
- 선택지 유효성 검증
- 응답과 답변 상세를 하나의 트랜잭션으로 저장

예시 API:

```text
POST /api/public/polls/:pollCode/responses
```

요청 예시:

```json
{
  "respondent_key": "browser-uuid",
  "recipient_token": "optional-newsletter-token",
  "answers": [
    {
      "option_id": "uuid",
      "answer_text": null,
      "answer_number": null
    }
  ]
}
```

응답 예시:

```json
{
  "success": true,
  "response_id": "uuid",
  "already_submitted": false
}
```

## 8.2 Poll 결과 조회 API

```text
GET /api/public/polls/:pollCode/results
GET /api/admin/polls/:pollId/results
```

사용자용 결과 API는 `show_results = true`인 경우에만 결과를 반환한다.

관리자용 결과 API는 관리자 권한이 있을 때만 전체 결과를 반환한다.

## 8.3 Poll 관리 API

```text
POST /api/admin/projects/:projectId/polls
GET /api/admin/projects/:projectId/polls
GET /api/admin/sessions/:sessionId/polls
PATCH /api/admin/polls/:pollId
DELETE /api/admin/polls/:pollId
POST /api/admin/polls/:pollId/start
POST /api/admin/polls/:pollId/close
POST /api/admin/polls/:pollId/duplicate
```

## 8.4 뉴스레터 대상자 API

```text
POST /api/admin/projects/:projectId/recipients/import
GET /api/admin/projects/:projectId/recipients
GET /api/admin/projects/:projectId/recipients/export-links
```

`export-links`는 외부 뉴스레터 툴에 넣을 수 있는 개인별 Poll 링크 목록을 생성한다.

## 8.5 엑셀 다운로드 API

```text
GET /api/admin/polls/:pollId/export
GET /api/admin/sessions/:sessionId/polls/export
GET /api/admin/projects/:projectId/polls/export
GET /api/admin/projects/:projectId/polls/summary-export
```

---

## 9. 결과 집계 방식

## 9.1 MVP 집계 방식

MVP에서는 응답 수가 크지 않다는 전제하에 조회 시점에 집계한다.

객관식 결과:

```sql
select
  po.id as option_id,
  po.label,
  count(pra.id) as response_count
from poll_options po
left join poll_response_answers pra on pra.option_id = po.id
left join poll_responses pr on pra.response_id = pr.id
where po.poll_id = :poll_id
group by po.id, po.label, po.sort_order
order by po.sort_order asc;
```

척도형 결과:

```sql
select
  count(*) as response_count,
  avg(pra.answer_number) as average_score
from poll_response_answers pra
join poll_responses pr on pra.response_id = pr.id
where pr.poll_id = :poll_id;
```

## 9.2 고도화 집계 방식

응답 규모가 커지면 별도 집계 테이블을 둔다.

```text
poll_result_snapshots
- poll_id
- total_responses
- option_counts jsonb
- average_score
- updated_at
```

관리자 대시보드는 이 snapshot을 읽고, 응답 제출 시 snapshot을 갱신한다.

MVP에서는 필수는 아니다.

---

## 10. 프론트엔드 화면 설계

## 10.1 관리자 홈

기존 Q&A 관리자 홈에 Poll 메뉴를 추가한다.

```text
[ Q&A / Poll 관리자 홈 ]

프로젝트 목록
┌────────────────────────────────────┐
│ Mendix Korea Seminar 2026          │
│ 세션 3개 | Q&A 128개 | Poll 8개    │
│ [상세보기] [Q&A 다운로드] [Poll 분석] │
└────────────────────────────────────┘
```

## 10.2 프로젝트 상세

```text
[ 프로젝트: Mendix Korea Seminar 2026 ]

탭:
[세션] [Q&A] [Poll] [뉴스레터 Poll] [분석]

[ + 세션 만들기 ] [ + Poll 만들기 ] [ + 뉴스레터 Poll 만들기 ]
```

## 10.3 세션 상세 / 관리자 Poll 화면

```text
[ 세션: Keynote ]

탭:
[Q&A] [Live Poll]

Live Poll 목록
┌────────────────────────────────────┐
│ Poll: 오늘 가장 관심 있는 주제는?   │
│ 상태: live | 응답 142명             │
│ [결과보기] [결과공개] [종료]        │
└────────────────────────────────────┘
```

## 10.4 사용자 Poll 화면

```text
[ 세션: Keynote ]

오늘 가장 관심 있는 주제는 무엇인가요?

( ) AI 자동화
( ) 데이터 분석
( ) 보안
( ) 클라우드 전환

[제출하기]
```

## 10.5 사용자 결과 화면

관리자가 결과 공개를 켠 경우에만 표시한다.

```text
투표 결과

AI 자동화        48% ██████████
데이터 분석      25% █████
보안             17% ███
클라우드 전환    10% ██
```

## 10.6 뉴스레터 Poll 화면

```text
[행사 후 설문]

Mendix Korea Seminar 2026에 참석해 주셔서 감사합니다.

1. 전체 행사 만족도는 어떠셨나요?
[1] [2] [3] [4] [5]

2. 가장 관심 있는 후속 주제는 무엇인가요?
[ ] AI 자동화
[ ] 제조 DX
[ ] Low-code 개발
[ ] 고객 사례

3. 후속 상담을 원하시나요?
( ) 예
( ) 아니오

[제출하기]
```

---

## 11. 개발 일정

기존 Q&A 시스템이 구축되어 있다는 전제하에 Live Poll 기능은 3주 MVP로 개발한다.

## Week 1. DB 및 백엔드 기반

| 일차 | 작업 |
|---:|---|
| 1일차 | polls, poll_options, poll_responses, poll_response_answers, poll_recipients 스키마 생성 |
| 2일차 | Poll 생성/수정/삭제 API 구현 |
| 3일차 | Poll 응답 제출 API/RPC 구현, 중복 응답 방지 |
| 4일차 | Poll 결과 집계 API 구현 |
| 5일차 | 관리자 권한, RLS, 토큰 검증 적용 |

## Week 2. 프론트엔드 및 Live Poll

| 일차 | 작업 |
|---:|---|
| 6일차 | 관리자 Poll 생성 UI 구현 |
| 7일차 | 세션별 Live Poll 목록/상태 제어 UI 구현 |
| 8일차 | 사용자 Poll 참여 화면 구현 |
| 9일차 | 관리자 결과 화면 및 결과 공개 기능 구현 |
| 10일차 | 실시간/준실시간 갱신, 모바일/PC 반응형 테스트 |

## Week 3. 뉴스레터 Poll 및 분석

| 일차 | 작업 |
|---:|---|
| 11일차 | 뉴스레터 Poll 생성 및 공개 링크 구현 |
| 12일차 | 참석자 CSV 업로드 및 recipient_token 생성 |
| 13일차 | 응답 결과 분석 화면 구현 |
| 14일차 | Poll 응답/분석 엑셀 다운로드 구현 |
| 15일차 | 통합 테스트, 배포, 현장 시나리오 점검 |

---

## 12. 테스트 시나리오

## 12.1 기능 테스트

| 테스트 항목 | 기대 결과 |
|---|---|
| Poll 생성 | 프로젝트 또는 세션 하위에 정상 생성 |
| 단일 선택 응답 | 하나의 선택지만 저장 |
| 복수 선택 응답 | 여러 선택지가 저장 |
| 5점 척도 응답 | 숫자 값이 저장되고 평균 계산 |
| 주관식 응답 | 텍스트 응답 저장 |
| 중복 응답 | 동일 Poll에 중복 제출 불가 |
| Poll 시작 | 사용자 화면에 표시 |
| Poll 종료 | 사용자 응답 불가 |
| 결과 공개 | 사용자 결과 화면 표시 |
| 결과 비공개 | 사용자 결과 화면 숨김 |
| 뉴스레터 링크 응답 | recipient_token 기준 응답 저장 |
| Poll별 다운로드 | 해당 Poll 응답만 다운로드 |
| 프로젝트 전체 다운로드 | 프로젝트 전체 Poll 응답 다운로드 |

## 12.2 환경 테스트

| 환경 | 테스트 내용 |
|---|---|
| iPhone Safari | Poll 참여, 제출, 결과 확인 |
| Android Chrome | Poll 참여, 제출, 결과 확인 |
| 카카오톡 인앱 브라우저 | Poll 링크 접속, localStorage 동작 |
| PC Chrome | 관리자 Poll 생성/결과 확인 |
| 뉴스레터 링크 | 이메일 앱/브라우저에서 응답 가능 여부 |

## 12.3 부하 테스트

| 상황 | 기대 결과 |
|---|---|
| 100명 동시 Poll 제출 | 응답 누락 없이 저장 |
| 300명 사용자 결과 Polling | 서버 부하 허용 범위 |
| 관리자 결과 화면 | 2~5초 내 결과 반영 |
| 중복 제출 시도 | DB unique 제약으로 차단 |
| 엑셀 다운로드 | 데이터 누락 없이 생성 |

---

## 13. MVP 제외 기능

| 기능 | 제외 사유 |
|---|---|
| 시스템 직접 이메일 발송 | 외부 뉴스레터 툴 활용이 현실적 |
| 조건 분기형 설문 | 구현 복잡도 높음 |
| 이미지 선택형 Poll | MVP 이후 확장 |
| 퀴즈 채점/랭킹 | 일반 Poll 기능과 분리 권장 |
| 고급 AI 주관식 분석 | 초기에는 키워드/수동 분류로 충분 |
| 사용자 로그인 | 행사 참여 장벽 증가 |
| 실시간 사용자 WebSocket | Supabase 무료 연결 제한 고려 |

---

## 14. 개발팀 전달용 핵심 메모

1. Live Poll은 기존 Q&A 시스템의 projects / sessions / tracks 구조를 재사용한다.
2. 행사 중 사용자 Poll 화면은 WebSocket을 사용하지 않고 Polling 또는 제출 후 refetch로 처리한다.
3. 관리자 Poll 결과 화면만 Realtime 또는 짧은 Polling을 사용한다.
4. Poll 응답은 반드시 서버 API 또는 RPC로 원자적으로 저장한다.
5. 중복 응답은 `poll_id + respondent_key` 또는 `poll_id + recipient_id` unique 제약으로 막는다.
6. 뉴스레터 Poll은 직접 이메일 발송보다 공유 링크/개인별 토큰 링크 생성을 우선 구현한다.
7. 행사 후 분석을 위해 live_event 응답과 newsletter 응답을 구분해서 저장한다.
8. 엑셀 다운로드는 Poll별, 세션별, 프로젝트별로 제공한다.
9. 개인정보가 포함될 수 있으므로 recipient 이메일과 회사명은 관리자 화면과 다운로드에만 노출한다.
10. MVP에서는 집계 결과를 실시간으로 계산해도 되지만, 응답 규모가 커지면 snapshot 테이블을 검토한다.

---

## 15. 최종 MVP 구조 요약

```text
관리자
- 프로젝트 선택
- 세션 선택
- Poll 생성
- Poll 시작/종료
- 결과 공개/비공개
- 실시간 결과 확인
- 뉴스레터 Poll 생성
- 참석자 CSV 업로드
- 개인별 Poll 링크 생성
- Poll 결과 분석
- 엑셀 다운로드

사용자
- QR 또는 URL 접속
- 현재 Poll 확인
- Poll 응답 제출
- 응답 완료 확인
- 공개된 결과 확인

행사 후 참석자
- 뉴스레터 링크 클릭
- Poll/Survey 응답
- 제출 완료 확인

DB
- projects
- tracks
- sessions
- polls
- poll_options
- poll_responses
- poll_response_answers
- poll_recipients

핵심 안정성 장치
- 사용자 WebSocket 미사용
- 관리자 중심 Realtime
- poll_id + respondent_key unique
- poll_id + recipient_id unique
- recipient_token 기반 뉴스레터 응답 추적
- 관리자 다운로드 API 권한 검증
```
