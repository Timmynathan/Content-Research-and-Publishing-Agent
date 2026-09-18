import { callClaudeForJson } from "./anthropic.js";
import { LINKEDIN_FORMATTING_RULES, X_FORMATTING_RULES, NEWSLETTER_FORMATTING_RULES } from "./guidance.js";
import { validateLinkedIn, validateX, validateNewsletter, type ValidationResult } from "./channelValidators.js";

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

export interface ChannelGenerateResult {
  subject: string | null;
  body: string;
  validation: ValidationResult;
  retried: boolean;
}

/**
 * Shared by the initial post-approval adaptation (adapt.ts) and a
 * reviewer-requested single-channel revision (channelRevise.ts): one
 * generation attempt, then — only if code-side validation fails — a
 * single retry with the concrete violation spelled out (exact target
 * length/word count, not just "you were over the limit"). Every caller
 * still checks `validation.valid` itself; a second failure is returned
 * as-is, not thrown, since an out-of-spec draft is still something a
 * reviewer should see and act on, not a hidden stage failure.
 */
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
 * `context` is the article (adapt.ts) or the current post plus the
 * reviewer's note (channelRevise.ts) — this function doesn't care which,
 * it just builds the channel-specific prompt around whatever context
 * it's handed.
 */
export async function generateLinkedInPost(context: string): Promise<ChannelGenerateResult> {
  const { result, validation, retried } = await generateWithOneRetry<BodyOnlyInput>({
    system: "You are adapting an approved article into a LinkedIn post. Follow the platform rules exactly.",
    buildPrompt: (violation) =>
      [context, "", "LinkedIn formatting rules:", LINKEDIN_FORMATTING_RULES, violation ? `\n${violation}` : null]
        .filter(Boolean)
        .join("\n"),
    toolName: "record_linkedin_post",
    toolDescription: "Record the LinkedIn post body.",
    schema: BODY_SCHEMA,
    validate: (r) => validateLinkedIn(r.body),
  });
  return { subject: null, body: result.body, validation, retried };
}

export async function generateXPost(context: string): Promise<ChannelGenerateResult> {
  const { result, validation, retried } = await generateWithOneRetry<BodyOnlyInput>({
    system: "You are adapting an approved article into an X post. Follow the platform rules exactly, including the hard character limit.",
    buildPrompt: (violation) =>
      [context, "", "X formatting rules:", X_FORMATTING_RULES, violation ? `\n${violation}` : null]
        .filter(Boolean)
        .join("\n"),
    toolName: "record_x_post",
    toolDescription: "Record the X post body.",
    schema: BODY_SCHEMA,
    validate: (r) => validateX(r.body),
  });
  return { subject: null, body: result.body, validation, retried };
}

export async function generateNewsletter(context: string): Promise<ChannelGenerateResult> {
  const { result, validation, retried } = await generateWithOneRetry<SubjectBodyInput>({
    system: "You are adapting an approved article into an email newsletter. Follow the formatting rules exactly, including the word count range.",
    buildPrompt: (violation) =>
      [context, "", "Newsletter formatting rules:", NEWSLETTER_FORMATTING_RULES, violation ? `\n${violation}` : null]
        .filter(Boolean)
        .join("\n"),
    toolName: "record_newsletter",
    toolDescription: "Record the newsletter subject and body.",
    schema: SUBJECT_BODY_SCHEMA,
    validate: (r) => validateNewsletter(r.subject, r.body),
  });
  return { subject: result.subject, body: result.body, validation, retried };
}
