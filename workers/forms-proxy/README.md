# SPVH Forms Proxy

Cloudflare Worker that proxies form submissions from `spvhgroup.com` to Google Apps Script and returns real JSON status with CORS headers, so the site can gate its success UI on the actual response.

## What it does

- Enforces an Origin allowlist (only `spvhgroup.com` / `www.spvhgroup.com`).
- Rate limits per IP (5 req/minute) — optional, needs a KV binding.
- Forwards the JSON body to Apps Script following the 302 redirect that Apps Script always issues on POST.
- Returns `{ ok: true }` on success or `{ ok: false, error: "…" }` with a real HTTP status on failure.

## First-time deploy

```bash
cd workers/forms-proxy
npm install -g wrangler
wrangler login
wrangler secret put APPS_SCRIPT_URL
# paste your current Apps Script webhook URL when prompted
wrangler deploy
```

You'll get a URL like `https://spvh-forms-proxy.<your-account>.workers.dev`.
Copy it into `src/config/forms.ts` in the site repo.

## Optional: bind a subdomain

In Cloudflare dashboard → Workers & Pages → `spvh-forms-proxy` → Settings → Triggers → Add Custom Domain: `forms.spvhgroup.com`. Then use that URL in `src/config/forms.ts` instead of the `.workers.dev` one.

## Optional: enable rate limiting

```bash
wrangler kv namespace create RATE_LIMIT
```

Copy the returned `id` into `wrangler.toml` (uncomment the block), then `wrangler deploy` again.

## Rotating the Apps Script URL

```bash
wrangler secret put APPS_SCRIPT_URL
```

The site keeps pointing at the same Worker; only the upstream changes.
