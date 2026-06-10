#!/usr/bin/env node
/**
 * K-Map Router — 배포 엔드포인트 실측 검증 (Phase 2 게이트)
 *
 * 목적: 배포된 Worker(`/api/resolve`)를 "경유"해 좌표 추출 성공률을 잰다.
 *       resolve-test.mjs는 구글에 직접 fetch라 로컬 IP로 테스트되지만,
 *       이 스크립트는 Cloudflare 데이터센터 IP에서 구글이 봇/consent를
 *       주는지까지 포함한 "진짜 배포 환경" 성공률을 측정한다.
 *
 * 사용법:
 *   1) links.txt 에 실제 구글맵 공유 링크를 한 줄에 하나씩 (20~30개 권장,
 *      맛집/핀드롭/호텔 + /dir/ 길찾기 링크를 섞을 것).
 *   2) node verify-deployed.mjs                  # 기본 배포 URL 사용
 *      node verify-deployed.mjs links.txt        # 링크 파일 지정
 *      ENDPOINT=https://... node verify-deployed.mjs   # 엔드포인트 오버라이드
 *
 * 판단 기준(PROGRESS.md): 성공률 90%+ → 명세대로 진행 /
 *   70~90% → 이름검색 폴백 필수 / <70% → 설계 재검토.
 */

import { readFileSync } from "node:fs";

const ENDPOINT =
  process.env.ENDPOINT ||
  "https://k-map-router.chakra4267.workers.dev/api/resolve";

const inKorea = (lat, lng) =>
  lat >= 32.5 && lat <= 39.5 && lng >= 124 && lng <= 132.5;

async function resolveViaWorker(url) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      return { httpError: res.status, raw: "(non-JSON response)" };
    }
    return { status: res.status, data };
  } catch (e) {
    return { fetchError: e.message };
  }
}

const file = process.argv[2] || "links.txt";
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

console.log(`=== DEPLOYED VERIFY: ${links.length}개 링크 ===`);
console.log(`endpoint: ${ENDPOINT}\n`);

const methodCount = {};
const reasonCount = {};
let success = 0, fail = 0, outOfKorea = 0;

for (const link of links) {
  const r = await resolveViaWorker(link);

  if (r.fetchError) {
    fail++;
    console.log(`❌ NET-ERR  ${link}\n     ${r.fetchError}\n`);
  } else if (r.data && r.data.success) {
    success++;
    const { lat, lng, name, method, origin } = r.data;
    methodCount[method] = (methodCount[method] || 0) + 1;
    const flag = inKorea(lat, lng) ? "" : "  ⚠️한국영역밖";
    if (flag) outOfKorea++;
    console.log(`✅ OK     ${link}`);
    console.log(`     coord: ${lat}, ${lng}  [${method}]${flag}`);
    console.log(`     name : ${name || "(없음)"}`);
    if (origin) {
      console.log(`     from : ${origin.name || "(이름없음)"} @ ${origin.lat}, ${origin.lng}`);
    }
    console.log("");
  } else {
    fail++;
    const reason = (r.data && r.data.reason) || `http_${r.status}`;
    reasonCount[reason] = (reasonCount[reason] || 0) + 1;
    console.log(`⚠️  FAIL  ${link}`);
    console.log(`     reason: ${reason}  (HTTP ${r.status})`);
    console.log(`     msg   : ${(r.data && r.data.message) || ""}\n`);
  }
  await new Promise((res) => setTimeout(res, 400)); // 과한 요청 방지
}

const total = links.length;
const rate = ((success / total) * 100).toFixed(1);
console.log("─".repeat(60));
console.log(`성공(좌표추출): ${success}/${total}  (${rate}%)`);
console.log(`실패: ${fail}/${total}`);
if (outOfKorea) console.log(`⚠️ 한국영역 밖 좌표: ${outOfKorea}건 (오추출 의심)`);
console.log("전략별 분포:", JSON.stringify(methodCount));
console.log("실패 사유별 :", JSON.stringify(reasonCount));
console.log(
  "\n판단 기준: 90%+ → 명세대로 진행 / 70~90% → 이름검색 폴백 필수 / <70% → 설계 재검토",
);
console.log(
  "※ 실패 사유에 resolve_failed/no_coords가 몰리고 한국밖 좌표가 잦으면 = " +
  "데이터센터 IP에서 구글이 consent/봇 페이지를 주는 신호.",
);
