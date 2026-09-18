import { StageError } from "../_lib/errors.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { ChannelOutputRow, DraftRow } from "../../shared/types.js";

/**
 * Stage handler for 'adapting' -> 'queued'.
 *
 * Refuses to run at all until every channel_output for the approved
 * draft has been individually signed off by a reviewer (approved_at
 * set — see api/channelReview.ts and migrations/010). This is the
 * actual enforcement of the post-approval review gate, not just the
 * manager's "Publish" button being hidden client-side while any are
 * still pending: without it, a manager could still queue content a
 * reviewer explicitly sent back for revision.
 *
 * Once past that gate: the newsletter only queues when valid — it
 * sends itself automatically via Resend with no human step in between,
 * so an invalid one must never reach the queue at all. LinkedIn and X
 * are different: nothing posts automatically for them, a person always
 * copies and pastes the text themselves, so blocking an invalid one
 * from the queue doesn't prevent bad content going out — it just makes
 * the manager dig it out of the request page instead of the queue, and
 * they still have to fix it by hand either way. So those two queue
 * regardless of `valid`; the Queue page surfaces the validation issues
 * so whoever posts it knows to trim/fix it first.
 */
export async function queueContent(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("id")
    .eq("request_id", request.id)
    .eq("selected", true)
    .maybeSingle<Pick<DraftRow, "id">>();
  if (draftError) throw new StageError(`Failed to load the selected draft: ${draftError.message}`);
  if (!draft) throw new StageError("No selected draft found for this request.");

  const { data: outputs, error: outputsError } = await supabase
    .from("channel_outputs")
    .select("*")
    .eq("draft_id", draft.id)
    .returns<ChannelOutputRow[]>();
  if (outputsError) throw new StageError(`Failed to load channel outputs: ${outputsError.message}`);
  if (!outputs || outputs.length === 0) throw new StageError("No channel outputs found to queue.");

  const unresolved = outputs.filter((o) => !o.approved_at);
  if (unresolved.length > 0) {
    const names = unresolved.map((o) => (o.revision_requested_comment ? `${o.channel} (revision requested)` : `${o.channel} (awaiting review)`));
    throw new StageError(
      `Not every channel output has been reviewed yet: ${names.join(", ")}. A reviewer needs to approve each one before this can be queued.`,
      { unresolved: unresolved.map((o) => ({ id: o.id, channel: o.channel, pending: Boolean(o.revision_requested_comment) })) },
    );
  }

  const queueable = outputs.filter((o) => o.channel === "newsletter" ? o.valid : true);
  if (queueable.length === 0) {
    throw new StageError(
      "None of the adapted channel outputs can be queued — the newsletter didn't pass validation, and it's the only channel that requires it. Check the channel outputs' validation details.",
    );
  }

  const { data: existingQueueItems, error: existingError } = await supabase
    .from("publish_queue")
    .select("channel_output_id")
    .in("channel_output_id", queueable.map((o) => o.id))
    .returns<Array<{ channel_output_id: string }>>();
  if (existingError) throw new StageError(`Failed to check existing queue items: ${existingError.message}`);

  const alreadyQueued = new Set((existingQueueItems ?? []).map((q) => q.channel_output_id));
  const toQueue = queueable.filter((o) => !alreadyQueued.has(o.id));

  if (toQueue.length > 0) {
    const rows = toQueue.map((o) => ({
      channel_output_id: o.id,
      channel: o.channel,
      scheduled_for: new Date().toISOString(),
      status: "queued" as const,
    }));
    const { error: insertError } = await supabase.from("publish_queue").insert(rows);
    if (insertError) throw new StageError(`Failed to queue channel outputs: ${insertError.message}`, { rows });
  }

  return {
    nextStage: "queued",
    detail: { queued: toQueue.length, alreadyQueued: alreadyQueued.size, skippedInvalidNewsletter: outputs.length - queueable.length },
  };
}
