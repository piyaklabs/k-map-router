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

  // 3) 모바일 길찾기 공유(g_st=…): ?geocode={b64};{b64}&daddr=이름 — 좌표가 URL 파라미터에
  //    없고 geocode= base64 protobuf에만 있음(실측 2026-06). 여러 엔트리면 마지막=목적지.
  m = text.match(/[?&]geocode=([^&\s"']+)/i);
  if (m) {
    const r = decodeGeocodeParam(m[1]);
    if (r) return { ...r, method: "geocode=" };
  }

  // 4) viewport 중심: /@{lat},{lng},17z (실측상 공유 링크 다수가 여기로 잡힘)
  m = text.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (m) { const r = mk(m[1], m[2], "@latlng"); if (r) return r; }

  // 5) Maps URLs API: ?query={lat},{lng} / ?q= / &destination= / &daddr=
  m = text.match(/[?&](?:q|query|destination|daddr)=(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/i);
  if (m) { const r = mk(m[1], m[2], "query="); if (r) return r; }

  // 6) viewport/center 파라미터: ll= / center= / sll=
  m = text.match(/[?&](?:ll|center|sll)=(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/i);
  if (m) { const r = mk(m[1], m[2], "ll="); if (r) return r; }

  // 7) 바디 임베디드 배열형: [null,null,{lat},{lng}]
  m = text.match(/\[null,null,(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/);
  if (m) { const r = mk(m[1], m[2], "array"); if (r) return r; }

  return null;
}

function geocodeEntries(raw: string): string[] {
  try {
    return decodeURIComponent(raw).split(";").filter(Boolean);
  } catch {
    return [];
  }
}

/** geocode= 마지막 엔트리(=목적지) 디코딩. */
function decodeGeocodeParam(raw: string): { lat: number; lng: number } | null {
  const entries = geocodeEntries(raw);
  return entries.length ? decodeGeocodeEntry(entries[entries.length - 1]) : null;
}

/**
 * geocode= 엔트리 디코딩 (외부 의존성 0 — atob는 Workers/Node 내장).
 * 각 엔트리는 base64url protobuf: 0x15(field2, fixed32 LE)=lat×1e6, 0x1D(field3)=lng×1e6.
 * 실측 검증: "FWFrPQIdEYSRBy…" → 37.579617, 126.977041 (경복궁).
 */
function decodeGeocodeEntry(entry: string): { lat: number; lng: number } | null {
  try {
    const bin = atob(entry.replace(/-/g, "+").replace(/_/g, "/"));
    let lat: number | null = null;
    let lng: number | null = null;
    for (let i = 0; i + 4 < bin.length && (lat === null || lng === null); i++) {
      const tag = bin.charCodeAt(i);
      if ((tag !== 0x15 || lat !== null) && (tag !== 0x1d || lng !== null)) continue;
      let v = 0;
      for (let j = 3; j >= 0; j--) v = v * 256 + bin.charCodeAt(i + 1 + j);
      if (v > 0x7fffffff) v -= 0x100000000;
      if (tag === 0x15) lat = v / 1e6;
      else lng = v / 1e6;
      i += 4;
    }
    if (lat === null || lng === null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * 출발지 추출 — 길찾기(A→B) 링크일 때만 존재. 좌표 쌍이 2개 이상이면 첫 쌍=출발지.
 * (쌍이 1개뿐이면 그게 목적지이므로 출발지 없음 → 앱이 현재 위치 사용.)
 */
export function extractOrigin(text: string): { lat: number; lng: number } | null {
  const dirPairs = [...text.matchAll(/!1d(-?\d{1,3}\.\d{3,})!2d(-?\d{1,3}\.\d{3,})/g)];
  if (dirPairs.length >= 2) {
    const lat = parseFloat(dirPairs[0][2]); // ⚠️ !2d=lat, !1d=lng (역순)
    const lng = parseFloat(dirPairs[0][1]);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
  }
  const m = text.match(/[?&]geocode=([^&\s"']+)/i);
  if (m) {
    const entries = geocodeEntries(m[1]);
    if (entries.length >= 2) return decodeGeocodeEntry(entries[0]);
  }
  return null;
}

export type TravelMode = "walk" | "transit" | "car";

/**
 * 구글맵 링크가 담은 이동수단 추출 ("구글맵 계획 그대로 점프"용).
 * - `travelmode=driving|walking|transit|bicycling` (Maps URLs API)
 * - `dirflg=d|w|r|b` (d=운전, w=도보, r=대중교통, b=자전거)
 * - `!3e0|1|2|3` (0=운전, 1=자전거, 2=도보, 3=대중교통)
 * 자전거는 미지원 모드라 무시(거리 기본값으로). 못 찾으면 null.
 */
export function extractTravelMode(text: string): TravelMode | null {
  const tm = text.match(/[?&]travelmode=(driving|walking|transit|bicycling)/i);
  if (tm) {
    const v = tm[1].toLowerCase();
    if (v === "driving") return "car";
    if (v === "walking") return "walk";
    if (v === "transit") return "transit";
    return null; // bicycling
  }
  const df = text.match(/[?&]dirflg=([a-z])/i);
  if (df) {
    const v = df[1].toLowerCase();
    if (v === "d") return "car";
    if (v === "w") return "walk";
    if (v === "r") return "transit";
    return null; // b
  }
  const e3 = text.match(/!3e([0-3])/);
  if (e3) {
    if (e3[1] === "0") return "car";
    if (e3[1] === "2") return "walk";
    if (e3[1] === "3") return "transit";
    return null; // 1 = 자전거
  }
  return null;
}

// 좌표 문자열("37.5,127.0")은 이름이 아님 → 이름 후보에서 제외
const COORD_LIKE = /^-?\d{1,3}\.\d+\s*,?\s*-?\d{1,3}\.\d+$/;

function decodeNameSegment(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw.replace(/\+/g, " ")).trim();
    if (decoded && !COORD_LIKE.test(decoded)) return decoded;
  } catch {
    /* malformed encoding → 이름 포기 */
  }
  return null;
}

/** 장소명 추출 — best-effort, optional (CLAUDE.md §4: 이름은 신뢰 불가). */
export function extractName(finalUrl: string, body: string): string | null {
  const place = finalUrl.match(/\/maps\/place\/([^/@]+)/);
  if (place) {
    const n = decodeNameSegment(place[1]);
    if (n) return n;
  }
  // /dir/ 길찾기 URL: /maps/dir/{출발지}/…/{목적지}/@… — 마지막 일반 세그먼트=목적지
  const dir = finalUrl.match(/\/maps\/dir\/([^?#]+)/);
  if (dir) {
    const segs = dir[1]
      .split("/")
      .filter((s) => s && !s.startsWith("@") && !s.startsWith("data="));
    if (segs.length) {
      const n = decodeNameSegment(segs[segs.length - 1]);
      if (n) return n;
    }
  }
  // 모바일 길찾기 공유 링크: 목적지 이름이 daddr= 에 있음
  const daddr = finalUrl.match(/[?&]daddr=([^&]+)/i);
  if (daddr) {
    const n = decodeNameSegment(daddr[1]);
    if (n) return n;
  }
  const og = body.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og) return og[1].trim();
  return null;
}

/** 출발지 이름 — /dir/ 첫 세그먼트(세그먼트 2개 이상일 때) 또는 saddr=. */
export function extractOriginName(finalUrl: string): string | null {
  const dir = finalUrl.match(/\/maps\/dir\/([^?#]+)/);
  if (dir) {
    const segs = dir[1]
      .split("/")
      .filter((s) => s && !s.startsWith("@") && !s.startsWith("data="));
    if (segs.length >= 2) {
      const n = decodeNameSegment(segs[0]);
      if (n) return n;
    }
  }
  const saddr = finalUrl.match(/[?&]saddr=([^&]+)/i);
  if (saddr) return decodeNameSegment(saddr[1]);
  return null;
}

export interface OriginOut {
  lat: number;
  lng: number;
  name: string | null;
}

export type ResolveResult =
  | {
      success: true;
      lat: number;
      lng: number;
      name: string | null;
      method: string;
      origin: OriginOut | null;
      mode: TravelMode | null;
    }
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

  // 출발지(A→B 링크): 한국 밖이거나 목적지와 같으면 버림 → 앱이 현재 위치 사용
  let origin: OriginOut | null = null;
  const o = extractOrigin(haystack);
  if (
    o &&
    inKorea(o.lat, o.lng) &&
    (Math.abs(o.lat - coords.lat) > 1e-6 || Math.abs(o.lng - coords.lng) > 1e-6)
  ) {
    origin = { ...o, name: extractOriginName(nameSource) };
  }

  return {
    success: true,
    lat: coords.lat,
    lng: coords.lng,
    name,
    method: coords.method,
    origin,
    mode: extractTravelMode(haystack),
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
