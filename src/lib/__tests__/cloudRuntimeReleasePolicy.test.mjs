import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { cloudReleaseDecision, checkCloudRelease } from "../../../scripts/cloud-runtime-release-policy.mjs";

const old = "a".repeat(40), current = "b".repeat(40);
assert.deepEqual(cloudReleaseDecision({ expectedSha: current, checkedOutSha: current,
  mainRef: `${current}\trefs/heads/main\n` }), {
  deploy: true, revision: current, currentMain: current, reason: "current-main",
});
assert.equal(cloudReleaseDecision({ expectedSha: old, checkedOutSha: old,
  mainRef: `${current}\trefs/heads/main` }).deploy, false, "late old job must not roll back main");
for (const changedPaths of [[], ["README.md"], ["docs/runtime.json", ".serena/memory.json", "src/notes.md"]]) {
  assert.equal(cloudReleaseDecision({expectedSha: old, checkedOutSha: old,
    mainRef: `${current}\trefs/heads/main`, changedPaths}).deploy, true,
  "a verified CI-ignored-only change must not strand the last tested code release");
}
for (const changedPaths of [["trigger.config.ts"], ["README.md", "public/fonts/font.woff2"], ["docs-lookalike/a.ts"], ["a.md.ts"], [""], [null], "README.md"]) {
  assert.equal(cloudReleaseDecision({expectedSha: old, checkedOutSha: old,
    mainRef: `${current}\trefs/heads/main`, changedPaths}).deploy, false);
}
for (const expectedSha of [undefined, "", "main", `${current}\ndeploy=true`, "$(env)"]) {
  assert.throws(() => cloudReleaseDecision({ expectedSha, checkedOutSha: current, mainRef: `${current}\trefs/heads/main` }));
}
assert.throws(() => cloudReleaseDecision({expectedSha: current, checkedOutSha: old, mainRef:`${current}\trefs/heads/main`}), /checked-out/);
for (const mainRef of ["", `${current}\trefs/heads/other`, `${current}\trefs/heads/main\n${old}\trefs/heads/main`, "denied"]) {
  assert.throws(() => cloudReleaseDecision({expectedSha: current, checkedOutSha: current, mainRef}), /could not be verified/);
}

// Real Git transport + real CLI, using only disposable local repositories.
const root = mkdtempSync(join(tmpdir(), "ysa-cloud-policy-"));
const remote = join(root,"remote.git"), checkout = join(root,"checkout");
mkdirSync(checkout);
const git = (cwd,args,input) => execFileSync("git",args,{cwd,input,encoding:"utf8",stdio:["pipe","pipe","pipe"],
  env:{...process.env,GIT_AUTHOR_NAME:"Policy fixture",GIT_AUTHOR_EMAIL:"fixture@example.invalid",GIT_COMMITTER_NAME:"Policy fixture",GIT_COMMITTER_EMAIL:"fixture@example.invalid"}}).trim();
git(root,["init","--bare",remote]); git(checkout,["init"]);
git(checkout,["remote","add","origin",remote]);
const tree = git(checkout,["mktree"],"");
const blob = git(checkout,["hash-object","-w","--stdin"],"export const version = 2;\n");
const runtimeTree = git(checkout,["mktree"],`100644 blob ${blob}\truntime.ts\n`);
const first = git(checkout,["commit-tree",tree,"-m","first"]);
const second = git(checkout,["commit-tree",runtimeTree,"-p",first,"-m","second"]);
git(checkout,["update-ref","HEAD",first]); git(checkout,["push","origin",`${first}:refs/heads/main`]);
let result = checkCloudRelease({cwd:checkout,env:{GITHUB_SHA:first}});
assert.equal(result.deploy,true);
git(checkout,["push","origin",`${second}:refs/heads/main`]);
const out = join(root,"step-output"), summary = join(root,"step-summary");
const command = resolve("scripts/cloud-runtime-release-policy.mjs");
let cli = spawnSync(process.execPath,[command],{cwd:checkout,encoding:"utf8",
  env:{...process.env,GITHUB_SHA:first,GITHUB_OUTPUT:out,GITHUB_STEP_SUMMARY:summary}});
