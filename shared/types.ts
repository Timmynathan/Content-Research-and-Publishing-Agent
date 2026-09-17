// Shared between src/ (browser) and api/ (serverless). No server-only
// secrets or SDK imports belong in this file — it is safe to bundle
// into the client.

// The happy-path sequence, used to render the linear progress track.
export const STAGE_ORDER = [
  "requested",
  "researching",
  "sources_selected",
  "planned",
  "drafting",
  "evaluating",
  "revising",
  "ready_for_review",
  "approved",
  "adapting",
  "queued",
  "published",
] as const;

export type HappyStage = (typeof STAGE_ORDER)[number];

// 'sources_insufficient' is a branch off 'researching', not a step on
// the happy path — deliberately excluded from STAGE_ORDER so the
// progress track doesn't imply every request passes through it. It's
// still a first-class Stage value: content_requests.stage can equal it,
// and every Stage-keyed dispatch (e.g. advance.ts's handler table) must
// account for it.
export type Stage = HappyStage | "sources_insufficient";

// Below this many SELECTED (usable) sources, a request lands at
// 'sources_insufficient' instead of auto-advancing to
// 'sources_selected'.
export const USABLE_SOURCE_FLOOR = 2;

// Automated search+scrape passes are capped at this many per request
// (the initial research stage is round 1; each manual "find more" /
// "search again" increments it). A single manually added or pasted
// source doesn't count as a round.
export const MAX_SEARCH_ROUNDS = 3;

export type StaffRole = "manager" | "reviewer";

export interface StaffRow {
  user_id: string;
  role: StaffRole;
  display_name: string | null;
  created_at: string;
}

export interface ContentRequestRow {
  id: string;
  stage: Stage;
  stage_error: string | null;
  idea: string;
  /** Short, plain-language heading generated from `idea` for display — see migrations/004_short_title.sql. Null until generated. */
  short_title: string | null;
  target_audience: string;
  source_url: string | null;
  supporting_material: string | null;
  keywords: string[];
  tone: string | null;
  /** Set when a manager explicitly chooses "proceed anyway" out of sources_insufficient. */
  thinly_sourced: boolean;
  /** Opt-in, off by default — pauses the otherwise-unattended pipeline at 'sources_selected' for this request only. */
  review_sources_before_drafting: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// A failed fetch always keeps its raw provider error (for debugging, see
// the event log / "Raw error" expander) but that text is written for a
// developer, not a content manager — it's Firecrawl's own vendor
// message, sometimes with a sales link in it. This enum is what the UI
// actually shows a person, mapped from the raw error in code (never
// left for the model to phrase).
export const FETCH_FAILURE_REASONS = [
  "unsupported_site",
  "not_found",
  "blocked",
  "paywalled",
  "timeout",
  "no_content",
  "error",
] as const;

export type FetchFailureReason = (typeof FETCH_FAILURE_REASONS)[number];

// Platforms Firecrawl is known not to read at all (login walls / bot
// protection) — excluded from web search results so search slots aren't
// spent on pages already known to fail. Applies ONLY to URLs discovered
// by search: an explicitly supplied source_url, or a URL a manager adds
// by hand, is always attempted regardless of domain — a URL someone
// typed in is a request, and silently skipping it is worse than trying
// and reporting why it failed.
export const EXCLUDED_SEARCH_DOMAINS = [
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
] as const;

export type SourceOrigin = "scraped" | "pasted";

export interface SourceRow {
  id: string;
  request_id: string;
  /** Null for a pasted source (origin='pasted') — text with no URL. */
  url: string | null;
  title: string | null;
  publisher: string | null;
  published_at: string | null;
  fetched_at: string;
  raw_text: string | null;
  excerpt: string | null;
  selected: boolean;
  selection_reason: string | null;
  fetch_ok: boolean;
  fetch_error: string | null;
  failure_reason: FetchFailureReason | null;
  origin: SourceOrigin;
  /** Which automated search round produced this row; 0 for a manually added/pasted single source. */
  search_round: number;
  created_at: string;
}

// Shape for inserting a sources row (DB-generated columns omitted).
// Used as an explicit return/parameter annotation wherever code builds
// a row from a scrape or paste result — without it, TS infers a narrow
// union of two near-identical literal object types (one per success/
// failure branch) instead of one consistent shape, which Supabase's
// insert() then rejects for a batch array.
export type SourceInsert = Omit<SourceRow, "id" | "created_at" | "fetched_at">;

export interface DraftClaim {
  text: string;
  source_id: string | null;
  flagged: boolean;
  flag_reason: string | null;
}

export interface DraftSection {
  key: string;
  heading: string;
  body: string;
  claims: DraftClaim[];
}

export interface OutlineSection {
  key: string;
  heading: string;
  level: "h2" | "h3";
  notes: string;
}

export interface DraftOutline {
  title: string;
  primary_keyword: string;
  secondary_keywords: string[];
  sections: OutlineSection[];
}

export interface DraftRow {
  id: string;
  request_id: string;
  variant: number;
  angle: string;
  outline: DraftOutline;
  sections: DraftSection[];
  attempt: number;
  selected: boolean;
  created_at: string;
}

// 1 initial attempt + 2 revision passes, hard-capped in code (see
// api/stages/evaluate.ts's decideNextStage) — the model never decides
// whether to keep revising, only whether a given pass improved things.
export const MAX_DRAFT_ATTEMPTS = 3;

// Rubric scale: 1-5 per criterion (the rubric doc itself doesn't fix a
// scale, this is our choice). Only STRICT_RUBRIC_CRITERIA (below) must
// individually clear this bar; the rest can be weaker as long as the
// overall average clears AVERAGE_PASS_THRESHOLD.
export const PASS_SCORE_THRESHOLD = 4;

export const RUBRIC_CRITERIA = [
  "Topic Relevance",
  "Source Grounding",
  "Factual Consistency",
  "Audience Fit",
  "Tone",
  "SEO Fit",
  "Channel Fit",
  "Clarity",
  "Completeness",
] as const;

export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];

