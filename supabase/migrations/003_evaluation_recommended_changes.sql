-- Migration: adds the recommended_changes column evaluations needs to
-- hand revise.ts specific, actionable notes rather than just a list of
-- failing section keys. Run this yourself in the Supabase SQL editor.

alter table evaluations add column if not exists recommended_changes text[] not null default '{}';
