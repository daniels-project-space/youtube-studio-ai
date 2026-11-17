import { readFileSync, statSync } from "node:fs";

const keyPath = "/etc/youtube-studio-workshop/trigger-production.key";
const stat = statSync(keyPath);
if (process.getuid?.() !== 0 || stat.uid !== 0 || (stat.mode & 0o077)) throw new Error("Workshop Trigger credential is not private");
process.env.TRIGGER_SECRET_KEY = readFileSync(keyPath, "utf8").trim();
process.env.TRIGGER_API_URL = "http://127.0.0.1:39400";
const { tasks, runs } = await import("@trigger.dev/sdk");
const run = await tasks.trigger("workshop-runtime-readiness", {});
console.log("Started read-only Studio worker check", run.id);
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  const result = await runs.retrieve(run.id);
  if (result.status === "COMPLETED") {
    const output = result.output;
    if (output?.ok !== true || output.localDatabase !== true || output.scopedStorage !== true || output.renderProjectBound !== true || output.modelRestrictions !== true || output.providerJobsStarted !== 0) throw new Error("Unexpected worker readiness evidence");
    console.log("Studio worker verified its database, scoped storage and render project; no model job started");
    process.exit(0);
  }
  if (["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(result.status)) {
    throw new Error(`Studio worker check ended ${result.status}; inspect the retained run`);
  }
  await new Promise(resolve => setTimeout(resolve, 1500));
}
throw new Error("Studio worker check is still pending; inspect its retained run before retrying");
