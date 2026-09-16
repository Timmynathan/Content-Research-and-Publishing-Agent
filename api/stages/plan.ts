import { callClaudeForJson } from "../_lib/anthropic.js";
import { StageError } from "../_lib/errors.js";
import { SEO_BEST_PRACTICES } from "../_lib/guidance.js";
import { buildSourceContext } from "../_lib/sourceContext.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { DraftOutline, SourceRow } from "../../shared/types.js";

const TEXT_BUDGET_PER_SOURCE = 1500;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;

interface PlanToolInput {
  options: Array<{
    angle: string;
    title: string;
    primary_keyword: string;
    secondary_keywords: string[];
    sections: Array<{ key: string; heading: string; level: "h2" | "h3"; notes: string }>;
  }>;
}

const PLAN_TOOL_SCHEMA = {
  type: "object",
  properties: {
    options: {
      type: "array",
      minItems: MIN_OPTIONS,
      maxItems: MAX_OPTIONS,
      description: "2 to 3 genuinely different angles on the same idea, not reworded versions of one angle.",
      items: {
        type: "object",
        properties: {
          angle: { type: "string", description: "One sentence describing what makes this option's take distinct." },
          title: { type: "string", description: "The H1 title. Must include the primary_keyword." },
          primary_keyword: { type: "string" },
          secondary_keywords: { type: "array", items: { type: "string" } },
          sections: {
            type: "array",
            description: "The article's H2/H3 outline for this option.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Short slug id, e.g. 'why-it-matters'. Unique within this option." },
                heading: { type: "string" },
                level: { type: "string", enum: ["h2", "h3"] },
                notes: {
                  type: "string",
                  description: "What this section should cover and which source(s) it should draw on.",
                },
              },
              required: ["key", "heading", "level", "notes"],
            },
          },
        },
        required: ["angle", "title", "primary_keyword", "secondary_keywords", "sections"],
      },
    },
  },
  required: ["options"],
};

const PLAN_SYSTEM_PROMPT =
  "You are a content strategist planning article outlines grounded in the given sources. Produce 2 to 3 outlines with genuinely different angles — not the same article reworded. Follow the SEO guidance for title, keyword placement, and heading structure.";

// What's actually wrong with a plan response, if anything — checked
// after both the first attempt and the retry, so the caller only ever
// has to decide once whether to accept or give up.
function planIssues(result: PlanToolInput | null | undefined): string[] {
  const optionCount = result?.options?.length ?? 0;
  if (!result || !Array.isArray(result.options) || optionCount < MIN_OPTIONS) {
    return [
      `Only ${optionCount} option(s) were returned. At least ${MIN_OPTIONS} genuinely distinct angles are required — do not stop after one, and do not pad with a reworded duplicate.`,
    ];
  }
  const issues: string[] = [];
  for (const opt of result.options.slice(0, MAX_OPTIONS)) {
    if (!Array.isArray(opt.sections) || opt.sections.length === 0) {
      issues.push(`The "${opt.angle}" option has no outline sections. Every option needs a complete H2/H3 section outline.`);
    }
  }
  return issues;
}

/**
 * Calls Claude for plan options, and if the model under-delivers (too
 * few options, or an option with no sections), retries once with the
 * exact shortfall spelled out — the model doesn't know it fell short
 * unless told, so restating the requirement with what specifically was
 * missing measurably improves retry compliance (same approach as the
 * channel-output retry in adapt.ts). Whatever the second attempt
 * returns is handed back as-is; the caller does the final accept/reject
 * check once, in one place.
 */
async function generatePlanWithOneRetry(basePrompt: string): Promise<PlanToolInput> {
  const callOpts = {
    system: PLAN_SYSTEM_PROMPT,
    toolName: "record_plan_options",
    toolDescription: "Record 2-3 distinct outline options for the article.",
    inputSchema: PLAN_TOOL_SCHEMA,
    maxTokens: 6144,
  };

  const first = await callClaudeForJson<PlanToolInput>({ ...callOpts, prompt: basePrompt });
  const issues = planIssues(first);
  if (issues.length === 0) return first;

  const violationNote = `Your previous attempt did not meet the requirements:\n${issues.join("\n")}\nReturn ${MIN_OPTIONS} to ${MAX_OPTIONS} complete, genuinely distinct outline options this time.`;
  return callClaudeForJson<PlanToolInput>({ ...callOpts, prompt: `${basePrompt}\n\n${violationNote}` });
}

/**
 * Stage handler for 'sources_selected' -> 'planned'.
 *
 * Claude proposes 2-3 outlines with genuinely different angles, built
 * from the selected sources and assets/seo-best-practices.md. Each
 * option becomes its own drafts row (variant, angle, outline) with
 * empty sections — the next stage (draft) fills those in.
 */
export async function planContent(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("*")
    .eq("request_id", request.id)
    .eq("selected", true)
    .returns<SourceRow[]>();

  if (sourcesError) {
    throw new StageError(`Failed to load selected sources: ${sourcesError.message}`);
  }
  if (!sources || sources.length === 0) {
    throw new StageError(
      "No selected sources found for this request. This shouldn't be reachable from sources_selected — check the source selection stage.",
    );
  }

  const prompt = [
    `Content idea: ${request.idea}`,
    `Target audience: ${request.target_audience}`,
    request.tone ? `Desired tone: ${request.tone}` : null,
    request.keywords?.length ? `Requested keywords: ${request.keywords.join(", ")}` : null,
    request.supporting_material ? `Supporting material from the requester:\n${request.supporting_material}` : null,
    "",
    "SEO guidance to follow when planning structure and keywords:",
    SEO_BEST_PRACTICES,
    "",
    "Selected sources to plan from:",
    buildSourceContext(sources, TEXT_BUDGET_PER_SOURCE),
  ]
    .filter(Boolean)
    .join("\n");

  const result = await generatePlanWithOneRetry(prompt);

  if (!result || !Array.isArray(result.options) || result.options.length < MIN_OPTIONS) {
    throw new StageError(
      `The AI came back with fewer than ${MIN_OPTIONS} usable article angles for this idea, even after an automatic retry. This is uncommon — try running this stage again, and if it keeps happening, the selected sources may be too narrow to support multiple distinct angles.`,
      { raw: result },
    );
  }

  const options = result.options.slice(0, MAX_OPTIONS);

  const emptyOptionIndex = options.findIndex((opt) => !Array.isArray(opt.sections) || opt.sections.length === 0);
  if (emptyOptionIndex !== -1) {
    throw new StageError(
      `The AI's outline for one option ("${options[emptyOptionIndex].angle}") came back with no sections, even after an automatic retry. This is uncommon — try running this stage again.`,
      { raw: options[emptyOptionIndex] },
    );
  }

  const rows = options.map((opt, i) => {
    const outline: DraftOutline = {
      title: opt.title,
      primary_keyword: opt.primary_keyword,
      secondary_keywords: opt.secondary_keywords ?? [],
      sections: opt.sections.map((s) => ({ key: s.key, heading: s.heading, level: s.level, notes: s.notes })),
    };
    return {
      request_id: request.id,
      variant: i + 1,
      angle: opt.angle,
      outline,
      sections: [],
      attempt: 1,
      selected: false,
    };
  });

  const { error: insertError } = await supabase.from("drafts").insert(rows);
  if (insertError) {
    throw new StageError(`Failed to write draft option rows: ${insertError.message}`, { rows });
  }

  return {
    nextStage: "planned",
    detail: { optionCount: rows.length, angles: rows.map((r) => r.angle) },
  };
}
