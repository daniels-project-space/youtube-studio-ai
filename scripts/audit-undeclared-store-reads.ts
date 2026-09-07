/**
 * UNDECLARED-STORE-READ AUDIT — a block reading a key it never declared.
 *
 * The exact inverse of audit-inert-consumes, and the more dangerous direction.
 * That one finds a declaration with no read, which costs an ordering constraint.
 * This finds a READ WITH NO DECLARATION, and the store is a Proxy that throws on
 * a read of a key the block's manifest does not list. So the cost is not a
 * wasted constraint — it is the block failing, mid-pipeline, the first time a
 * branch that touches that key is taken.
 *
 * Which is why a static check earns its keep here. The runtime enforcement is
 * real but only fires on the path actually executed: a key read inside a rarely
 * taken branch can sit undeclared indefinitely and then throw on the run that
 * finally takes it. A branch is exactly where an undeclared read hides, because
 * the common path is the one anybody tested.
 *
 * A block's declaration is `manifest.consumes ∪ manifest.optionalConsumes`,
 * AFTER the MODULE_CONTRACTS override is applied — which matters, because most
 * blocks declare `consumes: []` in the block file and carry their real inputs as
 * optionalConsumes in the contract. Reading only the block file would report
 * nearly every block.
 *
 * The scoping is imported from audit-inert-consumes rather than re-derived: it
 * drops each block's own declaration arrays before scanning, follows same-file
 * helpers four levels deep, and resolves keys written as string constants. Those
 * corrections were earned once and the two audits must agree about what a block
 * reads, or one of them is lying.
 *
 * KNOWN LIMIT, stated so a clean run is not over-read: a key read through an
 * indirection deeper than four levels, or in another module that receives the
 * whole store, is invisible here. That is the safe direction — a missed finding
 * costs what the runtime already catches, an invented one costs trust.
 *
 * WHAT THE FIRST RUN FOUND: 74 undeclared reads, and six blocks confirmed BROKEN
 * by executing them against the real Proxy — director_brief, dp_brief,
 * editor_brief, composer_brief, critic_spec (all failing on "showBible") and
 * metadata (on "channelProgramRoute"). Commit 2a5397d had replaced Convex
 * channel fetches with store reads without declaring them. The crew briefs are
 * in eleven of twelve families.
 *
 * THE BASELINE IS 2, AND BOTH ARE FALSE POSITIVES THAT MUST STAY:
 *
 *   novita_render_images.visualMatterReferenceAssets
 *   novita_render_video.visualMatterReferenceAssets
 *
 * The read is real and lives in requireVisualMatter, a helper those blocks do
 * call — but behind `options.attachExternalReferenceAssets`, which only the QA
 * blocks set. This audit follows helpers; it cannot tell that a branch is
 * unreachable for one caller. Declaring the key would satisfy this audit and
 * BREAK visualMatterReferenceAssets.test, which asserts the opposite on purpose:
 * "reference R2 pixels must not be declared as primary keyframe-generator
 * input". A bulk fix did exactly that and the test caught it. Leave them.
 */
import { registerAllBlocks } from "@/engine/blocks";
import { allManifests } from "@/engine/registry";
import { blockScopes } from "./audit-inert-consumes";

/**
 * Keys the runner places in the store for every block, so reading one is never
 * an undeclared read. COST_PATCH_KEY is written, not read, but appears in the
 * same position and is cheaper to exclude than to special-case.
 */
const AMBIENT = new Set<string>([
  "__cost", // COST_PATCH_KEY
]);

interface Finding { block: string; file: string; line: number; key: string; paid: boolean }

function main(): void {
  registerAllBlocks();
  const scopes = blockScopes();
  const findings: Finding[] = [];
  let blocksChecked = 0;
  let readsChecked = 0;
  const noScope: string[] = [];

  for (const manifest of allManifests()) {
    const scope = scopes.get(manifest.id);
    if (!scope) { noScope.push(manifest.id); continue; }
    blocksChecked++;

    const declared = new Set<string>([
      ...Object.keys(manifest.consumes ?? {}),
      ...Object.keys(manifest.optionalConsumes ?? {}),
      // A block may read back what it produces within its own run.
      ...Object.keys(manifest.produces ?? {}),
      ...Object.keys(manifest.optionalProduces ?? {}),
    ]);

    for (const key of scope.reads) {
      readsChecked++;
      if (declared.has(key) || AMBIENT.has(key)) continue;
      findings.push({
        block: manifest.id,
        file: scope.file,
        line: scope.line,
        key,
        paid: Boolean(manifest.costAndLatency?.paid),
      });
    }
  }

  findings.sort((a, b) => Number(b.paid) - Number(a.paid) || a.block.localeCompare(b.block) || a.key.localeCompare(b.key));
  console.log(`blocks scanned: ${blocksChecked}   store reads examined: ${readsChecked}`);
  console.log(`reads of a key the block never declared: ${findings.length}\n`);
  for (const f of findings) {
    console.log(`  ${f.paid ? "PAID " : "     "} ${f.block} reads ${f.key}  (${f.file}:${f.line})`);
  }
  if (!findings.length) console.log("  none");
  if (noScope.length) {
    console.log(`\nno scope found for ${noScope.length} block(s), so they were not checked: ${noScope.join(", ")}`);
  }
  console.log(
    `\nThe store Proxy throws on an undeclared read, so each of these is a block that\n` +
      `fails the first time the branch containing that read is taken. Declare the key in\n` +
      `the block or its MODULE_CONTRACTS entry — as optionalConsumes when the block\n` +
      `already handles the key being absent.`,
  );
  console.log(`AUDIT_FINDINGS ${findings.length}`);
}

main();
