import { StageError } from "../_lib/errors.js";
import type { HandlerCtx, HandlerResult } from "./types.js";
import { USABLE_SOURCE_FLOOR, type SourceRow } from "../../shared/types.js";

/**
 * Stage handler for 'researching' -> 'sources_selected' | 'sources_insufficient'.
 *
 * No AI judgment call here — every successfully-fetched source is marked
 * selected by default, and a human curates from there (check/uncheck on
 * the Sources tab, itself unlocked by 'sources_selected'/
 * 'sources_insufficient' being EDITABLE_STAGES). A source that failed to
 * fetch has no content to draft from, so it's left unselected regardless.
 *
 * This never throws for "not enough material" — that's not a failure of
 * this stage, it's a legitimate outcome the request can rest in:
 * - Zero sources fetched at all, or fewer than USABLE_SOURCE_FLOOR
 *   fetched successfully: land at 'sources_insufficient' with whatever
 *   was retrieved (all still marked selected — there's just not enough
 *   of it to meet the floor).
 * - Otherwise: 'sources_selected'.
 * A genuine failure (DB read/write fails) still throws normally and
 * keeps the request at 'researching' with stage_error set, retryable.
 */
export async function finalizeSources(ctx: HandlerCtx): Promise<HandlerResult> {
  const { request, supabase } = ctx;

  const { data: sources, error: fetchError } = await supabase
    .from("sources")
    .select("*")
    .eq("request_id", request.id)
    .returns<SourceRow[]>();
  if (fetchError) {
    throw new StageError(`Failed to load sources: ${fetchError.message}`);
  }

  const fetchedOk = (sources ?? []).filter((s) => s.fetch_ok);

  const toSelect = fetchedOk.filter((s) => !s.selected);
  if (toSelect.length > 0) {
    const { error: updateError } = await supabase
      .from("sources")
      // Worded to read correctly if a manager later unchecks it: the
      // "not selected" pill (SourceList.tsx) then communicates the
      // current curation state, this just explains why there was
      // anything to curate in the first place.
      .update({ selected: true, selection_reason: "Retrieved successfully." })
      .in(
        "id",
        toSelect.map((s) => s.id),
      );
    if (updateError) {
      throw new StageError(`Failed to mark sources selected: ${updateError.message}`);
    }
  }

  const nextStage = fetchedOk.length < USABLE_SOURCE_FLOOR ? "sources_insufficient" : "sources_selected";

  return {
    nextStage,
    detail: { totalFetched: sources?.length ?? 0, selected: fetchedOk.length },
  };
}
