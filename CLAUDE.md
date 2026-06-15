# CLAUDE.md — K-Map Router

> Claude Code 작업 컨텍스트. 이 파일은 스파이크로 **실측 검증된 사실**만 담는다.
> 추측·재발명 금지. 의심되면 `docs/PRD.md`와 이 파일을 신뢰할 것.

## 1. 한 줄 정의
외국인 관광객이 구글맵 공유 링크를 붙여넣으면 네이버/카카오 지도 길찾기로
포워딩하는 초경량 **stateless** 웹 서비스. (DB 없음, 저장 없음)

## 2. 기술 스택
| 영역 | 선택 | 비고 |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind CSS | mobile-first, 영어 default |
| Backend | Cloudflare Workers (TypeScript) | **외부 의존성 0** — fetch + regex만 |
| Hosting | **단일 Worker + static assets 바인딩** (`@cloudflare/vite-plugin`) | FE와 `/api/resolve`가 동일 origin → CORS 부담 ↓. 무료 티어 |
| Storage | 없음 | stateless |

## 3. 아키텍처 불변 원칙 (검증 완료)
1. **좌표 해소는 반드시 서버사이드(Worker).** 브라우저에서 구글로 직접 fetch하면
   CORS로 차단됨. 프론트는 항상 `/api/resolve`를 호출한다.
2. **Stateless.** 유저/매핑 데이터 저장 안 함.
3. **English-default.** 모든 UI 텍스트·메타태그 영어.

## 4. ⚠️ 하드원 지식 — 이거 모르고 짜면 똑같이 깨진다
- **`goo.gl/maps`는 죽은 링크.** 2025-08-25부로 작동 중단. 입력으로 들어오면
  유효한 좌표를 줄 수 없으니 `dead_shortener`로 거절. 살아있는 입력은
  `maps.app.goo.gl/*`, `*.google.com/maps/*`, `*.google.co.kr/maps/*` 뿐.
- **이름(placeName) 추출은 신뢰 불가.** 실측상 공유 링크 다수가 `@위경도` 중심
  URL로 풀려서 `/place/이름/`도 `og:title`도 없다. **이름은 optional. 좌표가 척추다.**
- **좌표 포맷이 URL 종류마다 다르다 (아래 5절).** 특히 `/dir/`(길찾기) URL은
  `!1d{경도}!2d{위도}`로 **위경도 순서가 거꾸로**다. 절대 그냥 (1d,2d)=(lat,lng)로 읽지 말 것.
- **Workers 데이터센터 IP는 구글이 봇으로 의심**해 consent 페이지를 줄 수 있다.
  요청에 브라우저 UA + `Accept-Language` 필수. consent로 빠지면 `continue=` 파라미터에서
  원본 URL을 꺼내 재파싱. **배포 직후 실제 링크로 반드시 재검증** (로컬 한국 IP는 통과해도 Workers는 다를 수 있음).
- **Korea bbox sanity check:** lat 32.5–39.5, lng 124–132.5 벗어나면 의심 처리.
- **모바일 앱 "길찾기 → 공유" 링크(`g_st=` 파라미터)는 별종.** `?daddr={이름}&saddr={이름}&geocode={b64};{b64}`
  로 풀려 좌표가 평문 어디에도 없다 → §5 #3 geocode 디코딩 필수. 이름은 `daddr=`에서 추출 가능.

## 5. 좌표 추출 스펙 — 우선순위 순 (스파이크 검증)
URL과 HTML 바디를 합친 텍스트에 아래 순서로 적용. 먼저 매칭되는 것 채택.

1. `!3d(위도)!4d(경도)` — **place 핀** (가장 권위 있음)
2. `!1d(경도)!2d(위도)` — **directions 경유점**. ⚠️순서 반대. 여러 개면 **마지막=목적지**.
   (출발지=첫 쌍 → 원하면 naver `slat/slng`로 전달)
3. `[?&]geocode=` — **모바일 앱 길찾기 공유**(`g_st=` 붙음). ⚠️좌표가 URL 어디에도
   평문으로 없고 base64url protobuf에만 있음: 엔트리당 `0x15`(fixed32 LE)=lat×1e6,
   `0x1D`=lng×1e6. `;` 구분 다중 엔트리면 **마지막=목적지**. 이름은 `daddr=`에 있음(실측 2026-06).
4. `@(위도),(경도)` — viewport 중심. *실측상 공유 링크 다수가 여기로 잡힘*
5. `[?&](q|query|destination|daddr)=(위도),(경도)`
6. `[?&](ll|center|sll)=(위도),(경도)`
7. `[null,null,(위도),(경도)]` — 바디 임베디드 배열

