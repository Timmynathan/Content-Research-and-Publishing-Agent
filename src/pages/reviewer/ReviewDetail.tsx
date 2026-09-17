// Requirements this page must keep (do not blur with the manager's
// view in src/pages/manager/RequestDetail.tsx):
//
// - The reviewer sees: the source list, which sources support which
//   claims, any unsupported claims, and the thinly-sourced warning if
//   it applies. They get NO source editing controls at all — no
//   checkboxes, no add/paste/search-more/proceed-anyway/redraft. Those
//   are manager-only (enforced server-side in api/sources.ts too, not
//   just by omitting the buttons here).
// - Unsupported claims and the thinly-sourced warning must be the most
//   prominent things on this page — more prominent than they are on
//   the manager's view, since the reviewer is the last person who can
//   catch them before the article goes out.

import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { submitReviewDecision, ApiError } from "../../lib/api";
import type { ContentRequestRow, DraftRow, EvaluationRow, SourceRow } from "../../../shared/types";
import DraftOptionsBoard from "../../components/DraftOptionsBoard";
import SourceList from "../../components/SourceList";
import Field from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";

function ReviewSkeleton() {
  return (
    <div className="stack">
      <Skeleton style={{ height: 26, width: "60%" }} />
      <Skeleton style={{ height: 120 }} />
      <Skeleton style={{ height: 200 }} />
    </div>
  );
}

export default function ReviewDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [request, setRequest] = useState<ContentRequestRow | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chosenDraftId, setChosenDraftId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: requestData, error: requestError }, { data: sourcesData }, { data: draftsData }] = await Promise.all([
      supabase.from("content_requests").select("*").eq("id", id).maybeSingle<ContentRequestRow>(),
      supabase.from("sources").select("*").eq("request_id", id).order("created_at", { ascending: true }).returns<SourceRow[]>(),
      supabase.from("drafts").select("*").eq("request_id", id).order("variant", { ascending: true }).returns<DraftRow[]>(),
    ]);

    if (requestError) {
      setLoadError(requestError.message);
      return;
    }
    setRequest(requestData ?? null);
    setSources(sourcesData ?? []);
    setDrafts(draftsData ?? []);

    const draftIds = (draftsData ?? []).map((d) => d.id);
    if (draftIds.length > 0) {
      const { data: evaluationsData } = await supabase
        .from("evaluations")
        .select("*")
        .in("draft_id", draftIds)
        .order("created_at", { ascending: true })
        .returns<EvaluationRow[]>();
      setEvaluations(evaluationsData ?? []);
      // Only ever default-select a draft that actually passed — a
      // reviewer shouldn't land on a failing option just because it
      // happened to be first.
      const passingIds = (draftsData ?? [])
        .filter((d) => (evaluationsData ?? []).some((e) => e.draft_id === d.id && e.attempt === d.attempt && e.passed))
        .map((d) => d.id);
      setChosenDraftId((current) => current ?? passingIds[0] ?? null);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDecision(decision: "approved" | "rejected") {
    if (!id || !chosenDraftId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitReviewDecision(id, decision, chosenDraftId, comment.trim() || undefined);
      navigate("/review");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Failed to submit decision.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} />;
  if (!request) return <ReviewSkeleton />;

  // A reviewer only ever sees options that actually passed evaluation —
  // one still sitting at ready_for_review despite failing (it hit the
  // revision attempt cap; see decideNextStage in api/stages/evaluate.ts)
  // is filtered out here rather than shown flagged, so there's nothing
  // to accidentally approve that the rubric already rejected.
  const passingDrafts = drafts.filter((d) =>
    evaluations.some((e) => e.draft_id === d.id && e.attempt === d.attempt && e.passed),
  );

  const flaggedByDraft = passingDrafts.map((d) => ({
    draft: d,
    flagged: d.sections.flatMap((s) => s.claims.filter((c) => c.flagged).map((c) => ({ section: s.heading, claim: c }))),
  }));
  const totalFlagged = flaggedByDraft.reduce((sum, d) => sum + d.flagged.length, 0);

  return (
    <div className="stack">
      <div className="page-header">
        <h1>{request.short_title ?? request.idea}</h1>
        <p className="subtitle">For {request.target_audience}</p>
      </div>

      {request.thinly_sourced && (
        <ErrorState
          tone="warning"
          message="Thinly sourced. A manager chose to proceed with fewer usable sources than the normal floor. Weigh that before approving."
        />
      )}

      {totalFlagged > 0 && (
        <div className="ui-error ui-error-danger" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <strong>
            {totalFlagged} unsupported claim{totalFlagged === 1 ? "" : "s"} across{" "}
            {flaggedByDraft.filter((d) => d.flagged.length > 0).length} option
            {flaggedByDraft.filter((d) => d.flagged.length > 0).length === 1 ? "" : "s"}.
          </strong>
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {flaggedByDraft.map(
              ({ draft, flagged }) =>
                flagged.length > 0 && (
                  <li key={draft.id} style={{ marginBottom: 6 }}>
                    Option {draft.variant} ({draft.angle}):
                    <ul style={{ paddingLeft: 18 }}>
                      {flagged.map((f, i) => (
                        <li key={i}>
                          [{f.section}] "{f.claim.text}" — {f.claim.flag_reason}
                        </li>
                      ))}
                    </ul>
                  </li>
                ),
            )}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>Sources</h3>
        <SourceList sources={sources.filter((s) => s.selected)} />
      </div>

      {passingDrafts.length > 0 ? (
        <DraftOptionsBoard
          drafts={passingDrafts}
          evaluations={evaluations}
          sources={sources}
          selection={{ selectedId: chosenDraftId, onSelect: setChosenDraftId }}
        />
      ) : (
        <EmptyState
          title="No option passed evaluation"
          message="Every drafted option is still flagged below the quality bar even after the revision limit. There's nothing here a reviewer should approve as-is — this needs a manager to revisit the sources or the brief, not a review decision."
        />
      )}

      <div className="card">
        <h3>Decision</h3>
        {submitError && <ErrorState message={submitError} />}
        <Field label="Comment (required for rejection, optional for approval)" htmlFor="review-comment">
          <textarea
            id="review-comment"
            className="ui-textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Notes for the manager…"
          />
        </Field>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <Button variant="primary" onClick={() => handleDecision("approved")} loading={submitting} disabled={!chosenDraftId}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => handleDecision("rejected")} loading={submitting} disabled={!chosenDraftId}>
            Reject with comment
          </Button>
        </div>
      </div>
    </div>
  );
}
