import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const access = read("./OperationsAccess.tsx");
const provider = access.slice(
  access.indexOf("export function OperationsAccessProvider"),
  access.indexOf("function useOperationsAccessContext"),
);
assert.equal(
  provider.match(/fetch\("\/api\/operations\/elevation"/g)?.length,
  1,
  "the shared provider performs one session probe",
);
assert.match(access, /export function useOperationsAccess/);

const shell = read("./AppShell.tsx");
assert.match(
  shell,
  /<OperationsAccessProvider>[\s\S]*<OperationsAccess \/>[\s\S]*\{children\}[\s\S]*<\/OperationsAccessProvider>/,
  "the access probe must cover both the trigger and every page",
);

const library = read("../app/(app)/library/page.tsx");
assert.match(
  library,
  /operationsAccess === "owner"[\s\S]*<ThumbnailRefreshInventoryPanel/,
);

for (const path of [
  "../app/(app)/studio-assets/page.tsx",
  "../app/(app)/editorial-evidence/page.tsx",
  "../app/(app)/casefile/page.tsx",
  "../app/(app)/novita-render/page.tsx",
]) {
  const page = read(path);
  assert.match(page, /const operationsAccess = useOperationsAccess\(\)/);
  assert.match(page, /if \(operationsAccess !== "owner"\) \{/);
  assert.match(page, /<OwnerOnlyNotice/);
}

for (const path of [
  "../app/(app)/studio-assets/page.tsx",
  "../app/(app)/editorial-evidence/page.tsx",
  "../app/(app)/casefile/page.tsx",
]) {
  const page = read(path);
  assert.match(page, /if \(operationsAccess !== "owner"\) return;/);
  assert.match(page, /window\.setTimeout\(\(\) =>/);
  assert.match(page, /window\.clearTimeout\(timer\)/);
}

const novita = read("../app/(app)/novita-render/page.tsx");
assert.ok(
  (novita.match(/if \(operationsAccess !== "owner"\) return;/g) ?? []).length >= 2,
  "both Novita mount effects must wait for owner access",
);

const settings = read("../app/(app)/settings/page.tsx");
assert.match(settings, /const operationsAccess = useOperationsAccess\(\)/);
assert.ok(
  (settings.match(/if \(operationsAccess !== "owner"\) return;/g) ?? []).length >= 2,
  "settings reads and mutations must both wait for owner access",
);
assert.match(settings, /operationsAccess !== "owner" \? \([\s\S]*<OwnerOnlyNotice/);
assert.match(settings, /operationsAccess === "owner" && \(tab === "publishing"/);

console.log("Owner-only desk access contracts passed");
