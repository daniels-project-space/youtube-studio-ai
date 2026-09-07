/**
 * OVERRIDE-DROP AUDIT — a contract that REPLACES a block's input list, and
 * loses one of its inputs in the process.
 *
 * moduleManifest.ts:
 *
 *     const requiredKeys = override?.requiredConsumes ?? block.consumes;
 *
 * `requiredConsumes` does not ADD to what the block declares — it REPLACES it.
 * So a contract that lists nine of a block's ten inputs silently drops the
 * tenth, and the manifest no longer declares it at all.
 *
 * That matters twice over. The pipeline compiler stops requiring a producer for
 * the dropped key, and the runtime store Proxy — which throws on a read of an
 * undeclared key — starts refusing the block's own read of it. The first failure
 * is silent and the second is loud, but neither happens until that pipeline runs.
 *
 * A first version of this audit compared the two lists directly and reported 67
 * of 84 blocks. That was the audit being wrong, not the code: most contracts
 * simply do not override, so `block.consumes` stands and there is nothing to
 * disagree with. The question worth asking is narrower and only applies where an
 * override actually exists.
 *
 * WHAT IS NOT REPORTED. A key the override moves from required to OPTIONAL is
 * still declared, so the Proxy allows the read; that is a deliberate loosening,
 * usually because the input is a run seed with no producing block. Those are
 * listed separately.
 */
import { registerAllBlocks } from "@/engine/blocks";
import { allManifests, get as getBlock } from "@/engine/registry";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";


interface Finding { block: string; key: string }

function main(): void {
  registerAllBlocks();
  const manifests = new Map(allManifests().map((m) => [m.id, m]));

  const dropped: Finding[] = [];
  const loosened: Finding[] = [];
  let overriding = 0;

  for (const [blockId, contract] of Object.entries(MODULE_CONTRACTS)) {
    if (!manifests.has(blockId)) continue;
    const override = contract.requiredConsumes;
    if (!override) continue; // no override: block.consumes stands, nothing to drop
    overriding++;

    const block = getBlock(blockId);
    if (!block) continue;
    const required = new Set(override);
    const optional = new Set(contract.optionalConsumes ?? []);

    for (const key of block.consumes) {
      if (required.has(key)) continue;
      (optional.has(key) ? loosened : dropped).push({ block: blockId, key });
    }
  }

  dropped.sort((a, b) => a.block.localeCompare(b.block) || a.key.localeCompare(b.key));
  console.log(`contracts that override requiredConsumes: ${overriding}`);
  console.log(`inputs the block declares but its override drops entirely: ${dropped.length}\n`);
  for (const f of dropped) console.log(`  ${f.block}.${f.key}`);
  if (!dropped.length) console.log("  none");

  if (loosened.length) {
    console.log(`\nmoved from required to optional (still declared, so the Proxy allows the read): ${loosened.length}`);
    for (const f of loosened) console.log(`  ${f.block}.${f.key}`);
  }

  console.log(
    `\nA dropped key stops the compiler requiring a producer AND makes the runtime store\n` +
      `Proxy refuse the block's own read of it — neither of which shows up until that\n` +
      `pipeline runs.`,
  );
  console.log(`AUDIT_FINDINGS ${dropped.length}`);
}

main();