> 검증된 레퍼런스 구현: 리포 루트의 `resolve-test.mjs` (오프라인 self-test **9/9**
> — `/dir/`가 `@`보다 우선 + geocode= 디코딩 실측 케이스 포함). Worker의 추출
> 로직(`worker/src/resolve.ts`)은 이 파일과 **동일한 우선순위**로 짰다.
> CI에 `node resolve-test.mjs --selftest`를 넣어 회귀 가드로 쓴다.

## 6. 딥링크 스펙 (공식 문서 검증)

### 이동수단(mode): walk | transit — 스마트 기본 + 토글
- **구글맵은 도보 길찾기에 공유 버튼을 안 띄운다** → 사용자가 억지로 대중교통으로 바꿔 공유함.
  즉 링크의 "대중교통"은 진짜 의도가 아닐 때가 많음 → 우리가 거리로 보정한다.
- **기본값**(`defaultMode`): 출발지 있고 거리 ≤ **1.2km**(`WALK_THRESHOLD_KM`, Haversine) → **walk**, 아니면 transit.
  출발지 없으면(내 위치) 거리 모름 → transit. 결과 화면 **Walk/Transit 토글**로 1탭 전환.
- 앱별 모드 어휘 **다름**: 네이버 `route/walk`↔`route/public`, 카카오 앱 `by=foot`↔`by=publictransit`,
  네이버 웹 경로 끝 `/walk`↔`/transit`, 카카오 웹 `target=walk`↔`target=traffic`.

### 네이버 — primary
- 앱 스킴: `nmap://route/public?dlat={lat}&dlng={lng}&dname={enc}&appname={APPNAME}` (도보=`route/walk`, 자전거=`route/bicycle`)
  - `appname` **필수** (없으면 동작 보장 안 됨). 값: 배포 도메인 또는 번들ID.
  - `dname` **optional → 이름 없으면 생략**. 생략 시 네이버가 실제 주소를 표시.
  - `slat/slng/sname` 생략 시 현재 위치를 출발지로 사용. 있으면 A→B 출발지 지정.
- 미설치 폴백: Android `market://details?id=com.nhn.android.nmap` /
  iOS `itms-apps://itunes.apple.com/app/id311867728`

### 카카오 — secondary (대중교통 버그 주의)
- 앱 스킴: `kakaomap://route?ep={lat},{lng}&by=publictransit`
  - ⚠️ **`by` 무시 버그 보고됨** — 앱에서 항상 자동차(CAR)로 열릴 수 있음
    (2025년에도 재보고). 그래서 네이버를 primary로 둔다.
  - `sp={lat},{lng}` 생략 가능. 이동수단: car|publictransit|foot|bicycle.
- 웹 폴백: `https://map.kakao.com/link/to/{enc},{lat},{lng}` (구형 link API — 동작 수동확인)
  - ⚠️ **`link/walkto`는 없음(404).** 출발지 없는 도보도 그냥 `link/to` 사용(목적지만 표시, 앱서 모드 전환).
  - ⚠️ **이름 세그먼트에 콤마(`,`/`%2C`) 금지** — 들어가면 파싱 깨져 목적지 없는
    `?target=car`로 폴백(실측 2026-06). 이름 없을 때 `"lat,lng"`를 이름으로 넣으면 안 됨
    → 콤마를 공백 치환한 라벨 사용.
  - **link API는 출발지 미지원.** 출발지 필요하면 link/to가 리다이렉트하는 내부 포맷을 직접 구성:
    `map.kakao.com/?map_type=TYPE_MAP&target=…&rt={sx},{sy},{ex},{ey}&rt1={출발명}&rt2={도착명}`
    — 좌표는 **WCongnamul = EPSG:5181(GRS80 TM, lat0=38/lon0=127/FE=200000/FN=500000) × 2.5**.
    변환식은 카카오 자체 변환값과 정수 단위 일치 검증됨(실측 2026-06, `src/lib/deeplink.ts`).
- 미설치 폴백: iOS `id304608425` / Android `net.daum.android.map`

### 프론트 실행 분기
- **iOS**: 커스텀 스킴(`nmap://`, `kakaomap://`) → 타이머 폴백. ⚠️타이머 1.6s는 너무 짧음
  — "앱에서 열기" 확인 대화상자 중에 폴백이 끼어들어 엉뚱한 화면이 열림(실측). **2.5s** 사용,
  `visibilitychange`/`pagehide`로 전환 감지 시 취소.
- **Android**: 커스텀 스킴 대신 **`intent://…#Intent;scheme=…;package=…;S.browser_fallback_url=…;end`**
  — 파라미터 전달 보장 + 미설치 시 스토어 폴백 내장(Chrome 계열 정석).
- **데스크톱**: 새 탭. 네이버는 `map.naver.com/p/directions/-/{x},{y},{이름}/-/transit`
  (비공식, 좌표는 **Web Mercator EPSG:3857** 변환 필요). 안되면 좌표/이름 검색 폴백
  (`/p/search/`는 핀만 찍힘 — 길찾기 아님, 실측). 데스크톱은 edge case로 취급.

