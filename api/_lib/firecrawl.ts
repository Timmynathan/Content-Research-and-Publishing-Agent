import { Firecrawl } from "firecrawl";
import { env } from "./env.js";
import type { FetchFailureReason } from "../../shared/types.js";

let client: Firecrawl | null = null;

function getClient(): Firecrawl {
  if (!client) {
    client = new Firecrawl({ apiKey: env.firecrawlApiKey });
  }
  return client;
}

export interface ScrapedPage {
  ok: true;
  url: string;
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  text: string;
}

export interface FailedScrape {
  ok: false;
  url: string;
  /** Raw provider error — for the event log / debugging, not for a reviewer to read. */
  error: string;
  /** Code-assigned classification of `error`, for a human-readable reason in the UI. */
  reason: FetchFailureReason;
}

export type ScrapeResult = ScrapedPage | FailedScrape;

// Kept short enough that a top-up batch (several scrapes in parallel,
// possibly several batches in sequence) stays well inside the stage's
// function timeout.
const SCRAPE_TIMEOUT_MS = 15_000;

/**
 * Turns a provider error message into one of our own reasons. Provider
 * error text (Firecrawl's included) is written for their customer
 * debugging an integration, not for a content manager reading a source
 * list — it can even carry a vendor sales link. The raw message is
 * still kept alongside this (see FailedScrape.error) for anyone who
 * needs to debug the actual failure.
 */
function classifyFailure(message: string): FetchFailureReason {
  const msg = message.toLowerCase();
  if (msg.includes("do not support this site") || msg.includes("not supported")) return "unsupported_site";
  if (msg.includes("404") || msg.includes("not found")) return "not_found";
  if (
    msg.includes("403") ||
    msg.includes("forbidden") ||
    msg.includes("blocked") ||
    msg.includes("bot detection") ||
    msg.includes("captcha")
  )
    return "blocked";
  if (msg.includes("paywall") || msg.includes("subscription required") || msg.includes("402")) return "paywalled";
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  return "error";
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  try {
    const doc = await getClient().scrape(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: SCRAPE_TIMEOUT_MS,
    });
    const text = doc.markdown ?? "";
    if (!text.trim()) {
      return { ok: false, url, error: "Scrape succeeded but returned no readable content", reason: "no_content" };
    }
    return {
      ok: true,
      url,
      title: doc.metadata?.title ?? doc.metadata?.ogTitle ?? null,
      publisher: doc.metadata?.ogSiteName ?? null,
      publishedAt: doc.metadata?.publishedTime ?? null,
      text,
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    return { ok: false, url, error: message, reason: classifyFailure(message) };
  }
}

export interface SearchHit {
  url: string;
  title: string | null;
}

/** Web search for candidate URLs to scrape (no content — scraping is a separate, explicit step). */
export async function searchWeb(
  query: string,
  limit: number,
  excludeDomains?: readonly string[],
): Promise<SearchHit[]> {
  const result = await getClient().search(query, {
    limit,
    sources: ["web"],
    excludeDomains: excludeDomains?.length ? [...excludeDomains] : undefined,
  });
  const web = result.web ?? [];
  return web
    .map((entry) => ("url" in entry ? { url: entry.url, title: ("title" in entry && entry.title) || null } : null))
    .filter((hit): hit is SearchHit => hit !== null && Boolean(hit.url));
}
