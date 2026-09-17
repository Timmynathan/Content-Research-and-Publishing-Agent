import type { EventRow } from "../../shared/types";

// Turns the raw events written by the drafting/evaluating/revising
// handlers (api/stages/{draft,evaluate,revise}.ts) into a plain-English
// line for the auto-revise chat message on the request detail page.
// Written for the manager reading it, not as a developer log line: no
// jargon like "scored" or "options", full sentences, no em dashes.
export function describeRevisionEvent(e: EventRow): string {
  const detail = e.detail as Record<string, unknown> | null;

  if (!e.ok) {
    const message = typeof detail?.message === "string" ? detail.message : "Something went wrong.";
    if (e.stage === "drafting") return `Couldn't finish checking the drafts. ${message}`;
    if (e.stage === "evaluating") return `Couldn't decide what to do next. ${message}`;
    if (e.stage === "revising") return `Couldn't revise the drafts. ${message}`;
    return message;
  }

  if (e.stage === "drafting") {
    // runEvaluation's scoring pass (drafting -> evaluating).
    if (detail?.note) return "Already checked these drafts, nothing new to report.";
    const checked = typeof detail?.scored === "number" ? detail.scored : 0;
    const ready = typeof detail?.passed === "number" ? detail.passed : 0;
    const plural = checked === 1 ? "draft" : "drafts";
    const readyPlural = ready === 1 ? "is" : "are";
    return `Checked ${checked} ${plural}. ${ready} of them ${readyPlural} good enough to use.`;
  }

  if (e.stage === "evaluating") {
    // decideNextStage (evaluating -> revising | ready_for_review).
    if (Array.isArray(detail?.draftsNeedingRevision)) {
      const n = detail.draftsNeedingRevision.length;
      const plural = n === 1 ? "draft" : "drafts";
      const verb = n === 1 ? "needs" : "need";
      const pronoun = n === 1 ? "it" : "them";
      return `${n} ${plural} still ${verb} work. Fixing ${pronoun} now.`;
    }
    if (typeof detail?.passedCount === "number") {
      const failed = Array.isArray(detail?.stillFailingAtCap) ? detail.stillFailingAtCap.length : 0;
      if (failed === 0) return "All the drafts are good enough. Sending everything to review now.";
      return `Reached the limit on revisions. ${detail.passedCount} passed, ${failed} failed.`;
    }
    return "Decided what to do next.";
  }

  if (e.stage === "revising") {
    // reviseContent (revising -> drafting).
    if (detail?.note) return "No changes were needed this round.";
    const revised = typeof detail?.revised === "number" ? detail.revised : 0;
    const plural = revised === 1 ? "draft" : "drafts";
    return `Rewrote the weak parts of ${revised} ${plural}.`;
  }

  return "Done.";
}
