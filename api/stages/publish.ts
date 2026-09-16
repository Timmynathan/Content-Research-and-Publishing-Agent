import { StageError } from "../_lib/errors.js";
import { sendNewsletter } from "../_lib/resend.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { ApprovalRow, ChannelOutputRow, PublishQueueRow } from "../../shared/types.js";

/**
 * Stage handler for 'queued' -> 'published'.
 *
 * Only the newsletter is actually sent (via Resend, to a fixed test
 * recipient — never a real subscriber list). LinkedIn and X queue items
 * are left exactly as 'queued': this system never fakes a posted state
 * for a channel that doesn't have a posting integration — they stay
 * clearly "awaiting posting" until a human posts them elsewhere.
 *
 * content_requests.stage reaching 'published' means the publish STEP
 * ran, not that every channel is live — publish_queue.status is what's
 * authoritative per item, and is what the Queue page shows.
 */
export async function publishContent(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: approval, error: approvalError } = await supabase
    .from("approvals")
    .select("*")
    .eq("request_id", request.id)
    .eq("decision", "approved")
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle<ApprovalRow>();
  if (approvalError) throw new StageError(`Failed to load approval: ${approvalError.message}`);
  if (!approval) throw new StageError("No approved decision found for this request.");

  const { data: outputs, error: outputsError } = await supabase
    .from("channel_outputs")
    .select("*")
    .eq("draft_id", approval.draft_id)
    .returns<ChannelOutputRow[]>();
  if (outputsError) throw new StageError(`Failed to load channel outputs: ${outputsError.message}`);

  const newsletterOutput = (outputs ?? []).find((o) => o.channel === "newsletter");
  if (!newsletterOutput) {
    // No newsletter output (e.g. it never validated, so queue.ts never
    // queued it) — nothing to send, but LinkedIn/X can still be
    // legitimately sitting in the queue awaiting manual posting.
    return { nextStage: "published", detail: { newsletterSent: false, reason: "no valid newsletter output" } };
  }

  const { data: queueItem, error: queueError } = await supabase
    .from("publish_queue")
    .select("*")
    .eq("channel_output_id", newsletterOutput.id)
    .maybeSingle<PublishQueueRow>();
  if (queueError) throw new StageError(`Failed to load newsletter queue item: ${queueError.message}`);
  if (!queueItem) {
    return { nextStage: "published", detail: { newsletterSent: false, reason: "newsletter was never queued" } };
  }

  if (queueItem.status === "published") {
    // Never deliver twice — a retry that lands here after a successful
    // send is a no-op, not a resend.
    return { nextStage: "published", detail: { newsletterSent: false, reason: "already published" } };
  }

  const result = await sendNewsletter(newsletterOutput.subject ?? "(no subject)", newsletterOutput.body);

  if (result.ok) {
    const { error: updateError } = await supabase
      .from("publish_queue")
      .update({ status: "published", published_at: new Date().toISOString(), attempts: queueItem.attempts + 1, last_error: null })
      .eq("id", queueItem.id);
    if (updateError) throw new StageError(`Newsletter sent but failed to record it: ${updateError.message}`);
    return { nextStage: "published", detail: { newsletterSent: true, resendId: result.id } };
  }

  const { error: updateError } = await supabase
    .from("publish_queue")
    .update({ status: "failed", last_error: result.error, attempts: queueItem.attempts + 1 })
    .eq("id", queueItem.id);
  if (updateError) throw new StageError(`Newsletter send failed AND failed to record the failure: ${updateError.message}`);

  // The send failing doesn't fail this stage — the queue item's own
  // 'failed' status is the accurate, authoritative record; the request
  // still finished its publish step. See queue.tsx's retry action for
  // giving it another shot.
  return { nextStage: "published", detail: { newsletterSent: false, error: result.error } };
}
