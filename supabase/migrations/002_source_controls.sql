-- Migration: manual source controls, insufficient-sources branch, thin-
-- sourcing flag. Run this yourself in the Supabase SQL editor — not
-- executed by the agent. Safe to re-run (idempotent where practical).

-- Preserves existing data — a rename, not a drop+add.
alter table sources rename column fetch_failure_reason to failure_reason;

alter table sources add column if not exists origin text not null default 'scraped'
  check (origin in ('scraped', 'pasted'));

alter table sources add column if not exists search_round int not null default 1;

-- Pasted sources have no URL.
alter table sources alter column url drop not null;

alter table content_requests add column if not exists thinly_sourced boolean not null default false;

-- Add 'sources_insufficient' to the allowed stage values. The DROP
-- assumes Postgres's default auto-generated constraint name for an
-- inline column check (<table>_<column>_check). If this errors with
-- "constraint does not exist", run:
--   select conname from pg_constraint where conrelid = 'content_requests'::regclass and contype = 'c';
-- and substitute the real name for content_requests_stage_check below.
alter table content_requests drop constraint if exists content_requests_stage_check;
alter table content_requests add constraint content_requests_stage_check check (stage in (
  'requested', 'researching', 'sources_insufficient', 'sources_selected', 'planned', 'drafting',
  'evaluating', 'revising', 'ready_for_review', 'approved', 'adapting', 'queued', 'published'
));

-- Lock source edits once the request has moved past source selection.
-- "Change sources and redraft" unlocks by moving stage back to
-- sources_selected first — that's what lifts this check, not a bypass
-- flag.
create or replace function forbid_source_changes_after_selection_locked()
returns trigger as $$
declare
  req_id uuid;
  req_stage text;
begin
  req_id := coalesce(new.request_id, old.request_id);
  select stage into req_stage from content_requests where id = req_id;
  if req_stage not in ('requested', 'researching', 'sources_insufficient', 'sources_selected') then
    raise exception 'Source selection is locked once the request has moved past source selection (current stage: %). Use "Change sources and redraft" to unlock.', req_stage;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists forbid_source_changes_after_selection_locked_trigger on sources;
create trigger forbid_source_changes_after_selection_locked_trigger
  before insert or update or delete on sources
  for each row execute function forbid_source_changes_after_selection_locked();
