import { useState } from "react";
import { searchMoreSources, ApiError } from "../lib/api";
import { MAX_SEARCH_ROUNDS } from "../../shared/types";
import Button from "./ui/Button";
import ErrorState from "./ui/ErrorState";

// Manager-only manual source control. Adding a URL directly or pasting
// text was removed from this page — to supply material that way, the
// manager goes back to the researching step instead (see the back-arrow
// control on the request detail page). What's left here is topping up
// via search with the request's original terms — the primary, most-used
// action, so it's shown directly rather than tucked behind a collapsed
// disclosure.
export default function SourceManagementForms({
  requestId,
  maxRound,
  onChanged,
  showSearchMore = true,
}: {
  requestId: string;
  maxRound: number;
  onChanged: () => void | Promise<void>;
  /**
   * False when zero sources have been retrieved at all — per the
   * spec, that case doesn't offer another automated search. A search
   * that already returned nothing is a weak signal the same kind of
   * search will help again.
   */
  showSearchMore?: boolean;
}) {
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const roundCapReached = maxRound >= MAX_SEARCH_ROUNDS;

  async function handleSearchMore() {
    if (roundCapReached) return;
    setSearchBusy(true);
    setSearchError(null);
    try {
      await searchMoreSources(requestId);
      await onChanged();
    } catch (err) {
      setSearchError(err instanceof ApiError ? err.message : "Search failed.");
    } finally {
      setSearchBusy(false);
    }
  }

  if (!showSearchMore) return null;

  return (
    <div>
      {roundCapReached ? (
        <p className="subtitle">Research round cap reached for this request.</p>
      ) : (
        <>
          <div className="row">
            <span style={{ fontWeight: 500 }}>Not satisfied?</span>
            <Button variant="primary" onClick={handleSearchMore} loading={searchBusy}>
              Find more sources
            </Button>
          </div>
          <p className="subtitle" style={{ marginTop: 6 }}>
            Round {maxRound} of {MAX_SEARCH_ROUNDS} used.
          </p>
        </>
      )}
      {searchError && (
        <div style={{ marginTop: 6 }}>
          <ErrorState message={searchError} />
        </div>
      )}
    </div>
  );
}
