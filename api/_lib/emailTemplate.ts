import { env } from "./env.js";

// Branded HTML wrapper for the newsletter, used by _lib/resend.ts.
//
// The logo is a hosted https:// URL, not an embedded base64 data URI —
// a data URI was tried first so this would render regardless of whether
// the app was deployed yet, but several mail clients (notably Outlook's
// Word rendering engine, and any client with embedded images blocked by
// default) never render a data-URI <img> at all, no matter how it's
// encoded. A real URL is the version of this that actually renders
// across mail clients. Hosted in a public Supabase Storage bucket
// (created for exactly this — see supabase dashboard, bucket
// "public-assets") rather than requiring this app itself to be deployed
// just to serve one static image.
const LOGO_URL = `${env.supabaseUrl}/storage/v1/object/public/public-assets/logo.png`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildNewsletterHtml(subject: string, body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");

  return `<!--[if mso]><table role="presentation" width="100%"><tr><td><![endif]-->
<div style="background:#f7f7f5; padding:32px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #e0e0dc; border-radius:10px; overflow:hidden;">
    <div style="background:#2a3b19; padding:20px 24px;">
      <!--
        Table + an explicit white text wordmark, not just an <img alt>:
        some mail clients still don't load remote images by default
        until the recipient clicks "show images" — alt="" here so a
        not-yet-loaded image shows nothing rather than a broken-icon
        placeholder; the wordmark next to it is real text, not a
        fallback, so it's always visible immediately regardless.
      -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:middle;">
            <img src="${LOGO_URL}" width="40" height="40" alt="" style="display:block; border-radius:8px;" />
          </td>
          <td style="vertical-align:middle; padding-left:12px;">
            <span style="color:#ffffff; font-size:18px; font-weight:600; line-height:1;">Content Agent</span>
          </td>
        </tr>
      </table>
    </div>
    <div style="padding:28px 24px; color:#1a1a18; font-size:15px; line-height:1.65;">
      <h1 style="margin:0 0 18px; font-size:20px; line-height:1.35; color:#1a1a18;">${escapeHtml(subject)}</h1>
      ${paragraphs}
    </div>
    <div style="padding:16px 24px; border-top:1px solid #e0e0dc; color:#8a8a82; font-size:12px;">
      Sent via Content Agent.
    </div>
  </div>
</div>
<!--[if mso]></td></tr></table><![endif]-->`;
}
