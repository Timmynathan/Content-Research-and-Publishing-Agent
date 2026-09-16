import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import {
  advanceRequest,
  toggleSourceSelection,
  proceedAnyway,
  goBackToResearching,
  markChannelOutputPosted,
  generateShortTitle,
  ApiError,
} from "../../lib/api";
import type {
  ApprovalRow,
  ChannelOutputRow,
  ContentRequestRow,
  DraftRow,
  EvaluationRow,
  EventRow,
  SourceRow,
  Stage,
} from "../../../shared/types";
import { STAGE_ORDER } from "../../../shared/types";
import StageTrack from "../../components/StageTrack";
import SourceList from "../../components/SourceList";
import SourceManagementForms from "../../components/SourceManagementForms";
import AddPasteSourceForms from "../../components/AddPasteSourceForms";
import DraftOptionsBoard from "../../components/DraftOptionsBoard";
import ChannelPreview from "../../components/ChannelPreview";
import { ChannelBadge } from "../../components/ChannelIcon";
import { copyAndOpen, type CopyOpenableChannel } from "../../lib/copyAndOpen";
import { STAGE_LABELS } from "../../lib/stageLabels";
import { formatDateTime } from "../../lib/time";
import Button from "../../components/ui/Button";
import IconButton from "../../components/ui/IconButton";
import StatusPill from "../../components/ui/StatusPill";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";
import { ArrowLeftIcon } from "../../components/ui/icons";

// Stages where adding a URL or pasting text is available — before
// selection has run. Matches PRE_SELECTION_STAGES in api/sources.ts.
const PRE_SELECTION_STAGES = new Set(["requested", "researching"]);

// Stages where the manager can still edit which sources are selected.
// Matches EDITABLE_STAGES in api/sources.ts — kept in sync by hand since
// one lives in shared/types (client+server) risk and the other is a UI
// concern; if you change one, change the other.
const EDITABLE_STAGES = new Set(["sources_selected", "sources_insufficient"]);

// Each stage's output gets its own view rather than one long scrolling
// page — this maps a stage to the tab that shows what happened there.
type TabId = "sources" | "drafts" | "channels" | "events";
const SOURCES_TAB_STAGES = new Set(["requested", "researching", "sources_selected", "sources_insufficient"]);
const DRAFTS_TAB_STAGES = new Set(["planned", "drafting", "evaluating", "revising", "ready_for_review", "approved"]);
function tabForStage(stage: Stage): TabId {
  if (SOURCES_TAB_STAGES.has(stage)) return "sources";
  if (DRAFTS_TAB_STAGES.has(stage)) return "drafts";
  return "channels";
}

// Plain-language action labels for the advance button, keyed by the
// CURRENT stage (i.e. what clicking it is about to do) — "Run next
// stage (Researching)" describes the internal state machine, not what
// happens when you click it.
const STAGE_ACTION_LABELS: Partial<Record<Stage, string>> = {
  requested: "Start research",
  researching: "Select sources",
  planned: "Write draft",
  drafting: "Evaluate draft",
  evaluating: "Continue",
  revising: "Revise draft",
  approved: "Adapt for channels",
  adapting: "Queue for publishing",
  queued: "Publish",
};

