import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, supabaseAdmin } from "./_lib/auth.js";
import { HttpError, StageError } from "./_lib/errors.js";
import { runResearch } from "./_stages/research.js";
import { finalizeSources } from "./_stages/selectSources.js";
import { planContent } from "./_stages/plan.js";
import { draftContent } from "./_stages/draft.js";
import { runEvaluation, decideNextStage } from "./_stages/evaluate.js";
import { reviseContent } from "./_stages/revise.js";
import { adaptContent } from "./_stages/adapt.js";
import { queueContent } from "./_stages/queue.js";
import { publishContent } from "./_stages/publish.js";
import { notImplementedStage } from "./_stages/notImplemented.js";
import type { StageHandler } from "./_stages/types.js";
import type { ContentRequestRow, Stage } from "../shared/types.js";

// Dispatch table: keyed by the request's CURRENT stage. The handler for
// stage X performs the work that stage represents and returns the NEXT
// stage to move to. Every Stage value must have an entry — a request
// stuck at a stage with no handler is a bug, not a silently-ignored
// no-op.
const handlers: Record<Stage, StageHandler> = {
  requested: runResearch,
  researching: finalizeSources,
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
  // No human decision here anymore (see migrations/011) — reached only
  // when NO drafted option ever passes evaluation, even after the
  // revision cap (see decideNextStage in evaluate.ts). A dead end for
  // the automation, same shape as 'sources_insufficient': the manager's
  // only way forward is "Change sources and redraft." This stub exists
  // only so the dispatch table stays total.
  ready_for_review: notImplementedStage(
    "ready_for_review has no automated next step — every drafted option failed evaluation even after revision. Use \"Change sources and redraft.\"",
  ),
  // Dead now that there's no human article-approval decision left to
  // reject (see migrations/011) — kept only so the dispatch table and
  // the Stage type stay total for any request that reached this stage
  // under the old flow.
  rejected: notImplementedStage("rejected (terminal)"),
  approved: adaptContent,
  adapting: queueContent,
  queued: publishContent,
  published: notImplementedStage("published (terminal)"),
};

// Stages that exist only as an internal handoff, not a point where a
// human needs to act — reaching one of these as a nextStage should run
// its handler immediately, in the same request, instead of parking there
// for a separate advance() call.
// - 'planned' is reached from 'sources_selected' and always just needs
//   draftContent to run next — planning only produces outline options
//   (title, angle, keywords) with no way to act on them before drafting
//   anyway (nothing lets a manager drop or edit one option here), so
//   pausing on the outline before writing the actual article text is a
//   click with no real decision behind it.
// - 'drafting' is reached from both 'planned' (first draft) and
//   'revising' (a revision loop) and always just needs scoring; there's
//   no decision for a human to make there.
// - 'evaluating' is reached right after 'drafting' finishes scoring and
//   always just needs decideNextStage to run — that handler is a pure,
//   already-computed decision from the numbers (see its doc comment in
//   evaluate.ts), not something a human weighs in on. It lands on
//   'revising' (needs a real "Revise draft" click — that one actually
//   calls Claude) or 'ready_for_review' (needs a reviewer), both genuine
//   stopping points; 'evaluating' itself never was one.
// - 'queued' is reached from 'adapting' and always just needs
//   publishContent to run next — queueing and publishing read as the
//   same action to a manager (the button said "Queue for publishing" and
//   the next one said "Publish"), and there's no human choice between
//   them either: LinkedIn/X always land in the queue for manual posting
//   regardless, and the newsletter always sends immediately once queued.
// - 'researching' is reached from 'requested' (see research.ts) and its
//   own handler (finalizeSources) makes no AI judgment call anymore —
//   it's a mechanical "mark everything fetched as selected" pass, with
//   the actual curation happening afterward on the Sources tab
//   (check/uncheck). Nothing here needs a human decision, so a fresh
//   request now goes straight from creation to 'sources_selected' (or
//   'sources_insufficient') without resting at 'researching' at all.
//   'researching' can still be reached on its own via "Go back" (see
//   api/sources.ts's go_back action) when a manager wants to add more
//   sources after the fact — that path writes the stage directly and
//   doesn't go through this dispatch loop, so it's unaffected: the
//   request rests there until the manager clicks the stage-action button
//   again, same as before.
const AUTO_ADVANCE_STAGES = new Set<Stage>(["drafting", "queued", "researching", "planned", "evaluating"]);

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

    const { requestId: _requestId, ...payload } = req.body ?? {};

    let stage = request.stage;

    while (true) {
      const stageHandler = handlers[stage];
      if (!stageHandler) {
        throw new HttpError(400, `No handler registered for stage '${stage}'`);
      }

      try {
        const result = await stageHandler({
          request: { ...request, stage },
          userId: authedUser.userId,
          role: authedUser.role,
          supabase: supabaseAdmin,
          payload,
        });

        const { error: eventError } = await supabaseAdmin.from("events").insert({
          request_id: requestId,
          stage,
          event: `${stage}_complete`,
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

        stage = result.nextStage;

        if (!AUTO_ADVANCE_STAGES.has(stage)) {
          res.status(200).json({ stage, stage_error: null });
          return;
        }
        // else: an internal handoff stage — loop straight into its
        // handler instead of returning and waiting for another call.
      } catch (stageErr: any) {
        // Never advance past a stage that failed, and never silently skip
        // one: write the failure event, record stage_error, leave stage
        // exactly where it was so a retry re-runs this same handler.
        const message = stageErr instanceof Error ? stageErr.message : String(stageErr);
        const raw = stageErr instanceof StageError ? stageErr.raw : undefined;

        await supabaseAdmin.from("events").insert({
          request_id: requestId,
          stage,
          event: `${stage}_failed`,
          ok: false,
          detail: { message, raw: raw ?? null },
        });

        await supabaseAdmin.from("content_requests").update({ stage_error: message }).eq("id", requestId);

        res.status(200).json({ stage, stage_error: message });
        return;
      }
    }
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}
