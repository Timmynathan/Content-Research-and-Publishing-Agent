-- ═══════════════════════════════════════════════════════════════════
-- AI Content Research and Publishing Agent — Schema
-- Run this yourself in the Supabase SQL editor. Not executed by the agent.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- staff — maps auth users to roles. No self-service signup: a manager
-- or admin must insert a row here before someone can use the app.
-- ───────────────────────────────────────────────────────────────────
create table if not exists staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('manager', 'reviewer')),
  display_name text,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- Every other table's RLS policies need to answer "is this caller
-- staff, and what's their role" — including staff's OWN select policy.
-- A policy on `staff` that queries `staff` directly (e.g. `exists
-- (select 1 from staff where user_id = auth.uid())`) makes Postgres
-- detect infinite recursion (42P17) and refuse the read entirely, which
-- also breaks every other table's policies since they trigger the same
-- check. `security definer` functions run with RLS bypassed internally,
-- breaking the cycle, and give every other policy one shared place to
-- call instead of repeating the EXISTS subquery.
create or replace function is_staff(uid uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from staff where user_id = uid);
$$;

create or replace function staff_role(uid uuid default auth.uid())
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from staff where user_id = uid;
$$;

-- Any authenticated staff member can see the staff roster (needed to
-- resolve "who decided this" and to check their own role client-side).
create policy staff_select on staff
  for select to authenticated
  using (is_staff());

-- No insert/update/delete policy for authenticated users: role
-- assignment is done by you directly in the Supabase table editor or
-- via the service role, never through the app.

-- ───────────────────────────────────────────────────────────────────
-- content_requests
-- ───────────────────────────────────────────────────────────────────
create table if not exists content_requests (
  id uuid primary key default gen_random_uuid(),
  -- 'sources_insufficient' is a branch off 'researching': reached when
  -- fewer than the usable-source floor were selected. It is not a
  -- failure (stage_error stays null) — it's a resting state offering
  -- the manager an explicit choice (search again, supply material, or
  -- proceed anyway) rather than auto-advancing or hard-blocking.
  stage text not null default 'requested' check (stage in (
    'requested', 'researching', 'sources_insufficient', 'sources_selected', 'planned', 'drafting',
    'evaluating', 'revising', 'ready_for_review', 'approved', 'adapting',
    'queued', 'published'
  )),
  stage_error text,
  idea text not null,
  target_audience text not null,
  source_url text,
  supporting_material text,
  keywords text[] not null default '{}',
  tone text,
  -- Set when a manager explicitly chooses "proceed anyway" out of
  -- sources_insufficient. Must surface as a warning wherever the
  -- article/output is shown, most importantly to the reviewer before
  -- they approve.
  thinly_sourced boolean not null default false,
  created_by uuid not null references staff(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table content_requests enable row level security;

create policy content_requests_select on content_requests
  for select to authenticated
  using (is_staff());

create policy content_requests_insert on content_requests
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and staff_role() = 'manager'
  );

-- Updates happen through api/advance.ts using the service role, which
-- bypasses RLS. This policy exists so a manager can still edit request
-- metadata (e.g. before research starts) directly if needed.
create policy content_requests_update on content_requests
  for update to authenticated
  using (is_staff())
  with check (is_staff());

create index if not exists content_requests_stage_idx on content_requests(stage);

-- ───────────────────────────────────────────────────────────────────
-- sources — one row per source considered, whether or not used.
-- ───────────────────────────────────────────────────────────────────
create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references content_requests(id) on delete cascade,
  -- Nullable: a pasted source (origin='pasted') has no URL, only text a
  -- human typed or pasted directly — the escape hatch for anything the
  -- scraper can't reach (paywalls, PDFs, internal notes, social posts).
  url text,
  title text,
  publisher text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  raw_text text,
  excerpt text,
  selected boolean not null default false,
  selection_reason text,
  fetch_ok boolean not null default true,
  fetch_error text,
  -- Code-assigned classification of fetch_error, for a human-readable
  -- reason in the UI. fetch_error keeps the raw vendor message for
  -- debugging; this is what a reviewer/manager actually reads.
  failure_reason text check (failure_reason in (
    'unsupported_site', 'not_found', 'blocked', 'paywalled', 'timeout', 'no_content', 'error'
  )),
  origin text not null default 'scraped' check (origin in ('scraped', 'pasted')),
  -- Which automated search+scrape pass produced this row (the initial
  -- research handler is round 1; each manual "find more"/"search again"
  -- increments it, capped at 3). 0 for a single manually-added or
  -- pasted source, which isn't a "round" — it costs one action, not a
  -- whole search pass.
  search_round int not null default 1,
  created_at timestamptz not null default now()
);

