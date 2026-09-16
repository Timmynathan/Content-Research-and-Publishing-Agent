import { createHash } from "node:crypto";
import { callClaudeForJson } from "../_lib/anthropic.js";
import { StageError } from "../_lib/errors.js";
import { LINKEDIN_FORMATTING_RULES, X_FORMATTING_RULES, NEWSLETTER_FORMATTING_RULES } from "../_lib/guidance.js";
import { validateLinkedIn, validateX, validateNewsletter, type ValidationResult } from "../_lib/channelValidators.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { ApprovalRow, DraftRow } from "../../shared/types.js";

function hashDraftContent(draft: DraftRow): string {
  return createHash("sha256").update(JSON.stringify(draft.sections)).digest("hex");
}

function articleText(draft: DraftRow): string {
  return draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
}

interface BodyOnlyInput {
  body: string;
}

interface SubjectBodyInput {
  subject: string;
  body: string;
}

const BODY_SCHEMA = {
  type: "object",
  properties: { body: { type: "string" } },
  required: ["body"],
};

const SUBJECT_BODY_SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
};

async function generateWithOneRetry<T extends { body: string }>(opts: {
  system: string;
  buildPrompt: (violationNote: string | null) => string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  validate: (result: T) => ValidationResult;
}): Promise<{ result: T; validation: ValidationResult; retried: boolean }> {
  const first = await callClaudeForJson<T>({
    system: opts.system,
    prompt: opts.buildPrompt(null),
    toolName: opts.toolName,
    toolDescription: opts.toolDescription,
    inputSchema: opts.schema,
    maxTokens: 2048,
  });
  const firstValidation = opts.validate(first);
  if (firstValidation.valid) {
    return { result: first, validation: firstValidation, retried: false };
  }

  // Prefer the concrete, actionable instructions (exact target length,
  // exact word count to cut/add) over just restating what was wrong —
  // a model doesn't count characters as it writes, so leaving it to do
  // that arithmetic itself is a weaker signal than handing it the
  // already-computed target.
  const violationNote = `Your previous attempt failed validation. Fix it exactly as follows: ${
    (firstValidation.retryHints.length ? firstValidation.retryHints : firstValidation.issues).join(" ")
  }`;
  const second = await callClaudeForJson<T>({
    system: opts.system,
    prompt: opts.buildPrompt(violationNote),
    toolName: opts.toolName,
    toolDescription: opts.toolDescription,
    inputSchema: opts.schema,
    maxTokens: 2048,
  });
  const secondValidation = opts.validate(second);
  return { result: second, validation: secondValidation, retried: true };
}

/**
 * Stage handler for 'approved' -> 'adapting'.
 *
 * First re-checks that the approval is still for the CURRENT content of
 * the approved draft — if the draft changed since approval, the
 * approval is stale and this hands back to 'ready_for_review' instead
 * of adapting stale content (this is a normal outcome, not a failure).
 * Otherwise generates LinkedIn, X, and newsletter versions, each
 * validated in code against assets/channel-formatting-rules.md's
 * countable limits — never trusted on the model's word, and never
 * silently truncated or marked valid when it isn't. An invalid output
 * gets one regeneration attempt with the violation stated; if it's
 * still invalid, it's stored as invalid and surfaced, not discarded.
 */
export async function adaptContent(ctx: HandlerCtx): Promise<HandlerResult> {
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
  if (!approval) throw new StageError("No approved decision found for this request — cannot adapt without one.");

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", approval.draft_id)
    .maybeSingle<DraftRow>();
  if (draftError) throw new StageError(`Failed to load approved draft: ${draftError.message}`);
  if (!draft) throw new StageError("The approved draft no longer exists.");

  const currentHash = hashDraftContent(draft);
  if (currentHash !== approval.content_hash) {
    return {
      nextStage: "ready_for_review",
      detail: {
        staleApproval: true,
        note: "The approved draft's content changed since it was approved. Sending this back for a fresh review rather than adapting stale content.",
      },
    };
  }

  const article = articleText(draft);
  const context = [
    `Original article title: ${draft.outline.title}`,
    `Target audience: ${request.target_audience}`,
    request.tone ? `Desired tone: ${request.tone}` : null,
    "",
    "Full approved article:",
    article,
  ]
    .filter(Boolean)
    .join("\n");

  const [linkedin, x, newsletter] = await Promise.all([
    generateWithOneRetry<BodyOnlyInput>({
      system: "You are adapting an approved article into a LinkedIn post. Follow the platform rules exactly.",
      buildPrompt: (violation) =>
        [context, "", "LinkedIn formatting rules:", LINKEDIN_FORMATTING_RULES, violation ? `\n${violation}` : null]
          .filter(Boolean)
          .join("\n"),
      toolName: "record_linkedin_post",
      toolDescription: "Record the LinkedIn post body.",
      schema: BODY_SCHEMA,
      validate: (r) => validateLinkedIn(r.body),
    }),
    generateWithOneRetry<BodyOnlyInput>({
      system: "You are adapting an approved article into an X post. Follow the platform rules exactly, including the hard character limit.",
      buildPrompt: (violation) =>
        [context, "", "X formatting rules:", X_FORMATTING_RULES, violation ? `\n${violation}` : null]
          .filter(Boolean)
          .join("\n"),
      toolName: "record_x_post",
      toolDescription: "Record the X post body.",
      schema: BODY_SCHEMA,
      validate: (r) => validateX(r.body),
    }),
    generateWithOneRetry<SubjectBodyInput>({
      system: "You are adapting an approved article into an email newsletter. Follow the formatting rules exactly, including the word count range.",
      buildPrompt: (violation) =>
        [context, "", "Newsletter formatting rules:", NEWSLETTER_FORMATTING_RULES, violation ? `\n${violation}` : null]
          .filter(Boolean)
          .join("\n"),
      toolName: "record_newsletter",
      toolDescription: "Record the newsletter subject and body.",
      schema: SUBJECT_BODY_SCHEMA,
      validate: (r) => validateNewsletter(r.subject, r.body),
    }),
  ]);

  const rows = [
    {
      draft_id: draft.id,
      channel: "linkedin" as const,
      subject: null,
      body: linkedin.result.body,
      validation: { ...linkedin.validation, retried: linkedin.retried },
      valid: linkedin.validation.valid,
    },
    {
      draft_id: draft.id,
      channel: "x" as const,
      subject: null,
      body: x.result.body,
      validation: { ...x.validation, retried: x.retried },
      valid: x.validation.valid,
    },
    {
      draft_id: draft.id,
      channel: "newsletter" as const,
      subject: newsletter.result.subject,
      body: newsletter.result.body,
      validation: { ...newsletter.validation, retried: newsletter.retried },
      valid: newsletter.validation.valid,
    },
  ];

  const { error: insertError } = await supabase.from("channel_outputs").insert(rows);
  if (insertError) throw new StageError(`Failed to save channel outputs: ${insertError.message}`, { rows });

  return {
    nextStage: "adapting",
    detail: { validCount: rows.filter((r) => r.valid).length, total: rows.length },
  };
}
