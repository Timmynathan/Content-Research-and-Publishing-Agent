// Source excerpts are raw Firecrawl markdown, truncated mid-document —
// good for grounding an LLM, not for a person skimming to check "does
// this source look right." Strips the common markdown syntax down to
// plain, readable text for display. Not a full parser — just enough to
// stop a manager from reading "## Why Onboarding Fails" as literal
// hashes.
export function stripMarkdownForDisplay(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/^#{1,6}\s+/gm, "") // heading hashes
    .replace(/^>\s?/gm, "") // blockquote markers
    .replace(/^[-*+]\s+/gm, "• ") // bullet markers -> a real bullet
    .replace(/^\d+\.\s+/gm, (m) => m) // ordered list markers, keep as-is
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim()) // fenced code, drop fences
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/__([^_]+)__/g, "$1") // bold (underscore)
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/_([^_]+)_/g, "$1") // italic (underscore)
    .replace(/^-{3,}$/gm, "") // horizontal rules
    .replace(/\n{3,}/g, "\n\n") // collapse excess blank lines
    .trim();
}
