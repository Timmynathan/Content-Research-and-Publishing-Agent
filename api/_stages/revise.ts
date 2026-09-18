import { callClaudeForJson, coerceToolArray } from "../_lib/anthropic.js";
import { StageError } from "../_lib/errors.js";
import { SEO_BEST_PRACTICES } from "../_lib/guidance.js";
import { buildSourceContext } from "../_lib/sourceContext.js";
import { verifyClaimGrounding } from "../_lib/grounding.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import { MAX_DRAFT_ATTEMPTS, type DraftRow, type EvaluationRow, type SourceRow } from "../../shared/types.js";

const TEXT_BUDGET_PER_SOURCE = 2500;

interface ReviseToolInput {
  sections: Array<{
    key: string;
    heading: string;
    body: string;
    claims: Array<{ text: string; source_id: string }>;
  }>;
}

const REVISE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      minItems: 1,
      description: "Exactly the sections being revised — same keys as requested, rewritten to fix the stated problems.",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          heading: { type: "string" },
          body: { type: "string" },
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                source_id: { type: "string" },
              },
              required: ["text", "source_id"],
            },
          },
        },
        required: ["key", "heading", "body", "claims"],
      },
    },
  },
  required: ["sections"],
};

/**
 * Stage handler for 'revising' -> 'drafting'.
 *
 * Regenerates ONLY the sections a draft's latest evaluation flagged as
 * failing, for whichever draft(s) still need it and haven't hit the
 * attempt cap — not the whole article. Bumps attempt only on the drafts
 * it touches, then hands back to 'drafting' so the next evaluate pass
 * scores exactly (and only) what changed. Runs unattended, the instant
 * it's reached (see RequestDetail.tsx's auto-advance effect) — there's
 * no human decision involved here, only the rubric's own numbers (see
 * decideNextStage in evaluate.ts).
 */
