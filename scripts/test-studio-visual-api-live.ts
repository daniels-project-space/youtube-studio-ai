import assert from "node:assert/strict";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--live") throw new Error("Explicit --live required");
  const key = process.env.RENDER_MANAGEMENT_API_KEY ?? "";
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Management credential unavailable");
  const base = "https://render-engine-sable.vercel.app/api/v1";
  const metadata = await fetch(`${base}/openapi.json`, { redirect: "error", signal: AbortSignal.timeout(20000) });
  assert.equal(metadata.status, 200);
  const api = await metadata.json();
  const routes = ["studio-zimage-batches", "studio-batch-admission", "studio-batch-scenes", "h3-scene-batches", "h3-scene-batches/output"];
  for (const route of routes) assert.ok(api.paths[`/api/v1/projects/{projectName}/${route}`]);
  assert.ok(api.components.schemas.CreateWorkflow.properties.profileId.enum.includes("studio-zimage-turbo"));
  const profiles = api.components.schemas.StudioZImageJob.properties.request.oneOf;
  assert.equal(profiles[0].properties.candidates.items.properties.width.const, 1920);
  assert.equal(profiles[0].properties.candidates.items.properties.height.const, 1088);
  assert.equal(profiles[1].properties.candidates.minItems, 2);
  assert.equal(profiles[1].properties.candidates.items.properties.width.const, 2048);
  assert.equal(profiles[1].properties.candidates.items.properties.height.const, 1152);
  const results = [];
  for (const [route, method] of [["studio-zimage-batches", "POST"], ["studio-batch-admission", "POST"],
    ["studio-batch-scenes", "POST"], ["h3-scene-batches", "POST"], ["h3-scene-batches", "GET"], ["h3-scene-batches/output", "GET"]]) {
    // Missing identities/payloads must fail before any model, storage or worker action.
    const response = await fetch(`${base}/projects/youtube-studio-render/${route}`, { method, redirect: "error",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 400, `${method} ${route} did not reach its real validation boundary`);
    void response.body?.cancel();
    results.push({ route, method, status: response.status });
  }
  const unauthenticated = await fetch(`${base}/projects/youtube-studio-render/h3-scene-batches`, {
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  assert.equal(unauthenticated.status, 401);
  void unauthenticated.body?.cancel();
  console.log(JSON.stringify({ passed: true, publicAlias: base, results, unauthenticatedStatus: 401,
    jobSubmissions: 0, gpuAllocations: 0, storageWrites: 0 }));
}
main().catch(() => { console.error("Live managed visual API validation failed; no render or retry was attempted."); process.exitCode = 1; });
