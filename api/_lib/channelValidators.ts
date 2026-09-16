// Code-side enforcement of assets/channel-formatting-rules.md. The doc
// is mostly qualitative (tone, structure, "keep it short") — Claude is
// asked to follow that in the generation prompt. What's enforced here,
// as the actual gate on `valid`, is only what the doc (or the real
// platform) states as an objective, countable limit:
//   - X: the doc caps hashtags at 1-2 (checked exactly); the 280-char
//     cap isn't in the doc but is X's real platform limit — a post
//     that doesn't fit the platform isn't "valid" regardless.
//   - LinkedIn: no explicit length rule in the doc; 3000 chars is
//     LinkedIn's real platform post limit, enforced as a sanity ceiling.
//   - Newsletter: the doc's 250-600 word range, checked exactly.
// Softer, non-countable guidance (PAS structure, "small number" of
// emojis, "clear call to action") is surfaced as advisory `issues` —
// visible to whoever reviews it, but doesn't flip `valid` to false,
// since a false negative there would wrongly invalidate a genuinely
// fine post over a judgment call this code can't make reliably.

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  /** Non-blocking notes — shown for visibility, don't affect `valid`. */
  warnings: string[];
  /**
   * Explicit, actionable instructions for a retry — a concrete target
   * with a safety margin, not just a restatement of what was wrong.
   * Models don't count characters as they write, so "you were over the
   * limit" leaves them to do the subtraction themselves; handing them
   * the arithmetic already done measurably improves retry compliance.
   */
  retryHints: string[];
}

const X_MAX_CHARS = 280;
const LINKEDIN_MAX_CHARS = 3000;
const NEWSLETTER_MIN_WORDS = 250;
const NEWSLETTER_MAX_WORDS = 600;
const MAX_ADVISORY_EMOJIS = 6;
// Aim under the hard cap by this much — models overshoot their own
// length estimate, so targeting the exact limit tends to fail again.
const LENGTH_SAFETY_MARGIN = 20;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countHashtags(text: string): number {
  return (text.match(/#\w+/g) ?? []).length;
}

function countEmojis(text: string): number {
  // Broad emoji range match — good enough for an advisory count, not a
  // hard gate.
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

function hasClosingCta(text: string): boolean {
  const lastLines = text.trim().split("\n").slice(-3).join(" ").toLowerCase();
  const ctaMarkers = [
    "?",
    "comment",
    "share",
    "follow",
    "let me know",
    "dm",
    "book",
    "try",
    "sign up",
    "learn more",
    "click",
    "join",
    "reply",
    "subscribe",
    "download",
    "register",
  ];
  return ctaMarkers.some((marker) => lastLines.includes(marker));
}

export function validateLinkedIn(body: string): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const retryHints: string[] = [];

  if (!body.trim()) issues.push("Post is empty.");
  if (body.length > LINKEDIN_MAX_CHARS) {
    issues.push(`Post is ${body.length} characters, over LinkedIn's ${LINKEDIN_MAX_CHARS}-character limit.`);
    const target = LINKEDIN_MAX_CHARS - LENGTH_SAFETY_MARGIN;
    retryHints.push(
      `Rewrite the whole post tighter so it is at most ${target} characters (currently ${body.length} — cut at least ${body.length - target}). Don't just trim the end; shorten sentences throughout. Count as you go.`,
    );
  }

  const emojiCount = countEmojis(body);
  if (emojiCount > MAX_ADVISORY_EMOJIS) {
    warnings.push(`${emojiCount} emojis used — the rules call for "a small number."`);
  }
  if (!hasClosingCta(body)) {
    warnings.push("Doesn't clearly end with a call to action.");
  }

  return { valid: issues.length === 0, issues, warnings, retryHints };
}

export function validateX(body: string): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const retryHints: string[] = [];

  if (!body.trim()) issues.push("Post is empty.");
  if (body.length > X_MAX_CHARS) {
    issues.push(`Post is ${body.length} characters, over X's ${X_MAX_CHARS}-character limit.`);
    const target = X_MAX_CHARS - LENGTH_SAFETY_MARGIN;
    retryHints.push(
      `Rewrite the whole post tighter so it is at most ${target} characters (currently ${body.length} — cut at least ${body.length - target}). Don't just trim the end; shorten sentences throughout. Count as you go.`,
    );
  }

  const hashtagCount = countHashtags(body);
  if (hashtagCount > 2) {
    issues.push(`${hashtagCount} hashtags used — the rules cap it at 1 to 2.`);
    retryHints.push(`Remove hashtags until only ${2} remain — keep the two most relevant ones.`);
  }

  return { valid: issues.length === 0, issues, warnings, retryHints };
}

export function validateNewsletter(subject: string, body: string): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const retryHints: string[] = [];

  if (!subject.trim()) issues.push("Subject line is empty.");
  if (subject.length > 150) {
    warnings.push(`Subject line is ${subject.length} characters — likely to get truncated in most inboxes.`);
  }

  const wordCount = countWords(body);
  if (wordCount < NEWSLETTER_MIN_WORDS || wordCount > NEWSLETTER_MAX_WORDS) {
    issues.push(
      `Body is ${wordCount} words — the rules call for ${NEWSLETTER_MIN_WORDS} to ${NEWSLETTER_MAX_WORDS}.`,
    );
    if (wordCount < NEWSLETTER_MIN_WORDS) {
      retryHints.push(
        `Expand the body by roughly ${NEWSLETTER_MIN_WORDS - wordCount} words — add detail or an example, aim for about ${NEWSLETTER_MIN_WORDS + 50} words total.`,
      );
    } else {
      retryHints.push(
        `Cut the body by roughly ${wordCount - NEWSLETTER_MAX_WORDS} words — aim for about ${NEWSLETTER_MAX_WORDS - 50} words total.`,
      );
    }
  }

  return { valid: issues.length === 0, issues, warnings, retryHints };
}
