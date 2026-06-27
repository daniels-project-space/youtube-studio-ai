/**
 * Pipeline composer — the deterministic engine under the P4 Architect
 * (docs/MODULES_TO_MASTRA.md). Given a GOAL (the store keys the channel needs
 * produced), the seed keys already present, and the available blocks (each
 * declaring consumes/produces), it backward-chains to the MINIMAL, dependency-
 * ordered, DAG-valid pipeline that produces the goal — which runPipelineWorkflow
 * then runs through Mastra.
 *
 * Division of labour: the Architect AGENT only needs to pick the GOAL and resolve
 * AMBIGUITY (which block, when several produce the same key + match the channel's
 * capabilities). Ordering, dependency resolution and validity are deterministic
 * here — so a hallucinated ordering can't ship; an unsatisfiable goal throws.
 */
import type { Block } from "@/engine/types";

export interface ComposeOptions {
  /** Store keys already present before the pipeline runs (the seed). */
  have?: string[];
  /**
   * Resolve which block produces a key when several can (the Architect's choice
   * point). Default: first registered. Return a block id from the candidates.
   */
  choose?: (key: string, candidates: Block[]) => string;
}

/**
 * Backward-chain a goal into an ordered, validated pipeline of blocks.
 * Throws on an unsatisfiable goal or a dependency cycle.
 */
export function composePipeline(goal: string[], blocks: Block[], opts: ComposeOptions = {}): Block[] {
  // key → every block that can produce it (ambiguity is the Architect's choice).
  const producers = new Map<string, Block[]>();
  for (const b of blocks) {
    for (const k of b.produces) {
      const list = producers.get(k) ?? [];
      list.push(b);
      producers.set(k, list);
    }
  }
  const choose = opts.choose ?? ((_key, cands) => cands[0].id);
  const have = new Set(opts.have ?? []);
  const ordered: Block[] = [];
  const added = new Set<string>();   // block ids already placed
  const visiting = new Set<string>(); // for cycle detection

  function need(key: string): void {
    if (have.has(key)) return;
    const cands = producers.get(key);
    if (!cands || cands.length === 0) throw new Error(`composePipeline: no block produces "${key}"`);
    const pickId = cands.length === 1 ? cands[0].id : choose(key, cands);
    const block = cands.find((b) => b.id === pickId) ?? cands[0];
    if (added.has(block.id)) return;
    if (visiting.has(block.id)) throw new Error(`composePipeline: dependency cycle through "${block.id}"`);
    visiting.add(block.id);
    for (const dep of block.consumes) need(dep); // satisfy upstream first
    visiting.delete(block.id);
    added.add(block.id);
    ordered.push(block);
    for (const p of block.produces) have.add(p); // its outputs are now available
  }

  for (const g of goal) need(g);
  return ordered;
}
