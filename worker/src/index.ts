/**
 * Worker 엔트리 — 라우팅 + 입력 검증 + CORS (CLAUDE.md §7 API 계약).
 *
 * 경로:
 *   POST /api/resolve  → { url } 받아 좌표 해소
 *   그 외             → (Phase 3) static assets, 없으면 404
 */
import { resolve } from "./resolve";

interface Env {
  // Phase 3에서 wrangler.jsonc의 assets 바인딩으로 채워짐 (단일 origin SPA 서빙).
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

// same-origin 배포가 기본(§7)이지만, 안전하게 CORS 헤더 포함.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type FailReason = "invalid_input" | "dead_shortener" | "resolve_failed" | "no_coords";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function fail(reason: FailReason, message: string, status = 400): Response {
  return json({ success: false, reason, message }, status);
}

/**
 * 입력 검증 (프론트와 백 양쪽에서 — 여기가 권위, CLAUDE.md §7).
 * 살아있는 형태: maps.app.goo.gl/*, *.google.com|co.kr (/maps 또는 maps. 서브도메인).
 * goo.gl/maps 는 2025-08-25 폐기 → dead_shortener 거절 (CLAUDE.md §4).
 */
function validateInput(raw: unknown): { ok: true; url: string } | { ok: false; res: Response } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, res: fail("invalid_input", "Please enter a valid Google Maps share link.") };
  }
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, res: fail("invalid_input", "Please enter a valid Google Maps share link.") };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, res: fail("invalid_input", "Please enter a valid Google Maps share link.") };
  }

  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // 폐기된 단축 링크 (maps.app.goo.gl 는 살아있으므로 제외)
  if ((host === "goo.gl" || host === "www.goo.gl") && path.startsWith("/maps")) {
    return {
      ok: false,
      res: fail("dead_shortener", "This Google short link format is no longer supported."),
    };
  }

  const isShare = host === "maps.app.goo.gl";
  const isGoogleHost =
    host === "google.com" ||
    host === "google.co.kr" ||
    host.endsWith(".google.com") ||
    host.endsWith(".google.co.kr");
  const looksLikeMaps = host.startsWith("maps.") || path.includes("/maps");

  if (isShare || (isGoogleHost && looksLikeMaps)) {
    return { ok: true, url: trimmed };
  }

  return { ok: false, res: fail("invalid_input", "Please enter a valid Google Maps share link.") };
}

async function handleResolve(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("invalid_input", "Please enter a valid Google Maps share link.");
  }

  const raw = (payload as { url?: unknown } | null)?.url;
  const v = validateInput(raw);
  if (!v.ok) return v.res;

  const result = await resolve(v.url);
  if (!result.success) {
    // resolve_failed / no_coords (네트워크/추출 실패) — 502로 구분
    return json(result, 502);
  }
  return json(result, 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/resolve") {
      if (request.method !== "POST") {
        return fail("invalid_input", "Use POST with a JSON body { url }.", 405);
      }
      return handleResolve(request);
    }

    // Phase 3: 정적 자산(SPA)을 동일 origin에서 서빙
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
