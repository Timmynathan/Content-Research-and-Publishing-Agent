import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, supabaseAdmin } from "./_lib/auth.js";
import { HttpError } from "./_lib/errors.js";
import { scrapeUrl, searchWeb } from "./_lib/firecrawl.js";
import { buildSearchQuery } from "./_lib/searchQuery.js";
import {
  EXCLUDED_SEARCH_DOMAINS,
  MAX_SEARCH_ROUNDS,
  type ContentRequestRow,
  type SourceInsert,
  type SourceRow,
} from "../shared/types.js";
import type { ScrapeResult } from "./_lib/firecrawl.js";

// All actions here are manual source management on top of the
// automated research/selection pass — adding, pasting, toggling, and
// re-searching. They belong to the manager only (server-side role
// check below, not just a hidden button): the reviewer's job is to
// approve or reject the *output*, not to edit the evidence it's built
// on. Blurring that line is exactly what the approval gate exists to
// prevent.

const EXCERPT_LENGTH = 600;
const SEARCH_MORE_LIMIT = 6;

// Stages where the source list is still open for manual editing
// (toggling selection, topping up via search). Once the request has
// moved past sources_selected, editing is locked (see the
// forbid_source_changes_after_selection_locked DB trigger, which is the
// real enforcement — these in-code checks just produce a clearer error
// message before hitting it).
const EDITABLE_STAGES = new Set(["sources_selected", "sources_insufficient"]);

// Adding a URL or pasting text directly is only offered BEFORE
// selection has run — anything added here is picked up automatically
// by the next Claude selection pass, same as an automatically-found
// source. "Go back" (below) returns a request from sources_selected/
// sources_insufficient to 'researching' specifically so these forms
// become available again without re-scraping.
const PRE_SELECTION_STAGES = new Set(["requested", "researching"]);

// "Change sources and redraft" is for the drafting/review window only —
// before a human has approved anything. It must NOT be reachable once a
// draft is approved, adapted, queued, or published: deleting drafts at
// that point cascades to the approval record and any publish_queue
// entries too, which would erase the record of content that may already
// be live. Correcting an approved/published piece needs a different,
// more deliberate process than this lightweight unlock button.
const REDRAFT_UNLOCKABLE_STAGES = new Set(["planned", "drafting", "evaluating", "revising", "ready_for_review"]);

interface ActionBody {
  requestId?: string;
  action?: string;
  url?: string;
  text?: string;
  title?: string;
  sourceId?: string;
  selected?: boolean;
  query?: string;
}

async function loadRequest(requestId: string): Promise<ContentRequestRow> {
  const { data, error } = await supabaseAdmin
    .from("content_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle<ContentRequestRow>();
  if (error) throw new HttpError(500, `Failed to load request: ${error.message}`);
  if (!data) throw new HttpError(404, "Content request not found");
  return data;
}

async function loadSources(requestId: string): Promise<SourceRow[]> {
  const { data, error } = await supabaseAdmin
    .from("sources")
    .select("*")
    .eq("request_id", requestId)
    .returns<SourceRow[]>();
  if (error) throw new HttpError(500, `Failed to load sources: ${error.message}`);
  return data ?? [];
}

async function logEvent(requestId: string, stage: string, event: string, ok: boolean, detail: unknown) {
  await supabaseAdmin.from("events").insert({ request_id: requestId, stage, event, ok, detail });
}

function requireEditable(request: ContentRequestRow) {
  if (!EDITABLE_STAGES.has(request.stage)) {
    throw new HttpError(
      409,
      `Source selection is locked at stage '${request.stage}'. Use "Change sources and redraft" to unlock before editing sources.`,
    );
  }
}

function requirePreSelection(request: ContentRequestRow) {
  if (!PRE_SELECTION_STAGES.has(request.stage)) {
    throw new HttpError(
      409,
      `Adding or pasting a source isn't available at stage '${request.stage}'. Use "Go back" first to return to researching.`,
    );
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authedUser = await requireStaff(req.headers.authorization);
    if (authedUser.role !== "manager") {
      throw new HttpError(403, "Only a manager can add, paste, deselect, or re-search sources.");
    }

    const body = (req.body ?? {}) as ActionBody;
    const { requestId, action } = body;
    if (!requestId || typeof requestId !== "string") {
      throw new HttpError(400, "requestId is required");
    }
    if (!action || typeof action !== "string") {
      throw new HttpError(400, "action is required");
    }

    const request = await loadRequest(requestId);

    switch (action) {
      case "add_url":
        await handleAddUrl(request, body);
        break;
      case "paste":
        await handlePaste(request, body, authedUser.userId);
        break;
      case "toggle_selection":
        await handleToggle(request, body, authedUser.userId);
        break;
      case "search_more":
        await handleSearchMore(request, body);
        break;
      case "proceed_anyway":
        await handleProceedAnyway(request, authedUser.userId);
        break;
      case "change_sources_and_redraft":
        await handleChangeSourcesAndRedraft(request, authedUser.userId);
        break;
      case "go_back":
        await handleGoBack(request, authedUser.userId);
        break;
      default:
        throw new HttpError(400, `Unknown action '${action}'`);
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err?.message ?? "Internal error" });
  }
}

