import type { Stage } from "../../shared/types";

export const STAGE_LABELS: Record<Stage, string> = {
  requested: "Requested",
  researching: "Researching",
  sources_insufficient: "Sources insufficient",
  sources_selected: "Sources selected",
  planned: "Planned",
  drafting: "Drafting",
  evaluating: "Evaluating",
  revising: "Revising",
  ready_for_review: "Ready for review",
  approved: "Approved",
  adapting: "Adapting",
  queued: "Queued",
  published: "Published",
};
