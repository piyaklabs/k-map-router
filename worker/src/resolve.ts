/**
 * 좌표/이름 추출 (CLAUDE.md §5 우선순위). 외부 의존성 0 — fetch + regex만.
 *
 * ⚠️ 이 파일의 추출 우선순위는 리포 루트 `resolve-test.mjs`(회귀 가드)와 **동일**해야 한다.
 *    바꾸려면 두 곳을 함께 고치고 `node resolve-test.mjs --selftest`를 통과시킬 것.
 */

// Workers 데이터센터 IP는 봇 의심을 받기 쉬움 → 브라우저 UA + Accept-Language 필수 (CLAUDE.md §4).
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export interface Coords {
  lat: number;
  lng: number;
  method: string;
}

/** 한국 영역 sanity check (CLAUDE.md §4). 벗어나면 의심 처리. */
export const inKorea = (lat: number, lng: number): boolean =>
  lat >= 32.5 && lat <= 39.5 && lng >= 124 && lng <= 132.5;

/**
 * 좌표 추출 — 우선순위 순으로 시도, 먼저 매칭되는 것 채택.
 * URL과 HTML 바디를 합친 텍스트에 적용한다.
 */
export function extractCoords(text: string): Coords | null {
  const mk = (latStr: string, lngStr: string, method: string): Coords | null => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, method };
  };

  // 1) place 핀 (가장 권위 있음): ...!3d{lat}!4d{lng}...
  let m = text.match(/!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/);
  if (m) { const r = mk(m[1], m[2], "data!3d!4d"); if (r) return r; }

  // 2) directions 경유점: !1d{lng}!2d{lat}  ⚠️위경도 순서 반대.
  //    여러 개면 마지막=목적지(첫 쌍=출발지). lat은 2d, lng은 1d.
  const dirPairs = [...text.matchAll(/!1d(-?\d{1,3}\.\d{3,})!2d(-?\d{1,3}\.\d{3,})/g)];
  if (dirPairs.length) {
    const last = dirPairs[dirPairs.length - 1];
    const r = mk(last[2], last[1], "dir!1d!2d");
    if (r) return r;
  }

  // 3) viewport 중심: /@{lat},{lng},17z (실측상 공유 링크 다수가 여기로 잡힘)
  m = text.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (m) { const r = mk(m[1], m[2], "@latlng"); if (r) return r; }

  // 4) Maps URLs API: ?query={lat},{lng} / ?q= / &destination= / &daddr=
  m = text.match(/[?&](?:q|query|destination|daddr)=(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/i);
  if (m) { const r = mk(m[1], m[2], "query="); if (r) return r; }

  // 5) viewport/center 파라미터: ll= / center= / sll=
  m = text.match(/[?&](?:ll|center|sll)=(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/i);
  if (m) { const r = mk(m[1], m[2], "ll="); if (r) return r; }

  // 6) 바디 임베디드 배열형: [null,null,{lat},{lng}]
  m = text.match(/\[null,null,(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/);
  if (m) { const r = mk(m[1], m[2], "array"); if (r) return r; }

  return null;
}

/** 장소명 추출 — best-effort, optional (CLAUDE.md §4: 이름은 신뢰 불가). */
export function extractName(finalUrl: string, body: string): string | null {
  const place = finalUrl.match(/\/maps\/place\/([^/@]+)/);
  if (place) {
    try {
      return decodeURIComponent(place[1].replace(/\+/g, " "));
    } catch {
      /* fallthrough */
    }
  }
  const og = body.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og) return og[1].trim();
  return null;
}

export type ResolveResult =
  | { success: true; lat: number; lng: number; name: string | null; method: string }
  | { success: false; reason: "resolve_failed" | "no_coords"; message: string };

/**
 * 링크 하나를 서버사이드에서 해소 + 좌표/이름 추출.
 * 입력 검증(invalid_input / dead_shortener)은 호출 전 index.ts에서 끝낸다.
 */
export async function resolve(url: string): Promise<ResolveResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (e) {
    return {
      success: false,
      reason: "resolve_failed",
      message: `Could not reach Google Maps: ${(e as Error).message}`,
    };
  }

  const finalUrl = res.url;
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* 바디 없이도 URL만으로 추출 시도 */
  }

  // consent/sorry 페이지로 빠진 경우: continue= 에 원본 URL이 있음 (CLAUDE.md §4)
  let nameSource = finalUrl;
  let haystack = finalUrl + "\n" + body;
  if (/consent\.google\.|\/sorry\//.test(finalUrl)) {
    const cont = finalUrl.match(/[?&]continue=([^&]+)/);
    const decoded = cont ? safeDecode(cont[1]) : "";
    nameSource = decoded;
    haystack = decoded + " " + body + " " + finalUrl;
  }

  const coords = extractCoords(haystack);
  if (!coords) {
    return {
      success: false,
      reason: "no_coords",
      message: "Could not extract location from this link. Try the search fallback.",
    };
  }

  const name = extractName(nameSource, body);
  return { success: true, lat: coords.lat, lng: coords.lng, name, method: coords.method };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
