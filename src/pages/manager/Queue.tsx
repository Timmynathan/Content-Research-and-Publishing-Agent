import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { retryPublishQueueItem, markQueueItemPosted, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/time";
import { ChannelBadge } from "../../components/ChannelIcon";
import ChannelPreview from "../../components/ChannelPreview";
import { copyAndOpen, type CopyOpenableChannel } from "../../lib/copyAndOpen";
import type { Channel, QueueStatus } from "../../../shared/types";
import Button from "../../components/ui/Button";
import StatusPill from "../../components/ui/StatusPill";
import ErrorState from "../../components/ui/ErrorState";
import EmptyState from "../../components/ui/EmptyState";
import Skeleton from "../../components/ui/Skeleton";

interface QueueRow {
  id: string;
  channel: Channel;
  scheduled_for: string;
  status: QueueStatus;
  attempts: number;
  last_error: string | null;
  published_at: string | null;
  channel_outputs: {
    subject: string | null;
    body: string;
    valid: boolean;
    validation: { issues?: string[] } | null;
    drafts: {
      request_id: string;
      content_requests: { idea: string } | null;
    } | null;
  } | null;
}

function statusTone(item: QueueRow): "success" | "danger" | "warning" | "neutral" {
  if (item.status === "published") return "success";
  if (item.status === "failed") return "danger";
  if (item.channel_outputs?.valid === false) return "warning";
  return "neutral";
}

export default function Queue() {
  const [items, setItems] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("publish_queue")
      .select("*, channel_outputs(subject, body, valid, validation, drafts(request_id, content_requests(idea)))")
      .order("scheduled_for", { ascending: false })
      .returns<QueueRow[]>();
    if (error) setError(error.message);
    else setItems(data);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleRetry(itemId: string) {
    setRetryingId(itemId);
    setRetryError(null);
    try {
      await retryPublishQueueItem(itemId);
      await load();
    } catch (err) {
      setRetryError(err instanceof ApiError ? err.message : "Retry failed.");
    } finally {
      setRetryingId(null);
    }
  }

  async function handleCopyAndOpen(itemId: string, channel: CopyOpenableChannel, body: string) {
    setCopyError(null);
    try {
      await copyAndOpen(channel, body);
      setCopiedId(itemId);
      setTimeout(() => setCopiedId((current) => (current === itemId ? null : current)), 3000);
      // Self-reported, not verified: clicking this is the manager's own
      // signal that they're posting it, not proof the app can check. See
      // markQueueItemPosted's doc comment.
      await markQueueItemPosted(itemId);
      await load();
    } catch {
      setCopyError('Couldn\'t copy to the clipboard — copy the text from "Raw text" below manually.');
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Publishing queue</h1>
        <p className="subtitle">What's scheduled, for which channel, when, and its status.</p>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {retryError && <ErrorState message={retryError} />}
      {copyError && <ErrorState message={copyError} />}

      {!items && !error && (
        <div className="stack">
          <Skeleton style={{ height: 110 }} />
          <Skeleton style={{ height: 110 }} />
        </div>
      )}

      {items && items.length === 0 && <EmptyState message="Nothing has been queued yet." />}

      {items && items.length > 0 && (
        <div className="stack">
          {items.map((item) => {
            const idea = item.channel_outputs?.drafts?.content_requests?.idea ?? "(request no longer available)";
            const requestId = item.channel_outputs?.drafts?.request_id;
            return (
              <div key={item.id} className="card">
                <div className="list-row-head">
                  <span className="list-row-title">
                    {requestId ? <Link to={`/request/${requestId}`}>{idea}</Link> : idea}
                  </span>
                  <span className="btn-row">
                    <ChannelBadge channel={item.channel} />
                    <StatusPill tone={statusTone(item)}>
                      {item.status === "queued" && item.channel_outputs?.valid === false ? "queued — needs edit" : item.status}
                    </StatusPill>
                  </span>
                </div>
                <p className="subtitle" style={{ marginBottom: 10 }}>
                  Scheduled {formatDateTime(item.scheduled_for)}
                  {item.published_at && ` · published ${formatDateTime(item.published_at)}`}
                  {item.attempts > 0 && ` · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}`}
                </p>

                {item.channel !== "newsletter" && !item.channel_outputs?.valid && item.channel_outputs?.validation?.issues && (
                  <div style={{ marginBottom: 10 }}>
                    <ErrorState
                      tone="warning"
                      message={`Needs editing before posting: ${item.channel_outputs.validation.issues.join(" ")}`}
                    />
                  </div>
                )}

                {item.channel_outputs && (
                  <div style={{ marginBottom: 10 }}>
                    <ChannelPreview output={{ channel: item.channel, subject: item.channel_outputs.subject, body: item.channel_outputs.body }} />
                  </div>
                )}

                {item.channel !== "newsletter" && item.status === "queued" && item.channel_outputs?.body && (
                  <div className="btn-row" style={{ marginBottom: 10 }}>
                    <Button
                      variant="primary"
                      onClick={() => handleCopyAndOpen(item.id, item.channel as CopyOpenableChannel, item.channel_outputs!.body)}
                    >
                      {copiedId === item.id ? "Copied — composer opened" : "Copy and open"}
                    </Button>
                  </div>
                )}

                {item.last_error && (
                  <div style={{ marginBottom: 10 }}>
                    <ErrorState message={item.last_error} />
                  </div>
                )}

                <details>
                  <summary style={{ fontSize: 12, color: "var(--text-muted)" }}>Raw text</summary>
                  <p style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 6 }}>{item.channel_outputs?.body}</p>
                </details>

                {item.channel === "newsletter" && item.status === "failed" && (
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <Button variant="secondary" onClick={() => handleRetry(item.id)} loading={retryingId === item.id}>
                      Retry send
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
