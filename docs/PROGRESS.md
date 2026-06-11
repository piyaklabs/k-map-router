# K-Map Router — 진행 상황 (세션 핸드오프)

> 새 세션이 이 파일 + `CLAUDE.md` + `docs/PRD.md`만 읽고 이어서 작업할 수 있도록 유지.
> **마지막 갱신: 2026-06-10.** 빌드 방식: 플랜 → 사용자 승인 → Phase별 빌드 → 각 Phase 끝 보고.

## 현재 상태 한 줄
**Phase 1·2·3 전부 완료 — MVP 배포 라이브(https://k-map-router.chakra4267.workers.dev). 남은 것: 실폰 딥링크 테스트(사용자).**

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

## Phase 3 — 완료 ✅ (프론트엔드, 미니멀 라이트 UI)
**디자인(사용자 선택):** 미니멀 라이트 — stone-50 배경 / stone-900 잉크 / 네이버 그린 `#03C75A` primary 솔리드 /
카카오 옐로 `#FEE500` secondary. system-ui 폰트(외부 fetch 0). Tailwind v4 `@theme` 토큰(`--color-naver` 등).

### 생성 파일
- `index.html`(영어 메타/OG, 이모지 SVG 파비콘), `vite.config.ts`(react+tailwind+cloudflare 플러그인), `src/main.tsx`, `src/index.css`
- `src/App.tsx` — 상태 머신 idle→resolving(스켈레톤)→success|error. 에러는 서버 message 표시 + Try another link(입력 리마운트 리셋).
- `src/components/LinkInput.tsx` — 클라 즉시 검증(비구글 → 링 하이라이트), Paste 버튼(iOS 거부 시 수동 안내 폴백), 붙여넣기 시 자동 제출, 값 있으면 버튼이 "Get directions"로 전환.
- `src/components/ResultButtons.tsx` — 목적지 카드(이름 없으면 좌표만) + 네이버/카카오 버튼. 모바일: 앱스킴→1.6s 폴백(네이버=스토어, 카카오=웹), 데스크톱: 네이버 웹검색/카카오 link API 새 탭.
- `src/components/AdSlot.tsx` — 빈 슬롯(높이 예약), `src/lib/{deeplink,ua}.ts` — §6 스펙(appname 필수, dname 없으면 생략, visibilitychange/pagehide 폴백 취소).
- `wrangler.jsonc` assets 바인딩(**directory 없음** — vite 플러그인이 출력 설정에 채움), `tsconfig.json`(FE)/`worker/tsconfig.json` 분리, scripts 정리(dev/build/deploy/typecheck/selftest/verify:deployed).

### 검증 결과 (2026-06-10)
- typecheck 클린 · selftest 8/8 · `vite build` 성공(클라 JS 62KB gzip, CSS 3.4KB).
- 배포 완료(버전 28a1ab78). 라이브 확인: `/` SPA 200, `/api/resolve` 동일 origin 실링크 성공, 깊은 경로 SPA 폴백 200, assets 200.
- ⚠️ `wrangler dev` 단독은 안 됨(루트 설정에 assets directory 없음) — dev/배포 모두 vite 경유.

### 1차 실기기 테스트 피드백 반영 (2026-06-10, 버전 25d499d4)
사용자 1차 테스트에서 발견된 4건 수정·배포 완료:
1. **모바일 길찾기 공유 링크(`g_st=`) no_coords** → §5 #3 `geocode=` base64 protobuf 디코딩 전략 추가
   (0x15=lat×1e6, 0x1D=lng×1e6, 마지막 엔트리=목적지) + `daddr=`에서 이름 추출. selftest 9/9.
2. **카카오 link/to가 `?target=car`로 깨짐** → 원인: 이름 세그먼트의 콤마(%2C). 콤마 제거 라벨로 수정, curl로 rt= 채워지는 것 확인.
3. **모바일 앱이 route 없이 그냥 열림** → 추정 원인: 1.6s 타이머가 iOS 확인 대화상자 중 폴백(깨진 카카오 웹링크→유니버설 링크) 발동.
   타이머 2.5s + Android는 `intent://`(S.browser_fallback_url 내장)로 전환. 공식 스펙 재확인: nmap dname=optional(N) 맞음, kakao by=publictransit 소문자 맞음.
4. **네이버 데스크톱이 핀만 찍힘** → `/p/search/`(핀) 대신 `/p/directions/-/{x},{y},{label}/-/transit`(Web Mercator 변환)로 변경. **미검증 — 사용자 확인 필요.**

### 2차 실기기 테스트 결과 (2026-06-10, 버전 cc924918)
- ✅ **데스크톱 네이버/카카오 길찾기 패널 정상** — `/p/directions` Web Mercator 포맷 동작 확인됨.
- ✅ **모바일 네이버 앱 정상 동작** (g_st 링크로 확인).
- ✅ 출발지 비어있음 = **의도된 동작** (앱은 현재 위치 자동, 웹은 사용자가 입력 — 웹페이지가 타 지도 웹에 "현재 위치"를 넘길 방법 없음).
- 추가 수정: 목적지가 좌표 문자열로 뜨던 문제 → **`/dir/` URL 경로 마지막 세그먼트에서 이름 추출** 추가
  (실측: `/maps/dir/서울역…/경복궁+사직로161/@…` 형태로 한글 이름이 경로에 있음). 이제 4/4 링크 전부 실이름 반환.
  이름 추출 순서: `/place/` → `/dir/` 마지막 세그먼트 → `daddr=` → `og:title`. 라벨 공백 정리 포함.

### A→B 출발지 지원 (2026-06-10, 사용자 요구 → 승인 후 구현, 버전 c7f69cf0)
**요구:** 무조건 "내 위치 출발"이면 안 됨 — A→B 길찾기 공유 링크는 A를 출발지로 살려야.
**구현(모드 분리 없이 링크에서 자동 감지):**
- API에 `origin` 필드 추가(§7 갱신): 좌표 쌍 ≥2면 첫 쌍(!1d!2d)/첫 geocode 엔트리=출발지,
  이름은 `/dir/` 첫 세그먼트·`saddr=`. 한국 밖/목적지와 동일하면 버림. 쌍 1개면 origin 없음(=내 위치).
- 딥링크: 네이버 `slat/slng/sname`, 카카오 앱 `sp=`, 네이버 웹 `/p/directions/{출발}/{도착}`.
  카카오 웹 link API는 출발지 미지원(한계).
- UI: 결과 카드에 `From 서울역… [✕]` 행 — ✕로 출발지 제거(내 위치 전환). origin 없고 모바일이면
  "From your current location" 표시. selftest 9/9(출발지 검증 포함).
- 실측: A→B 링크 4종에서 출발지(서울역·홍대입구역·인천국제공항·을지로회관) 정확 추출 확인.
- 수동 A 입력 모드는 의도적으로 제외 — 이름→좌표 지오코딩(외부 API·키) 필요해 MVP 제약 위반.

### 3차 실기기 테스트 결과 (2026-06-11)
- ✅ **iOS 네이버/카카오 앱 모두 A→B route 정상** — 모바일 핵심 경로 완성.
- ✅ 데스크톱 네이버 웹: A→B + 명칭 정상.
- 발견 2건 → 수정·배포(버전 06a53686):
  1. **카카오 웹 출발지 안 나옴** → link API가 출발지 미지원. 내부 포맷
     `?target=publictransit&rt={sx},{sy},{ex},{ey}&rt1=&rt2=` 직접 구성으로 교체.
     좌표는 WCongnamul(=EPSG:5181×2.5) 변환 — 카카오 자체 변환값과 3지점 정수 일치 검증.
  2. **iOS Paste 버튼 안 먹힘** → iOS 클립보드 허용 말풍선("Paste")을 안 누르면 멈춘 듯 보임.
     400ms 후 말풍선 안내 표시 + 4s 타임아웃 + 수동 붙여넣기 폴백 안내로 보강.

### 남은 확인
- [ ] 데스크톱 카카오: 출발지+도착지 길찾기로 뜨는지 (`target=publictransit` 값 유효성 미확인 — 안되면 car로)
- [ ] iOS Paste 버튼 재확인 (말풍선 안내 동작)
- [ ] **Android intent:// 경로 미검증** — Android 기기 확보 시 확인.
- [ ] 카카오 앱 `by=publictransit` 버그 여부 (정상 동작 보고됐으나 대중교통/자동차 어느 모드로 열렸는지 미확인)

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
