-- The reviewer's decision at 'ready_for_review' now has three distinct
-- outcomes instead of two:
--   - 'approved': unchanged.
--   - 'rejected': now a genuine terminal outcome (content_requests.stage
--     moves to the new 'rejected' stage) instead of looping back to
--     'ready_for_review' unchanged, which made a rejection invisible —
--     the exact same request just reappeared in the reviewer's queue
--     with no sign anything happened.
--   - 'revise' (new): sends the chosen draft back to the manager
--     (stage -> 'revising') with the reviewer's comment as guidance,
--     instead of being indistinguishable from a rejection.

alter table content_requests drop constraint if exists content_requests_stage_check;
alter table content_requests add constraint content_requests_stage_check check (stage in (
  'requested', 'researching', 'sources_insufficient', 'sources_selected', 'planned', 'drafting',
  'evaluating', 'revising', 'ready_for_review', 'approved', 'adapting',
  'queued', 'published', 'rejected'
));

alter table approvals drop constraint if exists approvals_decision_check;
alter table approvals add constraint approvals_decision_check check (decision in ('approved', 'rejected', 'revise'));
