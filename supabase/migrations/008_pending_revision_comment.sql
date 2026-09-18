-- Explicit marker for "a reviewer sent this specific draft back for
-- revision" — set by review.ts's 'revise' decision, read by the
-- manager's UI to show just that one option (instead of all draft
-- options) with the reviewer's note and a "Revise with AI" prompt the
-- manager can edit before it runs, and cleared by revise.ts once it
-- actually processes that revision. Null the rest of the time,
-- including for the ordinary automated evaluation-failure revision
-- loop, which never touches this column.
alter table drafts add column if not exists revision_requested_comment text;
