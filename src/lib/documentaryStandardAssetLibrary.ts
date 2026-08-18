/**
 * Curated, reusable documentary evidence assets.
 *
 * These records deliberately keep the source page, attribution and usage terms
 * next to the downloaded file. A renderer can use the cached file, while a
 * producer can still audit where it came from. Do not add logos or assets whose
 * source page marks them as third-party copyright.
 */

export const DOCUMENTARY_STANDARD_ASSET_ROOT = "public/assets/documentary-standard/v1";

export type DocumentaryAssetUse = "editorial_factual" | "reference_only";

export interface DocumentaryStandardAsset {
  id: string;
  title: string;
  tags: readonly string[];
  remoteUrl: string;
  sourcePageUrl: string;
  termsUrl: string;
  credit: string;
  use: DocumentaryAssetUse;
  localFile: string;
  /** Never use this record in a way that suggests NASA/JPL/Caltech endorsement. */
  restrictions: readonly string[];
}

/**
 * Approved provider metadata for future topic-specific acquisition. A fetcher
 * must record the exact item page, author/credit and license before caching.
 */
export const DOCUMENTARY_ASSET_PROVIDERS = [
  {
    id: "nasa",
    label: "NASA Image and Video Library / JPL Photojournal",
    collectionUrl: "https://images.nasa.gov/",
    termsUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    requiredMetadata: ["item_page", "credit", "terms_url", "download_url"],
  },
  {
    id: "library-of-congress",
    label: "Library of Congress",
    collectionUrl: "https://www.loc.gov/photos/",
    termsUrl: "https://www.loc.gov/legal/",
    requiredMetadata: ["item_page", "rights_statement", "download_url"],
  },
  {
    id: "wikimedia-commons",
    label: "Wikimedia Commons",
    collectionUrl: "https://commons.wikimedia.org/",
    termsUrl: "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
    requiredMetadata: ["item_page", "license", "creator", "attribution", "download_url"],
  },
] as const;

export const DOCUMENTARY_STANDARD_ASSETS = [
  {
    id: "nasa-blue-marble-earth",
    title: "Earth (Blue Marble, Suomi NPP)",
    tags: ["earth", "photograph", "blue-marble", "planet", "nasa"],
    remoteUrl: "https://images-assets.nasa.gov/image/PIA18033/PIA18033~orig.jpg",
    sourcePageUrl: "https://science.nasa.gov/photojournal/earth/",
    termsUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    credit: "Courtesy NASA",
    use: "editorial_factual",
    localFile: "nasa/blue-marble-earth-pia18033.jpg",
    restrictions: ["No NASA endorsement implication.", "Credit NASA and preserve the image's factual context as a Blue Marble montage."],
  },
  {
    id: "nasa-voyager-golden-record",
    title: "Voyager's Special Cargo: The Golden Record",
    tags: ["voyager", "golden-record", "record", "spacecraft", "nasa", "archive-photo"],
    remoteUrl: "https://images-assets.nasa.gov/image/PIA14113/PIA14113~orig.jpg",
    sourcePageUrl: "https://science.nasa.gov/photojournal/voyagers-special-cargo-the-golden-record/",
    termsUrl: "https://www.jpl.nasa.gov/jpl-image-use-policy/",
    credit: "Courtesy NASA/JPL-Caltech",
    use: "editorial_factual",
    localFile: "nasa/voyager-golden-record-pia14113.jpg",
    restrictions: ["No NASA/JPL/Caltech endorsement implication.", "Do not crop or caption in a way that misrepresents the source."],
  },
  {
    id: "nasa-pale-blue-dot-original",
    title: "Pale Blue Dot (1990)",
    tags: ["earth", "photograph", "pale-blue-dot", "voyager", "space", "nasa"],
    remoteUrl: "https://images-assets.nasa.gov/image/PIA00452/PIA00452~orig.jpg",
    sourcePageUrl: "https://science.nasa.gov/photojournal/solar-system-portrait-earth-as-pale-blue-dot/",
    termsUrl: "https://www.jpl.nasa.gov/jpl-image-use-policy/",
    credit: "Courtesy NASA/JPL-Caltech",
    use: "editorial_factual",
    localFile: "nasa/pale-blue-dot-pia00452.jpg",
    restrictions: ["No NASA/JPL/Caltech endorsement implication.", "Preserve the factual description: Earth is the small blue dot in the sunbeam."],
  },
  {
    id: "nasa-pale-blue-dot-revisited",
    title: "Pale Blue Dot Revisited (2020)",
    tags: ["earth", "photograph", "pale-blue-dot", "voyager", "space", "nasa", "reprocessed"],
    remoteUrl: "https://images-assets.nasa.gov/image/PIA23645/PIA23645~orig.jpg",
    sourcePageUrl: "https://science.nasa.gov/photojournal/pale-blue-dot-revisited/",
    termsUrl: "https://www.jpl.nasa.gov/jpl-image-use-policy/",
    credit: "Courtesy NASA/JPL-Caltech",
    use: "editorial_factual",
    localFile: "nasa/pale-blue-dot-revisited-pia23645.jpg",
    restrictions: ["No NASA/JPL/Caltech endorsement implication.", "Label it as the 2020 revisited processing, not the original 1990 image."],
  },
] as const satisfies readonly DocumentaryStandardAsset[];

export function documentaryStandardAsset(id: string): DocumentaryStandardAsset {
  const asset = DOCUMENTARY_STANDARD_ASSETS.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Unknown documentary standard asset: ${id}`);
  return asset;
}

export function documentaryAssetsForTags(tags: readonly string[]): DocumentaryStandardAsset[] {
  const required = new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  return DOCUMENTARY_STANDARD_ASSETS.filter((asset) => [...required].every((tag) => (asset.tags as readonly string[]).includes(tag)));
}