alter table sources enable row level security;

create policy sources_all on sources
  for all to authenticated
  using (is_staff())
  with check (is_staff());

create index if not exists sources_request_idx on sources(request_id);

-- Once source selection is locked (request has moved past
-- sources_selected/sources_insufficient), no insert/update/delete on
-- sources is allowed — a UI that just hides the edit controls is not a
-- control. "Change sources and redraft" unlocks by moving the request's
-- stage back to sources_selected FIRST, which is what actually lifts
-- this check on the next write.
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

-- ───────────────────────────────────────────────────────────────────
-- drafts
-- sections: jsonb array of { key, heading, body, claims: [{ text, source_id, flagged, flag_reason }] }
-- ───────────────────────────────────────────────────────────────────
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references content_requests(id) on delete cascade,
  variant int not null,
  angle text not null,
  outline jsonb,
  sections jsonb not null default '[]',
  attempt int not null default 1,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);

alter table drafts enable row level security;

create policy drafts_all on drafts
  for all to authenticated
  using (is_staff())
  with check (is_staff());

create index if not exists drafts_request_idx on drafts(request_id);

-- ───────────────────────────────────────────────────────────────────
-- evaluations
-- scores: jsonb keyed by the rubric's own criteria, e.g.
--   { "Topic Relevance": { "score": 4, "note": "..." }, ... }
-- ───────────────────────────────────────────────────────────────────
create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  attempt int not null,
  scores jsonb not null,
  overall numeric not null,
  passed boolean not null,
  failing_sections text[] not null default '{}',
  recommended_changes text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table evaluations enable row level security;

create policy evaluations_all on evaluations
  for all to authenticated
  using (is_staff())
  with check (is_staff());

create index if not exists evaluations_draft_idx on evaluations(draft_id);

-- ───────────────────────────────────────────────────────────────────
-- channel_outputs
-- ───────────────────────────────────────────────────────────────────
create table if not exists channel_outputs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'x', 'newsletter')),
  subject text,
  body text not null,
  validation jsonb,
  valid boolean not null default false,
  created_at timestamptz not null default now()
);

alter table channel_outputs enable row level security;

create policy channel_outputs_all on channel_outputs
  for all to authenticated
  using (is_staff())
  with check (is_staff());

create index if not exists channel_outputs_draft_idx on channel_outputs(draft_id);

-- ───────────────────────────────────────────────────────────────────
-- approvals
-- ───────────────────────────────────────────────────────────────────
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references content_requests(id) on delete cascade,
  draft_id uuid not null references drafts(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  comment text,
  content_hash text not null,
  decided_by uuid not null references staff(user_id),
  decided_at timestamptz not null default now()
);

alter table approvals enable row level security;

-- Everyone on staff can read approvals (managers need to see why a
-- request was rejected).
create policy approvals_select on approvals
  for select to authenticated
  using (is_staff());

-- Only reviewers can insert an approval, and only for themselves.
-- This is a secondary guard — the DB trigger below and the server-side
-- role check in api/advance.ts are the real gates. RLS alone is not
-- enough because a manager and a reviewer are both "authenticated".
create policy approvals_insert on approvals
  for insert to authenticated
  with check (
    decided_by = auth.uid()
    and staff_role() = 'reviewer'
  );

