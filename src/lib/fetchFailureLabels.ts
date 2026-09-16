import type { FetchFailureReason } from "../../shared/types";

export const FETCH_FAILURE_LABELS: Record<FetchFailureReason, string> = {
  unsupported_site: "Social platforms can't be read automatically",
  not_found: "Page not found",
  blocked: "The site blocked automated reading",
  paywalled: "Behind a paywall",
  timeout: "Took too long to respond",
  no_content: "No readable text on the page",
  error: "Couldn't be read",
};