// Builds a sources row from a scrape outcome. Explicit SourceInsert
// return type keeps every caller structurally identical (raw_text:
// string | null etc.) rather than TS inferring two narrow literal
// shapes from the ok/fail branches, which Supabase's insert() then
// refuses for a batch array.
function scrapeResultToRow(
  requestId: string,
  result: ScrapeResult,
  opts: { selected: boolean; selectionReason: string | null; searchRound: number },
): SourceInsert {
  if (result.ok) {
    return {
      request_id: requestId,
      url: result.url,
      title: result.title,
      publisher: result.publisher,
      published_at: result.publishedAt,
      raw_text: result.text,
      excerpt: result.text.slice(0, EXCERPT_LENGTH),
      selected: opts.selected,
      selection_reason: opts.selectionReason,
      fetch_ok: true,
      fetch_error: null,
      failure_reason: null,
      origin: "scraped",
      search_round: opts.searchRound,
    };
  }
  return {
    request_id: requestId,
    url: result.url,
    title: null,
    publisher: null,
    published_at: null,
    raw_text: null,
    excerpt: null,
    selected: false,
    selection_reason: null,
    fetch_ok: false,
    fetch_error: result.error,
    failure_reason: result.reason,
    origin: "scraped",
    search_round: opts.searchRound,
  };
}

async function handleAddUrl(request: ContentRequestRow, body: ActionBody) {
  requirePreSelection(request);
  const url = body.url?.trim();
  if (!url) throw new HttpError(400, "url is required");

  const result = await scrapeUrl(url);
  const row = scrapeResultToRow(request.id, result, {
    selected: result.ok,
    selectionReason: result.ok ? "Added manually by the manager." : null,
    searchRound: 0,
  });

  const { error: insertError } = await supabaseAdmin.from("sources").insert(row);
  if (insertError) throw new HttpError(500, `Failed to add source: ${insertError.message}`);

  await logEvent(request.id, request.stage, "source_added", result.ok, { url, fetch_ok: result.ok });
}

async function handlePaste(request: ContentRequestRow, body: ActionBody, actorId: string) {
  requirePreSelection(request);
  const text = body.text?.trim();
  if (!text) throw new HttpError(400, "text is required");

  const row: SourceInsert = {
    request_id: request.id,
    url: null,
    title: body.title?.trim() || null,
    publisher: null,
    published_at: null,
    raw_text: text,
    excerpt: text.slice(0, EXCERPT_LENGTH),
    selected: true,
    selection_reason: "Pasted manually by the manager.",
    fetch_ok: true,
    fetch_error: null,
    failure_reason: null,
    origin: "pasted",
    search_round: 0,
  };

  const { error: insertError } = await supabaseAdmin.from("sources").insert(row);
  if (insertError) throw new HttpError(500, `Failed to add pasted source: ${insertError.message}`);

  await logEvent(request.id, request.stage, "source_pasted", true, { title: row.title, actorId });
}

