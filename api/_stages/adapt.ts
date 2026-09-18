import { StageError } from "../_lib/errors.js";
import { generateLinkedInPost, generateXPost, generateNewsletter } from "../_lib/channelGenerate.js";
import { notifyReviewersOfChannelsReady } from "../_lib/staffNotifications.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import type { DraftRow } from "../../shared/types.js";

function articleText(draft: DraftRow): string {
  return draft.sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n");
}

/**
 * Stage handler for 'approved' -> 'adapting'.
 *
 * The winning draft is whichever one decideNextStage (evaluate.ts)
 * marked selected=true — there's no human article-approval decision
 * left to read instead (see migrations/011). Generates LinkedIn, X, and
 * newsletter versions (see _lib/channelGenerate.ts), each validated in
 * code against assets/channel-formatting-rules.md's countable limits —
 * never trusted on the model's word, and never silently truncated or
 * marked valid when it isn't. An invalid output gets one regeneration
 * attempt with the violation stated; if it's still invalid, it's stored
 * as invalid and surfaced, not discarded.
 *
 * 'adapting' is NOT auto-advanced past (see AUTO_ADVANCE_STAGES in
 * api/advance.ts) — every channel output needs a reviewer's sign-off
 * (approve or send back for revision — see api/channelReview.ts and
 * channelRevise.ts) before queueContent will move this to 'queued'.
 * The reviewer is notified here, the moment there's something for them
 * to look at.
 */
export async function adaptContent(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("request_id", request.id)
    .eq("selected", true)
    .maybeSingle<DraftRow>();
  if (draftError) throw new StageError(`Failed to load the selected draft: ${draftError.message}`);
  if (!draft) throw new StageError("No selected draft found for this request — cannot adapt without one.");

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
    generateLinkedInPost(context),
    generateXPost(context),
    generateNewsletter(context),
  ]);

  const rows = [
    {
      draft_id: draft.id,
      channel: "linkedin" as const,
      subject: linkedin.subject,
      body: linkedin.body,
      validation: { ...linkedin.validation, retried: linkedin.retried },
      valid: linkedin.validation.valid,
    },
    {
      draft_id: draft.id,
      channel: "x" as const,
      subject: x.subject,
      body: x.body,
      validation: { ...x.validation, retried: x.retried },
      valid: x.validation.valid,
    },
    {
      draft_id: draft.id,
      channel: "newsletter" as const,
      subject: newsletter.subject,
      body: newsletter.body,
      validation: { ...newsletter.validation, retried: newsletter.retried },
      valid: newsletter.validation.valid,
    },
  ];

  const { error: insertError } = await supabase.from("channel_outputs").insert(rows);
  if (insertError) throw new StageError(`Failed to save channel outputs: ${insertError.message}`, { rows });

  await notifyReviewersOfChannelsReady(supabase, request);

  return {
    nextStage: "adapting",
    detail: { validCount: rows.filter((r) => r.valid).length, total: rows.length },
  };
}