## 7. API 계약 — `POST /api/resolve`
요청: `{ "url": string }`
성공: `{ "success": true, "lat": number, "lng": number, "name": string|null, "method": string,
        "origin": { "lat", "lng", "name": string|null } | null }`
- `origin`: A→B 길찾기 공유 링크일 때만 (좌표 쌍 ≥2 → 첫 쌍/첫 geocode 엔트리 = 출발지,
  이름은 `/dir/` 첫 세그먼트 또는 `saddr=`). 한국 밖이거나 목적지와 동일하면 null.
  null이면 프론트가 출발지 파라미터 생략 → 앱이 현재 위치 사용.
실패: `{ "success": false, "reason": "invalid_input"|"dead_shortener"|"resolve_failed"|"no_coords", "message": string }`
- CORS 헤더 포함. 동일 zone route면 `same-origin` 권장.
- 입력 검증을 프론트(즉시 하이라이트)와 백(권위) 양쪽에서.

## 8. 디렉토리 구조 — 단일 Worker + static assets
> 2026 현행 CF 베스트(`@cloudflare/vite-plugin`). Pages+Worker 분리 안 함.
> Vite 빌드(`dist/client`)를 Worker의 `assets` 바인딩으로 동일 origin 서빙.
```
/                     루트에 Vite 프로젝트 + Worker 통합
  package.json         scripts: dev / build / deploy / typecheck / selftest / verify:deployed
  wrangler.jsonc       main=worker/src/index.ts + assets 바인딩(directory는 vite 플러그인이 출력 설정에 채움 — 루트에 적지 말 것)
  tsconfig.json        FE용. Worker는 worker/tsconfig.json (가까운 파일 우선)
  vite.config.ts       react + @tailwindcss/vite + @cloudflare/vite-plugin
  index.html           SPA 진입점 (영어 메타/OG, 외부 폰트 없음 — LCP<1s)
  src/                 React FE (미니멀 라이트: stone 팔레트 + 네이버그린/카카오옐로 토큰)
    App.tsx            원페이지 UI
    components/
      LinkInput.tsx    입력 + Paste-from-Clipboard (iOS 폴백 포함)
      ResultButtons.tsx 네이버/카카오 버튼 + UA 분기 실행
      AdSlot.tsx       정적 광고 슬롯 (MVP는 빈 컴포넌트)
    lib/deeplink.ts    딥링크 빌더 (6절 스펙)
    lib/ua.ts          User-Agent 판별
    index.css          @import "tailwindcss" (Tailwind v4, CSS-first)
  worker/
    src/index.ts       Worker 엔트리 (라우팅 + 입력검증 + CORS, ASSETS 폴백)
    src/resolve.ts     좌표/이름 추출 (5절 스펙, resolve-test.mjs와 동일 우선순위)
  docs/PRD.md
  resolve-test.mjs     검증 스파이크 (회귀 가드, self-test 8/8 — §5 6전략 포함)
```

## 9. 하지 말 것
- ❌ 추출 로직에 외부 라이브러리 추가 (fetch+regex로 충분, 검증됨).
- ❌ `dname=Destination` 같은 리터럴 플레이스홀더 전송 → 이름 없으면 파라미터 생략.
- ❌ `goo.gl/maps` 입력을 정상 처리 시도.
- ❌ 브라우저 storage(localStorage 등) 사용 — stateless.
- ❌ MVP 범위에 reverse geocoding / 즐겨찾기 / 다국어 토글 넣기 → PRD "이후 고도화".

## 10. 명령
```
# 로컬 (FE+Worker 동시, vite 플러그인이 workerd 구동):  npm run dev
# 배포 (typecheck+빌드 포함):                         npm run deploy
# 추출 회귀:    npm run selftest        (8/8 기대)
# 라이브 검증:  npm run verify:deployed (links.txt를 배포된 /api/resolve로 POST)
```
> ⚠️ `wrangler dev` 단독 실행은 assets directory가 루트 설정에 없어 안 됨 —
> dev/배포 모두 vite 경유(`npm run dev` / `npm run deploy`)가 정석.

### 캐시 정책 (배포 즉시 반영)
- wrangler.jsonc `assets.run_worker_first: true` → 모든 요청이 Worker를 먼저 거침.
- Worker가 응답 Cache-Control 교체: **HTML = `no-store, no-cache, must-revalidate`**(배포 즉시 반영),
  **`/assets/*`(해시 파일) = `max-age=31536000, immutable`**(영구 캐시). 그 외는 기본값 통과.
- ⚠️ 이거 없으면 index.html이 옛 자산 해시를 가리킨 채 브라우저/iOS에 캐시돼 업데이트가 안 보임(실측).
