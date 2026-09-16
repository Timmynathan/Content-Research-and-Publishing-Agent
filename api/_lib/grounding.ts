import type { DraftClaim, DraftSection } from "../../shared/types.js";

/**
 * The grounding guarantee, enforced in code: every claim's source_id
 * must exist among sources actually retrieved for this request AND
 * marked selected. A claim whose source_id is missing, invented, or
 * points at an unselected source is flagged — never silently dropped
 * or repaired. Silent repair means nobody ever learns the model is
 * drifting; flagging surfaces it to whoever reviews the draft.
 */
export function verifyClaimGrounding(
  sections: Array<{ key: string; heading: string; body: string; claims: Array<{ text: string; source_id: string | null }> }>,
  selectedSourceIds: Set<string>,
): DraftSection[] {
  return sections.map((section) => ({
    key: section.key,
    heading: section.heading,
    body: section.body,
    // Schema lists "claims" as required per section, but tool-use isn't
    // airtight about it — a section with no factual claims (a pure
    // intro/transition) sometimes comes back with the key omitted
    // entirely rather than an empty array. Treat that as zero claims
    // rather than crashing.
    claims: (section.claims ?? []).map((claim): DraftClaim => {
      const hasSourceId = typeof claim.source_id === "string" && claim.source_id.length > 0;
      const sourceIsSelected = hasSourceId && selectedSourceIds.has(claim.source_id as string);

      if (!hasSourceId) {
        return { text: claim.text, source_id: null, flagged: true, flag_reason: "No source_id was given for this claim." };
      }
      if (!sourceIsSelected) {
        return {
          text: claim.text,
          source_id: claim.source_id,
          flagged: true,
          flag_reason: "This source_id doesn't match a selected source for this request — it may be invented or point at a source that wasn't selected.",
        };
      }
      return { text: claim.text, source_id: claim.source_id, flagged: false, flag_reason: null };
    }),
  }));
}
