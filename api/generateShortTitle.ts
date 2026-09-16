import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, supabaseAdmin } from "./_lib/auth.js";
import { HttpError } from "./_lib/errors.js";
import { callClaudeForJson } from "./_lib/anthropic.js";
import type { ContentRequestRow } from "../shared/types.js";

// "idea" is a full prompt, often several sentences — fine to draft from,
// unreadable as a page heading. Generated once and cached on the row
// (short_title) rather than regenerated on every page view.

interface ShortTitleInput {
  heading: string;
}

const SHORT_TITLE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    heading: {
      type: "string",
      description:
        "A short, plain-language heading for this content request — 3 to 8 words, no ending punctuation, not clickbait. A label someone can scan to recognize the topic, not a rewrite of the full idea.",
    },
  },
  required: ["heading"],
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    await requireStaff(req.headers.authorization);

    const { requestId } = req.body ?? {};
    if (typeof requestId !== "string" || !requestId) {
      throw new HttpError(400, "requestId is required");
    }

    const { data: request, error: fetchError } = await supabaseAdmin
      .from("content_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle<ContentRequestRow>();
    if (fetchError) throw new HttpError(500, `Failed to load request: ${fetchError.message}`);
    if (!request) throw new HttpError(404, "Request not found");

    // Idempotent: if another tab/click already generated one, just return it.
    if (request.short_title) {
      res.status(200).json({ shortTitle: request.short_title });
      return;
    }

    const result = await callClaudeForJson<ShortTitleInput>({
      system: "You write short, plain-language headings for internal content requests.",
      prompt: `Content idea:\n${request.idea}`,
      toolName: "record_heading",
      toolDescription: "Record the short heading for this content request.",
      inputSchema: SHORT_TITLE_TOOL_SCHEMA,
      maxTokens: 200,
    });

    const shortTitle = result.heading?.trim();
    if (!shortTitle) throw new HttpError(500, "Claude returned an empty heading");

    const { error: updateError } = await supabaseAdmin
      .from("content_requests")
      .update({ short_title: shortTitle })
      .eq("id", requestId);
    if (updateError) throw new HttpError(500, `Failed to save heading: ${updateError.message}`);

    res.status(200).json({ shortTitle });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}
