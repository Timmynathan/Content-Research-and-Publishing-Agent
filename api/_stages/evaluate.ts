import { callClaudeForJson } from "../_lib/anthropic.js";
import { StageError } from "../_lib/errors.js";
import { EVALUATION_RUBRIC } from "../_lib/guidance.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import {
  AVERAGE_PASS_THRESHOLD,
  MAX_DRAFT_ATTEMPTS,
  PASS_SCORE_THRESHOLD,
  RUBRIC_CRITERIA,
  STRICT_RUBRIC_CRITERIA,
  type DraftRow,
  type EvaluationRow,
  type RubricCriterion,
} from "../../shared/types.js";

interface EvaluationToolInput {
  scores: Record<RubricCriterion, { score: number; note: string }>;
  failing_sections: string[];
  recommended_changes: string[];
}

const SCORE_PROPERTY = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 1, maximum: 5, description: "1 (poor) to 5 (excellent)." },
    note: { type: "string", description: "One short sentence explaining the score." },
  },
  required: ["score", "note"],
};

const EVALUATION_TOOL_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: Object.fromEntries(RUBRIC_CRITERIA.map((c) => [c, SCORE_PROPERTY])),
      required: [...RUBRIC_CRITERIA],
    },
    failing_sections: {
      type: "array",
      items: { type: "string" },
      description: "Section keys with a genuine problem that needs revision — not every section with a merely-improvable score.",
    },
    recommended_changes: {
      type: "array",
      items: { type: "string" },
      description: "Specific, actionable notes for whoever revises the failing sections.",
    },
  },
  required: ["scores", "failing_sections", "recommended_changes"],
};

