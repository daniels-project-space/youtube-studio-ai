import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const manifestFile = "deployment-inputs.json";
const layers = ["website", "backend", "trigger"];
const conservative = reason => ({ website: true, backend: true, trigger: true, reason });
const metadata = file => /^(?:docs|graphify-out|\.serena|\.agents|\.codex|coverage|\.github)\//.test(file) ||
  /(?:^|\/)(?:README|AGENTS)\.md$/.test(file) || /(?:^|\/)__tests__\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

export function classifyChanges(changed, before, after) {
  const manifests = [before, after];
  if (manifests.some(m => m?.version !== 1 || m.project !== "youtube-studio-ai" || !Array.isArray(m.globals) ||
    layers.some(layer => !Array.isArray(m[layer]?.files) || !Array.isArray(m[layer]?.uncertain) || m[layer].uncertain.length))) {
    return conservative("missing-or-uncertain-dependency-evidence");
  }
  const result = { website: false, backend: false, trigger: false, reason: "verified-layer-inputs" };
  for (const file of changed) {
    if (file === manifestFile) continue; // Its witnesses are validated separately.
    if (manifests.some(m => m.globals.includes(file))) return conservative("shared-build-configuration");
    let known = false;
    for (const layer of layers) {
      if (manifests.some(m => m[layer].files.includes(file))) { result[layer] = true; known = true; }
    }
    // Actual consumers take precedence over metadata/test exclusions.
    if (known || metadata(file)) continue;
    if (file.startsWith("src/trigger/")) { result.trigger = true; continue; }
    if (file.startsWith("convex/")) { result.backend = true; continue; }
    if (file.startsWith("src/app/") || file.startsWith("public/")) { result.website = true; continue; }
    return conservative("unclassified-input");
  }
  return result;
}

export function impactSince(base, { cwd = process.cwd(), head = "HEAD", force = false, redeploy = false } = {}) {
  if (force) return conservative("explicit-force-build");
  if (!/^[a-f0-9]{40}$/.test(base ?? "")) return conservative("missing-history");
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 20_000, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  try {
    // Promotions/redeployments may reuse the preview's own SHA as the
    // previous revision even while production serves different code. A
    // same-revision request may also carry changed environment settings.
    if (redeploy && git(["rev-parse", head]).trim() === base) return conservative("same-revision-redeployment");
    git(["merge-base", "--is-ancestor", base, head]);
    const read = revision => {
      const m = JSON.parse(git(["show", `${revision}:${manifestFile}`]));
      if (!m.blobs || m.generator !== "scripts/deployment-inputs.mjs") throw Error("Missing witnesses");
      const tree = new Map(git(["ls-tree", "-r", "-z", revision]).split("\0").filter(Boolean).map(row => {
        const [entry, file] = row.split("\t"); return [file, entry.split(" ")[2]];
      }));
      const required = new Set([...m.globals, ...layers.flatMap(layer => m[layer].files), m.generator, "scripts/deployment-impact.mjs", "vercel-ignore-build.sh"]);
      for (const file of required) {
        if (!m.blobs[file] || tree.get(file) !== m.blobs[file]) throw Error("Stale dependency witness");
      }
      return m;
    };
    const before = read(base), after = read(head);
    const changed = git(["diff", "--no-renames", "--name-only", "-z", base, head, "--"]).split("\0").filter(Boolean);
    return { ...classifyChanges(changed, before, after), changedFiles: changed.length };
  } catch { return conservative("unavailable-or-stale-dependency-evidence"); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv.find(arg => arg.startsWith("--base="))?.slice(7) ?? process.env.VERCEL_GIT_PREVIOUS_SHA;
  const result = impactSince(base, { force: process.env.VERCEL_FORCE_BUILD === "1", redeploy: process.argv.includes("--vercel-ignore") });
  console.log(JSON.stringify(result));
  if (process.argv.includes("--vercel-ignore")) process.exitCode = result.website ? 1 : 0;
}
