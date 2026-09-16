import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, supabaseAdmin } from "./_lib/auth.js";
import { HttpError, StageError } from "./_lib/errors.js";
import { runResearch } from "./stages/research.js";
import { selectSources } from "./stages/selectSources.js";
import { planContent } from "./stages/plan.js";
import { draftContent } from "./stages/draft.js";
import { runEvaluation, decideNextStage } from "./stages/evaluate.js";
import { reviseContent } from "./stages/revise.js";
import { processReviewDecision } from "./stages/review.js";
import { adaptContent } from "./stages/adapt.js";
import { queueContent } from "./stages/queue.js";
import { publishContent } from "./stages/publish.js";
import { notImplementedStage } from "./stages/notImplemented.js";
import type { StageHandler } from "./stages/types.js";
import type { ContentRequestRow, Stage } from "../shared/types.js";

// Dispatch table: keyed by the request's CURRENT stage. The handler for
// stage X performs the work that stage represents and returns the NEXT
// stage to move to. Every Stage value must have an entry — a request
// stuck at a stage with no handler is a bug, not a silently-ignored
// no-op.
const handlers: Record<Stage, StageHandler> = {
  requested: runResearch,
  researching: selectSources,
  // Not a generic "run the next step" stage — it requires an explicit
  // human choice (search again, supply material, or proceed anyway),
  // each with its own payload. Those go through api/sources.ts, not the
  // no-payload advance() dispatch. This entry exists only so the
  // dispatch table stays total and gives a clear message if something
  // calls generic advance() here by mistake.
  sources_insufficient: notImplementedStage(
    "sources_insufficient requires an explicit choice: use the source actions (search again / supply material / proceed anyway), not generic advance",
  ),
  sources_selected: planContent,
  planned: draftContent,
  drafting: runEvaluation,
  evaluating: decideNextStage,
  // Loops back to 'drafting' (not forward in STAGE_ORDER) — see
  // revise.ts: 'drafting's evaluate step scores whatever has an
  // unscored current attempt, whether that's everything on the first
  // pass or just the just-revised draft(s) here.
  revising: reviseContent,
  ready_for_review: processReviewDecision,
  approved: adaptContent,
  adapting: queueContent,
  queued: publishContent,
  published: notImplementedStage("published (terminal)"),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authedUser = await requireStaff(req.headers.authorization);

    const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : null;
    if (!requestId) {
      res.status(400).json({ error: "requestId is required" });
      return;
    }

    const { data: request, error: loadError } = await supabaseAdmin
      .from("content_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle<ContentRequestRow>();

    if (loadError) {
      throw new HttpError(500, `Failed to load request: ${loadError.message}`);
    }
    if (!request) {
      res.status(404).json({ error: "Content request not found" });
      return;
    }

    // A manager must not be able to approve their own request by
    // calling this endpoint directly — role check happens here, before
    // dispatch, in addition to the identity check inside review.ts and
    // the forbid_self_approval DB trigger, which is the real backstop.
    if (request.stage === "ready_for_review" && authedUser.role !== "reviewer") {
      throw new HttpError(403, "Only a reviewer can act on a request awaiting review.");
    }

    const stageHandler = handlers[request.stage];
    if (!stageHandler) {
      throw new HttpError(400, `No handler registered for stage '${request.stage}'`);
    }

    const { requestId: _requestId, ...payload } = req.body ?? {};

    try {
      const result = await stageHandler({
        request,
        userId: authedUser.userId,
        role: authedUser.role,
        supabase: supabaseAdmin,
        payload,
      });

      const { error: eventError } = await supabaseAdmin.from("events").insert({
        request_id: requestId,
        stage: request.stage,
        event: `${request.stage}_complete`,
        ok: true,
        detail: result.detail ?? null,
      });
      if (eventError) {
        throw new HttpError(500, `Stage succeeded but failed to write its event row: ${eventError.message}`);
      }

      const { error: updateError } = await supabaseAdmin
        .from("content_requests")
        .update({ stage: result.nextStage, stage_error: null })
        .eq("id", requestId);
      if (updateError) {
        throw new HttpError(500, `Stage succeeded but failed to advance the request: ${updateError.message}`);
      }

      res.status(200).json({ stage: result.nextStage, stage_error: null });
    } catch (stageErr: any) {
      // Never advance past a stage that failed, and never silently skip
      // one: write the failure event, record stage_error, leave stage
      // exactly where it was so a retry re-runs this same handler.
      const message = stageErr instanceof Error ? stageErr.message : String(stageErr);
      const raw = stageErr instanceof StageError ? stageErr.raw : undefined;

      await supabaseAdmin.from("events").insert({
        request_id: requestId,
        stage: request.stage,
        event: `${request.stage}_failed`,
        ok: false,
        detail: { message, raw: raw ?? null },
      });

      await supabaseAdmin.from("content_requests").update({ stage_error: message }).eq("id", requestId);

      res.status(200).json({ stage: request.stage, stage_error: message });
    }
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}
