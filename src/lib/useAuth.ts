import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { StaffRole } from "../../shared/types";

export interface AuthState {
  loading: boolean;
  session: Session | null;
  role: StaffRole | null;
  displayName: string | null;
  /** True once we know the signed-in user is NOT in the staff table. */
  notStaff: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    role: null,
    displayName: null,
    notStaff: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStaffRole(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ loading: false, session: null, role: null, displayName: null, notStaff: false });
        return;
      }
      const { data, error } = await supabase
        .from("staff")
        .select("role, display_name")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        setState({ loading: false, session, role: null, displayName: null, notStaff: true });
        return;
      }
      setState({
        loading: false,
        session,
        role: data.role as StaffRole,
        displayName: data.display_name,
        notStaff: false,
      });
    }

    supabase.auth.getSession().then(({ data }) => loadStaffRole(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      loadStaffRole(session);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}
