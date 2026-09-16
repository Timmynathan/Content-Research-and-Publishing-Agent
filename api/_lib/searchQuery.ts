export function buildSearchQuery(idea: string, keywords: string[]): string {
  const extra = keywords.length ? ` ${keywords.join(" ")}` : "";
  return `${idea}${extra}`.trim();
}
