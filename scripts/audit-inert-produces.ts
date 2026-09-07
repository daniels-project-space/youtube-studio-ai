/**
 * INERT-PRODUCES AUDIT — work whose result nothing reads.
 *
 * The mirror of audit-inert-consumes. That one finds a block declaring an input
 * it never reads, which costs an ordering constraint. This finds a block
 * PRODUCING a value no other block consumes, which can cost a provider call per
 * video for an artifact that goes nowhere.
 *
 * Found by hand on `notify`, whose `notified` is read by nothing — which is what
 * made it obviously right to degrade rather than fail the run when Telegram was
 * down. The same question is worth asking of all 84 blocks.
 *
 * BEING UNREAD IS NOT AUTOMATICALLY WASTE. Three legitimate reasons, all seen:
 *
 *   the value is for a HUMAN. compliance_check's disclosureRequired and
 *   complianceNote are advisory — "set in Studio" — and are meant to be read in
 *   the run log by an operator, not branched on by code.
 *   the value is EVIDENCE. Receipts and fingerprints exist to be persisted and
 *   audited later, not consumed by a downstream block.
 *   the value is a TERMINAL artifact. videoKey, watchUrl and their kin are the
 *   pipeline's output; nothing downstream consumes them because there is no
 *   downstream.
 *
 * So the output is a list of questions. The one worth acting on is a block that
 * spends real money to produce something nobody reads — and the honest test for
 * that is the `paid` flag, which is why it is reported.
 *
 * TWO IN THE CURRENT LIST ARE REAL, and both need an owner's decision because
 * consuming them means acting on a published video:
 *
 *   metadata.pinnedComment   generated per video, posted nowhere. There IS a
 *                            postComment() and pipelineDoctor uses it — with a
 *                            comment the DOCTOR writes itself. So metacraft's
 *                            pinned comment has never reached a video. This is
 *                            the same string whose 300-token ceiling was an
 *                            earlier finding ("every video shipped with an empty
 *                            pinned comment"); raising the ceiling made it
 *                            non-empty, and nothing consumes it either way.
 *   captions.captionsKey     the SRT is built from ground-truth timings, written
 *                            to R2 and recorded as an asset — and there is no
 *                            youtube/v3/captions call anywhere, so it is never
 *                            attached as a caption track. Burned-in captions are
 *                            a SEPARATE path and do work (timeline_assemble's
 *                            captionsApplied), so viewers see captions; what is
 *                            missing is the selectable track and its SEO and
 *                            accessibility value.
 *
 * The rest are receipts, fingerprints, terminal artifacts, gate outcomes
 * enforced by throwing, and values advisory to a human. Those are correct.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

import { registerAllBlocks } from "@/engine/blocks";
import { allManifests } from "@/engine/registry";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every store key READ anywhere in the repo, by AST, plus keys named in a
 * string literal.
 *
 * NOT by bare mention. The first version also counted any string literal or
 * property access of the same name, reasoning that a mention is enough doubt to
 * stay quiet. That made it incapable of finding anything: `produces: ["key"]` is
 * ITSELF a string literal, so every produced key was "mentioned" by its own
 * declaration, and a synthetic key that nothing anywhere read went undetected.
 * It reported 0 of 286 and the zero meant nothing.
 *
 * This is the same self-match mistake audit-inert-consumes made with its own
 * `consumes` array. Twice is a pattern: when an audit reads the source that
 * declares the thing it is auditing, the declaration has to be removed from what
 * it scans.
 */
function readKeys(files: readonly string[]): { read: Set<string> } {
  const read = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteral(node.argumentExpression)
      ) {
        read.add(node.argumentExpression.text);
      }
      if (
        ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        ["str", "opt", "num", "bool"].includes(node.expression.text) &&
        node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[1])
      ) {
        read.add(node.arguments[1].text);
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return { read };
}

interface Finding { block: string; key: string; paid: boolean }

function main(): void {
  registerAllBlocks();
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "convex"))];
  const { read } = readKeys(files);

  // What every block DECLARES it needs. A key consumed by any block is read by
  // definition, whatever the body does with it.
  const declaredConsumes = new Set<string>();
  for (const manifest of allManifests()) {
    for (const key of Object.keys(manifest.consumes ?? {})) declaredConsumes.add(key);
    for (const key of Object.keys(manifest.optionalConsumes ?? {})) declaredConsumes.add(key);
  }

  const findings: Finding[] = [];
  let produced = 0;
  for (const manifest of allManifests()) {
    const paid = Boolean(manifest.costAndLatency?.paid);
    for (const key of [
      ...Object.keys(manifest.produces ?? {}),
      ...Object.keys(manifest.optionalProduces ?? {}),
    ]) {
      produced++;
      if (declaredConsumes.has(key) || read.has(key)) continue;
      findings.push({ block: manifest.id, key, paid });
    }
  }

  findings.sort((a, b) => Number(b.paid) - Number(a.paid) || a.block.localeCompare(b.block));
  console.log(`declared produced keys: ${produced}`);
  console.log(`consumed by nothing and read nowhere: ${findings.length}\n`);
  for (const f of findings) {
    console.log(`  ${f.paid ? "PAID " : "     "} ${f.block}.${f.key}`);
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\nUnread is not automatically waste: a value can be advisory for a human, a\n` +
      `receipt kept for audit, or a terminal artifact with nothing downstream. The line\n` +
      `worth acting on is a PAID block spending real money on something nobody reads.`,
  );
  // Machine-readable, so scripts/run-audits.mjs never parses prose.
  console.log(`AUDIT_FINDINGS ${findings.length}`);
}

main();
