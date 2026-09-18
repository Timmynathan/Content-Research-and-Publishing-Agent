import { useRef, useState, type ReactNode } from "react";
import type { DraftClaim, DraftRow, EvaluationRow, RubricCriterion, SourceRow } from "../../shared/types";
import { RUBRIC_CRITERIA, PASS_SCORE_THRESHOLD } from "../../shared/types";
import StatusPill from "./ui/StatusPill";

function sourceLabelText(source: SourceRow | undefined): string {
  if (!source) return "(unknown source)";
  return source.title ?? source.url ?? "(pasted source)";
}

/** A source with no URL (a pasted source) has nothing to link to — the label is still shown, just as plain text. */
function SourceLink({ source }: { source: SourceRow | undefined }) {
  if (!source) return <>(unknown source)</>;
  if (!source.url) return <>{sourceLabelText(source)}</>;
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer">
      {sourceLabelText(source)}
    </a>
  );
}

/**
 * The claim and its source have to be visually connected — a
 * bibliography at the bottom of the article isn't that. Finds each
 * claim's exact text inside the section body and wraps it with a
 * superscript marker; hovering or focusing it shows the supporting
 * excerpt (or, for a flagged claim, why it's unsupported) in a popover.
 * A claim whose text can't be found verbatim in the body (rare —
 * whitespace/quoting drift from generation) is left unmarked rather
 * than guessed at.
 */
function renderBodyWithClaims(body: string, claims: DraftClaim[], sources: SourceRow[]): ReactNode {
  const matches: { start: number; end: number; claim: DraftClaim }[] = [];
  for (const claim of claims) {
    if (!claim.text) continue;
    const start = body.indexOf(claim.text);
    if (start === -1) continue;
    matches.push({ start, end: start + claim.text.length, claim });
  }
  matches.sort((a, b) => a.start - b.start);

  const resolved: typeof matches = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    resolved.push(m);
    cursor = m.end;
  }

  if (resolved.length === 0) return body;

  const nodes: ReactNode[] = [];
  let pos = 0;
  resolved.forEach((m, i) => {
    if (m.start > pos) nodes.push(body.slice(pos, m.start));
    const { claim } = m;
    const source = sources.find((s) => s.id === claim.source_id);
    nodes.push(
      <span key={`claim-${i}`} className={`claim${claim.flagged ? " is-flagged" : ""}`} tabIndex={0}>
        {body.slice(m.start, m.end)}
        <sup className="claim-marker">{i + 1}</sup>
        <span className={`claim-popover${claim.flagged ? " is-flagged" : ""}`} role="tooltip">
          <span className="claim-popover-label">{claim.flagged ? "Unsupported" : "Source"}</span>
          <span className="claim-popover-excerpt">
            {claim.flagged ? (claim.flag_reason ?? "Unsupported claim") : <SourceLink source={source} />}
          </span>
        </span>
      </span>,
    );
    pos = m.end;
  });
  if (pos < body.length) nodes.push(body.slice(pos));
  return nodes;
}

