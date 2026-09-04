/**
 * MODULE HEALTH — one screen that says which modules actually need work.
 *
 * Reading twenty-odd modules end to end to find out which ones are weak is the
 * slow way to answer a question the repository can answer itself. Three
 * properties predicted almost every real defect found so far, and all three are
 * mechanically checkable:
 *
 *   WIRED     do this module's files get imported by anything outside itself?
 *             The qwen3 narration provider had a contract, receipts, validators
 *             and gates, and no engine — the whole path was unreachable.
 *   ORACLE    is there a test that exercises it? Not proof of quality, but its
 *             absence is proof that nothing can catch a regression.
 *   DRIFT     does it contain per-channel values collapsing onto one constant?
 *             This is the defect class that made every thumbnail amber and
 *             every undeclared drawn channel render in the same hand.
 *
 * None of these three is sufficient on its own, and the report says so rather
 * than pretending to a verdict: a module can be wired, tested and free of
 * convergence and still produce poor output. What this rules out is the
 * opposite — spending a day reading a module that was already fine, which is
 * exactly what happened with the lofi loop.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { GENERATED_LOCKABLE_MODULES } from "@/lib/goldenModuleFiles.generated";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion"]);
const TEST = /\.test\.tsx?$|__tests__/;
/**
 * Invoked by a framework rather than imported: a Trigger task is reached by its
 * registered id, a Next route by its path. Counting importers for these reports
 * working production code as unreachable — which this audit did on its first
 * run for the channel planner, a live weekly task.
 */
const FRAMEWORK_ENTRY = /^src\/trigger\/|^convex\/|(^|\/)(page|layout|route|middleware)\.tsx?$/;
const IDENTITY = /(accent|palette|colou?r|motif|font|zone|layout|background|style|grammar|tone|voice|persona|niche|brand|dna|family|template|theme|mood|texture|treatment|framing|register|hero|badge)/i;
const BENIGN = /^(|0|1|-1|true|false|none|auto|default|en|utf-8|n\/a|general|UTC|16:9|application\/json)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function main(): void {
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "convex"))]
    .map((f) => relative(ROOT, f));
  const contents = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));
  const prod = files.filter((f) => !TEST.test(f));
  const tests = files.filter((f) => TEST.test(f));

  interface Row {
    id: string; label: string; files: number; loc: number;
    importers: number; tests: number; drift: number; frameworkInvoked: boolean;
  }
  const rows: Row[] = [];

  for (const module of GENERATED_LOCKABLE_MODULES) {
    if (!module.paths.length) continue;
    const own = new Set(module.paths);
    let loc = 0;
    let drift = 0;
    for (const path of module.paths) {
      const text = contents.get(path);
      if (!text) continue;
      loc += text.split("\n").length;
      // Same rule as audit-convergence, kept narrow on purpose.
      for (const match of text.matchAll(/([\w.?\[\]"'()]+)\s*(\?\?|\|\|)\s*"([^"]{2,})"/g)) {
        if (IDENTITY.test(match[1]) && !BENIGN.test(match[3])) drift += 1;
      }
    }

    // A module file referenced from a file that is not one of its own.
    //
    // Both the alias form and the bare module name are matched. Tests import
    // siblings relatively — `../editorialEvidencePacketBlocks` — so matching
    // only the "@/..." alias reported thoroughly tested blocks as having no
    // oracle, which is exactly the kind of false alarm that sends the next hour
    // to a module that was already covered.
    const stems = module.paths.flatMap((p) => [
      p.replace(/^src\//, "@/").replace(/\.tsx?$/, ""),
      (p.split("/").pop() ?? "").replace(/\.tsx?$/, ""),
    ]).filter((stem) => stem.length > 3);
    const importers = new Set<string>();
    const testers = new Set<string>();
    for (const [file, text] of contents) {
      if (own.has(file)) continue;
      if (!stems.some((stem) => text.includes(stem))) continue;
      (TEST.test(file) ? testers : importers).add(file);
    }
    const frameworkInvoked = module.paths.some((path) => FRAMEWORK_ENTRY.test(path));
    rows.push({
      id: module.id, label: module.label, files: module.paths.length, loc,
      importers: importers.size, tests: testers.size, drift, frameworkInvoked,
    });
  }

  rows.sort((a, b) => (a.tests - b.tests) || (b.drift - a.drift) || (a.importers - b.importers));

  const head = `${"module".padEnd(34)}${"files".padStart(6)}${"loc".padStart(7)}${"users".padStart(7)}${"tests".padStart(7)}${"drift".padStart(7)}  flags`;
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) {
    const flags = [
      r.tests === 0 ? "NO-ORACLE" : "",
      r.importers === 0 && !r.frameworkInvoked ? "UNREACHABLE" : "",
      r.importers === 0 && r.frameworkInvoked ? "framework-entry" : "",
      r.drift > 0 ? `drift:${r.drift}` : "",
    ].filter(Boolean).join(" ");
    console.log(
      `${r.id.padEnd(34)}${String(r.files).padStart(6)}${String(r.loc).padStart(7)}` +
      `${String(r.importers).padStart(7)}${String(r.tests).padStart(7)}${String(r.drift).padStart(7)}  ${flags}`,
    );
  }
  const noOracle = rows.filter((r) => r.tests === 0);
  console.log(`\n${rows.length} modules with files · ${noOracle.length} with no test of any kind`);
  console.log(`prod files ${prod.length} · test files ${tests.length}`);
}

main();
