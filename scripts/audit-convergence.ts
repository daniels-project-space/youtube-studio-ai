/**
 * CONVERGENCE AUDIT — the single-constant fallback.
 *
 * The most productive defect class found during the thumbnail rebuild, and the
 * hardest to see in review, because each instance reads as a sensible safety
 * net:
 *
 *     accentColor ?? "#ffd400"      -> every channel that omits an accent is amber
 *     textZone    ?? "left"         -> no unset headline ever moves
 *     motif       ?? "movie_poster" -> every unregistered channel gets a metal plaque
 *
 * One line, one constant, and every channel that does not set that field
 * becomes identical to every other channel that does not set it. An audit of
 * eleven renders found seven in the amber band before this was fixed. That is
 * how a "capable" module produces a monoculture.
 *
 * The rule this checks: a per-channel value must not fall back to a POINT. It
 * may fall back to a RANGE resolved by stable identity (see
 * src/lib/thumbnailDefaults.ts `spreadDefault`), which keeps renders
 * reproducible while letting unset fields spread across the available options.
 *
 * Scoped deliberately. Not every `?? "x"` is a bug — `?? ""`, `?? 0`, a unit, a
 * MIME type or an API version are all fine. Only values that vary BY CHANNEL
 * are flagged, because those are the ones whose collapse is visible in output.
 * An audit that reports everything gets ignored, which is worse than no audit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion"]);
const TEST_FILE = /\.test\.tsx?$|__tests__/;

/** Identity-bearing words: a value described by one of these varies by channel. */
const IDENTITY = /(accent|palette|colou?r|motif|font|typeface|zone|layout|background|style|grammar|tone|voice|persona|niche|brand|dna|family|template|theme|mood|texture|treatment|composition|framing|energy|register|hero|badge|caption|aspect)/i;

/** Constants that are not creative choices, so collapsing them is not a defect. */
const BENIGN = /^(|0|1|-1|true|false|none|auto|default|en|utf-8|application\/json|image\/(png|jpeg|webp)|v1|v1beta|GET|POST|PUT)$/i;

interface Finding {
  file: string;
  line: number;
  expr: string;
  literal: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function main(): void {
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "convex"))];
  const findings: Finding[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    if (TEST_FILE.test(rel)) continue;
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        const isFallback =
          op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken;
        if (isFallback && ts.isStringLiteral(node.right)) {
          const literal = node.right.text;
          const left = node.left.getText(sf);
          if (!BENIGN.test(literal) && literal.length > 1 && IDENTITY.test(left)) {
            findings.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              expr: `${left} ${op === ts.SyntaxKind.QuestionQuestionToken ? "??" : "||"} "${literal}"`,
              literal,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }

  // A constant used as the sole fallback in several places is the strongest
  // signal: it is a house style being applied wherever nothing was specified.
  const byLiteral = new Map<string, Finding[]>();
  for (const f of findings) {
    byLiteral.set(f.literal, [...(byLiteral.get(f.literal) ?? []), f]);
  }
  const ranked = [...byLiteral.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log("=== PER-CHANNEL VALUES THAT FALL BACK TO A SINGLE CONSTANT ===");
  console.log("   every channel that omits the field becomes identical\n");
  for (const [literal, group] of ranked) {
    console.log(`  "${literal}"  ×${group.length}`);
    for (const f of group.slice(0, 6)) {
      console.log(`      ${f.file}:${f.line}  ${f.expr.slice(0, 96)}`);
    }
  }
  console.log(`\n  ${findings.length} fallbacks across ${byLiteral.size} distinct constants`);
  console.log("  fix: resolve across a range by stable identity (spreadDefault), not onto a point");
}

main();
