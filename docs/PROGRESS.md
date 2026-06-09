# K-Map Router — 진행 상황 (세션 핸드오프)

> 새 세션이 이 파일 + `CLAUDE.md` + `docs/PRD.md`만 읽고 이어서 작업할 수 있도록 유지.
> **마지막 갱신: 2026-06-10.** 빌드 방식: 플랜 → 사용자 승인 → Phase별 빌드 → 각 Phase 끝 보고.

## 현재 상태 한 줄
**Phase 1·2 완료·검증됨(배포 + 실측 게이트 통과). 다음은 Phase 3(프론트엔드).**

---

## 확정된 설계 결정 (재논의 불필요)
1. **결정 1 — 추출 우선순위:** `resolve-test.mjs`를 CLAUDE.md §5 **6전략으로 보강한 뒤** Worker에 이식.
   - 보강 핵심: §5 #2 `!1d!2d` directions(위경도 **역순**, 여러 쌍이면 **마지막=목적지**)를 `@`보다 **우선**하도록 추가.
   - 이유: 기존 5전략은 `/dir/` 링크에서 `@`(뷰포트 중심)를 잡아 **목적지가 아닌 엉뚱한 좌표를 성공처럼** 반환하는 silent 버그. self-test에 `/dir/` 케이스가 없어 못 걸렀음.
2. **결정 2 — 아키텍처:** Cloudflare Pages+Worker 분리 ❌ → **단일 Worker + static assets 바인딩**(`@cloudflare/vite-plugin`).
   - 이유: 2026 현행 CF 베스트. FE와 `/api/resolve`가 **동일 origin** → CORS 부담 ↓ (§7의 same-origin 권장이 자연스러워짐).
   - CLAUDE.md §2/§8/§5 이 결정대로 이미 갱신됨.

## 검증된 외부 스펙 (2026-06 웹검색 재확인, CLAUDE.md와 일치)
- **네이버 딥링크:** `nmap://route/public?...&appname=` — 공식 문서상 `appname` **필수** 확인. `dname` optional.
- **카카오 딥링크:** `kakaomap://route?sp=&ep=&by=` — `by=publictransit`가 **자동차로 열리는 버그 여전**(devtalk 2026-05경 신규 신고). → 네이버 primary 유지.
- **툴체인:** Vite 7(Node 20.19+/22.12+), React 19, Tailwind **v4**(CSS-first, `@tailwindcss/vite` + `@import "tailwindcss"`, PostCSS 불필요), Wrangler 4.x(`wrangler.jsonc` 권장).

---

## Phase 1 — 완료 ✅
### 생성/수정 파일
- `worker/src/resolve.ts` — 6전략 추출(레퍼런스와 동일 우선순위) + `extractName`(best-effort) + consent(`continue=`) 우회 + `inKorea` bbox + UA/Accept-Language. **외부 의존성 0**.
- `worker/src/index.ts` — `POST /api/resolve` 라우팅, 입력 검증(권위), CORS, §7 에러 계약(`invalid_input`/`dead_shortener`/`resolve_failed`/`no_coords`). `ASSETS` 폴백은 Phase 3용 옵셔널.
- `resolve-test.mjs` — §5 6전략으로 보강 + `/dir/` self-test 2케이스 추가(회귀 가드).
- `wrangler.jsonc`, `package.json`, `tsconfig.json`, `.gitignore` — 단일 Worker 셋업.
- `CLAUDE.md` — §2 hosting, §8 디렉토리, §5 self-test 카운트(8/8) 갱신.

### 검증 결과
- `node resolve-test.mjs --selftest` → **8/8 통과**(directions가 @보다 우선함 포함).
- `npm run typecheck` → 클린.
- 에러 계약 7케이스 통과: 빈값/비구글/malformed JSON → `invalid_input`, `goo.gl/maps` → `dead_shortener`(단 `maps.app.goo.gl`은 통과), GET → 405, CORS preflight 헤더 OK.
- 라이브 추출 3/3(레퍼런스 스크립트 경유, Worker와 동일 로직): `query=`/`@latlng`/`ll=`.

### ⚠️ 알려진 환경 이슈 (코드 버그 아님)
- 이 개발 샌드박스에서 **`wrangler dev`의 workerd 로컬 fetch가 `internal error`로 실패**. curl/node fetch는 정상.
  → workerd 로컬 모드 아웃바운드 fetch가 샌드박스에서 막히는 환경 문제. 추출 로직은 레퍼런스로 실네트워크 검증 완료.
  **진짜 검증은 Phase 2(배포된 데이터센터 IP)에서 한다.**

---

## Phase 2 — 완료 ✅ (배포 + 실측 게이트 통과)
**최대 리스크였던 "데이터센터 IP에서 구글이 consent/봇 페이지를 주는가"가 실측으로 해소됨.**

### 배포
- `npx wrangler deploy` 완료 → **https://k-map-router.chakra4267.workers.dev**
- `verify-deployed.mjs` 추가: `links.txt`를 배포 엔드포인트(`/api/resolve`)로 POST해 실 배포 환경 성공률 측정 (구글 직접 fetch가 아니라 Worker 경유 = DC IP 리스크 포함).

### 실측 결과 (2026-06-10, `dir/links.txt` 4개 `maps.app.goo.gl` 링크)
- **성공률 4/4 (100%)**, consent/봇 페이지 **0건** → DC IP에서 구글 fetch 정상.
- 전부 `/dir/` 링크라 전략은 전부 `dir!1d!2d`(역순 로직 배포 환경서 정상). 좌표 전부 서울 bbox 내.
- 이름은 전부 null(설계상 정상, 좌표가 척추).

### ⚠️ 남은 검증 갭 (Phase 3와 병행 또는 차후)
- 표본 작음(4개)·전부 `/dir/` 한 종류. **place-핀(`!3d!4d`)·`@`뷰포트·`query=` 짧은 링크**는 배포 경유로 아직 미검증(저위험·풀URL 스모크는 통과). 링크 더 모이면 `node verify-deployed.mjs <file>`로 재측정.

---

## Phase 3 — 대기 (프론트엔드)
**생성 예정:** `index.html`, `vite.config.ts`(`@tailwindcss/vite` + `@cloudflare/vite-plugin`), `src/index.css`(`@import "tailwindcss"`),
`src/App.tsx`, `src/components/{LinkInput,ResultButtons,AdSlot}.tsx`, `src/lib/{deeplink,ua}.ts`.
**핵심:** 영어 default·모바일 원페이지·storage 금지·`dname` 없으면 생략·UA 분기(네이버 primary/카카오 secondary, 앱스킴→스토어/웹 폴백)·빈 AdSlot.
**wrangler.jsonc:** `assets: { directory: "./dist/client", binding: "ASSETS", not_found_handling: "single-page-application" }` 추가.

---

## 명령 요약
```
npm run selftest      # node resolve-test.mjs --selftest  (회귀 가드, 8/8 기대)
npm run typecheck     # tsc --noEmit
npm run dev:worker    # wrangler dev  (이 샌드박스에선 외부 fetch 막힘 주의)
npm run deploy        # wrangler deploy  (먼저 wrangler login 필요)
node resolve-test.mjs links.txt   # 라이브 추출 테스트(구글 직접 — Phase 2는 배포 경유 변형 필요)
```

## 제약 (불변)
MVP만 · 추출 외부 라이브러리 금지(fetch+regex) · 브라우저 storage 금지 · UI 영어 default ·
reverse geocoding·share target·다국어·실 AdSense 전부 MVP 제외.
