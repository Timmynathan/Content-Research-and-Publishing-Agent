import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import type { ContentRequestRow } from "../../../shared/types";
import { relativeAge } from "../../lib/time";
import StatusPill from "../../components/ui/StatusPill";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";

export default function ReviewQueue() {
  const [requests, setRequests] = useState<ContentRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("content_requests")
      .select("*")
      .eq("stage", "ready_for_review")
      .order("created_at", { ascending: true })
      .returns<ContentRequestRow[]>();
    if (error) setError(error.message);
    else setRequests(data);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Awaiting your review ({requests?.length ?? 0})</h1>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!requests && !error && (
        <div className="stack">
          <Skeleton style={{ height: 60 }} />
          <Skeleton style={{ height: 60 }} />
        </div>
      )}

      {requests && requests.length === 0 && <EmptyState message="Nothing waiting on you right now." />}

      {requests && requests.length > 0 && (
        <div className="stack">
          {requests.map((r) => (
            <Link key={r.id} to={`/review/${r.id}`} className="card card-link">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.idea}</div>
              <p className="subtitle row">
                For {r.target_audience} · waiting {relativeAge(r.created_at)}
                {r.thinly_sourced && <StatusPill tone="warning">thinly sourced</StatusPill>}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
