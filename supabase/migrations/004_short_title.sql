-- The "idea" field is a full prompt (often multiple sentences), not a
-- heading — fine as the input to research/drafting, but unreadable as a
-- page title. short_title is a short, plain-language label generated
-- once (lazily, on first view of the request detail page) and cached
-- here so it isn't regenerated on every load. Nullable: older requests,
-- and any request whose generation hasn't run yet, simply fall back to
-- showing "idea" in the UI.
alter table content_requests add column if not exists short_title text;
