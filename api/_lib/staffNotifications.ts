import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./auth.js";
import { sendStaffEmail } from "./resend.js";
import { env } from "./env.js";
import type { Channel, ContentRequestRow } from "../../shared/types.js";

// Staff emails live in Supabase Auth, not the `staff` table (which only
// has user_id/role/display_name) — the admin API is the only way to
// read them, hence supabaseAdmin specifically (the anon/RLS client
// can't call .auth.admin.*).
async function emailForUser(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

function requestTitle(request: ContentRequestRow): string {
  return request.short_title ?? request.idea;
}

function dashboardLink(path: string): string {
  return env.appUrl ? `\n\nOpen your dashboard: ${env.appUrl}${path}` : "";
}

/**
 * Best-effort: a failed or skipped notification is logged (to `events`,
 * for visibility on the request's Events tab, and to console for
 * server logs) but never thrown — a broken email must not block the
 * pipeline transition it's reporting on. `stage` is whatever the
 * request's stage is at the moment of the call, purely for the event
 * row; it's not re-derived here.
 */
async function notify(
  supabase: SupabaseClient,
  requestId: string,
  stage: string,
  event: string,
  userId: string,
  subject: string,
  body: string,
): Promise<void> {
  const email = await emailForUser(userId);
  if (!email) {
    console.error(`[staffNotifications] No email on file for staff user ${userId} — skipped "${subject}".`);
    await supabase.from("events").insert({
      request_id: requestId,
      stage,
      event,
      ok: false,
      detail: { userId, subject, reason: "no email on file for this staff user" },
    });
    return;
  }

  const result = await sendStaffEmail(email, subject, body);
  if (!result.ok) {
    console.error(`[staffNotifications] Failed to send "${subject}" to ${email}: ${result.error}`);
  }
  await supabase.from("events").insert({
    request_id: requestId,
    stage,
    event,
    ok: result.ok,
    detail: result.ok ? { to: email, subject, resendId: result.id } : { to: email, subject, error: result.error },
  });
}

/** Every staff member with role 'reviewer' — there's no per-request reviewer assignment, so all of them get notified. */
async function loadReviewerIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from("staff").select("user_id").eq("role", "reviewer");
  if (error || !data) return [];
  return data.map((r) => r.user_id as string);
}

async function notifyAllReviewers(
  supabase: SupabaseClient,
  requestId: string,
  stage: string,
  event: string,
  subject: string,
  body: string,
): Promise<void> {
  const reviewerIds = await loadReviewerIds();
  if (reviewerIds.length === 0) {
    console.error("[staffNotifications] No staff with role 'reviewer' to notify.");
    await supabase.from("events").insert({
      request_id: requestId,
      stage,
      event,
      ok: false,
      detail: { reason: "no reviewers on staff" },
    });
    return;
  }

  await Promise.all(reviewerIds.map((userId) => notify(supabase, requestId, stage, event, userId, subject, body)));
}

/**
 * Fires once channel outputs (LinkedIn/X/newsletter) are generated and
 * waiting for per-channel sign-off — see adapt.ts, the only caller.
 */
export async function notifyReviewersOfChannelsReady(supabase: SupabaseClient, request: ContentRequestRow): Promise<void> {
  const title = requestTitle(request);
  await notifyAllReviewers(
    supabase,
    request.id,
    "adapting",
    "reviewer_notification",
    `Channel outputs ready for review: ${title}`,
    `The LinkedIn, X, and newsletter versions of "${title}" are ready for your review.${dashboardLink(`/review/${request.id}`)}`,
  );
}

/**
 * Fires after a manager runs an AI revision for a single channel output
 * (see api/channelReview.ts's revise_with_ai action) — the reviewer
 * needs to know to come back and re-check that one channel, same as
 * they were notified the first time it was ready.
 */
export async function notifyReviewersOfChannelRevision(
  supabase: SupabaseClient,
  request: ContentRequestRow,
  channel: Channel,
): Promise<void> {
  const title = requestTitle(request);
  await notifyAllReviewers(
    supabase,
    request.id,
    "adapting",
    "reviewer_notification",
    `${channel} revised, ready to re-review: ${title}`,
    `The ${channel} version of "${title}" was revised and needs another look.${dashboardLink(`/review/${request.id}`)}`,
  );
}

const CHANNEL_DECISION_COPY: Record<"approved" | "revise", { subjectVerb: string; bodyVerb: string }> = {
  approved: { subjectVerb: "Approved", bodyVerb: "approved" },
  revise: { subjectVerb: "Sent back for revision", bodyVerb: "sent back for revision" },
};

/**
 * Fires after a reviewer approves or sends back a single channel output
 * — see api/channelReview.ts's approve/revise actions — to the manager
 * who created the request.
 */
export async function notifyManagerOfChannelDecision(
  supabase: SupabaseClient,
  request: ContentRequestRow,
  channel: Channel,
  decision: "approved" | "revise",
  comment: string | null,
): Promise<void> {
  const title = requestTitle(request);
  const copy = CHANNEL_DECISION_COPY[decision];
  const subject = `${copy.subjectVerb} (${channel}): ${title}`;
  const body = [
    `The ${channel} version of "${title}" was ${copy.bodyVerb} by the reviewer.`,
    comment ? `\nReviewer's note: ${comment}` : null,
    dashboardLink(`/request/${request.id}`),
  ]
    .filter(Boolean)
    .join("\n");

  await notify(supabase, request.id, "adapting", "manager_notification", request.created_by, subject, body);
}
