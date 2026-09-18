-- New post-approval review gate: a reviewer signs off on each adapted
-- channel output individually (LinkedIn / X / newsletter) instead of
-- everything queuing the moment a manager clicks "Publish." See
-- api/channelReview.ts (the reviewer's approve/revise actions) and
-- api/_stages/queue.ts (now refuses to queue until every channel_output
-- for the draft has approved_at set).
alter table channel_outputs add column if not exists approved_at timestamptz;
alter table channel_outputs add column if not exists approved_by uuid references staff(user_id);
-- Mirrors drafts.revision_requested_comment (migrations/008): non-null
-- means "a reviewer sent exactly this channel's output back with this
-- note, still unresolved." Set by a reviewer's 'revise' action, read by
-- the manager's UI to show an editable AI-revision prompt for that one
-- channel, cleared once api/_stages/channelRevise.ts processes it.
alter table channel_outputs add column if not exists revision_requested_comment text;
