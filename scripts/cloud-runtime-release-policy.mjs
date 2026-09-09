import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A serialized deployment can still arrive out of commit order. */
export function cloudReleaseDecision({ expectedSha, checkedOutSha, mainRef, changedPaths }) {
  const validSha = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
  if (!validSha(expectedSha) || !validSha(checkedOutSha) || expectedSha !== checkedOutSha) {
    throw new Error("Cloud release held: the checked-out revision does not match the trusted workflow revision.");
  }
  const match = /^([0-9a-f]{40})\s+refs\/heads\/main\s*$/.exec(mainRef);
  if (!match) throw new Error("Cloud release held: the current main revision could not be verified.");
  // Keep this aligned with push.paths-ignore in ci.yml. A docs-only push does
  // not enqueue a replacement release, so verified equal runtime source may
  // still deploy. Missing diff evidence must never grant this exception.
  const onlyIgnoredChanges = Array.isArray(changedPaths) && changedPaths.every(path =>
    typeof path === "string" && path.length > 0 &&
    (path.endsWith(".md") || path.startsWith("docs/") || path.startsWith(".serena/")));
  const current = expectedSha === match[1];
  return { deploy: current || onlyIgnoredChanges, revision: expectedSha, currentMain: match[1],
    reason: current ? "current-main" : onlyIgnoredChanges ? "only-ci-ignored-files-changed" : "superseded-before-cloud-writes" };
}

export function checkCloudRelease({ cwd = process.cwd(), env = process.env } = {}) {
  // No shell interpolation, provider calls, deployment or cancellation here.
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
  const input = { expectedSha: env.GITHUB_SHA, checkedOutSha: git(["rev-parse", "HEAD"]).trim(),
    mainRef: git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).trim() };
  let decision = cloudReleaseDecision(input);
  if (!decision.deploy) {
    // Fetch the observed immutable object, not a moving branch. Do not move
    // HEAD or the worktree. Endpoint diff works with shallow CI checkouts.
    git(["fetch", "--no-tags", "--depth=1", "origin", decision.currentMain]);
    const diff = git(["diff", "--no-renames", "--name-only", "-z", decision.revision, decision.currentMain, "--"]);
    decision = cloudReleaseDecision({ ...input, changedPaths: diff.split("\0").filter(Boolean) });
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `deploy=${decision.deploy}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    decision.deploy
      ? `Cloud release revision verified: \`${decision.revision}\` (${decision.reason}; observed main \`${decision.currentMain}\`). Both runtime steps may proceed.\n`
      : `Cloud deployment **skipped, not completed**: \`${decision.revision}\` was superseded by main \`${decision.currentMain}\` before any cloud writes. No running deployment was cancelled.\n`);
  return decision;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(checkCloudRelease())); }
  catch {
    // A remote error may contain credential-bearing URLs. Emit no git stderr.
    console.error("Cloud release held: unable to verify the trusted checkout against current main. No deployment is authorized.");
    process.exitCode = 1;
  }
}
