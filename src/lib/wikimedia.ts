/**
 * Wikimedia Commons image lookup — free, public-domain imagery for NAMED
 * entities (people, places, artworks): e.g. "Marcus Aurelius" → his bust.
 * Ported from autostudio concept_imagery.search_wikimedia. Returns a directly
 * downloadable image URL (scaled thumb) or null.
 */
const API = "https://commons.wikimedia.org/w/api.php";

interface SearchResp {
  query?: { search?: { title: string }[] };
}
interface ExtMeta {
  Artist?: { value?: string };
  LicenseShortName?: { value?: string };
}
interface InfoResp {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: {
          url?: string;
          thumburl?: string;
          width?: number;
          extmetadata?: ExtMeta;
        }[];
      }
    >;
  };
}

export interface WikiImage {
  url: string;
  /** Attribution line for the description credits (license ledger). */
  attribution: string;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Like searchWikimediaImageUrl but also returns an attribution line built from
 * extmetadata (Artist + LicenseShortName) for the license/attribution ledger.
 */
export async function searchWikimediaImage(
  query: string,
  thumbWidth = 1600,
): Promise<WikiImage | null> {
  const sUrl =
    `${API}?action=query&list=search&format=json&origin=*` +
    `&srnamespace=6&srlimit=6&srsearch=${encodeURIComponent(query + " filetype:bitmap")}`;
  let titles: string[] = [];
  try {
    const r = await fetch(sUrl);
    if (!r.ok) return null;
    const j = (await r.json()) as SearchResp;
    titles = (j.query?.search ?? []).map((s) => s.title).filter(Boolean);
  } catch {
    return null;
  }
  for (const title of titles.slice(0, 4)) {
    try {
      const iUrl =
        `${API}?action=query&prop=imageinfo&format=json&origin=*` +
        `&iiprop=url|size|extmetadata&iiurlwidth=${thumbWidth}&titles=${encodeURIComponent(title)}`;
      const r = await fetch(iUrl);
      if (!r.ok) continue;
      const j = (await r.json()) as InfoResp;
      for (const p of Object.values(j.query?.pages ?? {})) {
        const info = p.imageinfo?.[0];
        const url = info?.thumburl ?? info?.url;
        if (!url || !/\.(jpe?g|png)$/i.test(url.split("?")[0])) continue;
        const ext = info?.extmetadata ?? {};
        const artist = ext.Artist?.value ? stripHtml(ext.Artist.value) : "";
        const license = ext.LicenseShortName?.value ? stripHtml(ext.LicenseShortName.value) : "";
        const attribution =
          (artist ? `${artist}` : "Wikimedia Commons") +
          (license ? ` (${license})` : "") +
          (artist ? " via Wikimedia Commons" : "");
        return { url, attribution };
      }
    } catch {
      /* try next title */
    }
  }
  return null;
}

export async function searchWikimediaImageUrl(
  query: string,
  thumbWidth = 1600,
): Promise<string | null> {
  // 1) search the File namespace for bitmap images matching the entity.
  const sUrl =
    `${API}?action=query&list=search&format=json&origin=*` +
    `&srnamespace=6&srlimit=6&srsearch=${encodeURIComponent(query + " filetype:bitmap")}`;
  let titles: string[] = [];
  try {
    const r = await fetch(sUrl);
    if (!r.ok) return null;
    const j = (await r.json()) as SearchResp;
    titles = (j.query?.search ?? []).map((s) => s.title).filter(Boolean);
  } catch {
    return null;
  }
  if (titles.length === 0) return null;

  // 2) resolve the first usable title to a scaled, downloadable URL.
  for (const title of titles.slice(0, 4)) {
    try {
      const iUrl =
        `${API}?action=query&prop=imageinfo&format=json&origin=*` +
        `&iiprop=url|size&iiurlwidth=${thumbWidth}&titles=${encodeURIComponent(title)}`;
      const r = await fetch(iUrl);
      if (!r.ok) continue;
      const j = (await r.json()) as InfoResp;
      const pages = j.query?.pages ?? {};
      for (const p of Object.values(pages)) {
        const info = p.imageinfo?.[0];
        const url = info?.thumburl ?? info?.url;
        if (url && /\.(jpe?g|png)$/i.test(url.split("?")[0])) return url;
      }
    } catch {
      /* try next title */
    }
  }
  return null;
}
