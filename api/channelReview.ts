import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, supabaseAdmin } from "./_lib/auth.js";
import { HttpError, StageError } from "./_lib/errors.js";
import { reviseChannelOutput } from "./_lib/channelRevise.js";
import { notifyManagerOfChannelDecision, notifyReviewersOfChannelRevision } from "./_lib/staffNotifications.js";
import type { ChannelOutputRow, ContentRequestRow, DraftRow } from "../shared/types.js";

// The reviewer's per-channel sign-off on adapted content (LinkedIn/X/
// newsletter), separate from api/advance.ts because these actions don't
// change content_requests.stage — the request sits at 'adapting' for
// the whole review, only reaching 'queued' once every channel_output is
// approved (enforced in api/_stages/queue.ts, not just by hiding the
// button). Mirrors api/sources.ts's shape: one endpoint, an `action`
// field, per-action role and stage checks.

interface ActionBody {
  requestId?: string;
  action?: string;
  channelOutputId?: string;
  comment?: string;
  prompt?: string;
}

async function loadRequest(requestId: string): Promise<ContentRequestRow> {
  const { data, error } = await supabaseAdmin.from("content_requests").select("*").eq("id", requestId).maybeSingle<ContentRequestRow>();
  if (error) throw new HttpError(500, `Failed to load request: ${error.message}`);
  if (!data) throw new HttpError(404, "Content request not found");
  return data;
}

/** Confirms the channel output actually belongs to this request (via its draft) — not just any id the caller happens to pass. */
async function loadChannelOutput(requestId: string, channelOutputId: string): Promise<ChannelOutputRow> {
  const { data: output, error: outputError } = await supabaseAdmin
    .from("channel_outputs")
    .select("*")
    .eq("id", channelOutputId)
    .maybeSingle<ChannelOutputRow>();
  if (outputError) throw new HttpError(500, `Failed to load channel output: ${outputError.message}`);
  if (!output) throw new HttpError(404, "Channel output not found");

  const { data: draft, error: draftError } = await supabaseAdmin
    .from("drafts")
    .select("request_id")
    .eq("id", output.draft_id)
    .maybeSingle<Pick<DraftRow, "request_id">>();
  if (draftError) throw new HttpError(500, `Failed to load the channel output's draft: ${draftError.message}`);
  if (!draft || draft.request_id !== requestId) {
    throw new HttpError(404, "That channel output doesn't belong to this request.");
  }
  return output;
}

async function logEvent(requestId: string, event: string, ok: boolean, detail: unknown) {
  await supabaseAdmin.from("events").insert({ request_id: requestId, stage: "adapting", event, ok, detail });
}

function requireAdapting(request: ContentRequestRow) {
  if (request.stage !== "adapting") {
    throw new HttpError(409, `Channel outputs can only be reviewed at the 'adapting' stage (current stage: '${request.stage}').`);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authedUser = await requireStaff(req.headers.authorization);
    const body = (req.body ?? {}) as ActionBody;
    const { requestId, action, channelOutputId } = body;

    if (!requestId || typeof requestId !== "string") throw new HttpError(400, "requestId is required");
    if (!action || typeof action !== "string") throw new HttpError(400, "action is required");
    if (!channelOutputId || typeof channelOutputId !== "string") throw new HttpError(400, "channelOutputId is required");

    const request = await loadRequest(requestId);
    requireAdapting(request);

    // Same-person guard as review.ts's draft decisions — there's no DB
    // trigger backstop here (unlike forbid_self_approval on the
    // approvals table), so this code check is the actual enforcement,
    // not just a clearer error before one.
    if (authedUser.role === "reviewer" && authedUser.userId === request.created_by) {
      throw new HttpError(403, "You cannot review your own request's channel outputs.");
    }

    const output = await loadChannelOutput(requestId, channelOutputId);

    switch (action) {
      case "approve": {
        if (authedUser.role !== "reviewer") throw new HttpError(403, "Only a reviewer can approve a channel output.");
        const { error } = await supabaseAdmin
          .from("channel_outputs")
          .update({ approved_at: new Date().toISOString(), approved_by: authedUser.userId, revision_requested_comment: null })
          .eq("id", channelOutputId);
        if (error) throw new HttpError(500, `Failed to approve: ${error.message}`);
        await logEvent(requestId, "channel_approved", true, { channelOutputId, channel: output.channel });
        await notifyManagerOfChannelDecision(supabaseAdmin, request, output.channel, "approved", null);
        break;
      }

      case "revise": {
        if (authedUser.role !== "reviewer") throw new HttpError(403, "Only a reviewer can send a channel output back for revision.");
        const comment = typeof body.comment === "string" ? body.comment.trim() : "";
        if (!comment) throw new HttpError(400, "A comment is required to send a channel output back for revision.");
        const { error } = await supabaseAdmin
          .from("channel_outputs")
          .update({ revision_requested_comment: comment, approved_at: null, approved_by: null })
          .eq("id", channelOutputId);
        if (error) throw new HttpError(500, `Failed to flag for revision: ${error.message}`);
        await logEvent(requestId, "channel_revision_requested", true, { channelOutputId, channel: output.channel, comment });
        await notifyManagerOfChannelDecision(supabaseAdmin, request, output.channel, "revise", comment);
        break;
      }

      case "revise_with_ai": {
        if (authedUser.role !== "manager") throw new HttpError(403, "Only a manager can run the AI revision for a channel output.");
        if (!output.revision_requested_comment) {
          throw new HttpError(409, "This channel output has no pending revision request.");
        }
        const prompt = typeof body.prompt === "string" ? body.prompt : null;
        try {
          await reviseChannelOutput(supabaseAdmin, output, prompt);
        } catch (err: any) {
          const message = err instanceof Error ? err.message : String(err);
          await logEvent(requestId, "channel_revise_failed", false, { channelOutputId, channel: output.channel, message });
          throw err instanceof StageError ? new HttpError(500, message) : err;
        }
        await logEvent(requestId, "channel_revised", true, { channelOutputId, channel: output.channel });
        await notifyReviewersOfChannelRevision(supabaseAdmin, request, output.channel);
        break;
      }

      default:
        throw new HttpError(400, `Unknown action '${action}'`);
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}