// Criteria where a low score means the content is actually wrong or
// unsupported, not just weaker style — these can't be averaged away by
// strong scores elsewhere, so they're checked individually against
// PASS_SCORE_THRESHOLD regardless of the overall average.
export const STRICT_RUBRIC_CRITERIA: readonly RubricCriterion[] = ["Source Grounding", "Factual Consistency"];

// A draft can still pass with one or two merely-weaker (non-strict)
// criteria as long as the average across all 9 clears this bar.
// Requiring literally every one of the 9 criteria to individually hit
// PASS_SCORE_THRESHOLD made a first-attempt pass vanishingly unlikely by
// construction (roughly 0.8^9, ~13%, even for a genuinely solid draft),
// turning "evaluate" into an almost-automatic "revise once" step
// regardless of actual draft quality.
export const AVERAGE_PASS_THRESHOLD = 3.5;

export interface EvaluationRow {
  id: string;
  draft_id: string;
  attempt: number;
  scores: Record<RubricCriterion, { score: number; note: string }>;
  overall: number;
  passed: boolean;
  failing_sections: string[];
  /** Specific, actionable notes for whoever revises the failing sections. */
  recommended_changes: string[];
  created_at: string;
}

export type Channel = "linkedin" | "x" | "newsletter";

export interface ChannelOutputRow {
  id: string;
  draft_id: string;
  channel: Channel;
  subject: string | null;
  body: string;
  validation: unknown;
  valid: boolean;
  created_at: string;
}

export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalRow {
  id: string;
  request_id: string;
  draft_id: string;
  decision: ApprovalDecision;
  comment: string | null;
  content_hash: string;
  decided_by: string;
  decided_at: string;
}

export type QueueStatus = "queued" | "published" | "failed";

export interface PublishQueueRow {
  id: string;
  channel_output_id: string;
  channel: Channel;
  scheduled_for: string;
  status: QueueStatus;
  attempts: number;
  last_error: string | null;
  published_at: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  request_id: string;
  stage: string;
  event: string;
  ok: boolean;
  detail: unknown;
  at: string;
}

export interface AdvanceResponse {
  stage: Stage;
  stage_error: string | null;
}