async function handleToggle(request: ContentRequestRow, body: ActionBody, actorId: string) {
  requireEditable(request);
  const { sourceId, selected } = body;
  if (!sourceId || typeof selected !== "boolean") {
    throw new HttpError(400, "sourceId and selected are required");
  }

  const { data: source, error: loadError } = await supabaseAdmin
    .from("sources")
    .select("*")
    .eq("id", sourceId)
    .eq("request_id", request.id)
    .maybeSingle<SourceRow>();
  if (loadError) throw new HttpError(500, `Failed to load source: ${loadError.message}`);
  if (!source) throw new HttpError(404, "Source not found on this request");

  if (selected && !source.fetch_ok) {
    throw new HttpError(400, "Cannot select a source that failed to fetch: its content isn't available.");
  }

  // Recorded so the Sources tab can show a real reason for an excluded
  // source instead of a bare, unexplained "not selected" label — there's
  // no AI judgment anymore to ask why, so the only honest reason
  // available is that a person chose to leave it out. Cleared back to
  // null on re-selection: a currently-included source has nothing to
  // explain.
  const { error: updateError } = await supabaseAdmin
    .from("sources")
    .update({ selected, selection_reason: selected ? null : "A manager excluded it." })
    .eq("id", sourceId);
  if (updateError) throw new HttpError(500, `Failed to update source: ${updateError.message}`);

  await logEvent(request.id, request.stage, selected ? "source_selected" : "source_deselected", true, {
    sourceId,
    url: source.url,
    actorId,
  });
}

async function handleSearchMore(request: ContentRequestRow, body: ActionBody) {
  requireEditable(request);

  const existing = await loadSources(request.id);

  // Zero retrieved so far, still at sources_insufficient: the spec's
  // refusal case offers only "supply material yourself" or abandoning
  // the request — not another automated search. Enforced here too, not
  // just by hiding the button, since a client-side omission isn't a
  // control.
  if (request.stage === "sources_insufficient" && existing.filter((s) => s.fetch_ok).length === 0) {
    throw new HttpError(
      400,
      "Nothing has been retrieved yet for this request, so search again isn't offered here. Supply material yourself (add a URL or paste text) instead.",
    );
  }

  const rounds = existing.map((s) => s.search_round).filter((r) => r > 0);
  const currentMaxRound = rounds.length ? Math.max(...rounds) : 0;
  if (currentMaxRound >= MAX_SEARCH_ROUNDS) {
    throw new HttpError(409, `Research round cap (${MAX_SEARCH_ROUNDS}) reached for this request.`);
  }
  const newRound = currentMaxRound + 1;

  const query = body.query?.trim() || buildSearchQuery(request.idea, request.keywords ?? []);
  const alreadyConsidered = new Set(existing.map((s) => s.url).filter((u): u is string => Boolean(u)));

  const hits = await searchWeb(query, SEARCH_MORE_LIMIT + alreadyConsidered.size, EXCLUDED_SEARCH_DOMAINS);
  const candidates = hits.map((h) => h.url).filter((url) => !alreadyConsidered.has(url)).slice(0, SEARCH_MORE_LIMIT);

  if (candidates.length === 0) {
    await logEvent(request.id, request.stage, "sources_search_round", true, {
      round: newRound,
      query,
      attempted: 0,
      successful: 0,
      note: "no new candidates found",
    });
    return;
  }

  const results = await Promise.all(candidates.map((url) => scrapeUrl(url)));
  // Newly found sources default to unselected — a manager hasn't looked
  // at them yet, unlike the initial batch (finalizeSources marks those
  // selected automatically).
  const rows = results.map((result) =>
    scrapeResultToRow(request.id, result, {
      selected: false,
      selectionReason: "It was found via search and hasn't been reviewed yet.",
      searchRound: newRound,
    }),
  );

  const { error: insertError } = await supabaseAdmin.from("sources").insert(rows);
  if (insertError) throw new HttpError(500, `Failed to write new sources: ${insertError.message}`);

  const successful = rows.filter((r) => r.fetch_ok).length;
  await logEvent(request.id, request.stage, "sources_search_round", true, {
    round: newRound,
    query,
    attempted: rows.length,
    successful,
  });
}