assert.equal(cli.status,0,cli.stderr);
assert.equal(JSON.parse(cli.stdout).deploy,false);
assert.equal(readFileSync(out,"utf8"),"deploy=false\n");
assert.match(readFileSync(summary,"utf8"),/skipped, not completed/);
assert.equal(git(checkout,["rev-parse","HEAD"]),first, "policy must not move the checkout");
assert.equal(git(remote,["rev-parse","refs/heads/main"]),second, "policy must not mutate main");
git(checkout,["update-ref","HEAD",second]);
assert.equal(checkCloudRelease({cwd:checkout,env:{GITHUB_SHA:second}}).deploy,true, "current retry remains deployable");
const docsTree = git(checkout,["mktree"],`100644 blob ${blob}\tREADME.md\n100644 blob ${blob}\truntime.ts\n`);
const docsCommit = git(checkout,["commit-tree",docsTree,"-p",second,"-m","docs only"]);
git(checkout,["push","origin",`${docsCommit}:refs/heads/main`]);
result = checkCloudRelease({cwd:checkout,env:{GITHUB_SHA:second}});
assert.equal(result.deploy,true);
assert.equal(result.reason,"only-ci-ignored-files-changed");
assert.equal(git(checkout,["rev-parse","HEAD"]),second);
assert.equal(checkCloudRelease({cwd:checkout,env:{GITHUB_SHA:second}}).deploy,true,"docs-only retry is idempotent");
git(checkout,["remote","set-url","origin",join(root,"missing-SECRET-credential-url")]);
cli = spawnSync(process.execPath,[command],{cwd:checkout,encoding:"utf8",env:{...process.env,GITHUB_SHA:second,GITHUB_OUTPUT:out,GITHUB_STEP_SUMMARY:summary}});
assert.equal(cli.status,1,"unverifiable remote cannot authorize a deploy");
assert.doesNotMatch(cli.stdout+cli.stderr,/SECRET|deploy=true/);
assert.equal(readFileSync(out,"utf8"),"deploy=false\n", "a failed observation never appends approval");

// Check the real workflow wiring, not just a policy with no callers.
const workflow = readFileSync(resolve(".github/workflows/ci.yml"),"utf8");
// Use the already-installed lint dependency; no new production dependency.
const require = createRequire(import.meta.url);
const yaml = require(require.resolve("js-yaml", {paths:[require.resolve("eslint")]}));
const parsed = yaml.load(workflow);
assert.deepEqual(parsed.on.push["paths-ignore"],["**.md","docs/**",".serena/**"],
  "the ignored-source exception must track the actual workflow trigger");
const job = parsed.jobs["deploy-cloud-runtimes"];
assert.deepEqual(job.concurrency,{group:"youtube-studio-cloud-runtimes",queue:"max","cancel-in-progress":false});
const guardIndex = job.steps.findIndex(step=>step.id === "release_policy");
assert.ok(guardIndex > 0);
assert.equal(job.steps[guardIndex-1].name,"Install deploy tooling");
assert.deepEqual(job.steps.slice(guardIndex+1).map(step=>step.if),[
  "steps.release_policy.outputs.deploy == 'true'", "steps.release_policy.outputs.deploy == 'true'",
]);
const deployment = workflow.slice(workflow.indexOf("  deploy-cloud-runtimes:"));
assert.match(deployment,/group: youtube-studio-cloud-runtimes[\s\S]*?queue: max\s+cancel-in-progress: false/,
  "a late stale job must not cancel the latest pending revision");
assert.match(deployment,/id: release_policy[\s\S]*run: node scripts\/cloud-runtime-release-policy\.mjs/);
assert.ok(deployment.indexOf("id: release_policy") > deployment.indexOf("npm ci"), "check directly before cloud writes, after tooling install");
for (const name of ["Deploy canonical Convex runtime","Deploy Trigger production tasks"]) {
  assert.match(deployment,new RegExp(`name: ${name}\\n\\s+if: steps\\.release_policy\\.outputs\\.deploy == 'true'`));
}
assert.match(deployment,/convex dev --once --typecheck=disable/);
assert.match(deployment,/--skip-sync-env-vars/);
assert.match(workflow,/needs: typecheck/);
console.log("Cloud release policy passed: real Git transport, stale/current retries, invalid/missing evidence, output redaction and both real CI callers");
