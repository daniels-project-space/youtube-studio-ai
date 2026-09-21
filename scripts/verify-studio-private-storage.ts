import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getStudioPrivateBucket } from "../src/lib/studioPrivateStorage";
import { deleteObjects, getObjectBytes, presignDownload, putObject } from "../src/lib/storage";

// Operator-only deployment check. No control-plane credential enters app code.
let stage = "configuration";
async function main() {
  const bucket = getStudioPrivateBucket();
  const account = process.env.R2_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert.ok(account && token, "Vault-injected R2 account and Cloudflare token required");
  assert.ok(!process.env.R2_ENDPOINT || new URL(process.env.R2_ENDPOINT).origin ===
    `https://${account}.r2.cloudflarestorage.com`, "Probe must target the checked R2 account");
  async function control(suffix: string) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, "Private bucket control-plane check failed");
    const data = await response.json();
    assert.equal(data.success, true);
    return data.result;
  }
  stage = "public-domain-configuration";
  const managed = await control("/domains/managed");
  assert.equal(managed.enabled, false, "r2.dev must be disabled before any write");
  assert.deepEqual((await control("/domains/custom")).domains, [], "Private bucket must have no custom domains");
  assert.match(managed.domain, /^pub-[a-f0-9]+\.r2\.dev$/u);
  const key = `operator-probes/private-storage/${randomUUID()}.txt`;
  const body = Buffer.from("Studio private storage access probe; no user data.\n");
  let created = false;
  try {
    stage = "create-probe";
    await putObject(key, body, { bucket, contentType: "text/plain", ifNoneMatch: "*" });
    created = true;
    stage = "authenticated-read";
    assert.deepEqual(Buffer.from(await getObjectBytes(key, bucket, { maxBytes: 1024, timeoutMs: 30_000 })), body);
    stage = "conditional-write";
    await assert.rejects(putObject(key, body, { bucket, ifNoneMatch: "*" }),
      (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412);
    stage = "signed-read";
    const signed = await presignDownload(key, { bucket, expiresIn: 60 });
    const signedResponse = await fetch(signed, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    assert.equal(signedResponse.status, 200, "Signed playback must work");
    assert.deepEqual(Buffer.from(await signedResponse.arrayBuffer()), body);
    const unsigned = new URL(signed);
    unsigned.search = "";
    for (const url of [unsigned.toString(), `https://${managed.domain}/${key}`]) {
      stage = url === unsigned.toString() ? "anonymous-s3-read" : "anonymous-r2dev-read";
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      const text = await response.text();
      console.log(JSON.stringify({ stage, status: response.status }));
      const missingAuthorization = stage === "anonymous-s3-read" && response.status === 400 &&
        text.includes("<Code>InvalidArgument</Code><Message>Authorization</Message>");
      assert.ok(!text.includes(body.toString()), "Anonymous response must not contain probe bytes");
      assert.ok(missingAuthorization || [401, 403, 404].includes(response.status), "Anonymous object access must be denied");
    }
    console.log(JSON.stringify({ bucket, privateDomainsVerified: true, signedRead: true,
      anonymousReadDenied: true, conditionalWrite: true }));
  } finally {
    if (created) {
      assert.equal(await deleteObjects([key], bucket), 1, "Probe cleanup must be acknowledged");
      console.log("Disposable probe deleted; no user objects changed");
    }
  }
}

main().catch((error: unknown) => {
  // Provider errors can contain signed URLs. Report only a bounded error type.
  console.error(JSON.stringify({ status: "failed", stage, errorType: error instanceof Error ? error.name : "unknown" }));
  process.exitCode = 1;
});
