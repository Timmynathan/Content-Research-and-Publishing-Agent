import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentRequestRow, Stage, StaffRole } from "../../shared/types.js";

export interface HandlerCtx {
  request: ContentRequestRow;
  userId: string;
  role: StaffRole;
  supabase: SupabaseClient;
  /**
   * Extra fields from the advance() request body beyond requestId —
   * every other stage ignores this, but the ready_for_review handler
   * needs the reviewer's decision (decision, draftId, comment), which
   * has nowhere else to travel since advance() is otherwise payload-free.
   */
  payload: Record<string, unknown>;
}

export interface HandlerResult {
  nextStage: Stage;
  /** Written into the completing events row for this stage. */
  detail?: unknown;
}

export type StageHandler = (ctx: HandlerCtx) => Promise<HandlerResult>;
