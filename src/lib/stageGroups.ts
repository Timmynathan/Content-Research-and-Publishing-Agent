import type { HappyStage, Stage } from "../../shared/types";
import { STAGE_LABELS } from "./stageLabels";

export interface StageGroup {
  key: string;
  label: string;
  stages: readonly HappyStage[];
}

// Purely a display simplification for the pipeline stepper. The real
// state machine (advance.ts's dispatch table, DB triggers, RLS, the
// event log) still runs through every individual Stage value untouched
// — 'planned', 'evaluating' and 'revising' are automated hops with no
// screen of their own (their results just show up inline on the draft
// card), and 'adapting' is the automated step right before 'queued', so
// none of them need a separate circle here. Grouped so a manager sees
// ~8 real waiting points instead of 12 mechanical ones.
export const STAGE_GROUPS: StageGroup[] = [
  { key: "requested", label: STAGE_LABELS.requested, stages: ["requested"] },
  { key: "researching", label: STAGE_LABELS.researching, stages: ["researching"] },
  { key: "sources_selected", label: STAGE_LABELS.sources_selected, stages: ["sources_selected"] },
  { key: "drafting", label: "Drafting", stages: ["planned", "drafting", "evaluating", "revising"] },
  { key: "ready_for_review", label: STAGE_LABELS.ready_for_review, stages: ["ready_for_review"] },
  { key: "approved", label: STAGE_LABELS.approved, stages: ["approved"] },
  { key: "queued", label: "Queued", stages: ["adapting", "queued"] },
  { key: "published", label: STAGE_LABELS.published, stages: ["published"] },
];

export function groupIndexForStage(stage: HappyStage): number {
  return STAGE_GROUPS.findIndex((g) => g.stages.includes(stage));
}

/** A stage a group's click represents, for routing (e.g. which tab to switch to) — not shown. */
export function representativeStage(group: StageGroup): Stage {
  return group.stages[0];
}
