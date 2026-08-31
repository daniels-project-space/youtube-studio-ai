import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ReviewedDataStoryRunDesk.tsx", import.meta.url), "utf8");

assert.match(source, /fetch\("\/api\/reviewed-data-story-runs"/, "the desk uses the owner-authenticated reviewed-data-story API");
assert.match(source, /action: "save_pack"/, "raw ledger entry must become an immutable reviewed pack first");
assert.match(source, /action: "prepare_ledger"/, "the desk can prepare the exact review checksum without a provider");
assert.match(source, /action: "start"/, "run start is an explicit separate action");
assert.match(source, /private review-paused episode/i, "operator copy must not imply automatic/public publication");
assert.doesNotMatch(source, /tasks\.trigger|bootstrapSecrets|anthropic|browserbase|openai/i, "the browser desk must not access providers or dispatch directly");

console.log("Reviewed data-story desk UI contracts passed");
