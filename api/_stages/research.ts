import { scrapeUrl, searchWeb, type ScrapeResult } from "../_lib/firecrawl.js";
import { StageError } from "../_lib/errors.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import { EXCLUDED_SEARCH_DOMAINS, type SourceInsert, type SourceRow } from "../../shared/types.js";
import { buildSearchQuery } from "../_lib/searchQuery.js";

// How many successfully-fetched sources we're aiming for. Search
// candidates are topped up in batches until we hit this or run out of
// candidates — filtering alone (stopping at the first N candidates,
// counting failures against the total) would silently leave a request
// under-sourced whenever a chunk of results turn out unscrapable.
const TARGET_SUCCESSFUL_SOURCES = 6;

// Hard ceiling on total scrape attempts from search, independent of
// TARGET_SUCCESSFUL_SOURCES, so a pathological topic (almost everything
// unscrapable) can't make this stage attempt an unbounded number of
// fetches.
const MAX_SEARCH_CANDIDATES = 12;

// Scraped this many at a time; after each batch we check whether the
// target's been hit before starting another, so we don't scrape more
// than necessary.
const SEARCH_BATCH_SIZE = 4;

const EXCERPT_LENGTH = 600;

function toSourceRow(requestId: string, result: ScrapeResult): SourceInsert {
  if (result.ok) {
    return {
      request_id: requestId,
      url: result.url,
      title: result.title,
      publisher: result.publisher,
      published_at: result.publishedAt,
      raw_text: result.text,
      excerpt: result.text.slice(0, EXCERPT_LENGTH),
      selected: false,
      selection_reason: null,
      fetch_ok: true,
      fetch_error: null,
      failure_reason: null,
      origin: "scraped" as const,
      search_round: 1,
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
    origin: "scraped" as const,
    search_round: 1,
  };
}

/**
 * Stage handler for 'requested' -> 'researching'.
 *
 * Any source URLs the manager supplied at request creation are already
 * in the `sources` table by the time this runs (added via the same
 * add-URL path as the manual "add a source" form, before this stage's
 * auto-start fires — see NewRequest.tsx and api/sources.ts's add_url
 * action). This only tops up from web search — excluding platforms known
 * to be unscrapable — counting what's already there toward the target
 * and skipping any URL already attempted, until either
 * TARGET_SUCCESSFUL_SOURCES successful fetches are reached (across
 * manually-supplied and searched sources combined) or search candidates
 * run out. Writes ONE sources row per NEW url actually attempted,
 * including failures — a source that could not be read is information,
 * not noise to discard.
 *
 * Individual fetch failures do not fail this stage; only a hard failure
 * to even attempt research (e.g. the search call itself throwing, with
 * nothing else to fall back on) does. Whether enough usable material was
 * retrieved to proceed is judged by the next stage (source selection),
 * not here.
 */
export async function runResearch(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: existingSources, error: existingError } = await supabase
    .from("sources")
    .select("*")
    .eq("request_id", request.id)
    .returns<SourceRow[]>();
  if (existingError) throw new StageError(`Failed to load existing sources: ${existingError.message}`);

  const existing = existingSources ?? [];
  let successCount = existing.filter((s) => s.fetch_ok).length;
  const alreadyConsidered = new Set(existing.map((s) => s.url).filter((u): u is string => Boolean(u)));

  const rows: SourceInsert[] = [];

  let searchHits: { url: string; title: string | null }[] = [];
  if (successCount < TARGET_SUCCESSFUL_SOURCES) {
    const query = buildSearchQuery(request.idea, request.keywords ?? []);
    try {
      searchHits = await searchWeb(query, MAX_SEARCH_CANDIDATES, EXCLUDED_SEARCH_DOMAINS);
    } catch (err: any) {
      // A failed search is only fatal if we also have nothing else to
      // fall back on (no manually-supplied sources already in place).
      if (existing.length === 0) {
        throw new StageError(
          "The web search failed and there were no manually supplied sources to fall back on. Try again, or go back and add a source URL or paste material directly.",
          { error: String(err) },
        );
      }
    }
  }

  const candidates = searchHits.map((h) => h.url).filter((url) => !alreadyConsidered.has(url));

  let i = 0;
  while (successCount < TARGET_SUCCESSFUL_SOURCES && i < candidates.length) {
    const batch = candidates.slice(i, i + SEARCH_BATCH_SIZE);
    i += batch.length;
    const results = await Promise.all(batch.map((url) => scrapeUrl(url)));
    for (const result of results) {
      rows.push(toSourceRow(request.id, result));
      if (result.ok) successCount++;
    }
  }

  if (rows.length === 0 && existing.length === 0) {
    throw new StageError(
      "No sources were supplied and the web search didn't return anything to read. Go back and add a source URL or paste material directly, or try again in case this was temporary.",
      { idea: request.idea, keywords: request.keywords },
    );
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("sources").insert(rows);
    if (insertError) {
      throw new StageError(`Failed to write sources rows: ${insertError.message}`, { rows });
    }
  }

  return {
    nextStage: "researching",
    detail: {
      preExisting: existing.length,
      attempted: rows.length,
      successful: rows.filter((r) => r.fetch_ok).length,
      failed: rows.filter((r) => !r.fetch_ok).length,
    },
  };
}
