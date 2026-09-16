import { callClaudeForJson } from "../_lib/anthropic.js";
import { StageError } from "../_lib/errors.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import { USABLE_SOURCE_FLOOR, type SourceRow } from "../../shared/types.js";

// How much of each source's extracted text Claude sees when judging
// relevance. This is a selection step, not a summarization step, but it
// still needs enough real content to judge — not just the excerpt.
const TEXT_BUDGET_PER_SOURCE = 3000;

interface SelectionToolInput {
  selections: Array<{ source_id: string; selected: boolean; reason: string }>;
}

const SELECTION_TOOL_SCHEMA = {
  type: "object",
  properties: {
    selections: {
      type: "array",
      description: "One entry for every source listed in the prompt, in any order.",
      items: {
        type: "object",
        properties: {
          source_id: { type: "string", description: "The exact id of the source being judged." },
          selected: { type: "boolean", description: "True if this source is relevant and usable evidence for the article." },
          reason: { type: "string", description: "One-line reason for the decision, whether selected or not." },
        },
        required: ["source_id", "selected", "reason"],
      },
    },
  },
  required: ["selections"],
};

/**
 * Stage handler for 'researching' -> 'sources_selected' | 'sources_insufficient'.
 *
 * Claude reads the extracted text of every successfully fetched source
 * and marks which are relevant, with a one-line reason each. It does
 * not rewrite or summarize the source text.
 *
 * This never throws for "not enough material" — that's not a failure of
 * this stage, it's a legitimate outcome the request can rest in.
 * - Zero sources fetched at all: skip the Claude call (nothing to judge)
 *   and go straight to 'sources_insufficient'.
 * - Fewer than USABLE_SOURCE_FLOOR selected as relevant: same, land at
 *   'sources_insufficient' with whatever was selected.
 * - Otherwise: 'sources_selected' as before.
 * A genuine failure (Claude call errors, malformed response, DB write
 * fails) still throws normally and keeps the request at 'researching'
 * with stage_error set, retryable.
 */
export async function selectSources(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: sources, error: fetchError } = await supabase
    .from("sources")
    .select("*")
    .eq("request_id", request.id)
    .eq("fetch_ok", true)
    .returns<SourceRow[]>();

  if (fetchError) {
    throw new StageError(`Failed to load sources: ${fetchError.message}`);
  }

  if (!sources || sources.length === 0) {
    return {
      nextStage: "sources_insufficient",
      detail: { totalFetched: 0, selected: 0, reason: "nothing was successfully retrieved" },
    };
  }

  const sourceListForPrompt = sources
    .map((s) => {
      const text = (s.raw_text ?? "").slice(0, TEXT_BUDGET_PER_SOURCE);
      return [
        `source_id: ${s.id}`,
        `url: ${s.url}`,
        `title: ${s.title ?? "(untitled)"}`,
        `publisher: ${s.publisher ?? "(unknown)"}`,
        `published_at: ${s.published_at ?? "(unknown)"}`,
        `content:\n${text}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = [
    `Content request idea: ${request.idea}`,
    `Target audience: ${request.target_audience}`,
    request.tone ? `Desired tone: ${request.tone}` : null,
    request.keywords?.length ? `Keywords: ${request.keywords.join(", ")}` : null,
    request.supporting_material ? `Supporting material provided by the requester:\n${request.supporting_material}` : null,
    "",
    "Below are candidate sources that were retrieved for this request. Judge each one on whether it is relevant, credible, and usable as evidence for an article on this topic for this audience. Mark it selected only if it should actually be cited or drawn on. Return a decision for every source listed.",
    "",
    sourceListForPrompt,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await callClaudeForJson<SelectionToolInput>({
    system:
      "You are a research editor selecting which retrieved sources are relevant and trustworthy enough to ground an article. You do not rewrite or summarize source text — you only judge and explain relevance.",
    prompt,
    toolName: "record_source_selections",
    toolDescription: "Record a relevance decision and one-line reason for every candidate source.",
    inputSchema: SELECTION_TOOL_SCHEMA,
    maxTokens: 2048,
  });

  if (!result || !Array.isArray(result.selections) || result.selections.length === 0) {
    throw new StageError(
      "The AI didn't judge any of the retrieved sources. This is usually a one-off — retrying this stage almost always works.",
      { raw: result },
    );
  }

  const knownIds = new Set(sources.map((s) => s.id));
  const decisionById = new Map<string, { selected: boolean; reason: string }>();
  for (const entry of result.selections) {
    if (entry && typeof entry.source_id === "string" && knownIds.has(entry.source_id)) {
      decisionById.set(entry.source_id, { selected: Boolean(entry.selected), reason: entry.reason ?? "" });
    }
  }

  const missing = sources.filter((s) => !decisionById.has(s.id));

  const updates = sources.map((s) => {
    const decision = decisionById.get(s.id) ?? {
      selected: false,
      reason: "Claude did not return an assessment for this source; treated as not selected.",
    };
    return { id: s.id, selected: decision.selected, selection_reason: decision.reason };
  });

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from("sources")
      .update({ selected: update.selected, selection_reason: update.selection_reason })
      .eq("id", update.id);
    if (updateError) {
      throw new StageError(`Failed to write selection for source ${update.id}: ${updateError.message}`);
    }
  }

  const selectedCount = updates.filter((u) => u.selected).length;

  if (selectedCount < USABLE_SOURCE_FLOOR) {
    return {
      nextStage: "sources_insufficient",
      detail: {
        totalFetched: sources.length,
        selected: selectedCount,
        missingDecisions: missing.map((m) => m.id),
      },
    };
  }

  return {
    nextStage: "sources_selected",
    detail: {
      totalFetched: sources.length,
      selected: selectedCount,
      missingDecisions: missing.map((m) => m.id),
    },
  };
}
