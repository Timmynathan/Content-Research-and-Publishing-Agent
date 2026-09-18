import { useEffect, useState } from "react";
import type { DraftRow, EvaluationRow, SourceRow } from "../../shared/types";
import DraftCard from "./DraftCard";
import StatusPill from "./ui/StatusPill";
import IconButton from "./ui/IconButton";
import Button from "./ui/Button";
import { CloseIcon } from "./ui/icons";

/**
 * Side-by-side "document page" previews of each article option, faded out
 * at the bottom rather than fully rendered — comparing 2-3 full drafts
 * stacked vertically meant scrolling past one's entire rubric table and
 * claims list just to see the next option existed. Clicking a preview
 * pops the full DraftCard (scores, claims, revision history included) up
 * in an overlay, leaving the grid underneath untouched.
 *
 * `selection`, when given, turns this from a read-only board (the
 * manager's view) into a pick-one board (the reviewer's): a radio on
 * each card and a "choose this option" action inside the expanded
 * modal, both calling the same onSelect so picking works whether the
 * reviewer decides from the grid or after reading the full option.
 */
export default function DraftOptionsBoard({
  drafts,
  evaluations,
  sources,
  selection,
}: {
  drafts: DraftRow[];
  evaluations: EvaluationRow[];
  sources: SourceRow[];
  selection?: { selectedId: string | null; onSelect: (draftId: string) => void };
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
      // Capped to the same width as the expanded-option modal below —
      // .card has no max-width of its own (it just fills whatever
      // container it's in), and .article-body's reading-width cap
      // (68ch) left a wide, empty gutter to its right once this was the
      // only draft left (e.g. after approval deletes the others) instead
      // of the two- or three-column grid this used to sit in.
      <div className="stack" style={{ maxWidth: 780 }}>
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
              {(selection || evaluation) && (
                <div className="btn-row" style={{ marginBottom: 6 }}>
                  {selection && (
                    <input
                      type="radio"
                      name="chosenDraft"
                      checked={selection.selectedId === draft.id}
                      onChange={() => selection.onSelect(draft.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Choose option ${draft.variant} to approve or reject`}
                    />
                  )}
                  {evaluation && (
                    <StatusPill tone={evaluation.passed ? "success" : "warning"}>
                      {evaluation.passed ? "passed" : "failed"}
                    </StatusPill>
                  )}
                </div>
              )}
              {draft.image_url && (
                <img
                  src={draft.image_url}
                  alt={draft.image_alt ?? ""}
                  style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, marginBottom: 8, display: "block" }}
                />
              )}

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
            {selection && (
              <div className="btn-row" style={{ marginBottom: 10 }}>
                <Button
                  variant={selection.selectedId === expandedDraft.id ? "primary" : "secondary"}
                  onClick={() => selection.onSelect(expandedDraft.id)}
                >
                  {selection.selectedId === expandedDraft.id ? "Chosen for approval/rejection" : "Choose this option"}
                </Button>
              </div>
            )}
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
