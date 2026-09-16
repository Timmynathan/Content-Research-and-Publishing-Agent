import type { ReactNode } from "react";

/** "No data" must never look like "failed to load" — see ErrorState. */
export default function EmptyState({
  title,
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      {title && <div className="ui-empty-title">{title}</div>}
      <p className="ui-empty-message">{message}</p>
      {action}
    </div>
  );
}
