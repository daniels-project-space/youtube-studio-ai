/**
 * INERT-INPUT AUDIT — find fields a function's input type declares and its body
 * never reads.
 *
 * This generalises a real and expensive bug. `PlanStorySpineInput` declared
 * `intentSec` — the Director's per-beat pacing intent, produced by a paid model
 * call the run makes anyway — and storySpine.ts referenced it exactly once, in
 * the type. Beats were mapped onto sentences by count instead, and
 * scripts/story-spine-pacing-harness.ts measured the consequence on real
 * briefDirector output: a mean 30.6% of the timeline carried the wrong beat
 * purpose, worst case 46.2%, with the error largest where the Director's pacing
 * opinion was strongest.
 *
 * Nothing failed. The types checked, the tests passed, every gate was green,
 * and the field was simply inert. That is what makes this class worth a
 * mechanical detector rather than a reading pass: an inert input is invisible
 * to every other check in the repo, and one is indistinguishable from another
 * until someone measures the output.
 *
 * WHAT IS REPORTED, and what deliberately is not:
 *
 *   reported     a property declared on a type that is used as a function
 *                parameter, where neither `param.field`, `{ field }`
 *                destructuring, nor `"field"` appears anywhere in the file.
 *   NOT reported a file where the parameter is spread (`...input`), passed
 *                whole to another call, or indexed dynamically. The field may
 *                be read somewhere this cannot see, and a finding that might be
 *                wrong is how an audit stops being read — the same lesson the
 *                ceiling audit learned four times over.
 *   NOT reported types whose fields are all inert. That is a type nobody uses,
 *                which is the inertness audit's job, not this one.
 *   NOT reported shared RECORD types. The first run reported 28 findings and
 *                over half were this mistake: `score(entry: PerfEntry)` takes a
 *                persisted analytics row as its only parameter, so every field
 *                that function does not happen to score looked inert, while the
 *                fields are read all over the repo. A record type is recognised
 *                by being used somewhere as data rather than as a parameter —
 *                `PerfEntry[]`, `Promise<PerfEntry>`, `Record<string, PerfEntry>`,
 *                `as PerfEntry`. A purpose-built input like PlanStorySpineInput
 *                appears in a parameter position and nowhere else, which is
 *                exactly what makes "its only consumer ignores this field" mean
 *                something.
 *
 * Being unread is not automatically a bug. A field can be part of a published
 * shape, or read by a consumer of the same object elsewhere. The output is a
 * list of questions, and the question is always the same one: is this field
 * doing what whoever declared it believed it was doing?
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

/** Remove comments, so a field named only in prose never counts as read. */
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
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

interface Finding {
  file: string;
  line: number;
  typeName: string;
  field: string;
  usedBy: string;
  /** Other files that read this leaf name — the reader's discriminator. */
  elsewhere: string[];
}

/**
 * Every property in a type, INCLUDING nested object literals, as `path` (for
 * the report) and `leaf` (what code would actually read).
 *
 * The first version of this walked only top-level members, and so failed its
 * own ground truth: reverting the storySpine fix did not make it report
 * intentSec, because intentSec is not a member of PlanStorySpineInput. It lives
 * two levels down, in `structure.beats[].intentSec`. The bug that motivated the
 * audit was invisible to the audit — which is the whole reason to test a
 * detector against a known instance before believing a clean run.
 */
