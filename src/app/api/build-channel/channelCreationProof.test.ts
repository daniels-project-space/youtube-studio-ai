import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/app/api/build-channel/route.ts"), "utf8");
const wizard = readFileSync(resolve(process.cwd(), "src/app/(app)/channels/new/page.tsx"), "utf8");

assert.match(
  route,
  /approvedForSetupSpend && !reviewedDataStoryIntake && !approvedForProbe/,
  "automatic execution must require the bounded private proof",
);
assert.match(
  route,
  /automatic channel creation requires one bounded private validation render/,
  "the server must explain the missing creation proof",
);
assert.match(
  wizard,
  /setRunProbe\(e\.target\.checked\)/,
  "enabling setup spend must enable the creation proof in the wizard",
);
assert.match(
  wizard,
  /checked=\{approveSetupSpend && runProbe\} readOnly/,
  "the proof control must remain visibly required once execution is approved",
);
assert.match(
  wizard,
  /required one bounded private proof/,
  "the wizard must label the proof as required rather than optional",
);

console.log("automatic channel creation proof contracts passed");
