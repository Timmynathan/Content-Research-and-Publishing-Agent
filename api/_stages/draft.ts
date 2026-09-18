import { callClaudeForJson, coerceToolArray } from "../_lib/anthropic.js";
import { StageError } from "../_lib/errors.js";
import { SEO_BEST_PRACTICES } from "../_lib/guidance.js";
import { buildSourceContext } from "../_lib/sourceContext.js";
import { verifyClaimGrounding } from "../_lib/grounding.js";
import { searchImage } from "../_lib/pexels.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { DraftRow, SourceRow } from "../../shared/types.js";

const TEXT_BUDGET_PER_SOURCE = 2500;

interface DraftToolInput {
  sections: Array<{
    key: string;
    heading: string;
    body: string;
    claims: Array<{ text: string; source_id: string }>;
  }>;
}

const DRAFT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      minItems: 1,
      description: "One entry per outline section, in the same order, using the same keys.",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          heading: { type: "string" },
          body: {
            type: "string",
            description: "2 to 4 short paragraphs (2-3 sentences each) for this section.",
          },
          claims: {
            type: "array",
            description:
              "Every specific factual claim, statistic, or attributed statement in this section's body — each paired with the source_id it came from. If a sentence makes no factual claim (pure framing/transition), it needs no entry here.",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "The claim as it appears in the body." },
                source_id: { type: "string", description: "The exact id of the source this claim is grounded in." },
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
 * Stage handler for 'planned' -> 'drafting'.
 *
 * For every draft option planned in the previous stage, generates full
 * section bodies from its outline, each with the factual claims it
 * makes paired to a source_id. Every claim is then verified in code
 * against the sources actually retrieved and selected for this request
 * — never trusted or silently repaired (see api/_lib/grounding.ts).
 */
export async function draftContent(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const [{ data: drafts, error: draftsError }, { data: sources, error: sourcesError }] = await Promise.all([
    supabase.from("drafts").select("*").eq("request_id", request.id).returns<DraftRow[]>(),
    supabase.from("sources").select("*").eq("request_id", request.id).eq("selected", true).returns<SourceRow[]>(),
  ]);

  if (draftsError) throw new StageError(`Failed to load draft options: ${draftsError.message}`);
  if (sourcesError) throw new StageError(`Failed to load selected sources: ${sourcesError.message}`);
  if (!drafts || drafts.length === 0) {
    throw new StageError("No outline options were found to draft from — the planning step doesn't appear to have completed. Try going back and running that stage again.");
  }
  if (!sources || sources.length === 0) {
    throw new StageError("There are no selected sources to draft from. Go to the Sources tab and select at least one source.");
  }

  const selectedSourceIds = new Set(sources.map((s) => s.id));
  const sourceContext = buildSourceContext(sources, TEXT_BUDGET_PER_SOURCE);

  const results = await Promise.all(
    drafts.map(async (draft) => {
      const outlineText = draft.outline.sections
        .map((s) => `${s.level} [${s.key}] ${s.heading}\n  notes: ${s.notes}`)
        .join("\n");

      const prompt = [
        `Content idea: ${request.idea}`,
        `Target audience: ${request.target_audience}`,
        request.tone ? `Desired tone: ${request.tone}` : null,
        `Article angle for this option: ${draft.angle}`,
        `Title: ${draft.outline.title}`,
        `Primary keyword: ${draft.outline.primary_keyword}`,
        `Secondary keywords: ${draft.outline.secondary_keywords.join(", ")}`,
        "",
        "Outline to write from (use these exact section keys):",
        outlineText,
        "",
        "SEO guidance:",
        SEO_BEST_PRACTICES,
        "",
        "Available sources — every factual claim, statistic, or attributed statement must cite one of these by source_id:",
        sourceContext,
      ]
        .filter(Boolean)
        .join("\n");

      // Run alongside the Claude call, not after — it doesn't depend on
      // the drafted text, only the outline already in hand, and best-
      // effort (see pexels.ts) means it can never be what makes this
      // draft fail.
      const imagePromise = searchImage(draft.outline.primary_keyword || draft.outline.title);

      let result: DraftToolInput;
      try {
        result = await callClaudeForJson<DraftToolInput>({
          system:
            "You are a writer drafting an article section by section from a given outline, strictly grounded in the given sources. Every factual claim must be paired with the source_id it came from — never invent a source_id and never state a claim without one.",
          prompt,
          toolName: "record_draft_sections",
          toolDescription: "Record the full body and sourced claims for every outline section.",
          inputSchema: DRAFT_TOOL_SCHEMA,
          maxTokens: 8192,
          isValid: (result) => (coerceToolArray(result?.sections, "sections")?.length ?? 0) > 0,
        });
      } catch (err: any) {
        throw new StageError(
          `Writing the "${draft.angle}" option failed. This is usually a one-off — retrying this stage almost always works.`,
          { draftId: draft.id, cause: err.message },
        );
      }

      const sections = coerceToolArray(result?.sections, "sections") as DraftToolInput["sections"] | null;
      if (!sections || sections.length === 0) {
        throw new StageError(
          `The AI came back with an empty draft for the "${draft.angle}" option. This is usually a one-off — retrying this stage almost always works.`,
          { raw: result, draftId: draft.id },
        );
      }

      const verifiedSections = verifyClaimGrounding(sections, selectedSourceIds);
      const image = await imagePromise;
      return { draftId: draft.id, sections: verifiedSections, image };
    }),
  );

  for (const { draftId, sections, image } of results) {
    const { error: updateError } = await supabase
      .from("drafts")
      .update({
        sections,
        image_url: image?.url ?? null,
        image_alt: image?.alt ?? null,
        image_photographer: image?.photographer ?? null,
        image_photographer_url: image?.photographerUrl ?? null,
        image_pexels_url: image?.pexelsUrl ?? null,
      })
      .eq("id", draftId);
    if (updateError) {
      throw new StageError(`Failed to save drafted sections: ${updateError.message}`, { draftId });
    }
  }

  const flaggedCount = results.reduce(
    (sum, r) => sum + r.sections.reduce((s, sec) => s + sec.claims.filter((c) => c.flagged).length, 0),
    0,
  );

  return {
    nextStage: "drafting",
    detail: { draftCount: results.length, flaggedClaims: flaggedCount, imagesFound: results.filter((r) => r.image).length },
  };
}