function collectFields(
  node: ts.TypeNode | ts.InterfaceDeclaration,
  sf: ts.SourceFile,
  prefix = "",
  depth = 0,
): Array<{ path: string; leaf: string; line: number }> {
  if (depth > 4) return [];
  const members = ts.isInterfaceDeclaration(node)
    ? node.members
    : ts.isTypeLiteralNode(node)
      ? node.members
      : undefined;
  if (!members) {
    // Array<{...}> / ReadonlyArray<{...}> / {...}[] — descend into the element.
    if (ts.isArrayTypeNode(node)) return collectFields(node.elementType, sf, prefix, depth + 1);
    if (ts.isTypeReferenceNode(node) && node.typeArguments?.length === 1) {
      return collectFields(node.typeArguments[0]!, sf, prefix, depth + 1);
    }
    return [];
  }
  const out: Array<{ path: string; leaf: string; line: number }> = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const leaf = member.name.getText(sf).replace(/^["']|["']$/g, "");
    const path = prefix ? `${prefix}.${leaf}` : leaf;
    out.push({ path, leaf, line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1 });
    if (member.type) out.push(...collectFields(member.type, sf, path, depth + 1));
  }
  return out;
}

/**
 * Every type name used as the type of a function/method parameter in this file,
 * mapped to the function that takes it. Only single-parameter object inputs are
 * considered: a field on a multi-parameter helper is far more likely to be a
 * shared shape whose other consumers this cannot see.
 */
function parameterTypes(sf: ts.SourceFile): Map<string, { fn: string; spread: boolean }> {
  const out = new Map<string, { fn: string; spread: boolean }>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parameters.length === 1 &&
      node.body
    ) {
      const param = node.parameters[0]!;
      const typeNode = param.type;
      if (typeNode && ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
        const name = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
          ? node.name?.getText(sf) ?? "?"
          : ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(sf) : "?";
        const body = node.body.getText(sf);
        const paramName = ts.isIdentifier(param.name) ? param.name.getText(sf) : null;
        // A spread or a wholesale hand-off means the fields may be read
        // somewhere this file cannot see. Record it so the type is skipped.
        // `...input` must be a spread of the PARAMETER, not of one of its
        // fields. Matching `\\.\\.\\.input\\b` also matched
        // `[...input.sentenceTimings]`, which silently excluded
        // PlanStorySpineInput — the one type this audit exists to catch. Require
        // a terminator so only a genuine wholesale spread counts.
        const spread = !paramName
          || new RegExp(`\\.\\.\\.${paramName}\\s*[,)}\\]]`).test(body)
          || new RegExp(`\\(\\s*${paramName}\\s*[,)]`).test(body)
          || new RegExp(`:\\s*${paramName}\\s*[,}]`).test(body)
          || new RegExp(`\\b${paramName}\\s*\\[`).test(body);
        const prior = out.get(typeNode.typeName.getText(sf));
        out.set(typeNode.typeName.getText(sf), {
          fn: prior?.fn ?? name,
          spread: (prior?.spread ?? false) || spread,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

/**
 * Is this type used anywhere in the repo as DATA rather than as a parameter?
 *
 * A record type flows through the codebase as arrays, promises, map values and
 * casts. A purpose-built input type only ever appears in a parameter position.
 * Anything in the first group is skipped, because "the one function that takes
 * it ignores field X" says nothing when twenty other places read X.
 */
function recordTypeNames(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  const patterns = [
    // Imported by another file. A purpose-built input type lives with its one
    // consumer; a type other modules import is shared, and its fields may be
    // read by any of them. PersistedChannelVoiceCast — a persisted document
    // shape whose only data use is a `satisfies` in a test file this audit
    // skips — leaked seven findings until this pattern existed.
    /\bimport\s+(?:type\s+)?\{[^}]*?\b([A-Z]\w+)\b[^}]*?\}\s+from/g,
    /\btype\s+([A-Z]\w+)\s+as\s+\w+/g,
    /\b([A-Z]\w+)\[\]/g,
    /\b(?:Array|ReadonlyArray|Promise|Set|Map|Record)<[^>]*?\b([A-Z]\w+)\b/g,
    /\bas\s+([A-Z]\w+)\b/g,
    /:\s*([A-Z]\w+)\s*=/g,
    /\bextends\s+([A-Z]\w+)\b/g,
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) names.add(match[1]!);
    }
  }
  return names;
}

/**
 * Other files that read `.leaf`.
 *
 * This audit is deliberately file-scoped — a repo-wide rule would have missed
 * intentSec, which IS read elsewhere (crew/director.ts) and was still inert
 * where it mattered. But file scope alone cannot tell PlanStorySpineInput
 * apart from FormatPreflight.fallbackFamily, whose doc says "never silently
 * selected" because an API route produces it and the channel-creation UI
 * displays it. So report the finding either way, and hand the reader the fact
 * that decides it.
 */
function readersOf(leaf: string, files: readonly string[], self: string): string[] {
  const pattern = new RegExp(`\\.${leaf}\\b`);
  const out: string[] = [];
  for (const file of files) {
    if (file === self) continue;
    if (pattern.test(strip(readFileSync(file, "utf8")))) out.push(relative(ROOT, file));
    if (out.length >= 4) break;
  }
  return out;
}

function main(): void {
  const findings: Finding[] = [];
  let typesInspected = 0;
  let fieldsInspected = 0;
  let skippedSpread = 0;
  let skippedRecord = 0;

  const files = walk(join(ROOT, "src"));
  const records = recordTypeNames(files);

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!/interface \w+|type \w+ =/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(ROOT, file);
    const params = parameterTypes(sf);
    if (!params.size) continue;

    // Comments stripped before the usage scan: a field named only in the
    // doc-comment that explains why it is unused would otherwise look used.
    const code = strip(text);

    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node)) {
        const typeName = node.name.getText(sf);
        const use = params.get(typeName);
        if (use) {
          if (use.spread) {
            skippedSpread++;
          } else if (records.has(typeName)) {
            skippedRecord++;
          } else {
            typesInspected++;
            const inert: Array<{ field: string; leaf: string; line: number }> = [];
            let total = 0;
            // Exclude the declaration itself so a field is never "used" by
            // being declared, nested ones included.
            //
            // This has to strip comments from the declaration the SAME way
            // `code` was stripped, or the replace silently matches nothing.
            // While it did, `field: type` in the declaration satisfied the
            // `\\bfield\\s*:` branch below and EVERY non-optional field counted
            // as read — the audit could only ever report optional ones.
            const body = code.replace(strip(node.getText(sf)), "");
            for (const member of collectFields(node, sf)) {
              total++;
              fieldsInspected++;
              const read = new RegExp(
                `(\\.${member.leaf}\\b|\\b${member.leaf}\\s*[,}:]|["'\`]${member.leaf}["'\`])`,
              ).test(body);
              if (!read) inert.push({ field: member.path, leaf: member.leaf, line: member.line });
            }
            // A type where NOTHING is read is an unused type, not an inert
            // field — a different finding, and the inertness audit's job.
            if (inert.length && inert.length < total) {
              for (const item of inert) {
                findings.push({
                  file: rel, line: item.line, typeName, field: item.field, usedBy: use.fn,
                  elsewhere: readersOf(item.leaf, files, file),
                });
              }
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  console.log(
    `single-parameter input types inspected: ${typesInspected}\n` +
      `  skipped, parameter spread or passed whole: ${skippedSpread}\n` +
      `  skipped, used elsewhere as a data record:  ${skippedRecord}`,
  );
  console.log(`fields inspected: ${fieldsInspected}`);
  console.log(`declared but never read: ${findings.length}\n`);
  for (const f of findings) {
    console.log(
      `  ${f.file}:${f.line}\n        ${f.typeName}.${f.field}  — taken by ${f.usedBy}(), read nowhere in the file\n` +
        `        ${f.elsewhere.length ? `read elsewhere: ${f.elsewhere.join(", ")}` : "read NOWHERE in src/ — fully inert"}`,
    );
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\nEach line is one question: is this field doing what whoever declared it\n` +
      `believed it was doing? PlanStorySpineInput.intentSec looked exactly like\n` +
      `these, type-checked cleanly, passed every gate, and cost a mean 30.6% of\n` +
      `the timeline carrying the wrong beat purpose.`,
  );
  // Machine-readable, so scripts/run-audits.mjs never parses prose.
  console.log(`AUDIT_FINDINGS ${findings.length}`);
}

main();
