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

/** nmap://route/public — appname 필수, 이름 없으면 dname 생략(네이버가 실제 주소 표시). */
export function naverAppUrl({ lat, lng, name }: Destination): string {
  let url = `nmap://route/public?dlat=${lat}&dlng=${lng}`;
  if (name) url += `&dname=${encodeURIComponent(name)}`;
  return `${url}&appname=${encodeURIComponent(APPNAME)}`;
}

export const NAVER_STORE: Record<Exclude<Platform, "desktop">, string> = {
  ios: "itms-apps://itunes.apple.com/app/id311867728",
  android: "market://details?id=com.nhn.android.nmap",
};

/** 데스크톱 폴백 — 네이버 웹 길찾기 URL은 비공식·변동 잦음 → 좌표/이름 검색으로. */
export function naverWebUrl({ lat, lng, name }: Destination): string {
  const q = encodeURIComponent(name ?? `${lat},${lng}`);
  return `https://map.naver.com/p/search/${q}`;
}

/** kakaomap://route — sp 생략 시 현재 위치 출발. by 무시 버그 주의(보조로만). */
export function kakaoAppUrl({ lat, lng }: Destination): string {
  return `kakaomap://route?ep=${lat},${lng}&by=publictransit`;
}

/** 카카오 웹 폴백 (구형 link API — 동작 수동확인됨). */
export function kakaoWebUrl({ lat, lng, name }: Destination): string {
  const enc = encodeURIComponent(name ?? `${lat},${lng}`);
  return `https://map.kakao.com/link/to/${enc},${lat},${lng}`;
}

/**
 * 앱 스킴 시도 → timeoutMs 내 화면 전환이 없으면(앱 미설치) 폴백 URL로 이동.
 * 앱으로 전환되면 pagehide/visibilitychange가 먼저 발생해 폴백을 취소한다.
 */
export function openWithFallback(
  appUrl: string,
  fallbackUrl: string,
  timeoutMs = 1600,
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
