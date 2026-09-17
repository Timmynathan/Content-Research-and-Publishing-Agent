-- Per-request opt-in that pauses the otherwise-unattended pipeline at
-- 'sources_selected' so a manager can look at what was found before any
-- drafting tokens are spent. Defaults to off: most requests are routine
-- and should just run straight through to ready_for_review.
alter table content_requests add column if not exists review_sources_before_drafting boolean not null default false;
