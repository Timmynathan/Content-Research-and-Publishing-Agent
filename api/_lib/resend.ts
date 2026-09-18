import { Resend } from "resend";
import { env } from "./env.js";
import { buildNewsletterHtml } from "./emailTemplate.js";

let client: Resend | null = null;

function getClient(): Resend {
  if (!client) {
    client = new Resend(env.resendApiKey);
  }
  return client;
}

export interface SendResult {
  ok: true;
  id: string;
}

export interface SendFailure {
  ok: false;
  error: string;
}

async function sendEmail(to: string, subject: string, body: string): Promise<SendResult | SendFailure> {
  try {
    const result = await getClient().emails.send({
      from: env.resendFrom,
      to,
      subject,
      text: body,
      html: buildNewsletterHtml(subject, body),
    });

    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    if (!result.data?.id) {
      return { ok: false, error: "Resend returned no error but also no message id." };
    }
    return { ok: true, id: result.data.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Always sends to the configured test recipient — never a real subscriber list. */
export async function sendNewsletter(subject: string, body: string): Promise<SendResult | SendFailure> {
  return sendEmail(env.resendTestRecipient, subject, body);
}

/**
 * An internal ops notification to one staff member's real address (from
 * Supabase Auth — see _lib/staffNotifications.ts), not a newsletter
 * subscriber — sending to their actual inbox is the point, unlike
 * sendNewsletter above. Note this still goes through the same Resend
 * account: on a sandbox/no-verified-domain setup, Resend itself will
 * only actually deliver to the account owner's verified address
 * regardless of what's passed here.
 */
export async function sendStaffEmail(to: string, subject: string, body: string): Promise<SendResult | SendFailure> {
  return sendEmail(to, subject, body);
}
