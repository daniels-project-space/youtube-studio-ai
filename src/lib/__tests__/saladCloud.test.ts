import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  SALAD_API_BASE, SaladCloudClient, SaladCloudError, buildSaladContainerGroup,
  isSaladGroupStopped, saladOccupiedGpuSlots, selectSaladGpu, type SaladGpuClass,
} from "../saladCloud";

const classes: SaladGpuClass[] = [
  { id: "a5db5c50-cbcb-4596-ae80-6a0c8090d80f", name: "RTX 3090 (24 GB)", prices: [{ price: "0.197", priority: "medium" }] },
  { id: "851399fb-7329-4195-a042-d6514b28cf33", name: "RTX 5090 (32 GB)", prices: [{ price: "0.38", priority: "medium" }] },
  { id: "83ef776e-ce34-4d89-8cf9-81898f1416fa", name: "RTX 5090 Laptop (24 GB)", prices: [{ price: "0.22", priority: "medium" }] },
];
const image = `ghcr.io/daniels-project-space/salad-worker@sha256:${"a".repeat(64)}`;
const request = buildSaladContainerGroup({
  name: "studio-batch-001", image, gpu: selectSaladGpu(classes, "RTX 3090"),
  replicas: 3, cpu: 8, memoryMb: 32768, storageBytes: 100 * 1024 ** 3,
});
function providerGroup(status = "stopped", running = 0) {
  return {
    id: "fb5f65cb-c2ab-47dd-b5cd-e4b9c364e38c", name: request.name, replicas: 3,
    priority: "medium", pending_change: false, container: { ...request.container,
      environment_variables: { SECRET: "do-not-return-this" },
      registry_authentication: { basic: { username: "user", password: "do-not-return-this" } },
    },
    current_state: { status, description: "do-not-return-this", instance_status_counts: {
      allocating_count: 0, creating_count: 0, running_count: running, stopping_count: 0,
    } }, queue_connection: request.queue_connection,
  };
}

