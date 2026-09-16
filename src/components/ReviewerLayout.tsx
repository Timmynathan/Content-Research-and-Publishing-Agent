import type { ReactNode } from "react";
import UserMenu from "./UserMenu";

// Deliberately minimal: no nav beyond the review queue itself, no
// pipeline machinery. A reviewer opens this, decides, and leaves.
export default function ReviewerLayout({
  children,
  displayName,
  email,
}: {
  children: ReactNode;
  displayName: string | null;
  email: string | null;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-logo">
            <img src="/logo.png" alt="" />
          </span>
          Content Agent Review
        </div>
        <div className="topbar-right">
          <UserMenu displayName={displayName} email={email} role="reviewer" />
        </div>
      </header>
      <main className="main main--narrow">{children}</main>
    </div>
  );
}
