import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { StageError } from "./errors.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return client;
}

export const CLAUDE_MODEL = "claude-sonnet-5";

/**
 * Claude's forced tool-use calls occasionally serialize an array-typed
 * property as a JSON string instead of an actual array — seen in
 * practice as either the bare array re-stringified (`"[...]"`) or the
 * whole object double-wrapped under the same key again
 * (`{"sections": "{\"sections\": [...]}"}`). It shows up specifically on
 * schemas whose array items carry large, quote-heavy text blocks (drafts
 * and revisions) — not something a schema `type` constraint alone
 * prevents. This unwraps either shape back into a real array so a
 * one-off serialization quirk doesn't get treated the same as a
 * genuinely empty response (which callers should still fail loudly on).
 */
export function coerceToolArray(value: unknown, key: string): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)[key])) {
      return (parsed as Record<string, unknown>)[key] as unknown[];
    }
  } catch {
    // Not valid JSON either — fall through to null.
  }
  return null;
}

interface ToolCallParams {
  system: string;
  content: Anthropic.MessageParam["content"];
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}

// Shared by callClaudeForJson and callClaudeForJsonWithFile — the only
// difference between them is how the user message's `content` is built
// (plain prompt string vs. a file block + prompt text); the tool-forcing
// call itself and every failure mode below it are identical.
async function callClaudeForToolUse<T>(params: ToolCallParams): Promise<T> {
  const anthropic = getClient();

  const request = {
    model: CLAUDE_MODEL,
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    messages: [{ role: "user" as const, content: params.content }],
    tools: [
      {
        name: params.toolName,
        description: params.toolDescription,
        input_schema: params.inputSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool" as const, name: params.toolName },
  };

  let response;
  try {
    response = await anthropic.messages.create(request);
  } catch {
    // One automatic retry before giving up: a network blip or transient
    // overload is common enough that surfacing it as a stage failure —
    // forcing a human to click "retry" themselves — defeats the point of
    // an unattended pipeline for something that's usually gone on the
    // very next try. Only the second attempt's error is what a caller
    // ever sees.
    try {
      response = await anthropic.messages.create(request);
    } catch (err: any) {
      throw new StageError(`Claude API call failed: ${err.message ?? err}`, { error: String(err) });
    }
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === params.toolName,
  );

  // Checked before the "no tool call" case: a response cut off by
  // max_tokens can still include a tool_use block, just with truncated/
  // incomplete input (e.g. an array that stops partway through). Left
  // undetected, that surfaces later as a confusing "returned no
  // sections" style error far from the actual cause — this makes the
  // real cause explicit immediately, whichever stage hit it.
  if (response.stop_reason === "max_tokens") {
    throw new StageError(
      "Claude's response was cut off by the token limit before it finished — increase maxTokens for this call.",
      { stopReason: response.stop_reason, partialInput: toolUse?.input ?? null },
    );
  }

  if (!toolUse) {
    throw new StageError("Claude did not return the expected structured tool call", {
      stopReason: response.stop_reason,
      content: response.content,
    });
  }

  return toolUse.input as T;
}

/**
 * Calls Claude with a tool-use forced call so the response is a schema
 * requirement, not a request we hope the model honors. Returns the
 * parsed tool input. Throws StageError (raw response attached) if the
 * model does not call the tool or the JSON doesn't parse — callers must
 * not guess at a partial/malformed result.
 *
 * `isValid`, when given, catches a narrower failure the JSON Schema
 * itself can't rule out — e.g. an array property with no `minItems` that
 * Claude satisfies with `[]`, a technically-schema-valid but useless
 * response. A result that fails it is retried once before being handed
 * back as-is; callers still validate the final result themselves and
 * throw their own StageError, this just avoids making every human click
 * "retry" by hand for what's usually a one-off on the very next call.
 */
export async function callClaudeForJson<T>(params: {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
  isValid?: (result: T) => boolean;
}): Promise<T> {
  const result = await callClaudeForToolUse<T>({ ...params, content: params.prompt });
  if (params.isValid && !params.isValid(result)) {
    return callClaudeForToolUse<T>({ ...params, content: params.prompt });
  }
  return result;
}

/**
 * Same contract as callClaudeForJson, but the user message carries an
 * attached file (PDF or image) ahead of the prompt text — used for
 * extracting text from an uploaded document rather than working from a
 * plain string. mediaType must be one Claude actually accepts as a
 * document/image block (checked by the caller before this is reached).
 */
export async function callClaudeForJsonWithFile<T>(params: {
  system: string;
  prompt: string;
  fileBase64: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const fileBlock: Anthropic.MessageParam["content"][number] =
    params.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.fileBase64 } };

  return callClaudeForToolUse<T>({ ...params, content: [fileBlock, { type: "text", text: params.prompt }] });
}
