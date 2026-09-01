import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(`${here}/page.tsx`, "utf8");
const styles = readFileSync(`${here}/settings.module.css`, "utf8");

assert.match(page, /function SettingsHero/,
  "settings must own a channel-specific governance composition");
assert.match(page, /Control boundary map/);
assert.match(page, /Changes require confirmation/);
assert.match(page, /function LockedGovernanceRoom/);
assert.match(page, /Publishing, account, and policy mutations remain disabled/);
assert.match(page, /Ledgers private/);

for (const tab of ["account", "production", "publishing", "learning"]) {
  assert.match(page, new RegExp(`id: "${tab}"`), `missing ${tab} governance room`);
}

assert.match(page, /fetch\("\/api\/channel-settings"/,
  "governance edits must remain connected to the real settings route");
assert.match(page, /\/api\/youtube-connect/);
assert.match(page, /\/api\/youtube-revoke/);
assert.match(page, /window\.confirm/,
  "consequential governance mutations must preserve explicit confirmation");
assert.match(page, /if \(operationsAccess !== "owner"\) return;/,
  "private approval requests must stop before an owner session exists");
assert.match(page, /operationsAccess !== "owner" \? \([\s\S]*<LockedGovernanceRoom/,
  "private governance panels must remain behind the owner branch");
assert.match(page, /\{tab === "publishing" && \(/);
assert.doesNotMatch(page, /<PageHeader/);
assert.match(styles, /prefers-reduced-motion: reduce/);

console.log("Settings UI contracts passed");
