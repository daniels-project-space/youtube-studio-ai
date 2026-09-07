/**
 * FAIL-OPEN AUDIT — find gates that pass when they cannot run.
 *
 * A gate has two ways to be useless. It can be too permissive, which shows up
 * in its output. Or it can be unable to run and treat that as a pass, which
 * shows up nowhere: the log says something benign, the pipeline continues, and
 * the check is simply missing from that video. Three confirmed instances, each
 * found by hand:
 *
 *   topicraft judge        `catch { gated = survivors }` admitted every bet as
 *                          if it had scored >= 7 on all four axes.
 *   spoken-line safety     a thrown scan logged "skipped (non-fatal)" and the
 *                          narration shipped unchecked — and the throw
 *                          correlated with there being a violation to find.
 *   compliance capability  the SAME check, twenty lines up: an
 *                          `if (!hasAnthropicKey()) return { sensitiveTopic:
 *                          false, ... }` guard returned the benign verdict in
 *                          silence, while the catch below it announced the
 *                          identical failure in full. This audit could not see
 *                          it, because it only inspected CATCH clauses — an
 *                          early-return capability guard is the same defect
 *                          wearing different syntax, and it now looks for both.
 *   sensitive classifier   both flags default false, so a failed call means the
 *                          manual-review gate cannot fire.
 *
 * This finds the shape mechanically so the fourth one does not need luck.
 *
 * IT REPORTS, IT DOES NOT PRESCRIBE. Failing open is often correct: a provider
 * outage must not block every publish, and a reasoned fallback that records why
 * it fell back (capabilityAdvisor, formatAdvisor) is good design, not a defect.
 * The distinction that matters is whether a consumer can TELL. So each finding
 * is classified by what the catch leaves behind:
 *
 *   SILENT      no log at all, or a log that reads as routine ("skipped",
 *               "continuing", "non-fatal"). This is the dangerous one.
 *   NAMED       the log says the check did not run. Fine.
 *   RETHROWS    not a fail-open at all; listed only when it is partial.
 *
 * Deliberately narrow about what counts. The first version reported any catch
 * in gate-like code and produced 160 findings out of 895 catches, most of them
 * correct code — a JWT parse returning null needs no log. A report that
 * overstates gets ignored, so this one requires the exact shape that was
 * actually measured failing: the catch must wrap a JSON-CONTRACT MODEL CALL.
 * That is the thing which fails intermittently on this fleet, and all three
 * confirmed cases have it. Missing a fail-open that has no model call in it is
 * the right direction to be wrong in.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);

/** Words that mark code whose job is to refuse something. */
const GATE_WORDS = /(gate|guard|check|scan|judge|verify|verif|validate|assert|compliance|qa|review|lint|audit|safety|policy|admit)/i;

