# griff_pj

Griff 프로젝트 모노레포. 프로젝트마다 최상위 폴더 하나를 씁니다.

> ⚠️ **이 저장소는 공개(public)입니다.** API 키·DB 비밀번호·토큰을 커밋하지 마세요.
> 자격증명은 `.env.local`(git 무시됨) 또는 배포 플랫폼 환경변수로만 주입합니다.

## 프로젝트

| 폴더 | 설명 | 스택 | 배포 |
|---|---|---|---|
| [`LivePoll/`](./LivePoll) | 실시간 행사 Live Poll·설문 솔루션. 참석자는 QR/세션 페이지로 참여하고, 행사 후 이메일 설문으로 추가 응답을 수집합니다. | Node.js · Express · Supabase | [livepoll-app.vercel.app](https://livepoll-app.vercel.app) |

## 구조

```
griff_pj/
├── .claude/agents/     # 프로젝트 공용 Claude Code 에이전트
├── .gitignore          # 공용 (시크릿 차단 규칙 포함)
└── LivePoll/           # 프로젝트별 폴더 — 자체 package.json·vercel.json 보유
```

새 프로젝트는 최상위에 폴더를 만들어 추가하고, 위 표에 한 줄 넣어주세요.

## 개발

각 프로젝트 폴더에서 독립적으로 실행합니다.

```bash
cd LivePoll
npm install
cp .env.example .env.local   # 값 채우기 (아래 참조)
npm start                    # http://localhost:8787
```

### LivePoll 환경변수

`.env.local` 에 설정합니다. 커밋 대상이 아닙니다.

| 변수 | 용도 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | 공개 클라이언트용 anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용. **절대 프론트엔드에 노출 금지** |
| `ADMIN_CONSOLE_TOKEN` | `/admin` 콘솔 및 `/api/admin/*` 보호 토큰 |
| `PORT` | 로컬 포트 (기본 8787) |

### 배포 참고

`LivePoll/` 은 저장소 하위 폴더이므로, Vercel 프로젝트 설정에서
**Root Directory 를 `LivePoll` 로 지정**해야 빌드가 됩니다.
