-- Removes the human review gate on the article draft itself. A draft
-- that passes automated evaluation now auto-advances straight to
-- 'approved' (see decideNextStage in api/_stages/evaluate.ts) instead
-- of waiting at 'ready_for_review' for a reviewer's approve/reject/
-- revise decision — that whole flow (api/_stages/review.ts) is removed.
-- The reviewer's job is now channel-output review only (already built
-- — see api/channelReview.ts).
--
-- 'ready_for_review' still exists as a stage value, repurposed as a
-- manager-facing dead end reached only when NO drafted option ever
-- passes evaluation, even after the revision cap — same shape as
-- 'sources_insufficient', not a human-approval checkpoint anymore.
--
-- Since nothing inserts an 'approved' approvals row for the article
-- anymore (there's no human decision left to record), the trigger that
-- required one before allowing 'adapting' is now checking for something
-- that will never exist. Replaced with the real underlying invariant:
-- a draft has been selected for this request. (Still exactly what
-- api/_stages/adapt.ts needs to find, now read directly rather than
-- via an approvals row.)
create or replace function require_approval_before_adapting()
returns trigger as $$
begin
  if new.stage = 'adapting' and old.stage is distinct from 'adapting' then
    if not exists (
      select 1 from drafts d where d.request_id = new.id and d.selected = true
    ) then
      raise exception 'Cannot move to adapting without a selected draft.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- forbid_self_approval and the approvals table itself are left as-is —
-- non-destructive, and still meaningful as a historical record for any
-- request that went through the old flow before this migration.
