import { StageError } from "../_lib/errors.js";
import type { StageHandler } from "./types.js";

// Phase 1 wires up 'requested' and 'researching' only. Every later stage
// has a real module coming in Phase 2/3 (plan, draft, evaluate, revise,
// adapt) — this stub keeps the dispatch table total (every Stage has a
// handler) and fails loudly and retryably rather than silently no-op'ing
// or crashing the request into an unhandled state.
export function notImplementedStage(stageName: string): StageHandler {
  return async () => {
    throw new StageError(
      `The '${stageName}' stage is not implemented yet (coming in a later build phase). No work was done and no data was written.`,
    );
  };
}
