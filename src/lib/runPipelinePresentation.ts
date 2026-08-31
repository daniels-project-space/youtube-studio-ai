import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";

/**
 * The only immutable invocation data the live operator surface needs: ordered
 * block IDs. The durable snapshot also contains seeds, artifact namespaces,
 * budget admission, and compiled configuration; none of that belongs in a
 * browser subscription merely to draw progress.
 */
export type FrozenRunPipelinePresentation = Readonly<{
  source: PipelineInvocationSnapshot["source"];
  entries: ReadonlyArray<Readonly<{ block: string }>>;
}>;

/**
 * Projects one verified, immutable run plan for the browser. Invalid,
 * incomplete, or historical snapshots deliberately return undefined so the
 * caller can label its compatibility fallback instead of presenting a mutable
 * channel plan as the one actually being executed.
 */
export function frozenRunPipelinePresentation(input: {
  snapshot?: unknown;
  sha256?: unknown;
}): FrozenRunPipelinePresentation | undefined {
  if (
    input.snapshot === undefined ||
    typeof input.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  ) {
    return undefined;
  }

  try {
    const snapshot = normalizePipelineInvocationSnapshot(
      input.snapshot as PipelineInvocationSnapshot,
    );
    if (pipelineInvocationSha256(snapshot) !== input.sha256) return undefined;

    return {
      source: snapshot.source,
      entries: snapshot.entries.map(({ block }) => ({ block })),
    };
  } catch {
    return undefined;
  }
}