/** The calls that actually fail intermittently on this fleet. */
const MODEL_CALL = /(claudeJsonPro|claudeJson|agentJson|geminiJsonPro|geminiJson|openRouterJson|openRouterChat|generateImage|visionJson)\s*[<(]/;

/** Log text that makes a missing check read as routine. */
/** A guard on whether a capability is available at all. */
const CAPABILITY_GUARD = /^!?\s*has[A-Z]\w*\s*\(|^!\s*\w*[Kk]ey\b|Enabled\s*\(\)/;

const ROUTINE = /(skipp?ed|continuing|non-?fatal|ignored|best-?effort|soft|fallback|unavailable|lint-only)/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  context: string;
  verdict: "SILENT" | "NAMED";
  detail: string;
}

function main(): void {
  const findings: Finding[] = [];
  let catches = 0;

  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("catch")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(ROOT, file);

    const visit = (node: ts.Node, enclosing: string): void => {
      let name = enclosing;
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name
      ) name = node.name.getText(sf);
      else if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) name = node.name.getText(sf);
      // Block ids (`id: "compliance_check"`) name the surrounding module.
      else if (
        ts.isPropertyAssignment(node) && node.name.getText(sf) === "id" && ts.isStringLiteral(node.initializer)
      ) name = node.initializer.text;

      // AN EARLY-RETURN GUARD is the same defect as a permissive catch, and this
      // audit could not see one. compliance_check opened with
      //   if (!hasAnthropicKey()) return { sensitiveTopic: false, ... };
      // — the identical failure the catch twenty lines below it announces in
      // full, silently. Same shape: the check cannot run, a benign verdict is
      // returned, nothing says so.
      if (
        ts.isIfStatement(node) &&
        node.thenStatement &&
        !node.elseStatement &&
        CAPABILITY_GUARD.test(node.expression.getText(sf))
      ) {
        const guardBody = node.thenStatement.getText(sf)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const returnsBenign = /return\s*\{[^}]*\b(false|""|\[\])/.test(guardBody);
        const guardLogs = Array.from(guardBody.matchAll(/["'`]([^"'`]{8,600})["'`]/g)).map((m) => m[1]);
        const guardNamed = guardLogs.some((l) =>
          /DID NOT RUN|FAILED|NOT quality-gated|never|errored|UNAVAILABLE|gets no |gets none/.test(l),
        );
        if (returnsBenign && !guardNamed && (GATE_WORDS.test(name) || GATE_WORDS.test(guardBody))) {
          findings.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            context: name,
            verdict: "SILENT",
            detail: `capability guard returns a benign verdict without naming it: ${node.expression.getText(sf).slice(0, 60)}`,
          });
        }
      }
      if (ts.isCatchClause(node)) {
        catches++;
        // Comments stripped first. Scanning raw text made the audit match its
        // own documentation: a catch whose comment EXPLAINS the old wording was
        // reported as still using it. An audit that flags the note describing
        // its own fix cannot be trusted about anything else.
        const body = node.block.getText(sf)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        // The try this catch belongs to — the model call lives in there, not
        // in the handler.
        const tryStatement = node.parent;
        const tried = ts.isTryStatement(tryStatement) ? tryStatement.tryBlock.getText(sf) : "";
        if (!MODEL_CALL.test(tried)) { node.forEachChild((child) => visit(child, name)); return; }
        const rethrows = /\bthrow\b/.test(body);
        const gateish = GATE_WORDS.test(name) || GATE_WORDS.test(body);
        // A catch that always rethrows is not a fail-open.
        const alwaysRethrows = rethrows && !/\breturn\b|=\s*/.test(body.replace(/throw[^;]*;/g, ""));
        if (gateish && !alwaysRethrows) {
          // 160 was too short: a template literal that names the failure in
          // full ran past the cap and the catch was reported as having "no log
          // at all" — the audit flagged code it had itself just been fixed to
          // approve of. Capture the whole literal and judge on its text.
          const logs = Array.from(body.matchAll(/["'`]([^"'`]{8,600})["'`]/g)).map((m) => m[1]);
          // A fail-open is fine when the fallback IDENTIFIES ITSELF — either the
          // log names what did not run, or the returned value carries a marker a
          // consumer can branch on. geoCinema returns verdict: "heuristic
          // fallback" and only passes when no hard flag is set; that is good
          // design, and an audit that calls it a defect trains people to ignore
          // the audit.
          // Vocabulary kept in step with audit-silent-degradation.ts. It drifted
          // once already: after crew/critic was changed to log "BRIEF
          // UNAVAILABLE — this video gets no review spec", this audit flagged it
          // as routine, because ROUTINE matched the lowercase word "unavailable"
          // while the loud list did not know the uppercase marker. An audit that
          // reports the fix it asked for is an audit that gets muted.
          const namedInLog = logs.some((l) =>
            /DID NOT RUN|FAILED|NOT quality-gated|never|errored|UNAVAILABLE|gets no |gets none/.test(l),
          );
          const markedInValue = /(judged:\s*false|ungated|unmeasured|not_measured|heuristic fallback|"fallback"|reasonCode)/i.test(body);
          // Returning a NON-EMPTY problem report is failing CLOSED, not open.
          // casefileCaseResearcher returns `["semantic verification failed: ..."]`
          // into an issues list, so a provider error becomes a verification
          // issue rather than a pass — the opposite of the defect this looks
          // for, and it was flagged because the audit could only see that a
          // value was returned, not what the value MEANT.
          const returnsProblemReport = /return\s*\[\s*[`"']?[^\]]*\b(failed|error|unsupported|invalid|missing)\b/i.test(body);
          const loud = namedInLog || markedInValue || returnsProblemReport;
          const routine = logs.some((l) => ROUTINE.test(l));
          const verdict: Finding["verdict"] = loud ? "NAMED" : "SILENT";
          if (verdict === "SILENT") {
            findings.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              context: name,
              verdict,
              detail: logs.length
                ? `${routine ? "routine-sounding log" : "log"}: "${logs[0].slice(0, 90)}"`
                : "no log at all",
            });
          }
        }
      }
      node.forEachChild((child) => visit(child, name));
    };
    visit(sf, "");
  }

  findings.sort((a, b) => (a.detail.startsWith("no log") === b.detail.startsWith("no log") ? 0 : a.detail.startsWith("no log") ? -1 : 1));
  console.log(`catch clauses inspected: ${catches}`);
  console.log(`in gate-like code, failing open without naming it: ${findings.length}\n`);
  for (const f of findings) {
    console.log(`  ${f.file}:${f.line}  [${f.context || "?"}]\n        ${f.detail}`);
  }
  console.log(
    `\nEach line is a QUESTION, not a defect. Failing open is often right — what must\n` +
    `be true is that a consumer can tell the check did not run. Read the catch and\n` +
    `decide; the three already fixed all looked exactly like these.`,
  );
  // Machine-readable, so scripts/run-audits.mjs never parses prose.
  console.log(`AUDIT_FINDINGS ${findings.length}`);
}

main();
