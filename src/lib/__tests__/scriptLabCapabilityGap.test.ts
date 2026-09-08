/** Script Lab must use bounded real video evidence without direct Google. */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHANNEL_INCEPTION_FAMILY_POLICIES } from "@/engine/channelInceptionContracts";
import { narrativePlaybookCapability } from "@/lib/scriptLab";
import { referenceOpeningCapability } from "@/lib/referenceOpening";

const source = readFileSync(join(process.cwd(), "src/lib/scriptLab.ts"), "utf8");
const capture = readFileSync(join(process.cwd(), "src/lib/referenceOpening.ts"), "utf8");
const triggerConfig = readFileSync(join(process.cwd(), "trigger.config.ts"), "utf8");
const inception = readFileSync(join(process.cwd(), "src/trigger/designChannelInception.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

assert.doesNotMatch(source, /geminiAnalyzeYouTube|hasGeminiKey|GEMINI_API_KEY/);
assert.match(source, /withReferenceOpeningEvidence\(/);
assert.match(source, /visionLocal\(\{/);
assert.match(source, /providers:\s*\["openrouter"\]/);
assert.match(source, /evidence\.transcript/);
assert.match(source, /evidence\.framePaths/);
assert.match(capture, /youtube:player_client=web_safari/);
assert.match(capture, /"-f",\s*"sb0"/);
assert.match(capture, /"--write-auto-subs"/);
assert.match(capture, /await rm\(dir, \{ recursive: true, force: true \}\)/);
assert.match(triggerConfig, /const YT_DLP_PACKAGE_VERSION = "2026\.6\.9"/);
assert.match(triggerConfig, /const YT_DLP_CLI_VERSION = "2026\.06\.09"/);
assert.match(triggerConfig, /yt-dlp==\$\{YT_DLP_PACKAGE_VERSION\}/);
assert.match(triggerConfig, /yt-dlp --version\)" = "\$\{YT_DLP_CLI_VERSION\}"/);

const previousKey = process.env.OPENROUTER_API_KEY;
const previousYtDlpBin = process.env.YT_DLP_BIN;
const probeDir = mkdtempSync(join(tmpdir(), "studio-yt-dlp-probe-"));
const probeBin = join(probeDir, "yt-dlp");
writeFileSync(probeBin, "#!/bin/sh\nprintf '2026.06.09\\n'\n", "utf8");
chmodSync(probeBin, 0o755);
try {
  delete process.env.OPENROUTER_API_KEY;
  const unavailable = narrativePlaybookCapability();
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason, /OPENROUTER_API_KEY/);

  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.YT_DLP_BIN = probeBin;
  const available = narrativePlaybookCapability();
  assert.equal(available.available, true, available.reason);
  assert.match(referenceOpeningCapability().version ?? "", /^\d{4}\.\d{1,2}\.\d{1,2}$/);
} finally {
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
  if (previousYtDlpBin === undefined) delete process.env.YT_DLP_BIN;
  else process.env.YT_DLP_BIN = previousYtDlpBin;
  rmSync(probeDir, { recursive: true, force: true });
}

const required = Object.entries(CHANNEL_INCEPTION_FAMILY_POLICIES)
  .filter(([, policy]) => policy.requiresNarrativePlaybook)
  .map(([family]) => family);
assert.ok(required.length >= 2 && !required.includes("music_loop"));
assert.match(
  inception,
  /if \(!admission\.executionAuthorized \|\| !playbookCapability\.available\)/,
  "Channel Inception must still fail before its first stage when capture/provider capability is missing",
);
assert.match(
  inception,
  /if \(plan\.familyPolicy\.requiresNarrativePlaybook\) \{[\s\S]{0,400}?scriptPlaybook = await distillScriptPlaybook\(/,
  "every family that requires the playbook must execute the evidence-backed route",
);

console.log(
  `SCRIPTLAB VIDEO EVIDENCE PASS — bounded storyboard + captions on OpenRouter; ${required.length} families unblocked when keyed`,
);
