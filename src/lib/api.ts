import { supabase } from "./supabaseClient";
import type { AdvanceResponse } from "../../shared/types";

export class ApiError extends Error {}

async function authedPost(path: string, body: unknown): Promise<any> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new ApiError("Not signed in");
  }

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const responseBody = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(responseBody?.error ?? `Request failed with status ${res.status}`);
  }

  return responseBody;
}

export async function advanceRequest(requestId: string): Promise<AdvanceResponse> {
  return authedPost("/api/advance", { requestId });
}

/** Generates (or, if already generated, just returns) the short display heading for a request. */
export async function generateShortTitle(requestId: string): Promise<string> {
  const { shortTitle } = await authedPost("/api/generateShortTitle", { requestId });
  return shortTitle;
}

export async function addSourceUrl(requestId: string, url: string): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "add_url", url });
}

export async function pasteSource(requestId: string, text: string, title?: string): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "paste", text, title });
}

export async function toggleSourceSelection(requestId: string, sourceId: string, selected: boolean): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "toggle_selection", sourceId, selected });
}

export async function searchMoreSources(requestId: string, query?: string): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "search_more", query });
}

export async function proceedAnyway(requestId: string): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "proceed_anyway" });
}

export async function goBackToResearching(requestId: string): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "go_back" });
}

/**
 * The recovery path now that source selection is no longer a checkpoint
 * the pipeline waits at: discards the current drafts (and everything
 * built on them — evaluations, channel outputs) and reopens source
 * editing, so a manager who doesn't like what the automation produced
 * can fix the sources and let it run again from source selection.
 */
export async function changeSourcesAndRedraft(requestId: string): Promise<void> {
  await authedPost("/api/sources", { requestId, action: "change_sources_and_redraft" });
}

export async function submitReviewDecision(
  requestId: string,
  decision: "approved" | "rejected",
  draftId: string,
  comment?: string,
): Promise<AdvanceResponse> {
  return authedPost("/api/advance", { requestId, decision, draftId, comment });
}

export async function retryPublishQueueItem(queueItemId: string): Promise<void> {
  await authedPost("/api/queue", { action: "retry_send", queueItemId });
}

/**
 * Self-reported, not verified — there's no posting integration for
 * LinkedIn/X to check against, so this records "a manager says they
 * posted this," not "the app confirmed it posted."
 */
export async function markQueueItemPosted(queueItemId: string): Promise<void> {
  await authedPost("/api/queue", { action: "mark_posted", queueItemId });
}

/** Same as markQueueItemPosted, for callers that only have the channel_output id (e.g. the request detail page). */
export async function markChannelOutputPosted(channelOutputId: string): Promise<void> {
  await authedPost("/api/queue", { action: "mark_posted", channelOutputId });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ApiError("Couldn't read the file."));
    reader.onload = () => {
      // readAsDataURL yields "data:<mime>;base64,<data>" — the server
      // only wants the raw base64 payload.
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads a PDF or image and returns the text Claude reads off it — used
 * to fill in "supporting material" from a file instead of pasting text
 * by hand. Word docs aren't supported yet (see api/extractText.ts).
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const dataBase64 = await readFileAsBase64(file);
  const { text } = await authedPost("/api/extractText", {
    filename: file.name,
    mediaType: file.type,
    dataBase64,
  });
  return text ?? "";
}
