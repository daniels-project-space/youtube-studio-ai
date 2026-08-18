/**
 * Search-first acquisition for documentary stills.
 *
 * The renderer tries audited licensed providers before it spends on generated
 * art. Every accepted online result carries the query, asset page,
 * attribution and license into a local provenance sidecar. If the image does
 * not satisfy the existing visual gate, the caller must reject it and use its
 * declared generation fallback instead of quietly reusing an uncredited URL.
 */
import { searchWikimediaImage } from "@/lib/wikimedia";

export interface OnlineDocumentaryAsset {
  provider: "wikimedia-commons" | "pexels";
  query: string;
  downloadUrl: string;
  sourcePageUrl: string;
  attribution: string;
  license?: string;
  licenseUrl?: string;
}

export interface SearchOnlineDocumentaryAssetArgs {
  /** Ordered from most exact named subject to broadest visual cue. */
  queries: readonly string[];
  thumbWidth?: number;
}

function uniqueQueries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 3 && value.length <= 180)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

interface PexelsPhoto {
  url?: string;
  photographer?: string;
  src?: { original?: string; large2x?: string; large?: string };
}

async function searchPexelsPhotos(query: string): Promise<OnlineDocumentaryAsset[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape&size=large`,
      { headers: { Authorization: key } },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { photos?: PexelsPhoto[] };
    return (body.photos ?? []).flatMap((photo) => {
      const downloadUrl = photo.src?.large2x ?? photo.src?.large ?? photo.src?.original;
      if (!downloadUrl || !photo.url) return [];
      return [{
        provider: "pexels" as const,
        query,
        downloadUrl,
        sourcePageUrl: photo.url,
        attribution: `Photo by ${photo.photographer ?? "Pexels contributor"} via Pexels`,
        license: "Pexels License",
        licenseUrl: "https://www.pexels.com/license/",
      }];
    });
  } catch {
    return [];
  }
}

/**
 * Licensed, online search seam for DocuMotion and future documentary renderers.
 * Pexels and Wikimedia expose reuse terms and attribution without relying on
 * unlicensed web scraping.
 */
/**
 * Return auditable licensed candidates per distinct query. Callers must run
 * their normal visual gate on every candidate; a search result is not itself
 * an approval to use that image.
 */
export async function searchOnlineDocumentaryAssets(
  args: SearchOnlineDocumentaryAssetArgs,
): Promise<OnlineDocumentaryAsset[]> {
  const candidates: OnlineDocumentaryAsset[] = [];
  const seenUrls = new Set<string>();
  for (const query of uniqueQueries(args.queries)) {
    for (const image of await searchPexelsPhotos(query)) {
      if (seenUrls.has(image.downloadUrl)) continue;
      seenUrls.add(image.downloadUrl);
      candidates.push(image);
    }
    const image = await searchWikimediaImage(query, args.thumbWidth ?? 1600);
    if (!image) continue;
    if (seenUrls.has(image.url)) continue;
    seenUrls.add(image.url);
    candidates.push({
      provider: "wikimedia-commons",
      query,
      downloadUrl: image.url,
      sourcePageUrl: image.sourcePageUrl,
      attribution: image.attribution,
      license: image.license,
      licenseUrl: image.licenseUrl,
    });
  }
  return candidates;
}

/** Compatibility helper for callers that only need the first candidate. */
export async function searchOnlineDocumentaryAsset(
  args: SearchOnlineDocumentaryAssetArgs,
): Promise<OnlineDocumentaryAsset | null> {
  return (await searchOnlineDocumentaryAssets(args))[0] ?? null;
}
