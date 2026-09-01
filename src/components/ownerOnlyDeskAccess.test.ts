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

const novitaDesk = read("../app/(app)/novita-render/page.tsx");
assert.match(novitaDesk, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(novitaDesk, /if \(operationsAccess !== "owner"\) \{/);
assert.match(novitaDesk, /<LockedRenderConsole access=\{operationsAccess\}/);
assert.match(novitaDesk, /No private fleet, job, prompt, or provider request was sent/);

const casefile = read("../app/(app)/casefile/page.tsx");
assert.match(casefile, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(
  casefile,
  /operationsAccess !== "owner" \? \([\s\S]*<LockedCasefileRoom/,
  "the custom Casefile shell must keep its private workspace behind the owner branch",
);
assert.match(casefile, /No private casefile request was sent/);

const editorialEvidence = read("../app/(app)/editorial-evidence/page.tsx");
assert.match(editorialEvidence, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(
  editorialEvidence,
  /operationsAccess !== "owner" \? \([\s\S]*<LockedEvidenceVault/,
  "the custom Evidence shell must keep receipts and review controls behind the owner branch",
);
assert.match(editorialEvidence, /No private evidence request was sent/);

const studioAssets = read("../app/(app)/studio-assets/page.tsx");
assert.match(studioAssets, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(
  studioAssets,
  /operationsAccess !== "owner" \? \([\s\S]*<LockedAssetRegistry/,
  "the custom asset shell must keep registry inventory and actions behind the owner branch",
);
assert.match(studioAssets, /No private asset request was sent/);

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
assert.match(settings, /operationsAccess !== "owner" \? \([\s\S]*<LockedGovernanceRoom/);
assert.match(
  settings,
  /No private governance records requested/,
  "viewer settings must explain that owner ledgers were not fetched",
);
assert.match(settings, /if \(operationsAccess !== "owner"\) return;/);
assert.match(settings, /\{tab === "publishing" && \(/);

console.log("Owner-only desk access contracts passed");
