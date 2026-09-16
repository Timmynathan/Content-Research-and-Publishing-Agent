import { StageError } from "../_lib/errors.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { ApprovalRow, ChannelOutputRow } from "../../shared/types.js";

/**
 * Stage handler for 'adapting' -> 'queued'.
 *
 * The newsletter only queues when valid — it sends itself automatically
 * via Resend with no human step in between, so an invalid one must
 * never reach the queue at all. LinkedIn and X are different: nothing
 * posts automatically for them, a person always copies and pastes the
 * text themselves, so blocking an invalid one from the queue doesn't
 * prevent bad content going out — it just makes the manager dig it out
 * of the request page instead of the queue, and they still have to fix
 * it by hand either way. So those two queue regardless of `valid`; the
 * Queue page surfaces the validation issues so whoever posts it knows
 * to trim/fix it first.
 */
export async function queueContent(ctx: HandlerCtx): Promise<HandlerResult> {
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
  if (!outputs || outputs.length === 0) throw new StageError("No channel outputs found to queue.");

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
