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
assert.deepEqual(parsed.jobs.typecheck.concurrency, {
  group: "ci-typecheck-${{ github.event.pull_request.number || github.ref }}",
  "cancel-in-progress": true,
}, "stale readiness suites must be cancelled without cancelling cloud deploys");
assert.deepEqual(job.concurrency,{group:"youtube-studio-cloud-runtimes",queue:"max","cancel-in-progress":false});
const guardIndex = job.steps.findIndex(step=>step.id === "release_policy");
assert.ok(guardIndex > 0);
const admissionIndex = job.steps.findIndex(step=>step.id === "release_admission");
assert.equal(admissionIndex, 1, "reject stale releases directly after checkout, before setup or install");
assert.equal(job.steps[admissionIndex].run, "node scripts/cloud-runtime-release-policy.mjs");
const planIndex = job.steps.findIndex(step => step.id === "publication_plan");
assert.equal(planIndex, admissionIndex + 1, "plan against native state and receipts before installing tooling");
assert.equal(job.steps[planIndex].run, "node scripts/cloud-runtime-publications.mjs plan");
assert.equal(job.steps[planIndex].if, "steps.release_admission.outputs.deploy == 'true'");
assert.deepEqual(job.steps.slice(planIndex + 1, guardIndex + 1).map(step => step.if), [
  "steps.release_admission.outputs.deploy == 'true' && steps.publication_plan.outputs.any == 'true'",
  "steps.release_admission.outputs.deploy == 'true' && steps.publication_plan.outputs.any == 'true'",
  "steps.release_admission.outputs.deploy == 'true' && steps.publication_plan.outputs.any == 'true'",
], "setup, install and final main guard run only for a required runtime publication");
assert.equal(job.steps[guardIndex-1].name,"Install deploy tooling");
assert.equal(job.needs, "typecheck", "the full quality gate precedes runtime planning and writes");
assert.equal(job.environment, "Production");
assert.equal(job.permissions.deployments, "write");
assert.equal(job.steps[0].with["fetch-depth"], 0, "independent baselines need actual Git history");
assert.match(job.if, /github\.event_name == 'push'/);
assert.match(job.if, /github\.event_name == 'workflow_dispatch'/);
assert.match(job.if, /refs\/heads\/main/);
for (const layer of ["backend", "trigger"]) {
  const attemptIndex = job.steps.findIndex(step => step.id === `${layer}_attempt`);
  const deployIndex = job.steps.findIndex(step => step.id === `${layer}_deploy`);
  const certifyIndex = job.steps.findIndex(step => step.name === `Certify native ${layer} publication`);
  assert.ok(attemptIndex > guardIndex && deployIndex > attemptIndex && certifyIndex > deployIndex);
  assert.equal(job.steps[attemptIndex].if, `steps.release_policy.outputs.deploy == 'true' && steps.publication_plan.outputs.${layer} == 'true'`);
  assert.equal(job.steps[attemptIndex].run, "node scripts/cloud-runtime-publications.mjs start");
  assert.equal(job.steps[attemptIndex].env.PUBLICATION_EXPECTED_NATIVE, `\${{ steps.publication_plan.outputs.${layer}_native }}`);
  assert.equal(job.steps[deployIndex].if, `steps.release_policy.outputs.deploy == 'true' && steps.${layer}_attempt.outputs.deployment != ''`);
  assert.equal(job.steps[certifyIndex].if, `steps.${layer}_deploy.outcome == 'success' && steps.${layer}_attempt.outputs.deployment != ''`);
  assert.equal(job.steps[certifyIndex].run, "node scripts/cloud-runtime-publications.mjs complete");
  assert.equal(job.steps[certifyIndex].env.PUBLICATION_DEPLOYMENT_ID, `\${{ steps.${layer}_attempt.outputs.deployment }}`);
}
const deployment = workflow.slice(workflow.indexOf("  deploy-cloud-runtimes:"));
assert.match(deployment,/group: youtube-studio-cloud-runtimes[\s\S]*?queue: max\s+cancel-in-progress: false/,
  "a late stale job must not cancel the latest pending revision");
assert.match(deployment,/id: release_policy[\s\S]*run: node scripts\/cloud-runtime-release-policy\.mjs/);
assert.ok(deployment.indexOf("id: release_policy") > deployment.indexOf("npm ci"), "check directly before cloud writes, after tooling install");
assert.match(deployment,/convex dev --once --typecheck=disable/);
assert.match(deployment,/--skip-sync-env-vars/);
assert.match(workflow,/needs: typecheck/);
console.log("Cloud release policy passed: real Git transport, stale/current retries, invalid/missing evidence, output redaction and both real CI callers");
