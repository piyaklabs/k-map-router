/**
 * 네이버/카카오 딥링크 빌더 (CLAUDE.md §6 — 공식 문서 검증 스펙).
 * 네이버 = primary (대중교통 정확·영어 우수), 카카오 = secondary
 * (`by=publictransit`가 자동차로 열리는 버그 보고됨).
 *
 * 출발지(origin): A→B 길찾기 공유 링크에서만 존재. 없으면 파라미터 생략
 * → 앱이 현재 위치를 출발지로 사용.
 */
import type { Platform } from "./ua";

export interface Destination {
  lat: number;
  lng: number;
  name: string | null;
}

// 네이버 nmap 스킴 필수 식별자 — 배포 도메인
const APPNAME = "kmap.piyaklabs.com";

const NAVER_ANDROID_PKG = "com.nhn.android.nmap";
const KAKAO_ANDROID_PKG = "net.daum.android.map";

type Origin = Destination | null;

function naverQuery(dest: Destination, origin: Origin): string {
  let q = "";
  if (origin) {
    q += `slat=${origin.lat}&slng=${origin.lng}`;
    if (origin.name) q += `&sname=${encodeURIComponent(origin.name)}`;
    q += "&";
  }
  // dname은 공식 스펙상 optional — 생략 시 네이버가 실제 주소 표시 (리터럴 placeholder 금지)
  q += `dlat=${dest.lat}&dlng=${dest.lng}`;
  if (dest.name) q += `&dname=${encodeURIComponent(dest.name)}`;
  return `${q}&appname=${encodeURIComponent(APPNAME)}`;
}

/** iOS용 nmap 스킴. (Android는 intent:// 사용 — 파라미터 전달 보장 + 스토어 폴백 내장) */
export function naverAppUrl(dest: Destination, origin: Origin): string {
  return `nmap://route/public?${naverQuery(dest, origin)}`;
}

/**
 * Android Chrome 계열은 커스텀 스킴보다 intent://가 정석:
 * 파라미터가 그대로 앱 인텐트로 전달되고, 미설치면 S.browser_fallback_url로 빠진다.
 */
export function naverAndroidIntentUrl(dest: Destination, origin: Origin): string {
  const fallback = encodeURIComponent(
    `https://play.google.com/store/apps/details?id=${NAVER_ANDROID_PKG}`,
  );
  return (
    `intent://route/public?${naverQuery(dest, origin)}` +
    `#Intent;scheme=nmap;package=${NAVER_ANDROID_PKG};S.browser_fallback_url=${fallback};end`
  );
}

export const NAVER_IOS_STORE = "itms-apps://itunes.apple.com/app/id311867728";
export const NAVER_ANDROID_STORE_WEB = `https://play.google.com/store/apps/details?id=${NAVER_ANDROID_PKG}`;

/** Web Mercator(EPSG:3857) 경로 세그먼트 — 네이버 웹 /p/directions 좌표계. */
function naverWebSegment(p: Destination): string {
  const x = (p.lng * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + p.lat) * Math.PI) / 360)) * 20037508.34) /
    Math.PI;
  return `${x.toFixed(7)},${y.toFixed(7)},${encodeURIComponent(webLabel(p))}`;
}

/**
 * 데스크톱 — 네이버 웹 길찾기 (비공식 /p/directions).
 * 형식: /p/directions/{출발|-}/{x},{y},{이름}/{경유|-}/transit
 */
export function naverWebUrl(dest: Destination, origin: Origin): string {
  const start = origin ? naverWebSegment(origin) : "-";
  return `https://map.naver.com/p/directions/${start}/${naverWebSegment(dest)}/-/transit`;
}

/** iOS용 kakaomap 스킴. sp 생략 시 현재 위치 출발. by 무시 버그 주의(보조로만). */
export function kakaoAppUrl(dest: Destination, origin: Origin): string {
  const sp = origin ? `sp=${origin.lat},${origin.lng}&` : "";
  return `kakaomap://route?${sp}ep=${dest.lat},${dest.lng}&by=publictransit`;
}

export function kakaoAndroidIntentUrl(dest: Destination, origin: Origin): string {
  const sp = origin ? `sp=${origin.lat},${origin.lng}&` : "";
  const fallback = encodeURIComponent(kakaoWebUrl(dest, origin));
  return (
    `intent://route?${sp}ep=${dest.lat},${dest.lng}&by=publictransit` +
    `#Intent;scheme=kakaomap;package=${KAKAO_ANDROID_PKG};S.browser_fallback_url=${fallback};end`
  );
}

