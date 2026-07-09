/**
 * SPVH Forms Proxy — Cloudflare Worker
 *
 * Purpose: sit between the browser and Google Apps Script so the site can
 * gate its success UI on the real submission result instead of `no-cors`.
 *
 * Also gets us:
 *   - Real CORS with an allowlist (only spvhgroup.com origins)
 *   - Origin/Referer check against opportunistic curl scripts
 *   - Rate limit per IP via Workers KV (optional, enabled if RATE_LIMIT KV bound)
 *   - Small JSON envelope with { ok, error } the site can trust
 */

const ALLOWED_ORIGINS = [
  'https://spvhgroup.com',
  'https://www.spvhgroup.com',
];

// Rate limit: max N requests per IP per window (seconds)
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60;

// Max request body size in bytes (15 MB — covers a 10 MB PDF base64-encoded ~13.3 MB)
const MAX_BODY_BYTES = 15 * 1024 * 1024;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

async function checkRateLimit(env, ip) {
  if (!env.RATE_LIMIT) return true; // KV not bound, skip
  const key = `rl:${ip}`;
  const cur = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (cur >= RATE_LIMIT_MAX) return false;
  await env.RATE_LIMIT.put(key, String(cur + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, origin);
    }

    // Origin allowlist
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: 'Origin not allowed' }, 403, origin);
    }

    // Size cap
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Payload too large' }, 413, origin);
    }

    // Rate limit
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await checkRateLimit(env, ip))) {
      return json({ ok: false, error: 'Too many requests. Please try again in a minute.' }, 429, origin);
    }

    // Apps Script endpoint is set via env secret so rotation is a wrangler command
    const target = env.APPS_SCRIPT_URL;
    if (!target) {
      return json({ ok: false, error: 'Server misconfigured' }, 500, origin);
    }

    let body;
    try {
      body = await request.text();
      if (body.length > MAX_BODY_BYTES) {
        return json({ ok: false, error: 'Payload too large' }, 413, origin);
      }
    } catch (e) {
      return json({ ok: false, error: 'Could not read body' }, 400, origin);
    }

    // Forward to Apps Script. `redirect: 'follow'` handles the 302 that Apps Script
    // always issues on POST — the browser can't follow it cross-origin with CORS,
    // but the Worker's fetch has no such restriction.
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
      });
    } catch (e) {
      return json({ ok: false, error: 'Upstream unreachable' }, 502, origin);
    }

    if (!upstream.ok) {
      return json({ ok: false, error: `Upstream returned ${upstream.status}` }, 502, origin);
    }

    // Apps Script returns JSON like { success: true }. Normalize to { ok: true }.
    let upstreamJson;
    try {
      upstreamJson = await upstream.json();
    } catch (e) {
      return json({ ok: false, error: 'Upstream returned malformed response' }, 502, origin);
    }

    if (upstreamJson && upstreamJson.success) {
      return json({ ok: true }, 200, origin);
    }

    return json(
      { ok: false, error: (upstreamJson && upstreamJson.error) || 'Submission rejected' },
      400,
      origin,
    );
  },
};
