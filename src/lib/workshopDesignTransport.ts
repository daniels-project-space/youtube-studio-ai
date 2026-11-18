import { z } from "zod";
import { canonicalJson } from "./canonicalJson";
import { sha256Hex } from "./sha256";

const entry = z.object({
  block: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  version: z.string().min(1).max(80).refine(value => value.trim().length > 0).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
}).strict();
const fields = {
  name: z.string().min(1).max(120).refine(value => value === value.trim()),
  family: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  entries: z.array(entry).min(1).max(100),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
};
const v1 = z.object({
  version: z.literal("workshop-design-snapshot/v1"),
  ...fields,
}).strict();
const v2 = z.object({
  version: z.literal("workshop-design-snapshot/v2"),
  ...fields,
  channelDesign: z.object({
    revision: z.number().int().positive().safe(),
    name: z.string().min(1).max(80).refine(value => value === value.trim()),
    niche: z.string().max(200).refine(value => value === value.trim()),
    persona: z.string().max(2000).refine(value => value === value.trim()),
    palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).max(5),
  }).strict(),
}).strict();
const transport = z.discriminatedUnion("version", [v1, v2]);
export type WorkshopDesignTransport = z.infer<typeof transport>;

/** Validate an untrusted design only. This never grants execution authority. */
export function parseWorkshopDesignTransport(value: unknown): WorkshopDesignTransport {
  const parsed = transport.parse(value);
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > 120_000) throw new Error("Workshop design exceeds its size limit");
  const { fingerprint, ...content } = parsed;
  if (sha256Hex(canonicalJson(content)) !== fingerprint) throw new Error("Workshop design fingerprint does not match its content");
  return parsed;
}
