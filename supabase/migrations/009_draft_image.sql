-- One stock photo per draft (via Pexels — see api/_lib/pexels.ts),
-- fetched once in draft.ts alongside the section text. Nullable: a
-- missing PEXELS_API_KEY, a rate limit, or no search results all just
-- mean no image for that draft, never a failed drafting stage.
alter table drafts add column if not exists image_url text;
alter table drafts add column if not exists image_alt text;
alter table drafts add column if not exists image_photographer text;
alter table drafts add column if not exists image_photographer_url text;
alter table drafts add column if not exists image_pexels_url text;
