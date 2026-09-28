import { ASSET_RETENTION_MS, FINAL_VIDEO_RETENTION_MS, classifyUnboundR2Key } from "./r2AssetRetention";

export type LegacyR2Record = {
  bucket: string; key: string; size: number; lastModified: string; etag: string;
};
export type ConvexReference = { table: string; id: string; path: string };
export type CensusRow = LegacyR2Record & {
  family: "generated_media" | "final_video" | "possible_final" | "evidence" | "outside" | "protected";
  decision: "preserve" | "review_unreferenced";
  reason: string;
  references: ConvexReference[];
};

const THUMBNAIL_PATH = /(?:^|\/)(?:thumb(?:nail)?s?(?:-checkpoints)?|nano[-_]?banana)(?:\/|[._-])/iu;
const REUSABLE_PATH = /(?:^|\/)(?:library|reusable(?:-media)?)(?:\/|[._-])/iu;
const POSSIBLE_FINAL = /(?:^|\/)(?:final(?:[_-][^/]*)?|master(?:[_-][^/]*)?)\.mp4$/iu;

/** Historical names are evidence only. They never confer automatic delete authority. */
export function classifyLegacyR2Key(key: string): CensusRow["family"] {
  // Studio's imagecraft namespace and Nano Banana outputs are thumbnail work.
  if (key.startsWith("imagecraft/") || THUMBNAIL_PATH.test(key) || REUSABLE_PATH.test(key)) return "protected";
  const known = classifyUnboundR2Key(key);
  if (known !== "outside") return known;
  if (POSSIBLE_FINAL.test(key)) return "possible_final";
  return "outside";
}

export function validateLegacyInventory(rows: LegacyR2Record[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.bucket !== "youtube-studio-ai") throw new Error("Inventory must contain only the exact Studio bucket");
    if (!row.key || seen.has(row.key)) throw new Error("Inventory contains a missing or duplicate key");
    if (!Number.isSafeInteger(row.size) || row.size < 0 || !row.etag ||
        !Number.isFinite(Date.parse(row.lastModified))) throw new Error(`Incomplete R2 identity: ${row.key}`);
    seen.add(row.key);
  }
}

/** Includes URLs, escaped keys, nested metadata and free text; extra matches preserve bytes. */
export function referencesInDocument(
  document: Record<string, unknown>, table: string, keys: readonly string[],
): Map<string, ConvexReference[]> {
  const found = new Map<string, ConvexReference[]>();
  const id = typeof document._id === "string" ? document._id : "unknown";
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      let decoded = value;
      try { decoded = decodeURIComponent(value); } catch { /* retain raw match */ }
      for (const key of keys) {
        if (value.includes(key) || decoded.includes(key)) {
          const refs = found.get(key) ?? [];
          refs.push({ table, id, path });
          found.set(key, refs);
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    } else if (value && typeof value === "object") {
      for (const [name, entry] of Object.entries(value)) visit(entry, path ? `${path}.${name}` : name);
    }
  };
  visit(document, "");
  return found;
}

export function planLegacyR2Retention(
  records: LegacyR2Record[], references: ReadonlyMap<string, ConvexReference[]>, now: number,
): CensusRow[] {
  validateLegacyInventory(records);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid census time");
  return records.map((record) => {
    const family = classifyLegacyR2Key(record.key);
    const refs = references.get(record.key) ?? [];
    const modifiedAt = Date.parse(record.lastModified);
    const minAge = family === "final_video" || family === "possible_final"
      ? FINAL_VIDEO_RETENTION_MS : ASSET_RETENTION_MS;
    let reason: string;
    if (family === "protected") reason = "thumbnail or reusable library path";
    else if (family === "outside" || family === "evidence") reason = "unclassified or evidence path";
    else if (refs.length) reason = "referenced by authoritative Convex export";
    else if (modifiedAt > now || modifiedAt > now - minAge) reason = "minimum object age has not elapsed";
    else if (family === "possible_final") reason = "final-like name lacks an authoritative release classification";
    else if (family === "final_video") reason = "final release timestamp and YouTube state unverified";
    else reason = "unreferenced generated media older than 30 days; manual review required";
    return { ...record, family,
      decision: reason.startsWith("unreferenced generated media") ? "review_unreferenced" : "preserve",
      reason, references: refs };
  });
}
