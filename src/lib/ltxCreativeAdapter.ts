import { z } from "zod";

/**
 * A creative LoRA may affect the actual pixels, so it is a sealed worker-model
 * dependency rather than a loose prompt preset.  This keeps an attractive but
 * incompatible community adapter from silently degrading an LTX take.
 */
export const LTX_CREATIVE_ADAPTER_CONTRACT_VERSION = "ltx-creative-adapter/v1" as const;

const AdapterIdSchema = z.string()
  .regex(/^ltx-creative-[a-z0-9][a-z0-9-]{1,78}$/)
  .max(80);
const TriggerTokenSchema = z.string().trim().min(1).max(80)
  .regex(/^[\p{L}\p{N}_ -]+$/u, "adapter trigger tokens must be plain prompt text");
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** The only creator-facing switch. Trigger tokens are owned by the pinned model manifest. */
export const LtxCreativeAdapterSelectionSchema = z.object({
  id: AdapterIdSchema,
  /** Calibrated after the adapter's own visual benchmark; never accept full-strength by default. */
  strength: z.number().finite().min(0.15).max(0.95),
}).strict();

export type LtxCreativeAdapterSelection = z.infer<typeof LtxCreativeAdapterSelectionSchema>;

export interface ResolvedLtxCreativeAdapter extends LtxCreativeAdapterSelection {
  triggerTokens: readonly string[];
  manifestSha256: string;
}

const WorkerAdapterSpecSchema = z.object({
  id: AdapterIdSchema,
  kind: z.literal("file"),
  repository: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  manifestSha256: Sha256Schema,
  sourcePath: z.string().min(1),
  localPath: z.string().min(1),
  creativeAdapter: z.object({
    contractVersion: z.literal(LTX_CREATIVE_ADAPTER_CONTRACT_VERSION),
    role: z.enum(["visual-style", "camera-control", "material-style"]),
    baseModel: z.string().min(1),
    baseRevision: z.string().regex(/^[a-f0-9]{40}$/),
    runtimeRevision: z.string().regex(/^[a-f0-9]{40}$/),
    triggerTokens: z.array(TriggerTokenSchema).min(1).max(8)
      .superRefine((tokens, ctx) => {
        const normalized = tokens.map((token) => token.toLocaleLowerCase());
        if (new Set(normalized).size !== normalized.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "adapter trigger tokens must be unique" });
        }
      }),
    benchmark: z.object({
      rtx4090ProfileBenchmarked: z.literal(true),
      visualVerdict: z.literal("pass"),
    }).strict(),
  }).strict(),
}).passthrough();

/**
 * Resolve selected adapters from the exact immutable worker manifest before a
 * render plan is constructed. Empty selections remain completely unchanged.
 */
export function resolveLtxCreativeAdapters(args: {
  selections: ReadonlyMap<string, LtxCreativeAdapterSelection | undefined>;
  modelSpecs: readonly Record<string, unknown>[];
  baseModel: string;
  baseRevision: string;
  runtimeRevision: string;
}): Map<string, ResolvedLtxCreativeAdapter> {
  const requested = [...args.selections.entries()]
    .flatMap(([shotId, selection]) => selection ? [[shotId, LtxCreativeAdapterSelectionSchema.parse(selection)] as const] : []);
  if (!requested.length) return new Map();

  const specsById = new Map<string, z.infer<typeof WorkerAdapterSpecSchema>>();
  for (const raw of args.modelSpecs) {
    const parsed = WorkerAdapterSpecSchema.safeParse(raw);
    if (parsed.success) specsById.set(parsed.data.id, parsed.data);
  }

  const resolved = new Map<string, ResolvedLtxCreativeAdapter>();
  for (const [shotId, selection] of requested) {
    const spec = specsById.get(selection.id);
    if (!spec) {
      throw new Error(`LTX creative adapter ${selection.id} is not present in the sealed worker model manifest for ${shotId}`);
    }
    const adapter = spec.creativeAdapter;
    if (
      spec.repository !== args.baseModel ||
      spec.revision !== args.baseRevision ||
      adapter.baseModel !== args.baseModel ||
      adapter.baseRevision !== args.baseRevision ||
      adapter.runtimeRevision !== args.runtimeRevision ||
      !spec.sourcePath.includes("/loras/") ||
      !spec.localPath.includes("/loras/")
    ) {
      throw new Error(`LTX creative adapter ${selection.id} is not pinned to the active LTX runtime for ${shotId}`);
    }
    if (!adapter.benchmark.rtx4090ProfileBenchmarked || adapter.benchmark.visualVerdict !== "pass") {
      throw new Error(`LTX creative adapter ${selection.id} has not passed its RTX 4090 visual benchmark`);
    }
    resolved.set(shotId, {
      ...selection,
      triggerTokens: adapter.triggerTokens,
      manifestSha256: spec.manifestSha256,
    });
  }
  return resolved;
}
