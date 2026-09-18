import { env } from "./env.js";

export interface PexelsImage {
  url: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  /** The photo's own page on pexels.com — required by Pexels' attribution guidelines alongside the photographer credit. */
  pexelsUrl: string;
}

interface PexelsSearchResponse {
  photos: Array<{
    alt: string | null;
    photographer: string;
    photographer_url: string;
    url: string;
    src: { large: string; original: string };
  }>;
}

/**
 * Best-effort, never throws — a missing/invalid key, a rate limit, or a
 * network blip all just mean "no image for this draft," logged by the
 * caller as a non-fatal event the same way a failed staff-notification
 * email is (see staffNotifications.ts). An article isn't worth losing
 * over a stock photo.
 */
export async function searchImage(query: string): Promise<PexelsImage | null> {
  if (!env.pexelsApiKey) return null;

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: env.pexelsApiKey } },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as PexelsSearchResponse;
    const photo = data.photos?.[0];
    if (!photo) return null;

    return {
      url: photo.src.large ?? photo.src.original,
      alt: photo.alt || query,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      pexelsUrl: photo.url,
    };
  } catch {
    return null;
  }
}
