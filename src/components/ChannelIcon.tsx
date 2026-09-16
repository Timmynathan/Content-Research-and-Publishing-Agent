import type { Channel } from "../../shared/types";

// Simple, minimal, single-color glyphs — not a reproduction of any
// platform's official logo file, just a generic lettermark/symbol
// recognizable enough to tell channels apart at a glance.
function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4 4L20 20M20 4L4 20" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="3.2" height="11" fill="currentColor" />
      <circle cx="4.6" cy="4.6" r="2.2" fill="currentColor" />
      <path
        d="M10.5 20V9h3.1v1.6c.7-1.1 1.9-1.9 3.6-1.9 2.7 0 4.3 1.8 4.3 5V20h-3.2v-4.7c0-1.6-.6-2.7-2-2.7-1.1 0-1.8.8-2.1 1.5-.1.3-.1.6-.1 1V20h-3.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NewsletterGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 6.5 12 13l8.5-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CHANNEL_LABELS: Record<Channel, string> = {
  x: "X",
  linkedin: "LinkedIn",
  newsletter: "Newsletter",
};

export default function ChannelIcon({ channel }: { channel: Channel }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "var(--r-sm)",
        background: "var(--surface-sunken)",
        color: "var(--text)",
        flexShrink: 0,
      }}
      title={CHANNEL_LABELS[channel]}
      aria-label={CHANNEL_LABELS[channel]}
    >
      {channel === "x" && <XGlyph />}
      {channel === "linkedin" && <LinkedInGlyph />}
      {channel === "newsletter" && <NewsletterGlyph />}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
      <ChannelIcon channel={channel} />
      {CHANNEL_LABELS[channel]}
    </span>
  );
}