/**
 * 웹 URL용 목적지 라벨. ⚠️ 카카오 link API는 이름 세그먼트에 콤마(%2C 포함)가
 * 들어가면 파싱이 깨져 목적지 없는 ?target=car로 폴백된다(실측 2026-06)
 * → 콤마/%는 공백 치환 후 공백 정리. 이름 없으면 좌표 라벨.
 */
function webLabel({ lat, lng, name }: Destination): string {
  return (name ?? `${lat.toFixed(5)} ${lng.toFixed(5)}`)
    .replace(/[,%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * WGS84 → WCongnamul (카카오 웹 내부 좌표계 = EPSG:5181 TM × 2.5).
 * GRS80, lat0=38, lon0=127, k0=1, FE=200000, FN=500000.
 * 실측 검증: 카카오 link/to 리다이렉트가 변환해 준 값과 3개 지점 정수 단위 일치.
 */
function wcongnamul(lat: number, lng: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const lat0 = (38 * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const dLam = ((lng - 127) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = dLam * Math.cos(phi);
  const M = (p: number) =>
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * p) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const x =
    200000 +
    N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120);
  const y =
    500000 +
    (M(phi) -
      M(lat0) +
      N *
        Math.tan(phi) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [Math.round(x * 2.5), Math.round(y * 2.5)];
}

/**
 * 카카오 웹 폴백. 출발지 없으면 구형 link API(검증됨).
 * 출발지 있으면 link API가 미지원이라 link/to 리다이렉트 결과 포맷
 * (?rt={sx},{sy},{ex},{ey}&rt1=&rt2=)을 WCongnamul 좌표로 직접 구성.
 */
export function kakaoWebUrl(dest: Destination, origin: Origin = null): string {
  if (!origin) {
    return `https://map.kakao.com/link/to/${encodeURIComponent(webLabel(dest))},${dest.lat},${dest.lng}`;
  }
  const [sx, sy] = wcongnamul(origin.lat, origin.lng);
  const [ex, ey] = wcongnamul(dest.lat, dest.lng);
  // ⚠️ 웹의 이동수단 값은 앱 스킴(by=publictransit)과 다름: traffic=대중교통
  return (
    `https://map.kakao.com/?map_type=TYPE_MAP&target=traffic` +
    `&rt=${sx},${sy},${ex},${ey}` +
    `&rt1=${encodeURIComponent(webLabel(origin))}` +
    `&rt2=${encodeURIComponent(webLabel(dest))}`
  );
}

/**
 * 앱 스킴/인텐트 시도 → timeoutMs 내 화면 전환이 없으면(앱 미설치 등) 폴백 URL로 이동.
 * 앱으로 전환되면 pagehide/visibilitychange가 먼저 발생해 폴백을 취소한다.
 * iOS의 "앱에서 열기" 확인 대화상자 시간을 고려해 2.5s (짧으면 대화상자 중에
 * 폴백이 끼어들어 엉뚱한 화면이 열림 — 실측).
 */
export function openWithFallback(
  appUrl: string,
  fallbackUrl: string,
  timeoutMs = 2500,
): void {
  const timer = window.setTimeout(() => {
    if (document.visibilityState === "visible") {
      window.location.href = fallbackUrl;
    }
  }, timeoutMs);
  const cancel = () => window.clearTimeout(timer);
  window.addEventListener("pagehide", cancel, { once: true });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") cancel();
    },
    { once: true },
  );
  window.location.href = appUrl;
}

/** 플랫폼 분기까지 묶은 실행기 — 버튼 핸들러에서 이것만 호출. */
export function openNaver(
  dest: Destination,
  origin: Origin,
  platform: Platform,
): void {
  if (platform === "desktop") {
    window.open(naverWebUrl(dest, origin), "_blank", "noopener");
  } else if (platform === "android") {
    openWithFallback(naverAndroidIntentUrl(dest, origin), NAVER_ANDROID_STORE_WEB);
  } else {
    openWithFallback(naverAppUrl(dest, origin), NAVER_IOS_STORE);
  }
}

export function openKakao(
  dest: Destination,
  origin: Origin,
  platform: Platform,
): void {
  if (platform === "desktop") {
    window.open(kakaoWebUrl(dest, origin), "_blank", "noopener");
  } else if (platform === "android") {
    openWithFallback(kakaoAndroidIntentUrl(dest, origin), kakaoWebUrl(dest, origin));
  } else {
    openWithFallback(kakaoAppUrl(dest, origin), kakaoWebUrl(dest, origin));
  }
}
