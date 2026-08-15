import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const narrated = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const script = readFileSync(join(process.cwd(), "src/lib/scriptGen.ts"), "utf8");

assert.match(narrated, /assertDataStorySourceLedger\(ctx\.store\["dataStorySourceLedger"\]\)/);
assert.match(narrated, /assertDataStorySourceLedger\(ctx\.store\["dataStorySourceLedger"\], narration\)/);
assert.match(narrated, /dataStorySourceLedgerPrompt/);
assert.match(script, /sourceGrounding\?: string/);
assert.match(script, /req\.sourceGrounding/);

console.log("Data-story source-ledger script/QA binding tests passed");
