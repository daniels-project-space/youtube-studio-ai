import assert from "node:assert/strict";
import { inspectYuE2OpenRelayAdmission, planYuE2OpenRelayAdmission } from "@/lib/openRelayYuE2Admission";

const id = "04f10e93-cd76-4d63-b6ea-6721d30cc4f9";
const org = "626c2959-4f58-4779-b867-2a74129e93e5";
const narrow = { perGpu: { diskGb: 891, ramMb: 25454, vcpu: 2 }, free: { diskGb: 6209, ramMb: 152884, vcpu: 18 }, unitSizes: [1] };
const wide = { perGpu: { diskGb: 891, ramMb: 29102, vcpu: 2 }, free: { diskGb: 6810, ramMb: 233039, vcpu: 22 }, unitSizes: [1] };
const gpu = { gpuModelId: id, name: "RTX 3090", vramGb: 24, vm: { freeGpus: 14, minDiskGb: 30,
  placeableGpuCounts: [1, 2, 3, 4], offers: [narrow, wide] } };
const pricing = { gpu: [{ gpuModelId: id, gpuModelName: "RTX 3090", vramGb: 24, tier: "community", pricePerHourCents: 18 }] };
const input = { availability: [gpu], pricing, maximumHourlyCents: 18 };
const plan = planYuE2OpenRelayAdmission(input);
assert.equal(plan.compatibleOfferCount, 1);
assert.equal(plan.shape.guestMemMb, 28672);
assert.equal(plan.shape.allowFallback, false);
assert.equal(plan.authorizedToCreate, false);
assert.equal(plan.storagePriceVerified, false);
assert.equal(plan.gpuQualified, false);
assert.equal(plan.shape.public, false);

for (const offers of [[], [narrow], [{ ...wide, unitSizes: null }], [{ ...wide, unitSizes: [2] }],
  [{ ...wide, free: { ...wide.free, ramMb: 1 } }], [{ ...wide, free: { ...wide.free, diskGb: 59 } }],
  [{ ...wide, free: { ...wide.free, vcpu: 0 } }],
  [{ ...wide, free: { ...wide.free, ramMb: 1 } }, { ...wide, free: { ...wide.free, diskGb: 1 } }]]) {
  assert.throws(() => planYuE2OpenRelayAdmission({ ...input, availability: [{ ...gpu, vm: { ...gpu.vm, offers } }] }));
}
for (const vm of [{ ...gpu.vm, freeGpus: 0 }, { ...gpu.vm, minDiskGb: 61 }, { ...gpu.vm, placeableGpuCounts: [2] }]) {
  assert.throws(() => planYuE2OpenRelayAdmission({ ...input, availability: [{ ...gpu, vm }] }));
}
for (const change of [{ name: "RTX 4090" }, { vramGb: 32 }]) {
  assert.throws(() => planYuE2OpenRelayAdmission({ ...input, availability: [{ ...gpu, ...change }] }));
}
for (const rates of [[], [...pricing.gpu, ...pricing.gpu], [{ ...pricing.gpu[0], pricePerHourCents: 19 }],
  [{ ...pricing.gpu[0], pricePerHourCents: 0 }], [{ ...pricing.gpu[0], tier: "spot" }]]) {
  assert.throws(() => planYuE2OpenRelayAdmission({ ...input, pricing: { gpu: rates } }));
}

