import { useState } from "react";
import type { Channel } from "../../shared/types";

type ChannelOutputLike = {
  channel: Channel;
  subject: string | null;
  body: string;
};

// Mirrors api/_lib/channelValidators.ts's X_MAX_CHARS. Duplicated here
// deliberately rather than imported — that file lives under api/ (server
// code) and importing across that boundary into the client bundle isn't
// something this pass should do silently. If it ever drifts from the
// real validator, that's a two-line fix, not a design one.
const X_MAX_CHARS = 280;
const X_WARNING_AT = X_MAX_CHARS - 20;

// Purely a visual approximation of LinkedIn's real feed truncation
// point, used only to decide where this preview folds — not a
// validation rule enforced anywhere else in the app.
const LINKEDIN_FOLD_CHARS = 210;

function LinkedInPreview({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsFold = body.length > LINKEDIN_FOLD_CHARS;

  return (
    <div className="channel-preview cp-linkedin">
      <div className="cp-linkedin-head">
        <span className="cp-avatar" aria-hidden="true">
          co
        </span>
        <div>
          <div className="cp-linkedin-name">Your organization</div>
          <div className="cp-linkedin-meta">Just now · preview</div>
        </div>
      </div>
      <div className={`cp-linkedin-body${needsFold && !expanded ? " is-folded" : ""}`}>{body}</div>
      {needsFold && !expanded && (
        <button
          type="button"
          className="cp-linkedin-seemore"
          onClick={() => setExpanded(true)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          …see more
        </button>
      )}
    </div>
  );
}

function XPreview({ body }: { body: string }) {
  const count = body.length;
  const tone = count > X_MAX_CHARS ? "is-danger" : count >= X_WARNING_AT ? "is-warning" : "";

  return (
    <div className="channel-preview cp-x">
      <div className="cp-x-head">
        <span className="cp-avatar" aria-hidden="true">
          co
        </span>
        <div>
          <div className="cp-x-name">Your organization</div>
          <div className="cp-x-handle">@yourhandle</div>
        </div>
      </div>
      <div className="cp-x-body">{body}</div>
      <div className={`cp-x-counter ${tone}`}>
        {count}/{X_MAX_CHARS}
      </div>
    </div>
  );
}

function NewsletterPreview({ subject, body }: { subject: string | null; body: string }) {
  return (
    <div className="channel-preview cp-newsletter">
      <div className="cp-newsletter-head">
        <div className="cp-newsletter-subject">{subject ?? "(no subject)"}</div>
        <div className="cp-newsletter-from">From: (your configured sender)</div>
      </div>
      <div className="cp-newsletter-body">{body}</div>
    </div>
  );
}

/**
 * Renders a channel output as it will actually appear on its platform —
 * a textarea full of text tells a reviewer nothing about whether a
 * formatting rule was violated; a preview that looks like the platform
 * makes that obvious at a glance.
 */
export default function ChannelPreview({ output }: { output: ChannelOutputLike }) {
  if (output.channel === "linkedin") return <LinkedInPreview body={output.body} />;
  if (output.channel === "x") return <XPreview body={output.body} />;
  return <NewsletterPreview subject={output.subject} body={output.body} />;
}
