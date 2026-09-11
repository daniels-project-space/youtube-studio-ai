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
assert.match(access, /export function useRequestOperationsAccess/,
  "paid controls outside the top bar must open the one shared verification dialog");

const shell = read("./AppShell.tsx");
assert.match(
  shell,
  /<OperationsAccessProvider>[\s\S]*<OperationsAccess \/>[\s\S]*\{children\}[\s\S]*<\/OperationsAccessProvider>/,
  "the access probe must cover both the trigger and every page",
);
const routes = read("./operationsAccessRoutes.ts");
assert.match(routes, /OWNER_ACTION_ROUTE_PREFIXES/);
assert.match(routes, /pathname\.startsWith\(`\$\{prefix\}\/`\)/);
assert.doesNotMatch(routes, /\/library/,
  "read-only library work remains outside the global owner trigger");

const library = read("../app/(app)/library/page.tsx");
assert.match(
  library,
  /<ThumbnailRefreshInventoryPanel[\s\S]*canManage=\{operationsAccess === "owner"\}[\s\S]*canQueueCandidates/,
);
assert.doesNotMatch(library, /<OwnerOnlyNotice/,
  "thumbnail evidence, candidate refresh and automatic sync status stay visible without an owner-login wall");

const novitaDesk = read("../app/(app)/novita-render/page.tsx");
assert.match(novitaDesk, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(novitaDesk, /if \(operationsAccess !== "owner"\) \{/);
assert.match(novitaDesk, /<LockedRenderConsole access=\{operationsAccess\}/);
assert.match(novitaDesk, /Fleet capacity, jobs, and prompts remain unloaded/);

const casefile = read("../app/(app)/casefile/page.tsx");
assert.match(casefile, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(
  casefile,
  /operationsAccess !== "owner" \? \([\s\S]*<LockedCasefileRoom/,
  "the custom Casefile shell must keep its private workspace behind the owner branch",
);
assert.match(casefile, /Case records remain unloaded until the recorded YouTube owner is verified/);

const editorialEvidence = read("../app/(app)/editorial-evidence/page.tsx");
assert.match(editorialEvidence, /const operationsAccess = useOperationsAccess\(\)/);
assert.match(
  editorialEvidence,
  /operationsAccess !== "owner" \? \([\s\S]*<LockedEvidenceVault/,
  "the custom Evidence shell must keep receipts and review controls behind the owner branch",
);
assert.match(editorialEvidence, /Source snapshots and review fingerprints remain unloaded/);

const studioAssets = read("../app/(app)/studio-assets/page.tsx");
assert.match(studioAssets, /const operationsAccess = useOperationsAccess\(\)/);
const publicAssetPageStart = studioAssets.indexOf("export default function StudioAssetsPage()");
const privateAssetPageStart = studioAssets.indexOf("function OwnedStudioAssetsPage({ access }");
assert.ok(publicAssetPageStart >= 0 && privateAssetPageStart > publicAssetPageStart);
const publicAssetPage = studioAssets.slice(publicAssetPageStart, privateAssetPageStart);
assert.match(
  publicAssetPage,
  /return <OwnedStudioAssetsPage access=\{operationsAccess\} \/>/,
  "the toolkit remains useful before owner elevation",
);
assert.equal(publicAssetPage.match(/<OwnedStudioAssetsPage/g)?.length, 1);
assert.doesNotMatch(publicAssetPage, /<LockedAssetRegistry/);
const privateAssetPage = studioAssets.slice(privateAssetPageStart);
assert.match(privateAssetPage, /window\.setTimeout\(\(\) => void refresh\(\), 0\)/);
assert.match(privateAssetPage, /window\.clearTimeout\(timer\)/);
assert.match(privateAssetPage, /registryRequestRef\.current\?\.abort\(\)/);
assert.match(privateAssetPage, /signal: controller\.signal/);
assert.match(studioAssets, /Private approvals stay protected/);

for (const path of [
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
  /Publishing, account, and policy mutations remain disabled/,
  "viewer settings must explain that owner ledgers were not fetched",
);
assert.match(settings, /if \(operationsAccess !== "owner"\) return;/);
assert.match(settings, /\{tab === "publishing" && \(/);

console.log("Owner-only desk access contracts passed");
