// One-off: regenerates a single channel output (X, by default) for a
// given request, using the same generate -> validate -> one retry with
// a concrete target logic as api/stages/adapt.ts, then updates the
// existing channel_outputs row in place. For when a request has already
// finished the pipeline and there's no in-app "retry this channel"
// button yet.
//
// Usage: node scripts/retry-channel-output.mjs <requestId> [channel]
//   channel defaults to "x"

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocket as NodeWebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = NodeWebSocket;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(join(rootDir, ".env"));
loadEnvFile(join(rootDir, ".env.local"));

const requestId = process.argv[2];
const channel = process.argv[3] ?? "x";
if (!requestId) {
  console.error("Usage: node scripts/retry-channel-output.mjs <requestId> [channel]");
  process.exit(1);
}
if (!["x", "linkedin"].includes(channel)) {
  console.error("channel must be 'x' or 'linkedin' (newsletter retries go through the Queue page's Retry send button)");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_CHARS = channel === "x" ? 280 : 3000;
const SAFETY_MARGIN = 20;

function validate(body) {
  const issues = [];
  const retryHints = [];
  if (!body.trim()) issues.push("Post is empty.");
  if (body.length > MAX_CHARS) {
    issues.push(`Post is ${body.length} characters, over the ${MAX_CHARS}-character limit.`);
    const target = MAX_CHARS - SAFETY_MARGIN;
    retryHints.push(
      `Rewrite the whole post tighter so it is at most ${target} characters (currently ${body.length} — cut at least ${body.length - target}). Don't just trim the end; shorten sentences throughout. Count as you go.`,
    );
  }
  if (channel === "x") {
    const hashtagCount = (body.match(/#\w+/g) ?? []).length;
    if (hashtagCount > 2) {
      issues.push(`${hashtagCount} hashtags used — the rules cap it at 1 to 2.`);
      retryHints.push("Remove hashtags until only 2 remain — keep the two most relevant ones.");
    }
  }
  return { valid: issues.length === 0, issues, retryHints };
}

async function generateBody(prompt, violationNote) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    system: `You are adapting an approved article into a ${channel === "x" ? "X" : "LinkedIn"} post. Follow the platform rules exactly, including the hard character limit.`,
    messages: [{ role: "user", content: violationNote ? `${prompt}\n\n${violationNote}` : prompt }],
    tools: [
      {
        name: "record_post",
        description: "Record the post body.",
        input_schema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
      },
    ],
    tool_choice: { type: "tool", name: "record_post" },
  });
  const toolUse = response.content.find((b) => b.type === "tool_use" && b.name === "record_post");
  if (!toolUse) throw new Error("Claude did not return the expected tool call");
  return toolUse.input.body;
}

async function main() {
  const { data: approval, error: approvalError } = await supabase
    .from("approvals")
    .select("*")
    .eq("request_id", requestId)
    .eq("decision", "approved")
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (approvalError) throw approvalError;
  if (!approval) throw new Error("No approved decision found for this request.");

  const [{ data: draft, error: draftError }, { data: request, error: requestError }] = await Promise.all([
    supabase.from("drafts").select("*").eq("id", approval.draft_id).maybeSingle(),
    supabase.from("content_requests").select("*").eq("id", requestId).maybeSingle(),
  ]);
  if (draftError) throw draftError;
  if (requestError) throw requestError;
  if (!draft) throw new Error("Approved draft no longer exists.");

  const { data: existingOutput, error: outputError } = await supabase
    .from("channel_outputs")
    .select("*")
    .eq("draft_id", draft.id)
    .eq("channel", channel)
    .maybeSingle();
  if (outputError) throw outputError;
  if (!existingOutput) throw new Error(`No existing ${channel} channel output found for this draft.`);

  const article = draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
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

  console.log(`Regenerating ${channel} post for "${draft.outline.title}"...`);

  let body = await generateBody(context, null);
  let result = validate(body);
  let retried = false;

  if (!result.valid) {
    console.log("First attempt failed:", result.issues.join(" "));
    console.log("Retrying with:", result.retryHints.join(" "));
    const violationNote = `Your previous attempt failed validation. Fix it exactly as follows: ${result.retryHints.join(" ")}`;
    body = await generateBody(context, violationNote);
    result = validate(body);
    retried = true;
  }

  console.log(`Result: ${result.valid ? "VALID" : "STILL INVALID"} (${body.length} chars)`);
  console.log(body);

  const { error: updateError } = await supabase
    .from("channel_outputs")
    .update({ body, valid: result.valid, validation: { ...result, retried } })
    .eq("id", existingOutput.id);
  if (updateError) throw updateError;

  console.log(`\nUpdated channel_outputs row ${existingOutput.id}. Reload the request/queue page to see it.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