function buildEvaluationPrompt(request: HandlerCtx["request"], draft: DraftRow): string {
  const flaggedClaims = draft.sections.flatMap((s) => s.claims.filter((c) => c.flagged).map((c) => `[${s.key}] "${c.text}" — ${c.flag_reason}`));

  const sectionsText = draft.sections
    .map((s) => `${s.key}: ${s.heading}\n${s.body}`)
    .join("\n\n");

  return [
    `Content idea: ${request.idea}`,
    `Target audience: ${request.target_audience}`,
    request.tone ? `Desired tone: ${request.tone}` : null,
    `Article angle: ${draft.angle}`,
    `Title: ${draft.outline.title}`,
    `Primary keyword: ${draft.outline.primary_keyword}`,
    "",
    "Rubric to score against:",
    EVALUATION_RUBRIC,
    "",
    flaggedClaims.length
      ? `Claims already flagged by code as unsupported (missing or invalid source) — these should weigh heavily against Source Grounding and Factual Consistency:\n${flaggedClaims.join("\n")}`
      : "No claims were flagged as unsupported.",
    "",
    "Draft to evaluate:",
    sectionsText,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Stage handler for 'drafting' -> 'evaluating'.
 *
 * Scores every draft that doesn't yet have an evaluations row for its
 * CURRENT attempt — on the first pass that's every draft; after a
 * revision loop-back through here, that's only whichever draft(s) were
 * just revised (see revise.ts, which bumps attempt only on drafts it
 * touches). This is what makes evaluating<->revising a correct loop
 * instead of re-scoring or skipping content.
 */
export async function runEvaluation(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: drafts, error: draftsError } = await supabase
    .from("drafts")
    .select("*")
    .eq("request_id", request.id)
    .returns<DraftRow[]>();
  if (draftsError) throw new StageError(`Failed to load drafts: ${draftsError.message}`);
  if (!drafts || drafts.length === 0) {
    throw new StageError("No drafts found to evaluate.");
  }

  const { data: existingEvals, error: evalsError } = await supabase
    .from("evaluations")
    .select("draft_id, attempt")
    .in("draft_id", drafts.map((d) => d.id))
    .returns<Array<{ draft_id: string; attempt: number }>>();
  if (evalsError) throw new StageError(`Failed to load existing evaluations: ${evalsError.message}`);

  const alreadyScored = new Set((existingEvals ?? []).map((e) => `${e.draft_id}:${e.attempt}`));
  const needsScoring = drafts.filter((d) => !alreadyScored.has(`${d.id}:${d.attempt}`));

  if (needsScoring.length === 0) {
    // Idempotent retry: everything at its current attempt is already scored.
    return { nextStage: "evaluating", detail: { scored: 0, note: "all drafts already scored for their current attempt" } };
  }

  const knownKeys = new Set<string>();
  for (const d of drafts) for (const s of d.sections) knownKeys.add(`${d.id}:${s.key}`);

  const rows = await Promise.all(
    needsScoring.map(async (draft) => {
      const result = await callClaudeForJson<EvaluationToolInput>({
        system:
          "You are an editor scoring a draft article against a fixed rubric. Score honestly — do not inflate scores to avoid a revision cycle. List only sections with a real problem in failing_sections.",
        prompt: buildEvaluationPrompt(request, draft),
        toolName: "record_evaluation",
        toolDescription: "Record rubric scores, failing sections, and recommended changes for this draft.",
        inputSchema: EVALUATION_TOOL_SCHEMA,
        maxTokens: 2048,
      });

      if (!result || !result.scores) {
        throw new StageError(
          `The AI didn't return a score for the "${draft.angle}" option. This is usually a one-off — retrying this stage almost always works.`,
          { raw: result, draftId: draft.id },
        );
      }

      for (const criterion of RUBRIC_CRITERIA) {
        const entry = result.scores[criterion];
        if (!entry || typeof entry.score !== "number") {
          throw new StageError(
            `The AI's scoring of "${draft.angle}" was missing the "${criterion}" rubric score. This is usually a one-off — retrying this stage almost always works.`,
            { raw: result, draftId: draft.id },
          );
        }
      }

      const failingSections = (result.failing_sections ?? []).filter((key) => knownKeys.has(`${draft.id}:${key}`));
      const overall = RUBRIC_CRITERIA.reduce((sum, c) => sum + result.scores[c].score, 0) / RUBRIC_CRITERIA.length;
      const passed =
        failingSections.length === 0 &&
        STRICT_RUBRIC_CRITERIA.every((c) => result.scores[c].score >= PASS_SCORE_THRESHOLD) &&
        overall >= AVERAGE_PASS_THRESHOLD;

      return {
        draft_id: draft.id,
        attempt: draft.attempt,
        scores: result.scores,
        overall,
        passed,
        failing_sections: failingSections,
        recommended_changes: result.recommended_changes ?? [],
      };
    }),
  );

  const { error: insertError } = await supabase.from("evaluations").insert(rows);
  if (insertError) throw new StageError(`Failed to write evaluations: ${insertError.message}`, { rows });

  return {
    nextStage: "evaluating",
    detail: { scored: rows.length, passed: rows.filter((r) => r.passed).length },
  };
}

/**
 * Stage handler for 'evaluating' -> 'revising' | 'approved' | 'ready_for_review'.
 *
 * A pure decision from already-computed scores, no LLM call — the
 * model never decides whether to keep revising, this does, mechanically,
 * from the numbers. There's no human article-approval step anymore
 * (see migrations/011): once nothing needs further revision, the
 * best-scoring passing draft is selected automatically and the losing
 * options are discarded, same cleanup the old human "approve" decision
 * used to do — see adaptContent, which now reads drafts.selected
 * directly instead of an approvals row. Only if NOTHING ever passes,
 * even after the revision cap, does this stay at 'ready_for_review' —
 * repurposed as a manager-facing dead end (nothing here for a reviewer
 * to do; see REDRAFT_UNLOCKABLE_STAGES), not a human checkpoint.
 */
export async function decideNextStage(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: drafts, error: draftsError } = await supabase
    .from("drafts")
    .select("*")
    .eq("request_id", request.id)
    .returns<DraftRow[]>();
  if (draftsError) throw new StageError(`Failed to load drafts: ${draftsError.message}`);
  if (!drafts || drafts.length === 0) throw new StageError("No drafts found to decide on.");

  const { data: evals, error: evalsError } = await supabase
    .from("evaluations")
    .select("*")
    .in("draft_id", drafts.map((d) => d.id))
    .returns<EvaluationRow[]>();
  if (evalsError) throw new StageError(`Failed to load evaluations: ${evalsError.message}`);

  const latestByDraft = new Map<string, EvaluationRow>();
  for (const d of drafts) {
    const latest = (evals ?? []).find((e) => e.draft_id === d.id && e.attempt === d.attempt);
    if (!latest) {
      throw new StageError(
        `The "${d.angle}" option is missing its evaluation score. Try going back and running the evaluation stage again.`,
        { draftId: d.id, attempt: d.attempt },
      );
    }
    latestByDraft.set(d.id, latest);
  }

  const needsRevision = drafts.filter((d) => {
    const ev = latestByDraft.get(d.id)!;
    return !ev.passed && d.attempt < MAX_DRAFT_ATTEMPTS;
  });

  if (needsRevision.length > 0) {
    return {
      nextStage: "revising",
      detail: { draftsNeedingRevision: needsRevision.map((d) => ({ id: d.id, attempt: d.attempt })) },
    };
  }

  const passing = drafts.filter((d) => latestByDraft.get(d.id)!.passed);

  if (passing.length === 0) {
    const stillFailing = drafts.filter((d) => !latestByDraft.get(d.id)!.passed);
    return {
      nextStage: "ready_for_review",
      detail: { passedCount: 0, stillFailingAtCap: stillFailing.map((d) => d.id) },
    };
  }

  // Highest overall score wins; a tie keeps whichever was found first
  // (lowest variant number, since `drafts` was loaded in no particular
  // guaranteed order but `passing` preserves that same order).
  const best = passing.reduce((a, b) => (latestByDraft.get(b.id)!.overall > latestByDraft.get(a.id)!.overall ? b : a));

  const { error: selectError } = await supabase.from("drafts").update({ selected: true }).eq("id", best.id);
  if (selectError) throw new StageError(`Failed to mark the winning draft selected: ${selectError.message}`);

  // Discarding the losing options mirrors what the old human "approve"
  // decision used to do (see git history of review.ts) — nothing
  // downstream exists yet for any draft at this point, since adaptation
  // only happens after this.
  const { error: deleteError } = await supabase.from("drafts").delete().eq("request_id", request.id).neq("id", best.id);
  if (deleteError) throw new StageError(`Failed to remove the other draft options: ${deleteError.message}`);

  return {
    nextStage: "approved",
    detail: { selectedDraftId: best.id, overall: latestByDraft.get(best.id)!.overall, passedCount: passing.length, totalOptions: drafts.length },
  };
}
