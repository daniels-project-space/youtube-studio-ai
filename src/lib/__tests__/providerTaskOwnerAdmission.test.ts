import assert from "node:assert/strict";
import { admitProviderTaskOwner } from "@/lib/providerTaskOwnerAdmission";

assert.equal(
  admitProviderTaskOwner({
    requestedOwnerId: "owner-1",
    configuredOwnerId: "owner-1",
    runtime: "production",
  }),
  "owner-1",
);
assert.equal(
  admitProviderTaskOwner({
    configuredOwnerId: "owner-1",
    runtime: "production",
  }),
  "owner-1",
);
assert.throws(
  () =>
    admitProviderTaskOwner({
      requestedOwnerId: "owner-2",
      configuredOwnerId: "owner-1",
      runtime: "production",
    }),
  /does not match/,
);
assert.throws(
  () =>
    admitProviderTaskOwner({
      requestedOwnerId: "owner-1",
      runtime: "production",
    }),
  /requires STUDIO_OWNER_ID/,
);
assert.equal(
  admitProviderTaskOwner({
    requestedOwnerId: "owner-dev",
    runtime: "development",
    developmentFallbackOwnerId: "owner-fallback",
  }),
  "owner-dev",
);
assert.equal(
  admitProviderTaskOwner({
    runtime: "test",
    developmentFallbackOwnerId: "owner-test",
  }),
  "owner-test",
);

console.log("provider task owner admission tests passed");
