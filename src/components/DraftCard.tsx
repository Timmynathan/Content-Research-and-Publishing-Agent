import type { ReactNode } from "react";
import type { DraftClaim, DraftRow, EvaluationRow, RubricCriterion, SourceRow } from "../../shared/types";
import { RUBRIC_CRITERIA, PASS_SCORE_THRESHOLD } from "../../shared/types";
import StatusPill from "./ui/StatusPill";

function sourceLabel(sources: SourceRow[], sourceId: string | null): string {
  if (!sourceId) return "(no source)";
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return "(unknown source)";
  return source.title ?? source.url ?? "(pasted source)";
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
    const label = claim.flagged ? (claim.flag_reason ?? "Unsupported claim") : sourceLabel(sources, claim.source_id);
    nodes.push(
      <span key={`claim-${i}`} className={`claim${claim.flagged ? " is-flagged" : ""}`} tabIndex={0}>
        {body.slice(m.start, m.end)}
        <sup className="claim-marker">{i + 1}</sup>
        <span className={`claim-popover${claim.flagged ? " is-flagged" : ""}`} role="tooltip">
          <span className="claim-popover-label">{claim.flagged ? "Unsupported" : "Source"}</span>
          <span className="claim-popover-excerpt">{label}</span>
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

  return (
    <div className="card">
      <div className="btn-row" style={{ marginBottom: 6 }}>
        <StatusPill tone="neutral">attempt {draft.attempt}</StatusPill>
        {latestEvaluation && (
          <StatusPill tone={latestEvaluation.passed ? "success" : "warning"}>
            {latestEvaluation.passed ? "passed" : "failed"}
          </StatusPill>
        )}
      </div>
      <div className="list-row-title" style={{ marginBottom: 4 }}>
        Option {draft.variant}: {draft.angle}
      </div>

      <div className="article">
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
      </div>

      {latestEvaluation && (
        <details style={{ marginTop: 8 }}>
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
