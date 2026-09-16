import type { SourceRow } from "../../shared/types.js";

export function buildSourceContext(sources: SourceRow[], textBudgetPerSource: number): string {
  return sources
    .map((s) => {
      const text = (s.raw_text ?? "").slice(0, textBudgetPerSource);
      return [
        `source_id: ${s.id}`,
        `title: ${s.title ?? "(untitled)"}`,
        `url: ${s.url ?? "(pasted, no url)"}`,
        `content:\n${text}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}
