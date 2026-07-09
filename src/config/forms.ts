/**
 * Forms endpoint.
 *
 * Point this at the Cloudflare Worker that proxies to Google Apps Script.
 * The worker returns a real JSON response with { ok: true } on success and
 * proper CORS headers, so the site can gate its success UI on the actual result.
 *
 * To deploy: see workers/forms-proxy/README.md
 * After first deploy, replace this URL with the worker's URL, either:
 *   - https://spvh-forms-proxy.<your-account>.workers.dev
 *   - https://forms.spvhgroup.com   (if you bind a custom domain)
 */
export const FORMS = {
  endpoint: 'https://spvh-forms-proxy.spventures-inv.workers.dev',
} as const;
