# K-Map Router — PRD v2

> v1(초안) → v2 변경: 기술 스파이크로 핵심 가정을 실측 검증하고 깨진 부분을 수정한 버전.
> 변경 이력은 마지막 §8 참고.

## 1. 개요
한국 방문 외국인이 익숙한 구글맵에서 복사한 **장소 공유 링크**를 붙여넣으면,
국내 길찾기가 정확한 네이버/카카오 지도의 길찾기 화면으로 즉시 포워딩해 주는
초경량 라우팅 유틸리티. DB 없는 stateless 웹 서비스.

**검증된 시장 근거:** 한국은 지도 데이터 해외 반출 규제로 구글맵의 보행/대중교통
내비가 제약된다. 외국인 방문객의 상당수가 이를 가장 큰 불편으로 꼽으며, 기존 우회법은
"장소의 한국어 이름을 일일이 복사해 네이버/카카오에 붙여넣기"다. 본 서비스의 차별점은
그 수동 복붙을 **링크 1회 → 버튼 1탭**으로 줄이는 것.

## 2. 타겟
한국 방문(예정) 외국인 자유여행객. 1차 영어권, 모바일 우선.

## 3. 제품 원칙
- **Stateless & 초경량**: 저장 없음, 인프라 무료 티어 수렴.
- **Web-first**: 앱 설치 없이 URL/QR 접속만으로 3초 내 기능 수행.
- **English-default**: 모든 UI·메타 영어.
- **Mobile-first**: 주 사용처는 길 위의 스마트폰.

## 4. 범위

### MVP (이번 빌드)
- 구글맵 공유 링크 → 좌표 추출 → 네이버/카카오 길찾기 딥링크.
- 클립보드 붙여넣기, 로딩 상태, 에러 처리, 광고 슬롯(빈 컴포넌트).

### 이후 고도화 (MVP 제외)
- 좌표 → 이름 reverse geocoding(친숙한 목적지명 표시).
- 모바일 공유시트(Share Target) 진입점 — 복붙 마찰 제거(Android PWA).
- AdSense 실집행, 유입/SEO, 다국어, QR 생성.

## 5. 기능 요구사항

### 5.1 [BE] 좌표 추출 API — `POST /api/resolve`
- 입력: 구글맵 링크 문자열. 살아있는 형태는 `maps.app.goo.gl/*`,
  `*.google.com|co.kr/maps/*`. **`goo.gl/maps`는 2025-08-25 폐기 → 거절.**
- 로직: 브라우저 UA + `Accept-Language`로 redirect 추적 → 최종 URL+바디에서
  좌표 추출(우선순위는 CLAUDE.md §5). consent 페이지면 `continue=` 재파싱.
- 이름은 **best-effort, optional**(실측상 미추출 빈번).
- 출력: `{success, lat, lng, name|null, method}` 또는 `{success:false, reason, message}`.

### 5.2 [FE] 입력 UX
- 스크롤 없는 모바일 원페이지.
- **Paste from Clipboard** 버튼(웹 Clipboard API). iOS Safari 권한 제약 →
  **수동 입력 폴백 항상 병행**.
- 분석 중 스피너/스켈레톤.

### 5.3 [FE] 길찾기 라우팅 버튼
좌표 수신 시 두 버튼 활성화. UA로 앱/웹 분기 (스펙: CLAUDE.md §6).
- **네이버 = primary** (대중교통 정확, 영어 지원 우수).
  `nmap://route/public?dlat=&dlng=&[dname=]&appname=` — 이름 없으면 `dname` 생략.
- **카카오 = secondary**. `kakaomap://route?ep={lat},{lng}&by=publictransit`.
  ⚠️ 대중교통 모드가 자동차로 열리는 버그 보고됨 → 보조로만.

## 6. 비기능 요구사항
- **예외 처리**: (a) 구글맵 링크 아님 → 즉시 하이라이트 + "Please enter a valid
  Google Maps share link." (b) 해소/추출 실패 → 친절한 안내 + 입력 초기화 버튼.
  (c) `goo.gl/maps` → "This Google short link format is no longer supported."
- **성능/SEO**: 외부 의존 최소화, LCP < 1s 목표. 메타·타이틀·UI 전부 영어.
- **수익화 대비**: UI 하단에 AdSense 정적 슬롯(컴포넌트)만 미리 확보(MVP 미집행).

## 7. 미해결/확인 항목
- [ ] 배포된 Worker(데이터센터 IP)에서 동일 링크 추출 성공률 재측정 (consent 리스크).
- [ ] 네이버 웹(데스크톱) 길찾기 URL 현행 포맷 — 비공식, 안 되면 검색 폴백.
- [ ] 카카오 `by=publictransit` 버그 최신 상태 재확인.

## 8. v1 → v2 변경 이력 (스파이크 산출물)
| # | v1 가정 | v2 수정 | 근거 |
|---|---|---|---|
| 1 | `goo.gl/maps` 유효 입력 | 폐기 링크 → 거절 | 2025-08-25 서비스 종료 |
| 2 | 최종 URL @latlng 정규식이면 충분 | URL 종류별 다중 포맷 필요(`!3d!4d`, `!1d!2d` 역순, `@`, `query`, `ll`, 배열) | 실측: `/dir`는 `!1d경도!2d위도` |
| 3 | 네이버 `route/publictransit` | `route/public` + **`appname` 필수** | 네이버 공식 문서 |
| 4 | 카카오 대중교통 딥링크 신뢰 | 버그로 보조 강등, 네이버 primary | 카카오 devtalk 다건 |
| 5 | `dname=Destination` 고정 | 이름 없으면 `dname` 생략(실주소 표시) | 네이버 공식 문서 |
| 6 | 이름 추출 전제 | optional, 좌표가 척추 | 실측: 공유 링크 이름 미추출 빈번 |
| 7 | 순수 fetch+regex 우려 | 그대로 충분(검증) + 바디 파싱·consent 처리 추가 | 스파이크 self-test 6/6, live 3/3 |
