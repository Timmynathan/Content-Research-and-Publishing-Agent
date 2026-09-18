import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import type { ContentRequestRow, Stage } from "../../../shared/types";
import { relativeAge } from "../../lib/time";
import { STAGE_LABELS } from "../../lib/stageLabels";
import StatusPill from "../../components/ui/StatusPill";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";

// Terminal — not "in process" by any reading, so left out of the
// in-progress section. 'rejected' and 'published' instead show up in
// "Recently decided," capped and newest-first, purely for context.
const TERMINAL_STAGES = new Set<Stage>(["published", "rejected"]);
const RECENTLY_DECIDED_LIMIT = 5;

export default function ReviewQueue() {
  const [requests, setRequests] = useState<ContentRequestRow[] | null>(null);
  // request_ids at 'adapting' with at least one channel output still
  // needing a reviewer's sign-off — a request can sit at 'adapting'
  // with everything already approved (just waiting on the manager to
  // click Publish), which isn't something a reviewer needs to act on.
  const [pendingChannelRequestIds, setPendingChannelRequestIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    // Everything, not just ready_for_review — a reviewer with nothing to
    // act on right now still benefits from seeing what's moving through
    // the pipeline, instead of a dashboard that looks identical whether
    // nothing is happening or ten requests are mid-flight.
    const { data, error } = await supabase
      .from("content_requests")
      .select("*")
      .order("created_at", { ascending: true })
      .returns<ContentRequestRow[]>();
    if (error) {
      setError(error.message);
      return;
    }
    setRequests(data);

    // Joined client-side across two plain queries (draft_id -> request_id,
    // then channel_outputs by those draft_ids) rather than a PostgREST
    // embedded-resource select, matching how every other page in this
    // app correlates drafts/channel_outputs/sources — same pattern, not
    // a new one.
    const adaptingIds = (data ?? []).filter((r) => r.stage === "adapting").map((r) => r.id);
    if (adaptingIds.length === 0) {
      setPendingChannelRequestIds(new Set());
      return;
    }
    const { data: draftRows } = await supabase.from("drafts").select("id, request_id").in("request_id", adaptingIds).returns<Array<{ id: string; request_id: string }>>();
    const requestIdByDraftId = new Map((draftRows ?? []).map((d) => [d.id, d.request_id]));
    const draftIds = [...requestIdByDraftId.keys()];
    if (draftIds.length === 0) {
      setPendingChannelRequestIds(new Set());
      return;
    }
    const { data: outputs } = await supabase
      .from("channel_outputs")
      .select("draft_id, approved_at")
      .in("draft_id", draftIds)
      .returns<Array<{ draft_id: string; approved_at: string | null }>>();
    const pending = new Set(
      (outputs ?? [])
        .filter((o) => !o.approved_at)
        .map((o) => requestIdByDraftId.get(o.draft_id))
        .filter((id): id is string => Boolean(id)),
    );
    setPendingChannelRequestIds(pending);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const channelsAwaitingReview = requests?.filter((r) => r.stage === "adapting" && pendingChannelRequestIds.has(r.id)) ?? [];
  const inProgress =
    requests?.filter((r) => !(r.stage === "adapting" && pendingChannelRequestIds.has(r.id)) && !TERMINAL_STAGES.has(r.stage)) ?? [];
  const recentlyDecided = requests
    ? requests
        .filter((r) => TERMINAL_STAGES.has(r.stage))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, RECENTLY_DECIDED_LIMIT)
    : [];

  return (
    <div className="stack">
      <div className="page-header">
        <h1>Awaiting your review ({channelsAwaitingReview.length})</h1>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!requests && !error && (
        <div className="stack">
          <Skeleton style={{ height: 60 }} />
          <Skeleton style={{ height: 60 }} />
        </div>
      )}

      {requests && channelsAwaitingReview.length === 0 && <EmptyState message="Nothing waiting on you right now." />}

      {requests && channelsAwaitingReview.length > 0 && (
        <div className="stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>Channel outputs to review ({channelsAwaitingReview.length})</h2>
          <div className="stack">
            {channelsAwaitingReview.map((r) => (
              <Link key={r.id} to={`/review/${r.id}`} className="card card-link">
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.short_title ?? r.idea}</div>
                <p className="subtitle">LinkedIn, X, and newsletter versions ready for your sign-off</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {requests && inProgress.length > 0 && (
        <div className="stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>In progress ({inProgress.length})</h2>
          <p className="subtitle" style={{ margin: 0 }}>
            Nothing here needs you yet — still moving through research, drafting, or revision unattended, or waiting
            on the manager.
          </p>
          <div className="stack">
            {inProgress.map((r) => (
              <div key={r.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 600 }}>{r.short_title ?? r.idea}</div>
                  <StatusPill tone={r.stage_error ? "danger" : "neutral"}>{STAGE_LABELS[r.stage]}</StatusPill>
                </div>
                <p className="subtitle row" style={{ marginTop: 4 }}>
                  For {r.target_audience} · started {relativeAge(r.created_at)}
                  {r.thinly_sourced && <StatusPill tone="warning">thinly sourced</StatusPill>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {requests && recentlyDecided.length > 0 && (
        <div className="stack">
          <h2 style={{ fontSize: 16, margin: 0 }}>Recently decided</h2>
          <div className="stack">
            {recentlyDecided.map((r) => (
              <div key={r.id} className="card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 600 }}>{r.short_title ?? r.idea}</div>
                  <StatusPill tone={r.stage === "published" ? "success" : "danger"}>{STAGE_LABELS[r.stage]}</StatusPill>
                </div>
                <p className="subtitle" style={{ marginTop: 4 }}>{relativeAge(r.updated_at)} ago</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
