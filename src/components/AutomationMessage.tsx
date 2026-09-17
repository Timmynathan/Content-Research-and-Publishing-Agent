import type { ReactNode } from "react";

/**
 * A single chat-style status message from "the automation" — what used
 * to be plain paragraphs living inside the Pipeline stage card. Kept
 * visually and structurally separate from that card (a status update,
 * not part of the pipeline control itself), with the app's own logo
 * standing in as the sender's avatar, the same way a person's avatar
 * would in any chat thread.
 */
export default function AutomationMessage({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className={`automation-message${tone === "danger" ? " is-danger" : ""}`}>
      <span className="automation-message-avatar">
        <img src="/logo.png" alt="" />
      </span>
      <div className="automation-message-bubble">{children}</div>
    </div>
  );
}
