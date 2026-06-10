#!/usr/bin/env node
/**
 * K-Map Router — 좌표 추출 검증 스파이크 (no dependencies, Node 18+)
 *
 * 목적: maps.app.goo.gl 단축 링크를 서버사이드에서 풀어 위경도를 얼마나
 *       안정적으로 뽑아낼 수 있는지 "실측"한다. 제품 코드 작성 전 리스크 측정용.
 *
 * 사용법:
 *   1) 오프라인 자가 테스트(추출 로직만 검증, 네트워크 불필요):
 *        node resolve-test.mjs --selftest
 *   2) 실제 링크로 라이브 테스트:
 *        - links.txt 파일에 실제 구글맵 공유 링크를 한 줄에 하나씩 붙여넣기
 *          (맛집/카페/지하철역/핀드롭/호텔 등 유형을 섞어 20~30개 권장)
 *        - node resolve-test.mjs links.txt
 *
 * 출력: 링크별 (최종 URL / placeName / lat,lng / 성공한 추출 전략 / 실패),
 *       그리고 전체 성공률과 전략별 분포. 끝에 네이버/카카오 딥링크도 생성해
 *       폰에서 직접 탭 테스트할 수 있게 한다.
 */

import { readFileSync } from "node:fs";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const APPNAME = "com.kmaprouter.web"; // 네이버 스킴 필수 식별자 (배포 시 본인 도메인으로)

// 한국 영역 sanity check (네이버 허용범위 기반, 살짝 여유): 벗어나면 의심으로 표시
const inKorea = (lat, lng) =>
  lat >= 32.5 && lat <= 39.5 && lng >= 124 && lng <= 132.5;

/**
 * 좌표 추출 — 우선순위 순으로 여러 전략을 시도.
 * URL과 HTML 바디를 합친 텍스트에 적용한다.
 * 반환: { lat, lng, method } | null
 */
