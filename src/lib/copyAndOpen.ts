import type { Channel } from "../../shared/types";

// No OAuth, no token storage, no posting API, no claim of having
// posted anything — copies the text to the clipboard and opens the
// platform's own composer, so a person makes the actual post (and can
// tweak it first, which they usually want to anyway). Newsletter isn't
// included: it already sends for real via Resend.
export type CopyOpenableChannel = Extract<Channel, "x" | "linkedin">;

function composerUrl(channel: CopyOpenableChannel, body: string): string {
  if (channel === "x") {
    // Prefills the compose box directly — X's long-stable intent URL.
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(body)}`;
  }
  // LinkedIn has no reliable way to prefill free text via URL for a
  // personal post — this opens the feed with the composer active;
  // the text is on the clipboard, so it's one paste either way.
  return "https://www.linkedin.com/feed/?shareActive=true";
}

export async function copyAndOpen(channel: CopyOpenableChannel, body: string): Promise<void> {
  // window.open first and synchronously — some browsers only honor the
  // click's user-activation for popups within the same synchronous
  // task, and an awaited clipboard write can run past that window,
  // getting the tab blocked as a popup. The clipboard write has no such
  // strict timing requirement, so it's safe to do second.
  window.open(composerUrl(channel, body), "_blank", "noopener,noreferrer");
  await navigator.clipboard.writeText(body);
}