async function main() {
  assert.equal(selectSaladGpu(classes, "RTX 5090").id, classes[1].id);
  assert.throws(() => selectSaladGpu([classes[2]], "RTX 5090"), /exact/);
  assert.throws(() => selectSaladGpu([...classes, classes[0]], "RTX 3090"), /exact/);
  assert.equal(request.autostart_policy, false);
  assert.equal(request.container.priority, "medium");
  assert.equal(request.container.image_caching, true);
  assert.equal(request.replicas, 3);
  assert.equal(request.restart_policy, "never");
  assert.equal(request.networking?.auth, true);
  assert.equal(request.readiness_probe.http.path, "/healthz");
  assert.throws(() => buildSaladContainerGroup({
    name: "test-group", image: "image:latest", gpu: selectSaladGpu(classes, "RTX 3090"),
    replicas: 1, cpu: 4, memoryMb: 8192, storageBytes: 1024 ** 3,
  }));
  assert.throws(() => buildSaladContainerGroup({
    name: "test-group", image, gpu: selectSaladGpu(classes, "RTX 3090"),
    replicas: 1, cpu: 4, memoryMb: 8192, storageBytes: 1024 ** 3,
    environmentVariables: { SALAD_API_KEY: "do-not-return-this" },
  }), /scoped/);

  // Real HTTP transport exercises methods, JSON bodies, responses and header redaction.
  const seen: Array<{ method: string; path: string; body: unknown; contentType?: string }> = [];
  let mode: "ok" | "server-error" | "invalid-json" | "rate-limited" = "ok";
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    seen.push({ method: req.method!, path: req.url!, body: raw ? JSON.parse(raw) : undefined, contentType: req.headers["content-type"] });
    assert.equal(req.headers["salad-api-key"], "test-secret-value");
    res.setHeader("content-type", "application/json");
    if (mode === "server-error") { res.writeHead(503); res.end('{"detail":"test-secret-value"}'); return; }
    if (mode === "invalid-json") { res.writeHead(201); res.end("test-secret-value"); return; }
    if (mode === "rate-limited") { res.writeHead(429, { "Retry-After": "15" }); res.end("test-secret-value"); return; }
    if (/\/(start|stop)$/.test(req.url!)) { res.writeHead(202); res.end(); return; }
    if (req.url!.endsWith("gpu-classes")) { res.end(JSON.stringify({ items: classes })); return; }
    if (req.url!.endsWith("quotas")) { res.end(JSON.stringify({ container_groups_quotas: { container_replicas_quota: 10, container_replicas_used: 0 } })); return; }
    if (req.url!.endsWith("sce-gpu-availability")) { res.end(JSON.stringify({ available_gpu_medium: 7 })); return; }
    if (req.url!.endsWith("/instances")) { res.end(JSON.stringify({ instances: [] })); return; }
    if (req.method === "GET" && req.url!.endsWith("/containers")) { res.end(JSON.stringify({ items: [providerGroup()] })); return; }
    if (req.method === "POST") res.statusCode = 201;
    res.end(JSON.stringify(providerGroup()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const local = `http://127.0.0.1:${address.port}`;
  const client = new SaladCloudClient({ apiKey: "test-secret-value", organization: "test-org", project: "test-project",
    fetch: (url, init) => fetch(String(url).replace(SALAD_API_BASE, local), init),
  });
  try {
    assert.equal((await client.listGpuClasses()).length, 3);
    const groups = await client.listContainerGroups();
    assert(!JSON.stringify(groups).includes("do-not-return-this"));
    assert.equal(saladOccupiedGpuSlots(groups), 3, "group status alone cannot release capacity");
    assert.equal(saladOccupiedGpuSlots(groups, new Map([[request.name, []]])), 0);
    assert(isSaladGroupStopped(groups[0], await client.listContainerInstances(request.name)));
    const running = { ...groups[0], current_state: { status: "running", instance_status_counts: {
      allocating_count: 0, creating_count: 0, running_count: 2, stopping_count: 1,
    } } };
    assert.equal(saladOccupiedGpuSlots([running]), 3);
    assert.equal(saladOccupiedGpuSlots([{ ...running, replicas: 0 }]), 3);
    assert(!isSaladGroupStopped({ ...running, current_state: { ...running.current_state, status: "stopped" } }, []));
    assert(!isSaladGroupStopped(groups[0], [{ id: groups[0].id, state: "stopping", version: 1 }]));
    assert.equal((await client.getQuotas()).container_groups_quotas.container_replicas_quota, 10);
    assert.equal((await client.getGpuAvailability(request.container.resources)).available_gpu_medium, 7);
    await client.createContainerGroup(request);
    await client.startContainerGroup(request.name);
    await client.stopContainerGroup(request.name);
    await client.updateReplicas(request.name, 0);
    const scale = seen.at(-1)!;
    assert.equal(scale.method, "PATCH");
    assert.equal(scale.contentType, "application/merge-patch+json");
    assert.deepEqual(scale.body, { replicas: 0 });
    assert(seen.some((row) => row.path.endsWith("/containers/studio-batch-001/stop")));
    assert.throws(() => client.updateReplicas(request.name, 4));
    assert.throws(() => client.getContainerGroup("../other-org"));
    for (const nextMode of ["server-error", "invalid-json", "rate-limited"] as const) {
      mode = nextMode;
      const before = seen.length;
      await assert.rejects(client.createContainerGroup(request), (error: unknown) => {
        assert(error instanceof SaladCloudError);
        assert.equal(error.outcomeUnknown, mode !== "rate-limited");
        assert.equal(error.retryable, false);
        assert(!String(error).includes("test-secret-value"));
        assert(!JSON.stringify(error).includes("test-secret-value"));
        if (mode === "rate-limited") assert.equal(error.retryAfterSeconds, 15);
        return true;
      });
      assert.equal(seen.length, before + 1, "ambiguous paid mutation is never automatically repeated");
    }
    const broken = new SaladCloudClient({ apiKey: "test-secret-value", organization: "test-org", project: "test-project",
      fetch: async () => { throw new Error("transport contains test-secret-value"); },
    });
    await assert.rejects(broken.startContainerGroup(request.name), (error: unknown) => {
      assert(error instanceof SaladCloudError && error.outcomeUnknown);
      assert.equal(error.cause, undefined);
      assert(!JSON.stringify(error).includes("test-secret-value"));
      return true;
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  console.log("Salad client: exact GPU, pinned image, capacity, real HTTP lifecycle, redaction and ambiguous-write checks passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
