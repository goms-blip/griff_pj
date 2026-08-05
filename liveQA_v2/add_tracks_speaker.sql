-- ============================================================
-- 트랙(Track) + 강연자(speaker) 추가
-- SQL Editor 에 붙여넣고 Run. (기존 스키마 위에서 실행)
--  - 한 행사(project) 아래 여러 트랙(최대 4개 등) 운영 지원
--  - 세션은 트랙에 소속(track_id), 세션 폼의 '설명' 대신 '강연자'(speaker) 사용
-- ============================================================

-- 1) 트랙 테이블 (프로젝트 하위)
create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name varchar(100) not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);
create index if not exists idx_tracks_project on tracks(project_id, sort_order, created_at);

-- 트랙은 server.js(service_role) 경유로만 접근(랜딩 그룹핑/관리). anon 직접 정책 없음.
alter table tracks enable row level security;

-- 2) 세션: 트랙 소속 + 강연자
alter table sessions add column if not exists track_id uuid references tracks(id) on delete set null;
alter table sessions add column if not exists speaker varchar(100);
create index if not exists idx_sessions_track on sessions(track_id);

-- 확인용:
-- select id, name, sort_order from tracks order by sort_order;
-- select title, track_id, speaker from sessions;
