function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Read lazily (inside functions, not at module top-level import time in a
// way that crashes the whole module graph) so a missing optional key
// (e.g. RESEND_API_KEY before Phase 3 is wired) doesn't break unrelated
// stages.
export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get firecrawlApiKey() {
    return required("FIRECRAWL_API_KEY");
  },
  get resendApiKey() {
    return required("RESEND_API_KEY");
  },
  get resendFrom() {
    return required("RESEND_FROM");
  },
  get resendTestRecipient() {
    return required("RESEND_TEST_RECIPIENT");
  },
  // Optional: used only to build a clickable link in staff notification
  // emails (see _lib/staffNotifications.ts). Not required — without it,
  // those emails just skip the link rather than failing outright, since
  // there's nothing else that depends on this being set.
  get appUrl() {
    return process.env.APP_URL || null;
  },
  // Optional, like appUrl: _lib/pexels.ts treats a missing key as "skip
  // the image for this draft" (logged, not thrown) rather than failing
  // the whole drafting stage over a decorative image — see draft.ts.
  get pexelsApiKey() {
    return process.env.PEXELS_API_KEY || null;
  },
};