async function main() {
  const calls: string[] = [];
  const key = "test-key-".repeat(8);
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${key}`);
    const path = new URL(String(url)).pathname; calls.push(path);
    return Response.json(path === "/v1/whoami" ? { organizationId: org, scopes: ["vms:read"] }
      : path === "/v1/gpu-availability" ? input.availability : path === "/v1/pricing" ? pricing : { items: [] });
  };
  const report = await inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org, maximumHourlyCents: 18, fetchImpl });
  assert.equal(report.admissionMode, "new_vm");
  assert.equal(report.existingVm, null); assert.ok(!JSON.stringify(report).includes(key));
  assert.deepEqual(calls, ["/v1/whoami", "/v1/gpu-availability", "/v1/pricing", `/v1/orgs/${org}/vms`]);
  const vmId = "29e245a2-2e1a-431e-b5b3-654cf0ba1587";
  const retainedVm = { id: vmId, organizationId: org, name: "yt-yue2-3090-credential-validation", status: "stopped",
    gpuModelId: id, gpuCount: 1, gpuInfo: { name: "RTX 3090", vramGb: 24 }, guestMemMb: 28672,
    diskSizeGb: 60, public: false, tier: "community" };
  const burn = { vmId, gpuCount: 1, pricePerHourCents: 18, diskBilled: false };
  const retainedCalls: string[] = [];
  const retainedFetch = (detail: unknown = retainedVm, cost: unknown = burn): typeof fetch => async (url, init) => {
    assert.equal(init?.method, "GET");
    const path = new URL(String(url)).pathname; retainedCalls.push(path);
    if (path === "/v1/whoami") return Response.json({ organizationId: org, scopes: ["vms:read", "vms:write"] });
    if (path === `/v1/vms/${vmId}/detail`) return Response.json(detail);
    if (path === `/v1/vms/${vmId}/burn`) return Response.json(cost);
    throw new Error("Retained VM inspection must not depend on new-placement capacity or inventory names");
  };
  const retainedOptions = { apiKey: key, expectedOrganizationId: org, maximumHourlyCents: 18, existingVmId: vmId };
  const retained = await inspectYuE2OpenRelayAdmission({ ...retainedOptions, fetchImpl: retainedFetch() });
  assert.equal(retained.admissionMode, "retained_vm");
  if (retained.admissionMode !== "retained_vm") throw Error("Expected retained mode");
  assert.deepEqual(retained.existingVm, { id: vmId, name: retainedVm.name, status: "stopped" });
  assert.equal(retained.authorizedToRestart, false, "reported write scope is not verified restart permission");
  assert.equal(retained.restartCapacityVerified, false);
  assert.equal(retained.authorizedToCreate, false);
  assert.equal(retained.storagePriceVerified, true);
  assert.equal(retained.compatibleOfferCount, null);
  assert.deepEqual(retainedCalls, ["/v1/whoami", `/v1/vms/${vmId}/detail`, `/v1/vms/${vmId}/burn`]);
  for (const patch of [{ id }, { organizationId: id }, { status: "terminated" }, { status: "failed" },
    { gpuCount: 2 }, { gpuInfo: { name: "RTX 4090", vramGb: 24 } }, { gpuInfo: { name: "RTX 3090", vramGb: 12 } },
    { guestMemMb: 24576 }, { diskSizeGb: 59 }, { public: true }, { tier: "enterprise" }]) {
    await assert.rejects(() => inspectYuE2OpenRelayAdmission({ ...retainedOptions,
      fetchImpl: retainedFetch({ ...retainedVm, ...patch }) }));
  }
  for (const patch of [{ vmId: id }, { gpuCount: 2 }, { pricePerHourCents: 19 }, { pricePerHourCents: 0 }, { diskBilled: true }]) {
    await assert.rejects(() => inspectYuE2OpenRelayAdmission({ ...retainedOptions,
      fetchImpl: retainedFetch(retainedVm, { ...burn, ...patch }) }));
  }
  let invalidIdCalls = 0;
  await assert.rejects(() => inspectYuE2OpenRelayAdmission({ ...retainedOptions, existingVmId: "../other",
    fetchImpl: async () => { invalidIdCalls++; throw Error("Must validate ID before HTTP"); } }));
  assert.equal(invalidIdCalls, 0);
  for (const deniedPath of [`/v1/vms/${vmId}/detail`, `/v1/vms/${vmId}/burn`]) {
    const goodFetch = retainedFetch();
    await assert.rejects(() => inspectYuE2OpenRelayAdmission({ ...retainedOptions,
      fetchImpl: async (url, init) => new URL(String(url)).pathname === deniedPath
        ? new Response(key, { status: 403 }) : goodFetch(url, init) }), error => {
      assert.ok(error instanceof Error && error.message.includes("HTTP 403") && !error.message.includes(key));
      return true;
    });
  }
  for (const scopes of [["clusters:read", "clusters:write"], []]) {
    const observed: string[] = [];
    const actualAccess: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      observed.push(path);
      return path === "/v1/whoami" ? Response.json({ organizationId: org, scopes }) : fetchImpl(url, init);
    };
    const accepted = await inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
      maximumHourlyCents: 18, fetchImpl: actualAccess });
    assert.deepEqual(accepted.reportedScopes, scopes);
    assert.equal(accepted.readAccessVerified, true);
    assert.ok(observed.includes(`/v1/orgs/${org}/vms`), "scope metadata never substitutes for actual VM reads");
    assert.equal(accepted.authorizedToCreate, false, "successful reads cannot grant writes or spending");
  }
  for (const deniedPath of ["/v1/gpu-availability", "/v1/pricing", `/v1/orgs/${org}/vms`]) {
    await assert.rejects(() => inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
      maximumHourlyCents: 18, fetchImpl: async (url, init) => new URL(String(url)).pathname === deniedPath
        ? new Response(key, { status: 403 }) : fetchImpl(url, init) }), error => {
      assert.ok(error instanceof Error && error.message.includes("HTTP 403") && !error.message.includes(key));
      return true;
    });
  }
  await assert.rejects(() => inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
    maximumHourlyCents: 18, fetchImpl: async () => new Response(key, { status: 401 }) }), error => {
    assert.ok(error instanceof Error && !error.message.includes(key)); return true;
  });
  for (const [status, body, expectedRevoked] of [
    [401, JSON.stringify({ code: "REVOKED_API_KEY", error: key }), true],
    [401, JSON.stringify({ code: key, error: "api key revoked" }), false],
    [403, JSON.stringify({ code: "REVOKED_API_KEY", error: key }), false],
    [401, JSON.stringify({ code: "REVOKED_API_KEY", error: key.repeat(100) }), false],
    [401, "null", false],
  ] as const) {
    let reads = 0;
    await assert.rejects(() => inspectYuE2OpenRelayAdmission({ ...retainedOptions,
      fetchImpl: async () => { reads++; return new Response(body, { status }); } }), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("REVOKED_API_KEY"), expectedRevoked);
      assert.equal(error.message.includes("youtube/OPENRELAY_API_KEY"), expectedRevoked);
      assert.ok(!error.message.includes(key));
      return true;
    });
    assert.equal(reads, 1, "revoked identity cannot continue to inventory or provider mutation");
  }
  await assert.rejects(() => inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
    maximumHourlyCents: 18, fetchImpl: async () => new Response(key) }), error => {
    assert.ok(error instanceof Error && !error.message.includes(key)); return true;
  });
  let read = 0;
  await assert.rejects(() => inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
    maximumHourlyCents: 18, fetchImpl: async () => { read++; return Response.json({ organizationId: id, scopes: ["vms:read"] }); } }));
  assert.equal(read, 1, "wrong account stops before capacity reads");
  let pages = 0;
  const paginated: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    if (!parsed.pathname.endsWith("/vms")) return fetchImpl(url, init);
    assert.equal(parsed.searchParams.get("limit"), "100");
    assert.equal(parsed.searchParams.get("activeOnly"), "true");
    pages++;
    if (pages === 1) return Response.json({ items: [], nextCursor: "page&two" });
    assert.equal(parsed.searchParams.get("cursor"), "page&two");
    return Response.json({ items: [{ id, name: plan.shape.name, status: "stopped" }] });
  };
  const existing = await inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
    maximumHourlyCents: 18, fetchImpl: paginated });
  assert.equal(existing.existingVm?.id, id); assert.equal(pages, 2);
  await assert.rejects(() => inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
    maximumHourlyCents: 18, fetchImpl: async (url, init) => String(url).includes("/vms?")
      ? Response.json({ items: [], nextCursor: "repeated" }) : fetchImpl(url, init) }), /incomplete/);
  await assert.rejects(() => inspectYuE2OpenRelayAdmission({ apiKey: key, expectedOrganizationId: org,
    maximumHourlyCents: 18, fetchImpl: async (url, init) => String(url).includes("/vms?")
      ? Response.json({ items: [1, 2].map(() => ({ id, name: plan.shape.name, status: "stopped" })) })
      : fetchImpl(url, init) }), /Multiple/);
  console.log("YUE2 OPENRELAY EXACT-SHAPE ADMISSION PASS");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
