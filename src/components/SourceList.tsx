import type { SourceRow } from "../../shared/types";
import { stripMarkdownForDisplay } from "../lib/stripMarkdown";
import StatusPill from "./ui/StatusPill";
import { ChevronRightIcon } from "./ui/icons";

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Only ever called with sources that fetched successfully — a source
// with no content can't be included or excluded, just discarded, so
// SourceList filters those out entirely before this ever renders.
function SourceRowView({
  source,
  editable,
  onToggle,
}: {
  source: SourceRow;
  editable?: boolean;
  onToggle?: (selected: boolean) => void;
}) {
  const domain = domainOf(source.url);
  const displayTitle = source.title ?? source.url ?? "(pasted text, no title)";

  return (
    <div className={`source-row${!source.selected ? " is-excluded" : ""}`}>
      {editable && (
        <span className="source-row-checkbox">
          <input
            type="checkbox"
            checked={source.selected}
            onChange={(e) => onToggle?.(e.target.checked)}
            aria-label={`Include ${displayTitle} in drafting`}
          />
        </span>
      )}
      <div className="source-row-body">
        {domain && <div className="source-row-domain">{domain}</div>}
        <div className="source-row-title">
          {source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {displayTitle}
            </a>
          ) : (
            displayTitle
          )}
          {source.origin === "pasted" && (
            <>
              {" "}
              <StatusPill tone="neutral">pasted</StatusPill>
            </>
          )}
          {source.search_round > 1 && (
            <>
              {" "}
              <StatusPill tone="neutral">round {source.search_round}</StatusPill>
            </>
          )}
        </div>

        {/* Only shown for an excluded source — the reason is always
            populated for one of those (see api/sources.ts: a manual
            uncheck, an unreviewed search result, or — for a request from
            before source selection stopped being AI-judged — Claude's
            original explanation). An included source has nothing more
            interesting to say than "included," which the checkbox
            already shows. A colon, not "because" — a "because" lead-in
            forces every reason to grammatically continue it, which broke
            for legacy, AI-written reasons that are their own standalone
            sentence ("A listicle of tool picks..."), not a clause. A
            colon just introduces the reason, whatever shape it's in. */}
        {!source.selected && source.selection_reason && (
          <div className="source-row-reason">This source was not selected: {source.selection_reason}</div>
        )}

        {source.excerpt && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>Excerpt</summary>
            <p className="source-row-excerpt">{stripMarkdownForDisplay(source.excerpt)}</p>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * Leads with what was used, not what failed — "N sources used" is the
 * headline; anything not selected is collapsed by default rather than
 * presented as equally weighted rows. Sources that failed to fetch are
 * discarded entirely rather than shown anywhere: there's no content to
 * include or exclude, so nothing about them is actionable here — a
 * failure worth knowing about surfaces through other means (events log,
 * the sources_insufficient flow), not as a dead row in this list.
 */
export default function SourceList({
  sources,
  editable = false,
  onToggle,
}: {
  sources: SourceRow[];
  editable?: boolean;
  onToggle?: (sourceId: string, selected: boolean) => void;
}) {
  const fetched = sources.filter((s) => s.fetch_ok);

  if (fetched.length === 0) {
    return <p className="subtitle">No sources retrieved yet.</p>;
  }

  const used = fetched.filter((s) => s.selected);
  const skipped = fetched.filter((s) => !s.selected);

  return (
    <div>
      <p className="source-list-summary">
        <strong>
          {used.length} source{used.length === 1 ? "" : "s"} used
        </strong>
        {editable && " · tick to include, untick to exclude"}
      </p>

      {used.map((s) => (
        <SourceRowView
          key={s.id}
          source={s}
          editable={editable}
          onToggle={editable ? (selected) => onToggle?.(s.id, selected) : undefined}
        />
      ))}

      {used.length === 0 && <p className="subtitle">Nothing selected yet.</p>}

      {skipped.length > 0 && (
        <details className="source-skipped-group" style={{ marginTop: 8 }}>
          <summary>
            <span className="disclosure-chevron">
              <ChevronRightIcon size={13} />
            </span>{" "}
            {skipped.length} not selected
          </summary>
          <div style={{ marginTop: 4 }}>
            {skipped.map((s) => (
              <SourceRowView
                key={s.id}
                source={s}
                editable={editable}
                onToggle={editable ? (selected) => onToggle?.(s.id, selected) : undefined}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
