import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { StaffRole } from "../../shared/types";
import IconButton from "./ui/IconButton";
import StatusPill from "./ui/StatusPill";
import Button from "./ui/Button";
import { UserIcon } from "./ui/icons";

export default function UserMenu({
  displayName,
  email,
  role,
}: {
  displayName: string | null;
  email: string | null;
  role: StaffRole;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="user-menu" ref={containerRef}>
      <IconButton
        circular
        label={displayName ?? email ?? "Account menu"}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <UserIcon />
      </IconButton>

      {open && (
        <div className="user-menu-panel">
          <div className="user-menu-name">{displayName ?? "Unnamed"}</div>
          {email && <div className="user-menu-email">{email}</div>}
          <div style={{ marginTop: 6 }}>
            <StatusPill tone="neutral">{role}</StatusPill>
          </div>
          <Button variant="secondary" style={{ width: "100%", marginTop: 12 }} onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
