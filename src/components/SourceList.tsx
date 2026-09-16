import type { SourceRow } from "../../shared/types";
import { FETCH_FAILURE_LABELS } from "../lib/fetchFailureLabels";
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

function SourceRowView({
  source,
  isRequestSourceUrl,
  editable,
  onToggle,
}: {
  source: SourceRow;
  isRequestSourceUrl: boolean;
  editable?: boolean;
  onToggle?: (selected: boolean) => void;
}) {
  const domain = domainOf(source.url);
  const displayTitle = source.title ?? source.url ?? "(pasted text, no title)";

  return (
    <div className="source-row">
      {editable && source.fetch_ok && (
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

        {!source.fetch_ok && (
          <div className="source-row-reason">
            <StatusPill tone="warning">
              {source.failure_reason ? FETCH_FAILURE_LABELS[source.failure_reason] : "Couldn't be read"}
            </StatusPill>
            {isRequestSourceUrl && <> This was your supplied source — go back and paste its text directly instead.</>}
            {source.fetch_error && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--text-subtle)" }}>Raw error</summary>
                <p className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                  {source.fetch_error}
                </p>
              </details>
            )}
          </div>
        )}

        {source.fetch_ok && !source.selected && source.selection_reason !== null && (
          <div className="source-row-reason">
            <StatusPill tone="neutral">not selected</StatusPill>
          </div>
        )}

        {source.fetch_ok && !source.selected && source.selection_reason === null && (
          <div className="source-row-reason">
            <StatusPill tone="neutral">awaiting selection</StatusPill>
          </div>
        )}

        {source.selection_reason && <div className="source-row-reason">{source.selection_reason}</div>}

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
 * headline; the skipped group (fetch failures and anything not
 * selected) is collapsed by default rather than presented as equally
 * weighted rows.
 */
export default function SourceList({
  sources,
  requestSourceUrl,
  editable = false,
  onToggle,
}: {
  sources: SourceRow[];
  requestSourceUrl?: string | null;
  editable?: boolean;
  onToggle?: (sourceId: string, selected: boolean) => void;
}) {
  if (sources.length === 0) {
    return <p className="subtitle">No sources retrieved yet.</p>;
  }

  const used = sources.filter((s) => s.fetch_ok && s.selected);
  const skipped = sources.filter((s) => !s.fetch_ok || !s.selected);

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
          isRequestSourceUrl={Boolean(s.url && s.url === requestSourceUrl)}
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
            {skipped.length} skipped
          </summary>
          <div style={{ marginTop: 4 }}>
            {skipped.map((s) => (
              <SourceRowView
                key={s.id}
                source={s}
                isRequestSourceUrl={Boolean(s.url && s.url === requestSourceUrl)}
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
