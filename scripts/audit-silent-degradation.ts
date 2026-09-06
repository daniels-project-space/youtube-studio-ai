/**
 * SILENT-DEGRADATION AUDIT — find features that can vanish without saying so.
 *
 * Distinct from audit-fail-open-gates.ts, which looks for a GATE that passes
 * when it cannot run. This looks for a GENERATOR that produces nothing when it
 * cannot run, which is the more common shape and has accounted for most of what
 * this sweep has found:
 *
 *   metacraft pinnedComment  `.catch(() => "")` — every video ever made shipped
 *                            without a pinned comment.
 *   crew director/dp/editor/  each caught, logged the raw provider error, and
 *   composer/critic           returned undefined — five briefs could be absent
 *                             and the run looked identical to one that had them.
 *   entity_imagery            extraction failing left nothing to look up, so the
 *                             video got no entity imagery at all, logged the
 *                             same as a script that names nobody.
 *   competitor_research       three reads with a bare .catch(() => null), so an
 *                             outage looked like an unresearched niche.
 *
 * The pattern is always the same: a paid or fallible call inside a try, and a
 * catch that yields an EMPTY value while saying nothing about what is now
 * missing. Degrading is usually correct — a missing portrait must not fail a
 * render. What must never happen is that the degraded run is indistinguishable
 * from a healthy one.
 *
 * A finding is therefore only raised when BOTH hold:
 *   1. the try contains a fallible call (a model, a provider, or a network read);
 *   2. the catch yields empty AND its log does not name the loss.
 *
 * "Names the loss" is deliberately generous — any of UNAVAILABLE / DID NOT RUN /
 * FAILED / NO <THING> / "gets no" / "was never" counts. The bar is that a human
 * reading the run log can tell something is missing, not that the wording
 * matches a template.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);

/** Calls that can fail for reasons outside this process. */
const FALLIBLE = /(claudeJsonPro|claudeJson|agentJson|geminiJsonPro|geminiJson|openRouterJson|openRouterChat|visionLocal|visionUrls|\.query\(|\.mutation\(|fetch\(|synth[A-Z]\w*\()/;

/** A catch that hands back nothing. */
const YIELDS_EMPTY = /return\s+(undefined|null|""|''|``|\[\]|\{\})\s*;|=>\s*(undefined|null|""|''|``|\[\])\s*[,)]|=\s*(\[\]|null|undefined|"")\s*;/;

/**
 * An EMPTY catch — `catch { }` or `catch (e) { /* fallback below *\/ }`.
 *
 * This is the purest form of the shape this audit exists to find, and it was
 * invisible: the regex above looks for a catch that RETURNS an empty value, and
 * an empty catch returns nothing at all because the variable it was going to
 * fill was already initialised empty above the try.
 *
 * Found by hand in scriptGen, where `catch { /* fallback below *\/ }` swallowed
 * every failure of THE QUOTE of the episode. That call was also running below
 * its measured token floor, so it failed every single time, and the only trace
 * was a closing line that silently never existed.
 */
const isEmptyCatch = (body: string): boolean => /^\s*\{\s*\}\s*$/.test(body);

/**
 * Accessors whose null return IS their contract.
 *
 * fetchRemoteImage, searchWikimediaImage, getVideoPrivacy and friends are
 * helpers that answer "is this available?", and the honest answer is null. The
 * CALLER is the right place to report a loss, and does: entity_imagery logs
 * `no Wikimedia image for "X"` for exactly the null this audit would otherwise
 * flag inside the helper. Reporting both is how a list stops being read.
 *
 * Checked before exempting them, not assumed: all eight accessors flagged by the
 * first run had a caller that names the loss, and storyboardCritic — which is
 * NOT an accessor — turned out to fail closed downstream, since loreShortBlocks
 * rejects the whole outcome when `critique.accepted !== true`.
 */
const ACCESSOR = /^(fetch|search|get|read|load|probe|try|resolve|lookup|find)[A-Z_]/;

/** Wording that tells a reader something is now missing. */
const NAMES_THE_LOSS =
  /(UNAVAILABLE|DID NOT RUN|FAILED|failed|NOT quality-gated|NO [A-Z]{2,}|gets no |was never|gone|gets none|gave up|gives up|falling back|keeping the)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Finding { file: string; line: number; context: string; detail: string }

function main(): void {
  const findings: Finding[] = [];
  let considered = 0;

  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("catch")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(ROOT, file);

    const visit = (node: ts.Node, enclosing: string): void => {
      let name = enclosing;
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) name = node.name.getText(sf);
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) name = node.name.getText(sf);
      else if (ts.isPropertyAssignment(node) && node.name.getText(sf) === "id" && ts.isStringLiteral(node.initializer)) {
        name = node.initializer.text;
      }

      if (ts.isCatchClause(node) && ts.isTryStatement(node.parent)) {
        const tried = node.parent.tryBlock.getText(sf);
        if (FALLIBLE.test(tried)) {
          considered++;
          // Comments stripped: an audit that matches the note explaining its own
          // fix is an audit nobody trusts. This one learned that from the
          // fail-open audit, which flagged exactly that.
          const body = node.block.getText(sf)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1");
          const rethrows = /\bthrow\b/.test(body);
          const swallows = YIELDS_EMPTY.test(body) || isEmptyCatch(body);
          if (!rethrows && !ACCESSOR.test(name) && swallows && !NAMES_THE_LOSS.test(body)) {
            const logs = Array.from(body.matchAll(/["'`]([^"'`]{6,200})["'`]/g)).map((m) => m[1]);
            findings.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              context: name || "?",
              detail: logs.length
                ? `log: "${logs[0].slice(0, 80)}"`
                : isEmptyCatch(body) ? "EMPTY CATCH — swallows the failure entirely" : "NO LOG AT ALL",
            });
          }
        }
      }
      node.forEachChild((child) => visit(child, name));
    };
    visit(sf, "");
  }

  findings.sort((a, b) => Number(b.detail.startsWith("NO LOG")) - Number(a.detail.startsWith("NO LOG")));
  console.log(`catches wrapping a fallible call: ${considered}`);
  console.log(`yielding empty without naming the loss: ${findings.length}\n`);
  for (const f of findings) console.log(`  ${f.file}:${f.line}  [${f.context}]\n        ${f.detail}`);
  if (!findings.length) console.log("  none");
  console.log(
    `\nAll five remaining findings were investigated and are correct, recorded here so\n` +
    `the next reader does not repeat it:\n` +
    `  metacraft youtubeSuggest   an accessor in all but name — its caller logs the query\n` +
    `                             count, so an empty autocomplete IS visible one level up.\n` +
    `  storyboardCritic           returns null, and loreShortBlocks then rejects the whole\n` +
    `                             outcome (critique.accepted !== true), so it FAILS CLOSED\n` +
    `                             rather than accepting an uncritiqued storyboard.\n` +
    `  learn adaptShowBible       the swallowed write is a FOLLOW-UP marker; the\n` +
    `                             provider_started fence already prevents replay, so the\n` +
    `                             safety does not depend on this catch succeeding.\n` +
    `  planWeekAhead              same shape: the exact spend is persisted below regardless,\n` +
    `                             and Trigger makes one recovery-only attempt.\n` +
    `  pipelineDoctor sweep       advisory trend mining. It cannot affect a verdict, only\n` +
    `                             the defect-trend counters an operator reads.\n` +
    `\nThree others found by this audit's empty-catch rule WERE real and are fixed:\n` +
    `footagecraft (generic b-roll instead of narration-matched queries), architect\n` +
    `(designing on 0 competitors, indistinguishable from a niche that has none), and\n` +
    `geminiVision — which skipped every unreachable image and would have asked the\n` +
    `model to judge none, and which was removed outright as a zero-caller leftover.`,
  );
  console.log(
    `\nDegrading is usually right — a missing portrait must not fail a render. What must\n` +
    `never happen is that the degraded run reads exactly like a healthy one. Each line is\n` +
    `a question: is this feature's absence visible to whoever reads the run log?`,
  );
}

main();
