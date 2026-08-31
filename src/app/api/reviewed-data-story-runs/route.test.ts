import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /requireStudioActor\(request\)/, "both desk reads and mutations require an owner session");
assert.match(source, /action must be prepare_ledger, save_pack, or start/, "the endpoint has only explicit owner actions");
assert.match(source, /dataStorySourceLedgerFingerprint\(\s*ledgerFingerprintInput/, "the desk can derive the review checksum without accepting a run");
assert.match(source, /assertDataStorySourceLedger[\s\S]*createReviewedEvidencePack[\s\S]*reviewedEvidencePacksApi\.admit/,
  "raw ledger input is engine-validated then persisted as an immutable pack");
assert.match(source, /reviewedDataStoryApi\.admit[\s\S]*channelId:[\s\S]*packId:/,
  "start accepts only durable identifiers and delegates the full server-side admission");
assert.doesNotMatch(source, /tasks\.trigger|bootstrapSecrets|anthropic|browserbase|openai/i,
  "the owner desk creates no direct provider work or bypass dispatch");
assert.doesNotMatch(source, /programRoute:\s*body|showProfile:\s*body|pipeline:\s*body/,
  "route, profile, and pipeline are derived from the stored owned channel, never browser input");

console.log("Reviewed data-story runs API contracts passed");
