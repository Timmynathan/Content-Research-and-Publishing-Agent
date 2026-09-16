import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, supabaseAdmin } from "./_lib/auth.js";
import { HttpError } from "./_lib/errors.js";
import { sendNewsletter } from "./_lib/resend.js";
import type { ChannelOutputRow, PublishQueueRow } from "../shared/types.js";

// Manager-facing queue actions, independent of a request's own
// content_requests.stage (by the time a manager is looking at a failed
// item, the request has usually already moved on to 'published' — the
// per-item retry lives here, not in the stage-dispatch flow).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authedUser = await requireStaff(req.headers.authorization);
    if (authedUser.role !== "manager") {
      throw new HttpError(403, "Only a manager can retry a publish queue item.");
    }

    const { action, queueItemId, channelOutputId } = req.body ?? {};
    if (action !== "retry_send" && action !== "mark_posted") {
      throw new HttpError(400, `Unknown action '${action}'`);
    }
    if (action === "retry_send" && (typeof queueItemId !== "string" || !queueItemId)) {
      throw new HttpError(400, "queueItemId is required");
    }
    if (action === "mark_posted" && !queueItemId && !channelOutputId) {
      throw new HttpError(400, "queueItemId or channelOutputId is required");
    }

    // mark_posted may be called from a page that only has the
    // channel_output id (e.g. the request detail page, which doesn't
    // load publish_queue rows) — look the queue row up by either.
    const queueQuery = supabaseAdmin.from("publish_queue").select("*");
    const { data: queueItem, error: queueError } = await (
      typeof queueItemId === "string" && queueItemId
        ? queueQuery.eq("id", queueItemId)
        : queueQuery.eq("channel_output_id", channelOutputId)
    ).maybeSingle<PublishQueueRow>();
    if (queueError) throw new HttpError(500, `Failed to load queue item: ${queueError.message}`);
    if (!queueItem) throw new HttpError(404, "Queue item not found");

    if (action === "mark_posted") {
      if (queueItem.channel === "newsletter") {
        throw new HttpError(400, "The newsletter sends for real — it can't be marked posted by hand.");
      }
      if (queueItem.status === "published") {
        res.status(200).json({ ok: true });
        return;
      }

      const { data: outputForEvent } = await supabaseAdmin
        .from("channel_outputs")
        .select("*, drafts(request_id)")
        .eq("id", queueItem.channel_output_id)
        .maybeSingle<ChannelOutputRow & { drafts: { request_id: string } | null }>();

      const { error: updateError } = await supabaseAdmin
        .from("publish_queue")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", queueItem.id);
      if (updateError) throw new HttpError(500, `Failed to mark as posted: ${updateError.message}`);

      const requestIdForEvent = outputForEvent?.drafts?.request_id ?? null;
      if (requestIdForEvent) {
        // This is a human's own account of what happened, not something
        // the app verified — logged as such, not as a confirmed send,
        // since there's no posting integration for this channel to
        // actually check against.
        await supabaseAdmin.from("events").insert({
          request_id: requestIdForEvent,
          stage: "queued",
          event: "channel_output_marked_posted_by_manager",
          ok: true,
          detail: { queueItemId: queueItem.id, channel: queueItem.channel, actorId: authedUser.userId, selfReported: true },
        });
      }

      res.status(200).json({ ok: true });
      return;
    }

    if (queueItem.channel !== "newsletter") {
      throw new HttpError(400, "Only the newsletter channel can be retried here — LinkedIn/X have no send integration.");
    }
    if (queueItem.status === "published") {
      throw new HttpError(409, "This item was already published — refusing to send it again.");
    }

    const { data: output, error: outputError } = await supabaseAdmin
      .from("channel_outputs")
      .select("*, drafts(request_id)")
      .eq("id", queueItem.channel_output_id)
      .maybeSingle<ChannelOutputRow & { drafts: { request_id: string } | null }>();
    if (outputError) throw new HttpError(500, `Failed to load channel output: ${outputError.message}`);
    if (!output) throw new HttpError(404, "The channel output for this queue item no longer exists.");

    const requestId = output.drafts?.request_id ?? null;

    const result = await sendNewsletter(output.subject ?? "(no subject)", output.body);

    if (result.ok) {
      const { error: updateError } = await supabaseAdmin
        .from("publish_queue")
        .update({ status: "published", published_at: new Date().toISOString(), attempts: queueItem.attempts + 1, last_error: null })
        .eq("id", queueItem.id);
      if (updateError) throw new HttpError(500, `Sent but failed to record it: ${updateError.message}`);

      if (requestId) {
        await supabaseAdmin.from("events").insert({
          request_id: requestId,
          stage: "queued",
          event: "newsletter_retry_send",
          ok: true,
          detail: { queueItemId, resendId: result.id, actorId: authedUser.userId },
        });
      }

      res.status(200).json({ ok: true, published: true });
      return;
    }

    const { error: updateError } = await supabaseAdmin
      .from("publish_queue")
      .update({ status: "failed", last_error: result.error, attempts: queueItem.attempts + 1 })
      .eq("id", queueItem.id);
    if (updateError) throw new HttpError(500, `Send failed and failed to record it: ${updateError.message}`);

    if (requestId) {
      await supabaseAdmin.from("events").insert({
        request_id: requestId,
        stage: "queued",
        event: "newsletter_retry_send",
        ok: false,
        detail: { queueItemId, error: result.error, actorId: authedUser.userId },
      });
    }

    res.status(200).json({ ok: true, published: false, error: result.error });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}
