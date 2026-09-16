import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import UserMenu from "./UserMenu";

export default function ManagerLayout({
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
          Content Agent Workspace
        </div>
        <nav className="topbar-nav">
          <NavLink to="/" end>
            Requests
          </NavLink>
          <NavLink to="/new">New request</NavLink>
          <NavLink to="/queue">Queue</NavLink>
        </nav>
        <div className="topbar-right">
          <UserMenu displayName={displayName} email={email} role="manager" />
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