async function handleProceedAnyway(request: ContentRequestRow, actorId: string) {
  if (request.stage !== "sources_insufficient") {
    throw new HttpError(409, `Can only proceed anyway from 'sources_insufficient', not '${request.stage}'.`);
  }

  const sources = await loadSources(request.id);
  const retrievedCount = sources.filter((s) => s.fetch_ok).length;
  const selectedCount = sources.filter((s) => s.selected).length;

  if (retrievedCount === 0) {
    throw new HttpError(
      400,
      "Cannot proceed with zero sources retrieved: there is nothing to ground an article in. Supply material first (paste text or add a URL).",
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("content_requests")
    .update({ stage: "sources_selected", stage_error: null, thinly_sourced: true })
    .eq("id", request.id);
  if (updateError) throw new HttpError(500, `Failed to proceed: ${updateError.message}`);

  await logEvent(request.id, "sources_insufficient", "sources_proceed_anyway", true, {
    retrievedCount,
    selectedCount,
    actorId,
  });
}

async function handleChangeSourcesAndRedraft(request: ContentRequestRow, actorId: string) {
  if (!REDRAFT_UNLOCKABLE_STAGES.has(request.stage)) {
    const reason = EDITABLE_STAGES.has(request.stage) || request.stage === "requested" || request.stage === "researching"
      ? "nothing is locked yet"
      : "the request has already been approved or gone past it, which needs a different process, not a source change";
    throw new HttpError(409, `Cannot change sources at stage '${request.stage}': ${reason}.`);
  }

  // Cascades to evaluations, channel_outputs, and approvals tied to
  // these drafts — discarding the drafts discards everything built on
  // top of them too, since it's all about-to-be-stale content.
  const { error: deleteError } = await supabaseAdmin.from("drafts").delete().eq("request_id", request.id);
  if (deleteError) throw new HttpError(500, `Failed to discard drafts: ${deleteError.message}`);

  // Also flips review_sources_before_drafting on, regardless of what it
  // was: a manager who just discarded a run to fix the sources almost
  // certainly wants to look before the pipeline drafts again, not have
  // it auto-advance past sources_selected before they can touch
  // anything (see the client's auto-advance effect in RequestDetail.tsx,
  // which checks exactly this flag).
  const { error: updateError } = await supabaseAdmin
    .from("content_requests")
    .update({ stage: "sources_selected", stage_error: null, thinly_sourced: false, review_sources_before_drafting: true })
    .eq("id", request.id);
  if (updateError) throw new HttpError(500, `Failed to unlock sources: ${updateError.message}`);

  await logEvent(request.id, request.stage, "sources_change_and_redraft", true, {
    previousStage: request.stage,
    actorId,
  });
}

// Returns a request from sources_selected/sources_insufficient to
// 'researching' — not 'requested', which would re-run the scrape/search
// from scratch and risk duplicate rows for the same URLs (research.ts
// doesn't dedupe against rows already in the table from a prior pass).
// 'researching' is the step right before selection, so this makes the
// add-URL/paste forms available again and lets the manager re-trigger
// finalizeSources (Continue) to mark anything just added as selected
// too. Existing sources rows are kept, not deleted — nothing already
// found is lost.
async function handleGoBack(request: ContentRequestRow, actorId: string) {
  if (!EDITABLE_STAGES.has(request.stage)) {
    throw new HttpError(409, `Cannot go back from stage '${request.stage}'.`);
  }

  const { error: updateError } = await supabaseAdmin
    .from("content_requests")
    .update({ stage: "researching", stage_error: null, thinly_sourced: false })
    .eq("id", request.id);
  if (updateError) throw new HttpError(500, `Failed to go back: ${updateError.message}`);

  await logEvent(request.id, request.stage, "sources_go_back", true, {
    previousStage: request.stage,
    actorId,
  });
}
