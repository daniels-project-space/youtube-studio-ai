/**
 * UNBOUNDED-NORMALIZED AUDIT — numbers whose NAME promises a range their schema
 * does not enforce.
 *
 * `z.number()` says "this is a number". It does not say "this is a fraction of
 * the frame", and for a value that is only meaningful in 0..1 the difference is
 * a silent defect rather than a type error.
 *
 * Found by hand on the whiteboard storyboard, whose layer box is
 * `z.array(z.number().finite()).min(4).max(4)`. Four finite numbers — nothing
 * bounded them to the board, so [1.5, 0.2, 0.8, 0.6] validated cleanly, drew
 * entirely outside the frame, and the panel lost that layer AFTER an attested
 * image worker had rendered it. The helper that should have caught it was called
 * clampBox and did not clamp.
 *
 * WHAT IT LOOKS FOR
 *
 * A zod number field whose property name declares a normalized quantity — a
 * score, a ratio, a confidence, a fraction, an opacity, a box or a normalized
 * coordinate — and which carries no .min() and no .max(). The name is the
 * evidence: `score: z.number()` is a claim about a range that the schema then
 * declines to check.
 *
 * WHAT IT DELIBERATELY IGNORES
 *
 *   durations, counts, timestamps, prices, sizes in pixels — genuinely unbounded
 *   or bounded by something other than 0..1;
 *   fields with any .min/.max/.int/.positive/.nonnegative refinement, since the
 *   author has then thought about the range;
 *   fields inside a .refine() chain, which may enforce the bound as a whole.
 *
 * A finding is a question: is this value meaningful outside the range its name
 * implies? Where it is not, the bound belongs in the schema, because every
 * consumer downstream is entitled to assume it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);

/** Property names that assert a normalized range. */
const NORMALIZED = /^(.*_)?(score|ratio|confidence|fraction|frac|opacity|alpha|weight|probability|prob|pct|percent|norm|[xy]Norm|box|bbox|uv)$/i;

/** Names that merely CONTAIN a normalized word but are not one. */
const NOT_NORMALIZED = /(count|sec|seconds|ms|px|pixels|usd|cost|width|height|index|id|version|total|sum|bytes)$/i;

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
 * The element type inside `z.array( ... )`, by matching parentheses.
 *
 * A lazy regex stops at the first `)`, which for `z.array(z.number().finite()
 * .min(0).max(1))` captures `z.number(` and then reports a CORRECTLY bounded
 * schema as unbounded — selfContainedStoryReceipt's box, which is the model of
 * how this should be written.
 */
function arrayElement(declaration: string): string | null {
  const start = declaration.indexOf("z.array(");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + "z.array".length; i < declaration.length; i++) {
    const character = declaration[i];
    if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth === 0) return declaration.slice(start + "z.array(".length, i);
    }
  }
  return null;
}

interface Finding { file: string; line: number; field: string; declaration: string }

function main(): void {
  const findings: Finding[] = [];
  let inspected = 0;

  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("z.number(")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name) {
        const field = node.name.getText(sf).replace(/^["']|["']$/g, "");
        const declaration = node.initializer.getText(sf).replace(/\s+/g, " ");
        // Only zod number declarations, including arrays of them.
        if (/\bz\.number\(/.test(declaration) && declaration.length < 240) {
          const normalized = NORMALIZED.test(field) && !NOT_NORMALIZED.test(field);
          if (normalized) {
            inspected++;
            // Any range thinking at all exempts it — but on the RIGHT thing.
            //
            // The first version tested the whole declaration, so
            // `box: z.array(z.number().finite()).min(4).max(4)` looked bounded.
            // Those bounds are on the array LENGTH; the values inside are still
            // unbounded, which is exactly the whiteboard defect this audit was
            // written for. It could not see its own founding case. For an array,
            // inspect the element type instead.
            const subject = arrayElement(declaration) ?? declaration;
            const bounded = /\.(min|max|int|positive|nonnegative|nonpositive|negative|step|multipleOf)\s*\(/.test(subject);
            if (!bounded) {
              findings.push({
                file: relative(ROOT, file),
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                field,
                declaration: declaration.slice(0, 96),
              });
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  console.log(`zod number fields whose NAME asserts a normalized range: ${inspected}`);
  console.log(`declared without any bound: ${findings.length}\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}\n        ${f.field}: ${f.declaration}`);
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\nThe two score findings are CORRECT as they stand, and adding the bound would\n` +
      `make them worse. Both clamp at the use site — Math.max(0, Math.min(1, v.score))\n` +
      `— so an out-of-range verdict is pulled into range. A schema bound would instead\n` +
      `FAIL the parse, and both callers treat a failed critic as unavailable, so a model\n` +
      `returning 1.2 would block the work rather than score it 1. A clamp and a bound\n` +
      `are not interchangeable: one repairs, the other refuses.\n` +
      `\nz.number() says "this is a number". For a value only meaningful in 0..1 that\n` +
      `is not validation, it is a type check standing where a bound should be — and the\n` +
      `whiteboard layer box proved the cost: four finite numbers, no bound, a layer\n` +
      `drawn off-frame and lost after it had already been paid for.`,
  );
}

main();
