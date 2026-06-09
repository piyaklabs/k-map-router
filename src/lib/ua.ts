export type Platform = "ios" | "android" | "desktop";

/** UA 기반 플랫폼 판별 (CLAUDE.md §6 프론트 실행 분기). */
export function detectPlatform(
  ua: string = navigator.userAgent,
): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+는 데스크톱 Safari UA(Macintosh)로 보고됨 → 터치 여부로 구분
  if (/Macintosh/.test(ua) && "ontouchend" in document) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}
