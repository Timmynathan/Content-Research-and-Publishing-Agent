// The reviewer's job is entirely about channel outputs now (LinkedIn/X/
// newsletter, generated after a draft auto-passes evaluation and is
// selected — see decideNextStage in api/_stages/evaluate.ts) — there's
// no article-level approve/reject/revise step anymore (removed;
// migrations/011). This page only ever has something to show at
// request.stage === 'adapting'; anything else means there's nothing
// here for a reviewer to act on.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { approveChannelOutput, requestChannelRevision, ApiError } from "../../lib/api";
import type { ChannelOutputRow, ContentRequestRow, DraftRow } from "../../../shared/types";
import Field from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import StatusPill from "../../components/ui/StatusPill";
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

function ChannelReviewCard({
  requestId,
  output,
  busy,
  onApprove,
  onRevise,
}: {
  requestId: string;
  output: ChannelOutputRow;
  busy: boolean;
  onApprove: () => void;
  onRevise: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const validation = output.validation as { issues?: string[]; warnings?: string[] } | null;

  function handleRevise() {
    if (!comment.trim()) {
      setError("Say what needs to change before sending it back.");
      return;
    }
    setError(null);
    onRevise(comment.trim());
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, textTransform: "capitalize" }}>{output.channel}</h3>
        <div className="btn-row">
          {!output.valid && <StatusPill tone="danger">failed validation</StatusPill>}
          {output.approved_at && <StatusPill tone="success">approved</StatusPill>}
          {output.revision_requested_comment && <StatusPill tone="warning">revision requested</StatusPill>}
        </div>
      </div>

      {output.subject && <p style={{ fontWeight: 600, marginBottom: 6 }}>Subject: {output.subject}</p>}
      <p className="article-body" style={{ whiteSpace: "pre-wrap" }}>{output.body}</p>

      {validation?.issues && validation.issues.length > 0 && (
        <div className="ui-error ui-error-danger" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 8 }}>
          <strong>Validation issues:</strong>
          <ul style={{ marginTop: 4, paddingLeft: 18 }}>
            {validation.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {validation?.warnings && validation.warnings.length > 0 && (
        <p className="subtitle" style={{ marginTop: 8 }}>
          {validation.warnings.join(" ")}
        </p>
      )}

      {output.approved_at ? (
        <p className="subtitle" style={{ marginTop: 12 }}>
          You already approved this — nothing further to do here unless you change your mind.
        </p>
      ) : (
        <>
          {error && (
            <div style={{ marginTop: 8 }}>
              <ErrorState message={error} />
            </div>
          )}
          <Field label="Comment (required to send back for revision)" htmlFor={`comment-${output.id}`}>
            <textarea
              id={`comment-${output.id}`}
              className="ui-textarea"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What needs to change…"
            />
          </Field>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={onApprove} loading={busy}>
              Approve
            </Button>
            <Button variant="secondary" onClick={handleRevise} loading={busy}>
              Send back for revision
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ReviewDetail() {
  const { id } = useParams<{ id: string }>();

  const [request, setRequest] = useState<ContentRequestRow | null>(null);
  const [channelOutputs, setChannelOutputs] = useState<ChannelOutputRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: requestData, error: requestError } = await supabase
      .from("content_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle<ContentRequestRow>();
    if (requestError) {
      setLoadError(requestError.message);
      return;
    }
    setRequest(requestData ?? null);
    if (!requestData || requestData.stage !== "adapting") {
      setChannelOutputs([]);
      return;
    }

    const { data: draftsData } = await supabase.from("drafts").select("id").eq("request_id", id).returns<Pick<DraftRow, "id">[]>();
    const draftIds = (draftsData ?? []).map((d) => d.id);
    const { data: outputsData } = draftIds.length
      ? await supabase.from("channel_outputs").select("*").in("draft_id", draftIds).order("channel", { ascending: true }).returns<ChannelOutputRow[]>()
      : { data: [] as ChannelOutputRow[] };
    setChannelOutputs(outputsData ?? []);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove(output: ChannelOutputRow) {
    if (!id) return;
    setBusyId(output.id);
    setActionError(null);
    try {
      await approveChannelOutput(id, output.id);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to approve.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevise(output: ChannelOutputRow, comment: string) {
    if (!id) return;
    setBusyId(output.id);
    setActionError(null);
    try {
      await requestChannelRevision(id, output.id, comment);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to send back for revision.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveAll() {
    if (!id) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      const pending = channelOutputs.filter((o) => !o.approved_at && !o.revision_requested_comment);
      await Promise.all(pending.map((o) => approveChannelOutput(id, o.id)));
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to approve everything — check individual channels below.");
    } finally {
      setBulkBusy(false);
    }
  }

  if (loadError) return <ErrorState message={loadError} />;
  if (!request) return <ReviewSkeleton />;

  if (request.stage !== "adapting") {
    return (
      <div className="stack">
        <div className="page-header">
          <h1>{request.short_title ?? request.idea}</h1>
        </div>
        <EmptyState message="Nothing here for you to review right now — channel outputs (LinkedIn, X, newsletter) show up here once a draft clears evaluation." />
      </div>
    );
  }

  const pendingCount = channelOutputs.filter((o) => !o.approved_at && !o.revision_requested_comment).length;
  const allApproved = channelOutputs.length > 0 && channelOutputs.every((o) => o.approved_at);

  return (
    <div className="stack">
      <div className="page-header">
        <h1>{request.short_title ?? request.idea}</h1>
        <p className="subtitle">Channel outputs — {request.target_audience}</p>
      </div>

      {channelOutputs.length === 0 && <EmptyState message="No channel outputs yet." />}

      {actionError && <ErrorState message={actionError} />}

      {allApproved && (
        <EmptyState message="All channels approved. Nothing left to review here — the manager can publish now." />
      )}

      {pendingCount > 1 && (
        <div className="btn-row">
          <Button variant="primary" onClick={handleApproveAll} loading={bulkBusy}>
            Approve all {pendingCount} pending channels
          </Button>
        </div>
      )}

      {channelOutputs.map((output) => (
        <ChannelReviewCard
          key={output.id}
          requestId={request.id}
          output={output}
          busy={busyId === output.id || bulkBusy}
          onApprove={() => handleApprove(output)}
          onRevise={(comment) => handleRevise(output, comment)}
        />
      ))}
    </div>
  );
}
