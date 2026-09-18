import type { SupabaseClient } from "@supabase/supabase-js";
import { StageError } from "./errors.js";
import { generateLinkedInPost, generateXPost, generateNewsletter } from "./channelGenerate.js";
import type { ChannelOutputRow } from "../../shared/types.js";

/**
 * Regenerates ONE channel's output — unlike adapt.ts's initial
 * generation, this isn't a Stage handler (content_requests.stage stays
 * at 'adapting' throughout channel-level review; see
 * api/channelReview.ts, the only caller), so it lives here rather than
 * in _stages/.
 *
 * `promptOverride`, when given, is the manager's edited guidance from
 * the "Revise with AI" panel; falling back to the reviewer's original
 * revision_requested_comment mirrors revise.ts's draft-level pattern
 * exactly (run unedited via the generic retry path, or edited via the
 * dedicated one).
 */
export async function reviseChannelOutput(
  supabase: SupabaseClient,
  channelOutput: ChannelOutputRow,
  promptOverride: string | null,
): Promise<void> {
  const guidance = (promptOverride?.trim() || null) ?? channelOutput.revision_requested_comment;
  if (!guidance) {
    throw new StageError("No revision guidance available for this channel output — nothing to revise from.");
  }

  const context = [
    `Current ${channelOutput.channel} post${channelOutput.subject ? ` (subject: ${channelOutput.subject})` : ""}:`,
    channelOutput.body,
    "",
    "The reviewer sent this back with the following note — revise accordingly, keeping everything else about it the same:",
    guidance,
  ]
    .filter(Boolean)
    .join("\n");

  const generate =
    channelOutput.channel === "linkedin" ? generateLinkedInPost : channelOutput.channel === "x" ? generateXPost : generateNewsletter;

  let result;
  try {
    result = await generate(context);
  } catch (err: any) {
    throw new StageError(`Revising the ${channelOutput.channel} output failed. This is usually a one-off — try again.`, {
      channelOutputId: channelOutput.id,
      cause: err.message,
    });
  }

  const { error } = await supabase
    .from("channel_outputs")
    .update({
      subject: result.subject,
      body: result.body,
      validation: { ...result.validation, retried: result.retried },
      valid: result.validation.valid,
      revision_requested_comment: null,
      approved_at: null,
      approved_by: null,
    })
    .eq("id", channelOutput.id);
  if (error) throw new StageError(`Failed to save the revised ${channelOutput.channel} output: ${error.message}`, { channelOutputId: channelOutput.id });
}
