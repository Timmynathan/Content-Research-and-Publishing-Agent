import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import type { ContentRequestRow } from "../../../shared/types";
import { STAGE_LABELS } from "../../lib/stageLabels";
import { relativeAge } from "../../lib/time";
import StatusPill from "../../components/ui/StatusPill";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import Button from "../../components/ui/Button";
import Skeleton from "../../components/ui/Skeleton";

export default function RequestList() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ContentRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("content_requests")
      .select("*")
      .order("created_at", { ascending: false })
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
        <h1>Requests</h1>
        <p className="subtitle">Every content request, newest first. Stage and failures visible at a glance.</p>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!requests && !error && (
        <div className="stack">
          <Skeleton style={{ height: 44 }} />
          <Skeleton style={{ height: 44 }} />
          <Skeleton style={{ height: 44 }} />
        </div>
      )}

      {requests && requests.length === 0 && (
        <EmptyState
          message="No requests yet."
          action={
            <Link to="/new">
              <Button variant="primary">New request</Button>
            </Link>
          }
        />
      )}

      {requests && requests.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Idea</th>
                  <th>Audience</th>
                  <th>Stage</th>
                  <th className="num">Age</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="is-linked" onClick={() => navigate(`/request/${r.id}`)}>
                    <td className="wrap">
                      <Link to={`/request/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        {r.idea}
                      </Link>
                    </td>
                    <td className="wrap">{r.target_audience}</td>
                    <td>
                      <StatusPill tone={r.stage_error ? "danger" : "neutral"}>
                        {r.stage_error ? "Failed: " : ""}
                        {STAGE_LABELS[r.stage]}
                      </StatusPill>
                    </td>
                    <td className="num">{relativeAge(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
