/**
 * 네이버/카카오 딥링크 빌더 (CLAUDE.md §6 — 공식 문서 검증 스펙).
 * 네이버 = primary (대중교통 정확·영어 우수), 카카오 = secondary
 * (`by=publictransit`가 자동차로 열리는 버그 보고됨).
 */
import type { Platform } from "./ua";

export interface Destination {
  lat: number;
  lng: number;
  name: string | null;
}

// 네이버 nmap 스킴 필수 식별자 — 배포 도메인
const APPNAME = "k-map-router.chakra4267.workers.dev";

const NAVER_ANDROID_PKG = "com.nhn.android.nmap";
const KAKAO_ANDROID_PKG = "net.daum.android.map";

function naverQuery({ lat, lng, name }: Destination): string {
  // dname은 공식 스펙상 optional — 생략 시 네이버가 실제 주소 표시 (리터럴 placeholder 금지)
  let q = `dlat=${lat}&dlng=${lng}`;
  if (name) q += `&dname=${encodeURIComponent(name)}`;
  return `${q}&appname=${encodeURIComponent(APPNAME)}`;
}

/** iOS용 nmap 스킴. (Android는 intent:// 사용 — 파라미터 전달 보장 + 스토어 폴백 내장) */
export function naverAppUrl(dest: Destination): string {
  return `nmap://route/public?${naverQuery(dest)}`;
}

/**
 * Android Chrome 계열은 커스텀 스킴보다 intent://가 정석:
 * 파라미터가 그대로 앱 인텐트로 전달되고, 미설치면 S.browser_fallback_url로 빠진다.
 */
export function naverAndroidIntentUrl(dest: Destination): string {
  const fallback = encodeURIComponent(
    `https://play.google.com/store/apps/details?id=${NAVER_ANDROID_PKG}`,
  );
  return (
    `intent://route/public?${naverQuery(dest)}` +
    `#Intent;scheme=nmap;package=${NAVER_ANDROID_PKG};S.browser_fallback_url=${fallback};end`
  );
}

export const NAVER_IOS_STORE = "itms-apps://itunes.apple.com/app/id311867728";
export const NAVER_ANDROID_STORE_WEB = `https://play.google.com/store/apps/details?id=${NAVER_ANDROID_PKG}`;

/**
 * 데스크톱 — 네이버 웹 길찾기 (비공식 /p/directions, 좌표는 Web Mercator EPSG:3857).
 * 형식: /p/directions/{출발|-}/{x},{y},{이름}/{경유|-}/transit
 */
export function naverWebUrl(dest: Destination): string {
  const { lat, lng } = dest;
  const x = (lng * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI;
  return `https://map.naver.com/p/directions/-/${x.toFixed(7)},${y.toFixed(7)},${encodeURIComponent(webLabel(dest))}/-/transit`;
}

/** iOS용 kakaomap 스킴. sp 생략 시 현재 위치 출발. by 무시 버그 주의(보조로만). */
export function kakaoAppUrl({ lat, lng }: Destination): string {
  return `kakaomap://route?ep=${lat},${lng}&by=publictransit`;
}

export function kakaoAndroidIntentUrl(dest: Destination): string {
  const fallback = encodeURIComponent(kakaoWebUrl(dest));
  return (
    `intent://route?ep=${dest.lat},${dest.lng}&by=publictransit` +
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

/** 카카오 웹 폴백 (구형 link API). */
export function kakaoWebUrl(dest: Destination): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(webLabel(dest))},${dest.lat},${dest.lng}`;
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
export function openNaver(dest: Destination, platform: Platform): void {
  if (platform === "desktop") {
    window.open(naverWebUrl(dest), "_blank", "noopener");
  } else if (platform === "android") {
    openWithFallback(naverAndroidIntentUrl(dest), NAVER_ANDROID_STORE_WEB);
  } else {
    openWithFallback(naverAppUrl(dest), NAVER_IOS_STORE);
  }
}

export function openKakao(dest: Destination, platform: Platform): void {
  if (platform === "desktop") {
    window.open(kakaoWebUrl(dest), "_blank", "noopener");
  } else if (platform === "android") {
    openWithFallback(kakaoAndroidIntentUrl(dest), kakaoWebUrl(dest));
  } else {
    openWithFallback(kakaoAppUrl(dest), kakaoWebUrl(dest));
  }
}