export async function reviseContent(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const [{ data: drafts, error: draftsError }, { data: sources, error: sourcesError }] = await Promise.all([
    supabase.from("drafts").select("*").eq("request_id", request.id).returns<DraftRow[]>(),
    supabase.from("sources").select("*").eq("request_id", request.id).eq("selected", true).returns<SourceRow[]>(),
  ]);
  if (draftsError) throw new StageError(`Failed to load drafts: ${draftsError.message}`);
  if (sourcesError) throw new StageError(`Failed to load selected sources: ${sourcesError.message}`);
  if (!drafts || drafts.length === 0) throw new StageError("No drafts found to revise.");
  if (!sources || sources.length === 0) throw new StageError("No selected sources found — cannot revise without grounding material.");

  const { data: evals, error: evalsError } = await supabase
    .from("evaluations")
    .select("*")
    .in("draft_id", drafts.map((d) => d.id))
    .returns<EvaluationRow[]>();
  if (evalsError) throw new StageError(`Failed to load evaluations: ${evalsError.message}`);

  const selectedSourceIds = new Set(sources.map((s) => s.id));
  const sourceContext = buildSourceContext(sources, TEXT_BUDGET_PER_SOURCE);

  const toRevise = drafts
    .map((draft) => {
      const latest = (evals ?? []).find((e) => e.draft_id === draft.id && e.attempt === draft.attempt);
      return { draft, evaluation: latest };
    })
    .filter(
      (x): x is { draft: DraftRow; evaluation: EvaluationRow } =>
        Boolean(x.evaluation) && !x.evaluation!.passed && x.draft.attempt < MAX_DRAFT_ATTEMPTS,
    );

  if (toRevise.length === 0) {
    // Nothing left needing revision (e.g. a retry after everything already
    // got bumped) — safe to just hand back to drafting/evaluating.
    return { nextStage: "drafting", detail: { revised: 0, note: "nothing needed revision" } };
  }

  const results = await Promise.all(
    toRevise.map(async ({ draft, evaluation }) => {
      const failingKeys = new Set(evaluation.failing_sections);
      const sectionsToRevise = draft.sections.filter((s) => failingKeys.has(s.key));
      const outlineByKey = new Map(draft.outline.sections.map((s) => [s.key, s]));

      if (sectionsToRevise.length === 0) {
        throw new StageError(
          `The evaluation for "${draft.angle}" pointed at sections that no longer exist on this draft. Try going back and running the evaluation stage again.`,
          { draftId: draft.id, failingSections: evaluation.failing_sections },
        );
      }

      const otherSectionsSummary = draft.sections
        .filter((s) => !failingKeys.has(s.key))
        .map((s) => `${s.key}: ${s.heading}\n${s.body}`)
        .join("\n\n");

      const failingSectionsBrief = sectionsToRevise
        .map((s) => {
          const outline = outlineByKey.get(s.key);
          return [
            `${s.key}: ${s.heading}`,
            `current body:\n${s.body}`,
            outline ? `outline notes: ${outline.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");

      const prompt = [
        `Content idea: ${request.idea}`,
        `Target audience: ${request.target_audience}`,
        request.tone ? `Desired tone: ${request.tone}` : null,
        `Article angle: ${draft.angle}`,
        `Title: ${draft.outline.title}`,
        "",
        "Editor's feedback from the last evaluation — recommended changes:",
        evaluation.recommended_changes?.length ? evaluation.recommended_changes.join("\n") : "(none given)",
        "",
        "The rest of the article, for context and consistency (do not rewrite these):",
        otherSectionsSummary || "(no other sections)",
        "",
        "Sections to revise:",
        failingSectionsBrief,
        "",
        "SEO guidance:",
        SEO_BEST_PRACTICES,
        "",
        "Available sources — every factual claim must cite one of these by source_id:",
        sourceContext,
      ]
        .filter(Boolean)
        .join("\n");

      let result: ReviseToolInput;
      try {
        result = await callClaudeForJson<ReviseToolInput>({
          system:
            "You are revising specific sections of a draft article based on editor feedback. Rewrite ONLY the requested sections, keeping them consistent with the rest of the article. Every factual claim must cite a real source_id.",
          prompt,
          toolName: "record_revised_sections",
          toolDescription: `Record the rewritten body and claims for exactly these sections: ${[...failingKeys].join(", ")}.`,
          inputSchema: REVISE_TOOL_SCHEMA,
          maxTokens: 6144,
          isValid: (result) => (coerceToolArray(result?.sections, "sections")?.length ?? 0) > 0,
        });
      } catch (err: any) {
        throw new StageError(
          `Revising the "${draft.angle}" option failed. This is usually a one-off — retrying this stage almost always works.`,
          { draftId: draft.id, cause: err.message },
        );
      }

      const sections = coerceToolArray(result?.sections, "sections") as ReviseToolInput["sections"] | null;
      if (!sections || sections.length === 0) {
        throw new StageError(
          `The AI came back with no revised text for "${draft.angle}". This is usually a one-off — retrying this stage almost always works.`,
          { raw: result, draftId: draft.id },
        );
      }

      // Only accept sections that were actually asked for — an extra,
      // unsolicited edit (Claude revising something it wasn't asked to
      // touch) is discarded rather than failing the whole batch, since
      // the requested sections are still valid on their own. What we
      // must not accept silently is the opposite: a requested section
      // that never came back.
      const requestedSections = sections.filter((s) => failingKeys.has(s.key));
      const returnedKeys = new Set(requestedSections.map((s) => s.key));
      const missing = [...failingKeys].filter((k) => !returnedKeys.has(k));
      if (missing.length > 0) {
        throw new StageError(
          `The AI's revision of "${draft.angle}" was missing ${missing.length} of the requested section${missing.length === 1 ? "" : "s"}. This is usually a one-off — retrying this stage almost always works.`,
          { draftId: draft.id, expected: [...failingKeys], got: sections.map((s) => s.key) },
        );
      }

      const verifiedRevised = verifyClaimGrounding(requestedSections, selectedSourceIds);
      const revisedByKey = new Map(verifiedRevised.map((s) => [s.key, s]));

      const mergedSections = draft.sections.map((s) => revisedByKey.get(s.key) ?? s);

      return { draftId: draft.id, sections: mergedSections, newAttempt: draft.attempt + 1 };
    }),
  );

  for (const { draftId, sections, newAttempt } of results) {
    const { error: updateError } = await supabase
      .from("drafts")
      .update({ sections, attempt: newAttempt })
      .eq("id", draftId);
    if (updateError) throw new StageError(`Failed to save revised sections: ${updateError.message}`, { draftId });
  }

  return {
    nextStage: "drafting",
    detail: { revised: results.length, draftIds: results.map((r) => r.draftId) },
  };
}
