import { createHash } from "node:crypto";
import { StageError, HttpError } from "../_lib/errors.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { DraftRow } from "../../shared/types.js";

function hashDraftContent(draft: DraftRow): string {
  // Deterministic given our own construction of `sections` (consistent
  // key order from the same code path each time) — good enough to
  // detect "this draft's content changed since approval," which is all
  // it's used for.
  return createHash("sha256").update(JSON.stringify(draft.sections)).digest("hex");
}

/**
 * Stage handler for 'ready_for_review' -> 'approved' (on approve) or
 * back to 'ready_for_review' unchanged (on reject).
 *
 * Requires payload: { decision: 'approved' | 'rejected', draftId, comment? }.
 * The role check (reviewer only) and the "not your own request" check
 * are both enforced again here even though advance.ts's role gate and
 * the forbid_self_approval DB trigger already cover them — the trigger
 * is the real backstop; this is just a clearer error before hitting it.
 */
export async function processReviewDecision(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase, userId, payload } = ctx;

  const decision = payload.decision;
  const draftId = payload.draftId;
  const comment = typeof payload.comment === "string" ? payload.comment : null;

  if (decision !== "approved" && decision !== "rejected") {
    throw new HttpError(400, "decision must be 'approved' or 'rejected'");
  }
  if (typeof draftId !== "string" || !draftId) {
    throw new HttpError(400, "draftId is required — pick which article option this decision is about");
  }
  if (userId === request.created_by) {
    throw new StageError("You cannot approve or reject a request you created yourself.");
  }

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", draftId)
    .eq("request_id", request.id)
    .maybeSingle<DraftRow>();
  if (draftError) throw new StageError(`Failed to load draft: ${draftError.message}`);
  if (!draft) throw new HttpError(404, "That draft option doesn't belong to this request.");

  if (decision === "rejected") {
    const { error: insertError } = await supabase.from("approvals").insert({
      request_id: request.id,
      draft_id: draft.id,
      decision: "rejected",
      comment,
      content_hash: hashDraftContent(draft),
      decided_by: userId,
    });
    if (insertError) throw new StageError(`Failed to record rejection: ${insertError.message}`);

    return { nextStage: "ready_for_review", detail: { decision: "rejected", draftId, comment } };
  }

  // Approved: mark this option selected (and only this one), snapshot
  // its content hash, record the approval, then hand off to 'approved'
  // — the DB trigger require_approval_before_adapting is the actual
  // enforcement that nothing reaches 'adapting' without this row
  // existing; this handler is what makes it exist.
  const { error: deselectError } = await supabase.from("drafts").update({ selected: false }).eq("request_id", request.id);
  if (deselectError) throw new StageError(`Failed to clear prior selection: ${deselectError.message}`);

  const { error: selectError } = await supabase.from("drafts").update({ selected: true }).eq("id", draft.id);
  if (selectError) throw new StageError(`Failed to mark draft selected: ${selectError.message}`);

  const { error: insertError } = await supabase.from("approvals").insert({
    request_id: request.id,
    draft_id: draft.id,
    decision: "approved",
    comment,
    content_hash: hashDraftContent(draft),
    decided_by: userId,
  });
  if (insertError) throw new StageError(`Failed to record approval: ${insertError.message}`);

  return { nextStage: "approved", detail: { decision: "approved", draftId, comment } };
}