function DetailSkeleton() {
  return (
    <div className="stack">
      <Skeleton style={{ height: 28, width: "50%" }} />
      <Skeleton style={{ height: 16, width: "30%" }} />
      <div className="card stack">
        <Skeleton style={{ height: 14, width: 120 }} />
        <Skeleton style={{ height: 40 }} />
      </div>
      <div className="card stack">
        <Skeleton style={{ height: 14, width: 80 }} />
        <Skeleton style={{ height: 60 }} />
        <Skeleton style={{ height: 60 }} />
      </div>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<ContentRequestRow | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [channelOutputs, setChannelOutputs] = useState<ChannelOutputRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [sourceActionError, setSourceActionError] = useState<string | null>(null);
  const [proceeding, setProceeding] = useState(false);
  const [goingBack, setGoingBack] = useState(false);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const [copyOutputError, setCopyOutputError] = useState<string | null>(null);
  const [eventStageFilter, setEventStageFilter] = useState<Stage | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("sources");
  // Only steer the tab automatically the first time the request loads —
  // once a manager has picked a tab by hand, later polls updating
  // request.stage shouldn't yank them somewhere else.
  const didSetInitialTab = useRef(false);

  // Source ids with a toggle currently in flight. The 4s poll (below)
  // runs on its own fixed schedule with no idea a toggle is mid-request
  // — without this guard, a poll landing between the optimistic update
  // and the server actually committing it would overwrite the checkbox
  // with the not-yet-updated value, which then flips back correct a few
  // seconds later once the next poll catches up. Keeping the optimistic
  // value for any pending id until its own request settles avoids that.
  const pendingToggles = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: requestData, error: requestError }, { data: sourcesData }, { data: eventsData }, { data: draftsData }] =
      await Promise.all([
        supabase.from("content_requests").select("*").eq("id", id).maybeSingle<ContentRequestRow>(),
        supabase.from("sources").select("*").eq("request_id", id).order("created_at", { ascending: true }).returns<SourceRow[]>(),
        supabase.from("events").select("*").eq("request_id", id).order("at", { ascending: false }).returns<EventRow[]>(),
        supabase.from("drafts").select("*").eq("request_id", id).order("variant", { ascending: true }).returns<DraftRow[]>(),
      ]);

    if (requestError) {
      setLoadError(requestError.message);
      return;
    }
    setRequest(requestData ?? null);
    setSources((current) => {
      if (!sourcesData) return [];
      if (pendingToggles.current.size === 0) return sourcesData;
      return sourcesData.map((fetched) => {
        if (!pendingToggles.current.has(fetched.id)) return fetched;
        const optimistic = current.find((s) => s.id === fetched.id);
        return optimistic ? { ...fetched, selected: optimistic.selected } : fetched;
      });
    });
    setEvents(eventsData ?? []);
    setDrafts(draftsData ?? []);

    const draftIds = (draftsData ?? []).map((d) => d.id);
    if (draftIds.length > 0) {
      const [{ data: evaluationsData }, { data: channelOutputsData }] = await Promise.all([
        supabase.from("evaluations").select("*").in("draft_id", draftIds).order("created_at", { ascending: true }).returns<EvaluationRow[]>(),
        supabase.from("channel_outputs").select("*").in("draft_id", draftIds).returns<ChannelOutputRow[]>(),
      ]);
      setEvaluations(evaluationsData ?? []);
      setChannelOutputs(channelOutputsData ?? []);
    } else {
      setEvaluations([]);
      setChannelOutputs([]);
    }

    const { data: approvalsData } = await supabase
      .from("approvals")
      .select("*")
      .eq("request_id", id)
      .order("decided_at", { ascending: false })
      .returns<ApprovalRow[]>();
    setApprovals(approvalsData ?? []);
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (request && !didSetInitialTab.current) {
      didSetInitialTab.current = true;
      setActiveTab(tabForStage(request.stage));
    }
  }, [request]);

  // "idea" is a full prompt, not a heading — generate a short display
  // title the first time this request is viewed without one. Guarded by
  // request id (not just a boolean) so navigating straight from one
  // request detail page to another re-fires it for the new one.
  const requestedShortTitleFor = useRef<string | null>(null);
  useEffect(() => {
    if (request && !request.short_title && requestedShortTitleFor.current !== request.id) {
      requestedShortTitleFor.current = request.id;
      generateShortTitle(request.id)
        .then((shortTitle) => {
          setRequest((current) => (current && current.id === request.id ? { ...current, short_title: shortTitle } : current));
        })
        .catch(() => {
          // Silent — the heading just stays as the raw idea text, not worth a user-facing error for a cosmetic label.
        });
    }
  }, [request]);

  async function handleAdvance() {
    if (!id) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const result = await advanceRequest(id);
      await load();
      // Jump straight to whatever tab shows the result of what just ran,
      // instead of leaving the manager on "Sources" wondering whether a
      // draft click actually did anything — they'd otherwise have to
      // notice and click over to a different tab themselves.
      setActiveTab(tabForStage(result.stage));
    } catch (err) {
      setAdvanceError(err instanceof ApiError ? err.message : "Failed to advance the request.");
    } finally {
      setAdvancing(false);
    }
  }

  function handleStageClick(stage: Stage) {
    setActiveTab(tabForStage(stage));
  }

  async function handleToggle(sourceId: string, selected: boolean) {
    if (!id) return;
    setSourceActionError(null);

    // Optimistic: flip the checkbox immediately rather than waiting on
    // the round trip (auth check + a few sequential queries server-side).
    // Guarded against the background poll (see pendingToggles above)
    // until this request settles; reverted below if it actually fails.
    pendingToggles.current.add(sourceId);
    setSources((current) => current.map((s) => (s.id === sourceId ? { ...s, selected } : s)));

    try {
      await toggleSourceSelection(id, sourceId, selected);
    } catch (err) {
      // Scoped to just this source — reverting to a whole-array snapshot
      // taken before the request started could clobber an unrelated
      // source the background poll had legitimately updated meanwhile.
      setSources((current) => current.map((s) => (s.id === sourceId ? { ...s, selected: !selected } : s)));
      setSourceActionError(err instanceof ApiError ? err.message : "Failed to update source.");
    } finally {
      pendingToggles.current.delete(sourceId);
    }
  }

  async function handleProceedAnyway() {
    if (!id) return;
    setProceeding(true);
    setSourceActionError(null);
    try {
      await proceedAnyway(id);
      await load();
    } catch (err) {
      setSourceActionError(err instanceof ApiError ? err.message : "Failed to proceed.");
    } finally {
      setProceeding(false);
    }
  }

  async function handleGoBack() {
    if (!id) return;
    setGoingBack(true);
    setSourceActionError(null);
    try {
      await goBackToResearching(id);
      await load();
    } catch (err) {
      setSourceActionError(err instanceof ApiError ? err.message : "Failed to go back.");
    } finally {
      setGoingBack(false);
    }
  }

  async function handleCopyAndOpen(outputId: string, channel: CopyOpenableChannel, body: string) {
    setCopyOutputError(null);
    try {
      await copyAndOpen(channel, body);
      setCopiedOutputId(outputId);
      setTimeout(() => setCopiedOutputId((current) => (current === outputId ? null : current)), 3000);
      // Self-reported, not verified — see markChannelOutputPosted's doc comment.
      await markChannelOutputPosted(outputId);
      await load();
    } catch {
      setCopyOutputError("Couldn't copy to the clipboard — copy the text from the expanded content instead.");
    }
  }

  if (loadError) return <ErrorState message={loadError} />;
  if (!request) return <DetailSkeleton />;

  const fetchedSources = sources.filter((s) => s.fetch_ok);
  const selectedCount = sources.filter((s) => s.selected).length;
  const retrievedCount = fetchedSources.length;
  const rounds = sources.map((s) => s.search_round).filter((r) => r > 0);
  const maxRound = rounds.length ? Math.max(...rounds) : 0;

  const isInsufficient = request.stage === "sources_insufficient";
  const isEditable = EDITABLE_STAGES.has(request.stage);
  const isLocked = !isEditable && request.stage !== "requested" && request.stage !== "researching";
  const zeroRetrieved = retrievedCount === 0;
  const isPreSelection = PRE_SELECTION_STAGES.has(request.stage);
  // 'published' is the actual end of the pipeline — nothing to advance
  // to, so there's no "next stage" to run. Without this, the button
  // stayed visible and clicking it hit the terminal stub handler,
  // producing a "not implemented yet" error that reads like a bug for
  // something that's actually just "you're done." Terminal regardless
  // of stage_error — a stray error from an earlier click here can never
  // be fixed by "retrying," since there's still nothing to run.
  const isTerminal = request.stage === "published";
  const hasError = !isTerminal && Boolean(request.stage_error);

  return (
    <div className="stack">
      <div className="page-header">
        <h1>{request.short_title ?? request.idea}</h1>
        <p className="subtitle">For {request.target_audience}</p>
      </div>

      {request.thinly_sourced && (
        <ErrorState
          tone="warning"
          message={`Thinly sourced. A manager chose to proceed with only ${selectedCount} usable source${selectedCount === 1 ? "" : "s"}. This will carry through to the article and must be shown to the reviewer before approval.`}
        />
      )}

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          {isEditable && (
            <IconButton size="lg" label="Go back to add or paste a source" onClick={handleGoBack} disabled={goingBack}>
              <ArrowLeftIcon />
            </IconButton>
          )}
          <h3 style={{ margin: 0 }}>Pipeline stage</h3>
        </div>
        <StageTrack
          stage={request.stage}
          hasError={hasError}
          errorMessage={request.stage_error}
          onStageClick={handleStageClick}
          onRetry={handleAdvance}
          retrying={advancing}
        />

        {isTerminal && (
          <p className="subtitle">
            This request has been fully published — there's nothing further to run.
            {request.stage_error && " (A stray click here earlier produced an error message that can be ignored.)"}
          </p>
        )}

        {advanceError && <ErrorState message={advanceError} />}

        {request.stage === "ready_for_review" && !hasError && (
          <p className="subtitle">Waiting for a reviewer to approve or reject this draft — there's nothing to run here yet.</p>
        )}

        {!isInsufficient && !isTerminal && !hasError && request.stage !== "ready_for_review" && (
          <div className="btn-row">
            <Button variant="primary" onClick={handleAdvance} loading={advancing}>
              {request.stage === "sources_selected"
                ? "Continue to drafting"
                : (STAGE_ACTION_LABELS[request.stage] ?? `Run next stage (${STAGE_LABELS[request.stage]})`)}
            </Button>
          </div>
        )}

        {isLocked && (
          <div style={{ marginTop: 12 }}>
            <p className="subtitle">
              This request has moved past source selection into <strong>{STAGE_LABELS[request.stage]}</strong>.
              Sources can no longer be changed here.
            </p>
          </div>
        )}
      </div>

      <div className="tab-bar">
        <button
          type="button"
          className={`tab-btn${activeTab === "sources" ? " is-active" : ""}`}
          onClick={() => setActiveTab("sources")}
        >
          Sources ({sources.length})
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "drafts" ? " is-active" : ""}`}
          onClick={() => setActiveTab("drafts")}
        >
          Drafts ({drafts.length})
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "channels" ? " is-active" : ""}`}
          onClick={() => setActiveTab("channels")}
        >
          Channel outputs ({channelOutputs.length})
        </button>
        <button
          type="button"
          className={`tab-btn${activeTab === "events" ? " is-active" : ""}`}
          onClick={() => setActiveTab("events")}
        >
          Events ({events.length})
        </button>
      </div>

      {activeTab === "sources" && (
        <div className="stack">
          {isInsufficient && (
            <div className="card">
              <h3>Not enough usable sources</h3>
              {sourceActionError && <ErrorState message={sourceActionError} />}

              {zeroRetrieved ? (
                <p className="subtitle">
                  This topic could not be researched: nothing was successfully retrieved across {maxRound || 1} round
                  {maxRound === 1 ? "" : "s"} of search. Generating an article now would be pure invention, so that
                  option isn't offered. Use the back arrow above to supply the material yourself, or leave this
                  request as-is to abandon it.
                </p>
              ) : (
                <>
                  <p className="subtitle" style={{ marginBottom: 12 }}>
                    Only {selectedCount} usable source{selectedCount === 1 ? "" : "s"} out of {retrievedCount}{" "}
                    retrieved, below the floor of 2. Find more sources, use the back arrow above to supply material
                    yourself, or proceed anyway (this will be flagged as thinly sourced and shown to the reviewer
                    before they can approve).
                  </p>
                  <div style={{ marginBottom: 14 }}>
                    <SourceManagementForms requestId={request.id} maxRound={maxRound} onChanged={load} />
                  </div>
                  <Button variant="danger" onClick={handleProceedAnyway} loading={proceeding}>
                    Proceed anyway with {selectedCount} source{selectedCount === 1 ? "" : "s"}
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="card">
            <h3>Sources</h3>

            {isPreSelection && (
              <div style={{ marginBottom: 16 }}>
                <AddPasteSourceForms requestId={request.id} onChanged={load} />
              </div>
            )}

            {isEditable && !isInsufficient && sources.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <SourceManagementForms requestId={request.id} maxRound={maxRound} onChanged={load} />
              </div>
            )}

            {sourceActionError && !isInsufficient && <ErrorState message={sourceActionError} />}

            <SourceList
              sources={sources}
              requestSourceUrl={request.source_url}
              editable={isEditable}
              onToggle={handleToggle}
            />
          </div>
        </div>
      )}

      {activeTab === "drafts" && (
        <div className="stack">
          {drafts.length === 0 && <EmptyState message="No article drafts yet." />}

          {drafts.length > 0 && <DraftOptionsBoard drafts={drafts} evaluations={evaluations} sources={sources} />}

          {approvals.length > 0 && (
            <div className="card">
              <h3>Review decisions</h3>
              {approvals.map((a) => (
                <div key={a.id} className="list-row">
                  <div className="list-row-head">
                    <span className="list-row-title">{a.decision === "approved" ? "Approved" : "Rejected"}</span>
                    <StatusPill tone={a.decision === "approved" ? "success" : "danger"}>{a.decision}</StatusPill>
                  </div>
                  <div className="list-row-meta">{formatDateTime(a.decided_at)}</div>
                  {a.comment && <div className="list-row-meta">{a.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "channels" && (
        <div className="stack">
          {copyOutputError && <ErrorState message={copyOutputError} />}
          {channelOutputs.length === 0 && <EmptyState message="No channel outputs yet." />}
          {channelOutputs.map((c) => (
            <div key={c.id} className="card">
              <div className="list-row-head">
                <ChannelBadge channel={c.channel} />
                <StatusPill tone={c.valid ? "success" : "danger"}>{c.valid ? "channel-ready" : "invalid"}</StatusPill>
              </div>

              <div style={{ marginTop: 10 }}>
                <ChannelPreview output={c} />
              </div>

              {!c.valid && c.validation != null && (
                <div style={{ marginTop: 10 }}>
                  <ErrorState tone="warning" message={JSON.stringify(c.validation)} />
                </div>
              )}

              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 12, color: "var(--text-muted)" }}>Raw text</summary>
                <p style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 6 }}>{c.body}</p>
              </details>

              {c.valid && c.channel !== "newsletter" && (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <Button variant="secondary" onClick={() => handleCopyAndOpen(c.id, c.channel as CopyOpenableChannel, c.body)}>
                    {copiedOutputId === c.id ? "Copied — composer opened" : "Copy and open"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === "events" && (
        <div className="card">
          <h3>Event log</h3>
          <div className="row" style={{ margin: "10px 0" }}>
            <label className="subtitle" style={{ margin: 0 }} htmlFor="event-stage-filter">
              Filter by stage
            </label>
            <select
              id="event-stage-filter"
              className="ui-select"
              value={eventStageFilter ?? ""}
              onChange={(e) => setEventStageFilter(e.target.value ? (e.target.value as Stage) : null)}
            >
              <option value="">All stages</option>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
              <option value="sources_insufficient">{STAGE_LABELS.sources_insufficient}</option>
            </select>
          </div>
          {events.length === 0 && <EmptyState message="No events yet." />}
          {events.length > 0 &&
            (() => {
              const filteredEvents = eventStageFilter ? events.filter((e) => e.stage === eventStageFilter) : events;
              return filteredEvents.length === 0 ? (
                <p className="subtitle">No events for this stage yet.</p>
              ) : (
                <div className="ui-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Stage</th>
                        <th>Event</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((e) => (
                        <tr key={e.id}>
                          <td className="mono">{formatDateTime(e.at)}</td>
                          <td>{STAGE_LABELS[e.stage as keyof typeof STAGE_LABELS] ?? e.stage}</td>
                          <td>{e.event}</td>
                          <td>
                            <StatusPill tone={e.ok ? "success" : "danger"}>{e.ok ? "ok" : "failed"}</StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