-- No update/delete policy: approvals are append-only. A stale approval
-- is superseded by a new one, never edited in place.

create index if not exists approvals_request_idx on approvals(request_id);

-- A manager must not be able to approve their own request by
-- inserting an approvals row directly against the table (bypassing
-- api/advance.ts). This trigger is the enforced control, not the UI:
-- it refuses any approval where decided_by is the same person who
-- created the request.
create or replace function forbid_self_approval()
returns trigger as $$
declare
  requester uuid;
begin
  select created_by into requester from content_requests where id = new.request_id;
  if requester = new.decided_by then
    raise exception 'A user cannot approve or reject their own content request.';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists forbid_self_approval_trigger on approvals;
create trigger forbid_self_approval_trigger
  before insert on approvals
  for each row execute function forbid_self_approval();

-- Enforce "nothing is adapted or queued without an approval": a
-- content_requests row cannot move into 'adapting' unless a matching
-- 'approved' approvals row already exists for its currently selected
-- draft. This is checked again in api/advance.ts, but the trigger is
-- the actual control — a direct UPDATE against the table is refused
-- too.
create or replace function require_approval_before_adapting()
returns trigger as $$
begin
  if new.stage = 'adapting' and old.stage is distinct from 'adapting' then
    if not exists (
      select 1 from approvals a
      join drafts d on d.id = a.draft_id
      where a.request_id = new.id
        and a.decision = 'approved'
        and d.selected = true
    ) then
      raise exception 'Cannot move to adapting without an approved draft.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists require_approval_before_adapting_trigger on content_requests;
create trigger require_approval_before_adapting_trigger
  before update on content_requests
  for each row execute function require_approval_before_adapting();

-- ───────────────────────────────────────────────────────────────────
-- publish_queue
-- ───────────────────────────────────────────────────────────────────
create table if not exists publish_queue (
  id uuid primary key default gen_random_uuid(),
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  channel text not null check (channel in ('linkedin', 'x', 'newsletter')),
  scheduled_for timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'published', 'failed')),
  attempts int not null default 0,
  last_error text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

alter table publish_queue enable row level security;

create policy publish_queue_all on publish_queue
  for all to authenticated
  using (is_staff())
  with check (is_staff());

create index if not exists publish_queue_status_idx on publish_queue(status);

-- A published item must never be published again. This is enforced in
-- code (api/advance.ts / the publish handler refuses a second attempt
-- on a row already 'published'), but we also forbid the DB from ever
-- moving a row backwards out of 'published'.
create or replace function forbid_republish()
returns trigger as $$
begin
  if old.status = 'published' and new.status <> 'published' then
    raise exception 'Cannot change the status of an already-published queue item.';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists forbid_republish_trigger on publish_queue;
create trigger forbid_republish_trigger
  before update on publish_queue
  for each row execute function forbid_republish();

-- ───────────────────────────────────────────────────────────────────
-- events — append-only log of every stage transition and attempt.
-- ───────────────────────────────────────────────────────────────────
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references content_requests(id) on delete cascade,
  stage text not null,
  event text not null,
  ok boolean not null,
  detail jsonb,
  at timestamptz not null default now()
);

alter table events enable row level security;

create policy events_select on events
  for select to authenticated
  using (is_staff());

create policy events_insert on events
  for insert to authenticated
  with check (is_staff());

-- No update/delete policy anywhere on events: it is an append-only log.

create index if not exists events_request_idx on events(request_id);

-- ───────────────────────────────────────────────────────────────────
-- updated_at maintenance on content_requests
-- ───────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists content_requests_set_updated_at on content_requests;
create trigger content_requests_set_updated_at
  before update on content_requests
  for each row execute function set_updated_at();
