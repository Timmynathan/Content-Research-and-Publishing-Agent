-- Fixes forbid_source_changes_after_selection_locked (introduced in
-- 002_source_controls.sql), which had two bugs that together let it
-- silently defeat content_requests' ON DELETE CASCADE onto sources:
--
-- 1. It always `return new`, but a BEFORE DELETE row trigger has no NEW
--    (only OLD) — returning NEW on a delete returns null, and a null
--    return from a BEFORE DELETE trigger means "skip deleting this row,"
--    silently, with no error. Every direct or cascaded delete of a
--    sources row was quietly vetoed by this, no matter the stage.
-- 2. When triggered by a cascade (the parent content_requests row is
--    already gone), `select stage into req_stage` finds nothing, so
--    req_stage is null. `null not in (...)` is null, not true, so the
--    exception never fired either — the row just silently survived as
--    an orphan instead of being deleted or raising an error.
create or replace function forbid_source_changes_after_selection_locked()
returns trigger as $$
declare
  req_id uuid;
  req_stage text;
begin
  req_id := coalesce(new.request_id, old.request_id);
  select stage into req_stage from content_requests where id = req_id;

  -- A null req_stage means the parent request no longer exists (e.g.
  -- this row is being removed by a cascade from content_requests) —
  -- nothing left to lock against, so let it through.
  if req_stage is not null and req_stage not in ('requested', 'researching', 'sources_insufficient', 'sources_selected') then
    raise exception 'Source selection is locked once the request has moved past source selection (current stage: %). Use "Change sources and redraft" to unlock.', req_stage;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql security definer;
