# K-Map Router

**Turn Google Maps links into Naver / Kakao directions — built for travelers in Korea.**

🌐 Live: https://kmap.piyaklabs.com

Google Maps can't give walking or transit navigation in Korea (map-data export
restrictions). Locals use Naver Map and KakaoMap instead — but copying a place
name from Google into a Korean map app by hand is painful for visitors.
K-Map Router reduces that to **paste one link → tap one button**.

## How to use

1. In Google Maps, share any place or route → **Copy link**.
2. Open K-Map Router and tap **Paste from clipboard** (or paste manually).
3. Tap **Open in NAVER Map** (recommended) or **Open in KakaoMap**.

That's it. The right app opens with the destination — and the route — filled in.

- **Place links** route from your current location.
- **A→B directions links** keep the original start point. Tap **✕** next to
  "From …" if you'd rather start from where you are.
- No app? You're sent to the App Store / Play Store or the map's website.
- Desktop works too: buttons open Naver / Kakao web directions in a new tab.

### Supported links

| Input | Status |
|---|---|
| `maps.app.goo.gl/…` (share links) | ✅ |
| `google.com/maps/…`, `google.co.kr/maps/…` (full URLs, incl. `/dir/`) | ✅ |
| Mobile-app directions shares (`…?g_st=…`) | ✅ |
| `goo.gl/maps/…` | ❌ discontinued by Google (2025-08) — rejected with a clear message |

## API

`POST /api/resolve` with `{ "url": "<google maps link>" }`:

```json
{
  "success": true,
  "lat": 37.579617, "lng": 126.977041,
  "name": "경복궁 서울특별시 종로구 사직로 161",
  "origin": { "lat": 37.556074, "lng": 126.971873, "name": "서울역 …" },
  "method": "dir!1d!2d"
}
```

`name` and `origin` are best-effort and may be `null`. Errors return
`{ "success": false, "reason": "invalid_input" | "dead_shortener" | "resolve_failed" | "no_coords", "message": "…" }`.

## Architecture

- **Single Cloudflare Worker** serving both the React SPA (static assets
  binding) and `/api/resolve` — same origin, free tier, zero external
  dependencies (coordinate extraction is fetch + regex/decoding only).
- **Stateless.** Nothing is stored — no DB, no cookies, no localStorage.
- Coordinate resolution happens server-side (browser → Google is blocked by
  CORS); the Worker follows redirects with a browser UA and applies seven
  extraction strategies in priority order (see `CLAUDE.md` §5).
- Frontend: React 19 + Vite + Tailwind CSS v4, mobile-first, English UI.

```
worker/src/        Worker entry + coordinate/name extraction
src/               React SPA (components, deep-link builders, UA branching)
resolve-test.mjs   offline regression guard for extraction (9 cases)
verify-deployed.mjs  measures live success rate through the deployed API
docs/              PRD, progress/handoff notes
```

## Development

```bash
npm install
npm run dev        # local dev (Vite + workerd, same-origin /api)
npm run selftest   # extraction regression tests (expect 9/9)
npm run typecheck
npm run deploy     # typecheck + build + wrangler deploy
node verify-deployed.mjs links.txt   # live success-rate check (one URL per line)
```

Hard-won implementation facts (coordinate formats per URL type, deep-link
quirks, clipboard/iOS gotchas) are recorded in `CLAUDE.md` — read it before
touching extraction or deep-link code.
