/**
 * cost-reservation-breakdown — per-BLOCK cost reservation audit.
 *
 *   ./node_modules/.bin/tsx scripts/cost-reservation-breakdown.ts [family...]
 *
 * The cross-family compile survey reports one number per family
 * (`compilation.reservedMaxCostUsd`). That number is a SUM over paid modules,
 * so an outlier tells you nothing about WHICH module is expensive. This harness
 * re-derives the identical sum term by term — for every paid module it prints
 * the absolute contract ceiling (`maxCostUsd`), the configured envelope that
 * actually gets reserved (`maxCostUsdFor(params)`), and the delta between them.
 *
 * DRY RUN in the strict sense: it calls designPipeline()/compilePipeline() with
 * real catalog data and executes NO block. No Convex read/write, no provider
 * call, no ffmpeg, no Remotion, no spend.
 */
import { designPipeline } from "@/engine/designer";
import { FAMILIES, type FamilyKey } from "@/engine/families";
import { configuredMaxCostUsd } from "@/engine/moduleManifest";
import { validatePipeline } from "@/engine/validate";

const DEFAULT_FAMILIES: FamilyKey[] = ["cinematic", "documentary_collage_short"];
const LENGTHS = [1, 3, 5, 10, 20];

function usd(n: number): string {
  return `$${n.toFixed(3)}`;
}

function auditFamily(family: FamilyKey, lengthMinutes: number, verbose: boolean): number {
  const meta = FAMILIES[family];
  const design = designPipeline({
    family,
    nicheKey: "history",
    lengthMinutes,
    publishMode: "draft",
    toggles: { shorts: false, crosspost: false },
  });

  const resolved = validatePipeline(design.pipeline);
  const compiled = design.compilation;

  if (verbose) {
    console.log(`\n${"=".repeat(96)}`);
    console.log(`FAMILY  ${family}  (${meta.label})`);
    console.log(`length ${lengthMinutes}min | blocks ${design.pipeline.length} | available ${design.available}`);
    console.log(`family defaultRunBudgetUsd: ${meta.defaultRunBudgetUsd ?? "(none declared)"}`);
    console.log("=".repeat(96));
    console.log(
      `${"#".padStart(3)}  ${"module".padEnd(28)} ${"paid".padEnd(5)} ` +
        `${"absolute".padStart(10)} ${"reserved".padStart(10)}  params`,
    );
  }

  let total = 0;
  const contributions: Array<{ id: string; reserved: number; absolute: number }> = [];

  for (let i = 0; i < resolved.manifests.length; i++) {
    const manifest = resolved.manifests[i];
    const entry = resolved.entries[i];
    const params = entry.params ?? {};
    const paid = manifest.costAndLatency.paid;
    const absolute = manifest.costAndLatency.maxCostUsd;
    const reserved = paid
      ? configuredMaxCostUsd(manifest, params, { entries: resolved.entries, index: i })
      : 0;
    total += reserved;
    if (paid) contributions.push({ id: manifest.id, reserved, absolute: absolute ?? NaN });

    if (verbose && (paid || reserved > 0)) {
      const paramKeys = Object.keys(params);
      const shown = paramKeys
        .filter((k) => /count|shots?|beats?|frames?|scene|image|video|clip|upscale|qa|tier|watch|audio|duration|len/i.test(k))
        .map((k) => `${k}=${JSON.stringify(params[k])}`)
        .join(" ");
      console.log(
        `${String(i).padStart(3)}  ${manifest.id.padEnd(28)} ${(paid ? "PAID" : "-").padEnd(5)} ` +
          `${usd(absolute ?? 0).padStart(10)} ${usd(reserved).padStart(10)}  ${shown}`,
      );
    }
  }

  if (verbose) {
    console.log("-".repeat(96));
    contributions.sort((a, b) => b.reserved - a.reserved);
    console.log("TOP CONTRIBUTORS (descending):");
    for (const c of contributions) {
      const pct = total > 0 ? (c.reserved / total) * 100 : 0;
      const headroom = Number.isFinite(c.absolute) ? c.absolute - c.reserved : NaN;
      console.log(
        `   ${c.id.padEnd(28)} reserved ${usd(c.reserved).padStart(10)}  ` +
          `${pct.toFixed(1).padStart(5)}%  absolute ${usd(c.absolute).padStart(10)}  ` +
          `headroom ${Number.isFinite(headroom) ? usd(headroom) : "n/a"}`,
      );
    }
    console.log("-".repeat(96));
    console.log(`SUM (this harness)          ${usd(total)}`);
    console.log(`compilation.reservedMaxCostUsd ${compiled ? usd(compiled.reservedMaxCostUsd) : "(no compilation)"}`);
    if (compiled && Math.abs(compiled.reservedMaxCostUsd - total) > 1e-6) {
      console.log(`!! MISMATCH: harness sum and compiler rollup disagree`);
    }
  }

  return total;
}

function main(): void {
  const argv = process.argv.slice(2);
  const families = (argv.length ? argv : DEFAULT_FAMILIES) as FamilyKey[];

  for (const family of families) {
    if (!FAMILIES[family]) throw new Error(`unknown family ${family}`);
    auditFamily(family, 3, true);
  }

  // Length scaling: does the reservation actually track video length, or is it
  // a flat ceiling that never shrinks for a short video?
  console.log(`\n${"=".repeat(96)}`);
  console.log("LENGTH SCALING (reserved cost vs lengthMinutes)");
  console.log("=".repeat(96));
  console.log(`${"family".padEnd(30)}${LENGTHS.map((l) => `${l}min`.padStart(12)).join("")}`);
  for (const family of families) {
    const row = LENGTHS.map((l) => {
      try {
        return usd(auditFamily(family, l, false)).padStart(12);
      } catch (error) {
        return "ERR".padStart(12);
      }
    }).join("");
    console.log(`${family.padEnd(30)}${row}`);
  }
}

main();
