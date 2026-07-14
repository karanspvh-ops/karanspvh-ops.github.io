/**
 * SPVH Forms Proxy — Cloudflare Worker
 *
 * contact / deck / proposal  →  Resend API  →  info@spvhgroup.com (direct email)
 * application                →  Google Apps Script (needs Drive uploads + Sheet logging)
 */

const ALLOWED_ORIGINS = [
  'https://spvhgroup.com',
  'https://www.spvhgroup.com',
];

const RATE_LIMIT_MAX    = 5;
const RATE_LIMIT_WINDOW = 60;
const MAX_BODY_BYTES    = 15 * 1024 * 1024;

const TO_EMAIL   = 'info@spvhgroup.com';
const FROM_EMAIL = 'forms@spvhgroup.com';  // must be a verified Resend sender domain

// ── CORS helpers ────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ── Rate limit (KV optional) ─────────────────────────────────────────────────

async function checkRateLimit(env, ip) {
  if (!env.RATE_LIMIT) return true;
  const key = `rl:${ip}`;
  const cur = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (cur >= RATE_LIMIT_MAX) return false;
  await env.RATE_LIMIT.put(key, String(cur + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

// ── Resend email sender ──────────────────────────────────────────────────────

async function sendEmail(apiKey, { subject, html, replyTo }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:     `SPVH Group Forms <${FROM_EMAIL}>`,
      to:       [TO_EMAIL],
      reply_to: replyTo || undefined,
      subject,
      html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend ${res.status}`);
  return true;
}

// ── HTML email builders ──────────────────────────────────────────────────────

function row(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:8px 12px;font-weight:600;color:#4b5563;width:160px;vertical-align:top;white-space:nowrap">${label}</td>
    <td style="padding:8px 12px;color:#111827">${String(value).replace(/\n/g, '<br>')}</td>
  </tr>`;
}

function emailShell(title, tableRows) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:#1a2340;padding:24px 32px">
          <span style="color:#ffffff;font-size:20px;font-weight:700">SPVH Group</span>
          <span style="color:#93c5fd;font-size:14px;margin-left:12px">${title}</span>
        </td></tr>
        <tr><td style="padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
            ${tableRows}
          </table>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb">
          Submitted via spvhgroup.com
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildContactEmail(d) {
  return {
    subject: `[Contact] ${d.subject || 'New enquiry'} — ${d.name || 'Unknown'}`,
    replyTo: d.email,
    html: emailShell('New Contact Enquiry',
      row('Name',    d.name)     +
      row('Email',   d.email)    +
      row('Mobile',  d.phone)    +
      row('Company', d.company)  +
      row('Vertical',d.vertical) +
      row('Subject', d.subject)  +
      row('Message', d.message)
    ),
  };
}

function buildDeckEmail(d) {
  return {
    subject: `[Deck Request] ${d.name || 'Unknown'}`,
    replyTo: d.email,
    html: emailShell('Program Deck Request',
      row('Name',     d.name)     +
      row('Email',    d.email)    +
      row('Phone',    d.phone)    +
      row('LinkedIn', d.linkedin)
    ),
  };
}

function buildProposalEmail(d) {
  return {
    subject: `[CSR Proposal] ${d.org_name || 'Unknown Organisation'}`,
    replyTo: d.email,
    html: emailShell('CSR & Philanthropy Proposal',
      row('Organisation',   d.org_name)       +
      row('Contact Person', d.contact_person) +
      row('Email',          d.email)          +
      row('Phone',          d.phone)          +
      row('Focus Area',     d.focus_area)     +
      row('Summary',        d.summary)
    ),
  };
}

// ── Forward application to Apps Script (needs Drive + Sheets) ────────────────

async function forwardToAppsScript(target, rawBody) {
  const upstream = await fetch(target, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: rawBody,
  });
  if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
  const upstreamJson = await upstream.json().catch(() => ({}));
  if (!upstreamJson.success) throw new Error(upstreamJson.error || 'Submission rejected');
  return true;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: 'Origin not allowed' }, 403, origin);
    }

    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Payload too large' }, 413, origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await checkRateLimit(env, ip))) {
      return json({ ok: false, error: 'Too many requests. Please try again in a minute.' }, 429, origin);
    }

    let rawBody;
    try {
      rawBody = await request.text();
      if (rawBody.length > MAX_BODY_BYTES) {
        return json({ ok: false, error: 'Payload too large' }, 413, origin);
      }
    } catch {
      return json({ ok: false, error: 'Could not read body' }, 400, origin);
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400, origin);
    }

    // Honeypot
    if (data._hp_website) {
      return json({ ok: true }, 200, origin);
    }

    const formType = data._formType || 'contact';

    // Application → Apps Script (needs file uploads to Drive + Sheet logging)
    if (formType === 'application') {
      if (!env.APPS_SCRIPT_URL) {
        return json({ ok: false, error: 'Server misconfigured' }, 500, origin);
      }
      try {
        await forwardToAppsScript(env.APPS_SCRIPT_URL, rawBody);
        return json({ ok: true }, 200, origin);
      } catch (e) {
        return json({ ok: false, error: e.message }, 502, origin);
      }
    }

    // contact / deck / proposal → Resend direct email
    if (!env.RESEND_API_KEY) {
      return json({ ok: false, error: 'Server misconfigured' }, 500, origin);
    }

    let emailPayload;
    if (formType === 'contact')       emailPayload = buildContactEmail(data);
    else if (formType === 'deck')     emailPayload = buildDeckEmail(data);
    else if (formType === 'proposal') emailPayload = buildProposalEmail(data);
    else return json({ ok: false, error: 'Unknown form type' }, 400, origin);

    try {
      await sendEmail(env.RESEND_API_KEY, emailPayload);
      return json({ ok: true }, 200, origin);
    } catch (e) {
      return json({ ok: false, error: e.message }, 502, origin);
    }
  },
};
