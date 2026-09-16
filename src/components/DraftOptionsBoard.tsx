import { useEffect, useState } from "react";
import type { DraftRow, EvaluationRow, SourceRow } from "../../shared/types";
import DraftCard from "./DraftCard";
import StatusPill from "./ui/StatusPill";
import IconButton from "./ui/IconButton";
import { CloseIcon } from "./ui/icons";

/**
 * Side-by-side "document page" previews of each article option, faded out
 * at the bottom rather than fully rendered — comparing 2-3 full drafts
 * stacked vertically meant scrolling past one's entire rubric table and
 * claims list just to see the next option existed. Clicking a preview
 * pops the full DraftCard (scores, claims, revision history included) up
 * in an overlay, leaving the grid underneath untouched.
 */
export default function DraftOptionsBoard({
  drafts,
  evaluations,
  sources,
}: {
  drafts: DraftRow[];
  evaluations: EvaluationRow[];
  sources: SourceRow[];
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedDraft = expandedId ? (drafts.find((d) => d.id === expandedId) ?? null) : null;

  useEffect(() => {
    if (!expandedDraft) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedId(null);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [expandedDraft]);

  if (drafts.length <= 1) {
    return (
      <div className="stack">
        <h3 style={{ margin: 0 }}>Article options</h3>
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            evaluationsForDraft={evaluations.filter((e) => e.draft_id === draft.id)}
            sources={sources}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Article options</h3>
      <p className="subtitle" style={{ margin: 0 }}>
        Click an option to read it in full.
      </p>
      <div className="draft-option-grid">
        {drafts.map((draft) => {
          const evaluation = evaluations.find((e) => e.draft_id === draft.id && e.attempt === draft.attempt) ?? null;
          const flaggedCount = draft.sections.reduce((sum, s) => sum + s.claims.filter((c) => c.flagged).length, 0);

          return (
            <div
              key={draft.id}
              className="draft-option-card"
              role="button"
              tabIndex={0}
              onClick={() => setExpandedId(draft.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedId(draft.id);
                }
              }}
            >
              <div className="btn-row" style={{ marginBottom: 6 }}>
                <StatusPill tone={evaluation ? (evaluation.passed ? "success" : "warning") : "neutral"}>
                  {evaluation ? (evaluation.passed ? "meets rubric" : "below rubric") : "not yet scored"}
                </StatusPill>
              </div>
              <div className="list-row-title" style={{ marginBottom: 4 }}>
                Option {draft.variant}: {draft.angle}
              </div>

              <p className="subtitle draft-option-card-title">
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

              <div className="draft-option-card-body">
                {draft.sections.length === 0 && <p className="subtitle">Not drafted yet.</p>}
                {draft.sections.map((section) => (
                  <div key={section.key} className="draft-option-section">
                    <div className="draft-option-section-heading">{section.heading}</div>
                    <p className="draft-option-section-text">{section.body}</p>
                  </div>
                ))}
                <div className="draft-option-fade" />
              </div>

              <span className="draft-option-expand-hint">Read full option ▸</span>
            </div>
          );
        })}
      </div>

      {expandedDraft && (
        <div className="ui-modal-backdrop" onClick={() => setExpandedId(null)}>
          <div className="ui-modal" onClick={(e) => e.stopPropagation()}>
            <IconButton className="ui-modal-close" label="Close" onClick={() => setExpandedId(null)}>
              <CloseIcon />
            </IconButton>
            <DraftCard
              draft={expandedDraft}
              evaluationsForDraft={evaluations.filter((e) => e.draft_id === expandedDraft.id)}
              sources={sources}
            />
          </div>
        </div>
      )}
    </div>
  );
}
