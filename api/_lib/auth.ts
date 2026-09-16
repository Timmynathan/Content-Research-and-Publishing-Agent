import "./wsPolyfill.js";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { HttpError } from "./errors.js";
import type { StaffRole } from "../../shared/types.js";

// Service-role client: bypasses RLS. Used for every DB read/write inside
// stage handlers, since the handler runs as a trusted server process and
// role/ownership checks are done explicitly in code (see requireStaff
// below and the per-transition checks in advance.ts), not delegated to
// RLS for these writes.
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface AuthedUser {
  userId: string;
  role: StaffRole;
  displayName: string | null;
}

// Verifies the caller's Supabase session (the JWT from the client's
// Authorization header) and that they are a registered staff member.
// This is the server-side gate — RLS on content_requests etc. is a
// second, independent layer for direct table access, not a substitute
// for this check inside api/advance.ts.
export async function requireStaff(authHeader: string | undefined): Promise<AuthedUser> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }
  const token = authHeader.slice("Bearer ".length);

  const supabaseAsCaller = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data: userData, error: userError } = await supabaseAsCaller.auth.getUser(token);
  if (userError || !userData.user) {
    throw new HttpError(401, "Invalid or expired session");
  }

  const { data: staffRow, error: staffError } = await supabaseAdmin
    .from("staff")
    .select("user_id, role, display_name")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (staffError) {
    throw new HttpError(500, `Failed to load staff role: ${staffError.message}`);
  }
  if (!staffRow) {
    throw new HttpError(403, "This account is not registered as staff");
  }

  return {
    userId: staffRow.user_id,
    role: staffRow.role as StaffRole,
    displayName: staffRow.display_name,
  };
}
