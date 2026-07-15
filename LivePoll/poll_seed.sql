-- ============================================================
-- Live Poll 데모 시드 — "Mendix Korea Seminar 2026"
-- livepoll_schema.sql 적용 후 SQL Editor 에서 Run.
-- 참석자 페이지(index.html)/관리자(admin.html) 데모 코드와 일치한다.
-- 재실행 가능: 같은 code 의 프로젝트를 지우고 다시 생성한다.
-- ============================================================

do $$
declare
  v_project   uuid;
  v_track_a   uuid;
  v_track_b   uuid;
  v_keynote   uuid;
  v_lowcode   uuid;
  v_aiprac    uuid;
  v_poll      uuid;
begin
  -- 기존 데모 정리 (cascade 로 하위 세션/Poll/응답 함께 삭제)
  delete from projects where code = 'mendix2026';

  -- 프로젝트
  insert into projects (code, title, client_name, description, status)
  values ('mendix2026', 'Mendix Korea Seminar 2026', 'Mendix Korea',
          '엔터프라이즈 로우코드 세미나', '진행중')
  returning id into v_project;

  -- 트랙
  insert into tracks (project_id, name, sort_order) values (v_project, 'Track A', 1) returning id into v_track_a;
  insert into tracks (project_id, name, sort_order) values (v_project, 'Track B', 2) returning id into v_track_b;

  -- 세션
  insert into sessions (project_id, code, title, speaker, is_public)
  values (v_project, 'keynote', 'Keynote: 엔터프라이즈 AI의 미래', '김민수 (CTO)', true)
  returning id into v_keynote;

  insert into sessions (project_id, code, title, speaker, track_id, is_public)
  values (v_project, 'lowcode', '로우코드로 만드는 비즈니스 앱', '이서연', v_track_a, true)
  returning id into v_lowcode;

  insert into sessions (project_id, code, title, speaker, track_id, is_public)
  values (v_project, 'aiprac', 'AI 자동화 실전', '박지훈', v_track_b, true)
  returning id into v_aiprac;

  -- Poll 1: 단일 선택 (live, 결과 공개) — code topic2026
  insert into polls (project_id, session_id, code, title, question, poll_type, status, is_public, show_results)
  values (v_project, v_keynote, 'topic2026', '오늘 가장 관심 있는 주제',
          '오늘 가장 관심 있는 주제는 무엇인가요?', 'single_choice', 'live', true, true)
  returning id into v_poll;
  insert into poll_options (poll_id, label, value, sort_order) values
    (v_poll, 'AI 자동화', 'ai', 0),
    (v_poll, '데이터 분석', 'data', 1),
    (v_poll, '보안', 'security', 2),
    (v_poll, '클라우드 전환', 'cloud', 3);

  -- Poll 2: 복수 선택 (live) — code tools-use
  insert into polls (project_id, session_id, code, title, question, poll_type, status, is_public, show_results, allow_multiple_answers)
  values (v_project, v_lowcode, 'tools-use', '사용 중인 개발 도구',
          '현재 사용 중인 개발 도구를 모두 선택해주세요 (복수 선택)', 'multiple_choice', 'live', true, false, false)
  returning id into v_poll;
  insert into poll_options (poll_id, label, value, sort_order) values
    (v_poll, 'Mendix', 'mendix', 0),
    (v_poll, 'OutSystems', 'outsystems', 1),
    (v_poll, 'Power Apps', 'powerapps', 2),
    (v_poll, '직접 코딩', 'custom', 3);

  -- Poll 3: 5점 척도 (live) — code session-rate
  insert into polls (project_id, session_id, code, title, question, poll_type, status, is_public, show_results)
  values (v_project, v_aiprac, 'session-rate', '세션 만족도',
          '이번 세션은 얼마나 유익하셨나요?', 'rating', 'live', true, true)
  returning id into v_poll;

  -- Poll 4: 주관식 (live) — code qna-free
  insert into polls (project_id, session_id, code, title, question, poll_type, status, is_public, show_results)
  values (v_project, v_keynote, 'qna-free', '강연자 질문',
          '강연자에게 묻고 싶은 질문을 남겨주세요', 'short_text', 'live', true, false)
  returning id into v_poll;

  -- Poll 5: closed 상태 데모 — code morning-poll
  insert into polls (project_id, session_id, code, title, question, poll_type, status, is_public, show_results)
  values (v_project, v_keynote, 'morning-poll', '오전 세션 만족도',
          '오전 세션은 어떠셨나요?', 'single_choice', 'closed', true, true)
  returning id into v_poll;
  insert into poll_options (poll_id, label, value, sort_order) values
    (v_poll, '매우 만족', 'great', 0),
    (v_poll, '만족', 'good', 1),
    (v_poll, '보통', 'ok', 2);

  -- Poll 6: 뉴스레터 후속 설문 — code followup-2026 (프로젝트 전체, 세션 null)
  insert into polls (project_id, session_id, code, title, question, poll_type, status, source_type, is_public, show_results)
  values (v_project, null, 'followup-2026', '행사 후 만족도 조사',
          '전체 행사 만족도는 어떠셨나요?', 'rating', 'live', 'newsletter', true, false)
  returning id into v_poll;

  raise notice 'Live Poll 데모 시드 완료: project=%', v_project;
end $$;

-- 확인용:
-- select code, title, poll_type, status, source_type from polls order by created_at;
