/**
 * TOKEN-CEILING AUDIT — find JSON-contract calls whose ceiling cannot hold the
 * shape they ask for.
 *
 * Every pinned route here is a reasoning model: the output budget covers the
 * thinking AND the answer, so a ceiling sized for the answer alone fails the
 * JSON contract entirely and the call throws. Four confirmed instances so far,
 * each of which silently deleted a feature:
 *
 *   metacraft pinnedComment  300 -> 0/3 succeeded. Every video ever made
 *                            shipped with an empty pinned comment.
 *   capabilityAdvisor        500 -> 0/2. The advisor never once advised.
 *   formatAdvisor            700 -> 1/2. Format choice was a coin flip.
 *   topicraft judge         1500 -> 1/3. The topic quality gate was skipped on
 *                            two slates in three.
 *
 * WHAT DECIDES THE FLOOR IS THE SHAPE, NOT A CONSTANT. Measured on the shipping
 * routes:
 *
 *   single field   agentJson answered "2+2" inside 100 tokens. Low is fine.
 *   3-5 fields     ~1200 was needed once reasoning was included.
 *   a list         agentJson failed a 5-item list at 500 and passed at 1000;
 *                  claudeJson failed an 8-item ranking at 1500, passed at 2500.
 *
 * So this audit does not apply a blanket minimum — an earlier version of it did,
 * using a regex over the 40 preceding lines to guess "list-shaped", and it
 * mis-attributed several sites (it called `{"closing_line":string}` a list).
 * Instead it reads the contract the prompt actually declares — the
 * `Return STRICT JSON {...}` literal, or the zod schema passed to agentJson —
 * and sizes the requirement from that.
 *
 * geminiJson is excluded on purpose: it targets gemini-2.5-flash directly and
 * parses loosely, which is a different failure profile that has not been
 * measured here. Reporting it would be guessing.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".locks", "remotion", "__tests__"]);
const REASONING_HELPERS = /(claudeJsonPro|claudeJson|agentJson)\s*[<(]/;

/** Measured requirements by declared output shape. */
const FLOOR_SINGLE_FIELD = 0;      // 100 sufficed for a one-number answer
const FLOOR_MULTI_FIELD = 1200;    // measured on the advisor prompts
const FLOOR_LIST = 2000;           // 5-item list needed 1000; an 8-item ranking needed 2500

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

type Shape = "single_field" | "multi_field" | "list" | "unknown";

/**
 * The shape a call asks for, read from its own declared contract rather than
 * inferred from nearby words.
 */
function declaredShape(callText: string, fileText: string): { shape: Shape; detail: string } {
  // agentJson declares a zod schema; an array anywhere in it means a list.
  const schema = /schema:\s*([\s\S]{0,400}?)(?:,\n\s*(?:prompt|log|role|system|maxTokens|temperature):)/.exec(callText);
  if (schema) {
    let body = schema[1];
    // A schema passed BY REFERENCE — `schema: cutSchema` — was invisible to the
    // first version of this audit: it inspected the two captured words, found no
    // z.array, fell through to the literal-JSON check, found none, and reported
    // the call as "unknown" shape, which is never flagged. Every call in
    // engine/creative/crew.ts is written that way, so five agentJson calls on
    // modules serving 8-13 channels were silently exempt and the audit claimed
    // zero findings. Resolve the identifier to its declaration first.
    const ref = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(body);
    if (ref) {
      const decl = new RegExp(`const ${ref[1]}\\s*=\\s*([\\s\\S]{0,1200}?)\\n\\n`).exec(fileText)
        ?? new RegExp(`const ${ref[1]}\\s*=\\s*([\\s\\S]{0,1200}?)\\n(?=const |function |export )`).exec(fileText);
      if (decl) body = decl[1];
      else return { shape: "unknown", detail: `schema ${ref[1]} not resolvable in this file` };
    }
    if (/z\.array\(/.test(body)) return { shape: "list", detail: `zod array${ref ? ` (via ${ref[1]})` : ""}` };
    const fields = (body.match(/\w+:\s*z\./g) ?? []).length;
    if (fields >= 2) return { shape: "multi_field", detail: `zod, ${fields} fields${ref ? ` (via ${ref[1]})` : ""}` };
    if (fields === 1) return { shape: "single_field", detail: `zod, 1 field${ref ? ` (via ${ref[1]})` : ""}` };
  }
  // Everything else states the contract literally in the prompt.
  const literal = /STRICT JSON\s*(\{[\s\S]{0,400}?\})\s*[.`"]/.exec(callText);
  if (literal) {
    const body = literal[1];
    if (/\[/.test(body)) return { shape: "list", detail: body.replace(/\s+/g, " ").slice(0, 70) };
    const fields = (body.match(/"[\w_]+"\s*:/g) ?? []).length;
    if (fields >= 2) return { shape: "multi_field", detail: `${fields} fields` };
    if (fields === 1) return { shape: "single_field", detail: body.replace(/\s+/g, " ").slice(0, 50) };
  }
  return { shape: "unknown", detail: "no declared contract found" };
}

const floorFor = (shape: Shape): number =>
  shape === "list" ? FLOOR_LIST : shape === "multi_field" ? FLOOR_MULTI_FIELD : FLOOR_SINGLE_FIELD;

interface Finding { file: string; line: number; helper: string; ceiling: number; shape: Shape; detail: string; floor: number }

function main(): void {
  const findings: Finding[] = [];
  let inspected = 0;

  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (!REASONING_HELPERS.test(text)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /maxTokens:\s*([0-9_]+)/.exec(lines[i]);
      if (!m) continue;
      // Walk back to the helper that owns this argument object.
      let helper = "";
      let start = i;
      for (let j = i; j >= Math.max(0, i - 60); j--) {
        const c = /(claudeJsonPro|claudeJson|agentJson|geminiJsonPro|geminiJson|openRouterJson)\s*[<(]/.exec(lines[j]);
        if (c) { helper = c[1]; start = j; break; }
      }
      if (!/^(claudeJsonPro|claudeJson|agentJson)$/.test(helper)) continue;
      inspected++;
      const ceiling = Number(m[1].replace(/_/g, ""));
      // The contract can sit either side of maxTokens inside the same call.
      const callText = lines.slice(start, Math.min(lines.length, i + 25)).join("\n");
      const { shape, detail } = declaredShape(callText, text);
      const floor = floorFor(shape);
      if (ceiling >= floor) continue;
      findings.push({ file: relative(ROOT, file), line: i + 1, helper, ceiling, shape, detail, floor });
    }
  }

  findings.sort((a, b) => a.ceiling - b.ceiling);
  console.log(`reasoning-route JSON calls inspected: ${inspected}`);
  console.log(`below the floor their declared shape needs: ${findings.length}\n`);
  for (const f of findings) {
    console.log(
      `  ${String(f.ceiling).padStart(4)} < ${String(f.floor).padEnd(4)}  ${f.shape.padEnd(12)} ` +
      `${f.helper.padEnd(14)} ${f.file}:${f.line}\n` +
      `        contract: ${f.detail}`,
    );
  }
  if (!findings.length) console.log("  none");
  console.log(
    `\nFloors are measured, not assumed: a single field cleared 100 tokens, a 5-item list\n` +
    `failed at 500 and passed at 1000, an 8-item ranking failed at 1500 and passed at 2500.\n` +
    `"unknown" shapes are never reported — guessing is what made the first version wrong.`,
  );
}

main();