export default function DraftCard({
  draft,
  evaluationsForDraft,
  sources,
}: {
  draft: DraftRow;
  evaluationsForDraft: EvaluationRow[];
  sources: SourceRow[];
}) {
  const latestEvaluation = evaluationsForDraft.find((e) => e.attempt === draft.attempt) ?? null;
  const priorAttempts = evaluationsForDraft.filter((e) => e.attempt !== draft.attempt);

  const flaggedCount = draft.sections.reduce((sum, s) => sum + s.claims.filter((c) => c.flagged).length, 0);

  // Every distinct, non-flagged source actually cited by a claim
  // somewhere in this draft — a proper references list, not just the
  // per-claim hover popover, so the sourcing is skimmable at a glance
  // instead of requiring hovering every superscript one at a time.
  const citedSourceIds = Array.from(
    new Set(draft.sections.flatMap((s) => s.claims.filter((c) => !c.flagged && c.source_id).map((c) => c.source_id as string))),
  );
  const citedSources = citedSourceIds.map((id) => sources.find((s) => s.id === id)).filter((s): s is SourceRow => Boolean(s));

  const scoresRef = useRef<HTMLDetailsElement>(null);
  const [scoresOpen, setScoresOpen] = useState(false);

  function openScores() {
    setScoresOpen(true);
    // Native <details> needs a tick to actually render its content open
    // before scrollIntoView has anything below the fold to scroll to.
    requestAnimationFrame(() => scoresRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  return (
    <div className="card">
      <div className="btn-row" style={{ marginBottom: 6 }}>
        <StatusPill tone="neutral">attempt {draft.attempt}</StatusPill>
        {latestEvaluation && (
          <button
            type="button"
            onClick={openScores}
            title="See the rubric score breakdown"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <StatusPill tone={latestEvaluation.passed ? "success" : "warning"}>
              {latestEvaluation.passed ? "passed" : "failed"}
            </StatusPill>
          </button>
        )}
      </div>
      <div className="list-row-title" style={{ marginBottom: 4 }}>
        Option {draft.variant}: {draft.angle}
      </div>

      <div className="article">
        {draft.image_url && (
          <figure style={{ margin: "0 0 12px" }}>
            <img
              src={draft.image_url}
              alt={draft.image_alt ?? ""}
              style={{ width: "100%", borderRadius: 8, display: "block" }}
            />
            {draft.image_photographer && (
              <figcaption className="subtitle" style={{ marginTop: 4, fontSize: 12 }}>
                Photo by{" "}
                {draft.image_photographer_url ? (
                  <a href={draft.image_photographer_url} target="_blank" rel="noopener noreferrer">
                    {draft.image_photographer}
                  </a>
                ) : (
                  draft.image_photographer
                )}{" "}
                on{" "}
                <a href={draft.image_pexels_url ?? "https://www.pexels.com"} target="_blank" rel="noopener noreferrer">
                  Pexels
                </a>
              </figcaption>
            )}
          </figure>
        )}

        <p className="article-title">
          {draft.outline.title}
          {flaggedCount > 0 && (
            <>
              {" "}
              <StatusPill tone="danger">
                {flaggedCount} unsupported claim{flaggedCount === 1 ? "" : "s"}
              </StatusPill>
            </>
          )}
        </p>

        {draft.sections.length === 0 && <p className="subtitle">Not drafted yet.</p>}

        {draft.sections.map((section) => (
          <div key={section.key} className="article-section">
            <div className="article-heading">{section.heading}</div>
            <p className="article-body">{renderBodyWithClaims(section.body, section.claims, sources)}</p>
          </div>
        ))}

        {citedSources.length > 0 && (
          <div className="article-section">
            <div className="article-heading">References</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
              {citedSources.map((source) => (
                <li key={source.id} style={{ marginBottom: 4 }}>
                  <SourceLink source={source} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {latestEvaluation && (
        <details ref={scoresRef} open={scoresOpen} onToggle={(e) => setScoresOpen(e.currentTarget.open)} style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Rubric scores (attempt {latestEvaluation.attempt})
          </summary>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Score</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {RUBRIC_CRITERIA.map((criterion: RubricCriterion) => {
                const entry = latestEvaluation.scores[criterion];
                return (
                  <tr key={criterion}>
                    <td>{criterion}</td>
                    <td>
                      <StatusPill tone={entry.score >= PASS_SCORE_THRESHOLD ? "success" : "warning"}>
                        {entry.score}/5
                      </StatusPill>
                    </td>
                    <td className="subtitle">{entry.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {latestEvaluation.failing_sections.length > 0 && (
            <p className="subtitle" style={{ marginTop: 8 }}>
              Failing sections: {latestEvaluation.failing_sections.join(", ")}
            </p>
          )}
          {latestEvaluation.recommended_changes.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12, color: "var(--text-muted)" }}>
              {latestEvaluation.recommended_changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </details>
      )}

      {priorAttempts.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {priorAttempts.length} earlier attempt{priorAttempts.length === 1 ? "" : "s"}
          </summary>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Overall</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {priorAttempts.map((e) => (
                <tr key={e.id}>
                  <td>{e.attempt}</td>
                  <td>{e.overall.toFixed(1)}/5</td>
                  <td>
                    <StatusPill tone={e.passed ? "success" : "warning"}>{e.passed ? "passed" : "revised"}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
