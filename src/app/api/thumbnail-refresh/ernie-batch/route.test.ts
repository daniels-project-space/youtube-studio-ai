import assert from "node:assert/strict";

import { POST } from "./route";
import { GET as inventoryGET } from "../route";

async function main() {
  const response = await POST();
  assert.equal(response.status, 410);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "The reviewed ERNIE trial batch has been retired",
  });

  const preview = await inventoryGET(new Request("https://studio.invalid/api/thumbnail-refresh?ernieBatch=reviewed"));
  assert.equal(preview.status, 410);
  assert.match(preview.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(await preview.json(), {
    ok: false,
    error: "The reviewed ERNIE trial batch has been retired",
  });
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