function extractCoords(text) {
  const mk = (latStr, lngStr, method) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, method };
  };

  // 우선순위 순(CLAUDE.md §5). 먼저 매칭되는 것 채택.

  // 1) place 핀 (가장 권위 있음): ...!3d{lat}!4d{lng}...
  let m = text.match(/!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/);
  if (m) { const r = mk(m[1], m[2], "data!3d!4d"); if (r) return r; }

  // 2) directions 경유점: !1d{lng}!2d{lat}  ⚠️위경도 순서 반대.
  //    여러 개면 마지막=목적지(첫 쌍=출발지). lat은 2d, lng은 1d 임에 주의.
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

  // 4) viewport 중심: /@{lat},{lng},17z  (실측상 공유 링크 다수가 여기로 잡힘)
  m = text.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);
  if (m) { const r = mk(m[1], m[2], "@latlng"); if (r) return r; }

  // 5) Maps URLs API: ?query={lat},{lng} / ?q= / &destination= / &daddr=
  m = text.match(/[?&](?:q|query|destination|daddr)=(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/i);
  if (m) { const r = mk(m[1], m[2], "query="); if (r) return r; }

  // 6) viewport/center 파라미터: ll= / center= / sll=
  m = text.match(/[?&](?:ll|center|sll)=(-?\d{1,3}\.\d{3,})(?:,|%2C)(-?\d{1,3}\.\d{3,})/i);
  if (m) { const r = mk(m[1], m[2], "ll="); if (r) return r; }

  // 7) 바디 임베디드 배열형: [null,null,{lat},{lng}] (APP_INITIALIZATION_STATE 등)
  m = text.match(/\[null,null,(-?\d{1,3}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/);
  if (m) { const r = mk(m[1], m[2], "array"); if (r) return r; }

  return null;
}

/**
 * geocode= 엔트리 디코딩 (Worker resolve.ts와 동일 로직 유지).
 * base64url protobuf: 0x15(field2, fixed32 LE)=lat×1e6, 0x1D(field3)=lng×1e6.
 */
function decodeGeocodeParam(raw) {
  try {
    const entries = decodeURIComponent(raw).split(";").filter(Boolean);
    const last = entries[entries.length - 1]; // 마지막=목적지
    if (!last) return null;
    const bin = atob(last.replace(/-/g, "+").replace(/_/g, "/"));
    let lat = null, lng = null;
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

/** 장소명 추출 — URL의 /place/<name>/ 또는 og:title 메타태그 */
function extractName(finalUrl, body) {
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

/** 링크 하나 해소 + 추출 */
async function resolveOne(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const finalUrl = res.url;
    const body = await res.text();

    // 동의(consent) 페이지로 빠진 경우: continue= 파라미터에 원본 URL이 있음
    if (/consent\.google\.|\/sorry\//.test(finalUrl)) {
      const cont = finalUrl.match(/[?&]continue=([^&]+)/);
      const decoded = cont ? decodeURIComponent(cont[1]) : "";
      const coords = extractCoords(decoded + " " + body + " " + finalUrl);
      return {
        url, finalUrl, status: res.status,
        warn: "consent/sorry page (봇 의심 — 실제 서버에선 UA/IP 조정 필요)",
        coords, name: extractName(decoded, body),
      };
    }

    const haystack = finalUrl + "\n" + body;
    const coords = extractCoords(haystack);
    const name = extractName(finalUrl, body);
    return { url, finalUrl, status: res.status, coords, name };
  } catch (e) {
    return { url, error: e.message };
  }
}

/** 네이버/카카오 딥링크 생성 (검증된 공식 스펙 기준) */
function buildDeepLinks(lat, lng, name) {
  const enc = encodeURIComponent(name || "Destination");
  return {
    naverApp: `nmap://route/public?dlat=${lat}&dlng=${lng}&dname=${enc}&appname=${APPNAME}`,
    // 카카오: by=publictransit는 현재 앱에서 car로 무시되는 버그 보고됨
    kakaoApp: `kakaomap://route?ep=${lat},${lng}&by=publictransit`,
    kakaoWeb: `https://map.kakao.com/link/to/${enc},${lat},${lng}`, // 구형 link API, 동작 수동확인 필요
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 오프라인 자가 테스트: 알려진 URL/바디 샘플로 추출 로직 검증 (네트워크 불필요)
// ─────────────────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    { t: "https://www.google.com/maps/place/Gyeongbokgung/@37.5796,126.9770,17z", exp: [37.5796, 126.977] },
    { t: "...data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d37.5512!4d126.9882", exp: [37.5512, 126.9882] },
    { t: "https://www.google.com/maps/search/?api=1&query=37.5665,126.9780", exp: [37.5665, 126.978] },
    { t: "https://maps.google.com/?ll=37.5172,127.0473&z=16", exp: [37.5172, 127.0473] },
    { t: 'junk[null,null,37.5145,127.1059]morejunk', exp: [37.5145, 127.1059] },
    // directions(/dir/): !1d{lng}!2d{lat} 역순. 여러 쌍이면 마지막=목적지.
    { t: "https://www.google.com/maps/dir/?...!4m2!1d126.9706!2d37.5547!1m0!1d126.9770!2d37.5796", exp: [37.5796, 126.977] },
    // directions가 @뷰포트보다 우선해야 함(§5 #2 > #3): 둘 다 있으면 목적지를 잡아야 함.
    { t: "https://www.google.com/maps/dir/A/B/@37.5000,127.0000,12z/data=!4m2!1d126.9770!2d37.5796", exp: [37.5796, 126.977] },
    { t: "https://www.google.com/maps/place/Some+Cafe/data=just-an-address-no-coords", exp: null },
    // 모바일 길찾기 공유(g_st=ic): 좌표가 geocode= base64 protobuf에만 있음.
    // 실링크(경복궁) 실측값. 두 엔트리(출발;도착) 중 마지막=목적지.
    { t: "https://www.google.com/maps?geocode=FWoPPQId4W-RByl1kF5PmKN8NTEjt2zW3vqoGw%3D%3D;FWFrPQIdEYSRBymh3u1Kx6J8NTH2FccsU0Ywiw%3D%3D&daddr=Gyeongbokgung+Palace,+161+Sajik-ro&saddr=Seoul+Station&dirflg=r", exp: [37.579617, 126.977041] },
  ];
  let pass = 0;
  console.log("=== OFFLINE SELF-TEST (추출 로직) ===");
  for (const c of cases) {
    const r = extractCoords(c.t);
    const ok = c.exp === null
      ? r === null
      : r && Math.abs(r.lat - c.exp[0]) < 1e-6 && Math.abs(r.lng - c.exp[1]) < 1e-6;
    if (ok) pass++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  [${r ? r.method : "none"}]  ` +
      `${r ? `${r.lat},${r.lng}` : "null"}  <-  ${c.t.slice(0, 60)}`,
    );
  }
  console.log(`\n${pass}/${cases.length} passed\n`);
  // 딥링크 생성 예시도 같이 보여줌
  const dl = buildDeepLinks(37.5512, 126.9882, "경복궁");
  console.log("=== 딥링크 생성 예시 ===");
  console.log("naverApp :", dl.naverApp);
  console.log("kakaoApp :", dl.kakaoApp, "  (※ by=publictransit 무시 버그 주의)");
  console.log("kakaoWeb :", dl.kakaoWeb);
}

// ─────────────────────────────────────────────────────────────────────────
async function liveTest(file) {
  let links;
  try {
    links = readFileSync(file, "utf8")
      .split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    console.error(`'${file}' 를 읽을 수 없습니다. 링크를 한 줄에 하나씩 넣어주세요.`);
    process.exit(1);
  }
  if (links.length === 0) {
    console.error("링크가 비어 있습니다.");
    process.exit(1);
  }

  console.log(`=== LIVE TEST: ${links.length}개 링크 ===\n`);
  const methodCount = {};
  let success = 0, suspicious = 0;

  for (const link of links) {
    const r = await resolveOne(link);
    if (r.error) {
      console.log(`❌ ERROR  ${link}\n     ${r.error}\n`);
      continue;
    }
    if (r.coords) {
      success++;
      methodCount[r.coords.method] = (methodCount[r.coords.method] || 0) + 1;
      const { lat, lng } = r.coords;
      const flag = inKorea(lat, lng) ? "" : "  ⚠️한국영역밖";
      console.log(`✅ OK     ${link}`);
      console.log(`     name : ${r.name || "(없음)"}`);
      console.log(`     coord: ${lat}, ${lng}  [${r.coords.method}]${flag}`);
      if (r.warn) console.log(`     ⚠️  ${r.warn}`);
      const dl = buildDeepLinks(lat, lng, r.name);
      console.log(`     naver: ${dl.naverApp}`);
      console.log(`     kakao: ${dl.kakaoApp}\n`);
    } else {
      suspicious++;
      console.log(`⚠️  MISS  ${link}`);
      console.log(`     final: ${(r.finalUrl || "").slice(0, 90)}`);
      if (r.warn) console.log(`     ${r.warn}`);
      console.log(`     name : ${r.name || "(없음)"}  → 좌표추출 실패, 이름검색 폴백 필요\n`);
    }
    await new Promise((res) => setTimeout(res, 400)); // 과한 요청 방지
  }

  const total = links.length;
  console.log("─".repeat(60));
  console.log(`성공(좌표추출): ${success}/${total}  (${((success / total) * 100).toFixed(1)}%)`);
  console.log(`실패(이름검색 폴백 필요): ${suspicious}/${total}`);
  console.log("전략별 분포:", JSON.stringify(methodCount));
  console.log("\n판단 기준: 성공률 90%+ → 명세대로 진행 / 70~90% → 이름검색 폴백 필수 / <70% → 설계 재검토");
}

// 엔트리포인트
const arg = process.argv[2];
if (!arg || arg === "--selftest") {
  selfTest();
} else {
  liveTest(arg);
}
