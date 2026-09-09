/** Explicit opt-in storage protocol check. Never targets channel/video namespaces. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteObjects, getObjectBytes, listObjects, putObject } from "../src/lib/storage";

async function main() {
  if (process.argv[2] !== "--allow-isolated-storage-test") {
    throw new Error("Requires --allow-isolated-storage-test; creates and removes three tiny test objects");
  }
  const bucket = "salad-render-infra";
  const prefix = `salad-media-tests/${new Date().toISOString().slice(0, 10)}/delete-contract-${randomUUID()}/`;
  const sentinel = `${prefix}retained.txt`;
  const intermediates = [`${prefix}intermediate-a.txt`, `${prefix}intermediate-b.txt`];
  const exactKeys = [sentinel, ...intermediates];
  assert.deepEqual(await listObjects(prefix, bucket), []);
  console.log(JSON.stringify({ phase: "resolved-test-targets", bucket, exactKeys }));
  for (const key of exactKeys) {
    await putObject(key, Buffer.from(`isolated deletion contract fixture: ${key}`), {
      bucket, contentType: "text/plain", ifNoneMatch: "*",
    });
  }
  assert.deepEqual((await listObjects(prefix, bucket)).sort(), [...exactKeys].sort());
  assert.equal(await deleteObjects(intermediates, bucket), 2);
  assert.deepEqual(await listObjects(prefix, bucket), [sentinel]);
  assert.equal(Buffer.from(await getObjectBytes(sentinel, bucket)).toString(), `isolated deletion contract fixture: ${sentinel}`);
  // S3 acknowledges already absent exact keys: a lost-response retry is safe.
  assert.equal(await deleteObjects(intermediates, bucket), 2);
  assert.equal(await deleteObjects([sentinel], bucket), 1);
  assert.deepEqual(await listObjects(prefix, bucket), []);
  console.log(JSON.stringify({ phase: "passed", bucket, prefix, createdFixtureObjects: 3,
    fixtureObjectsRemoved: 3, alreadyAbsentAcknowledgements: 2, remainingFixtureObjects: 0,
    realVideoObjectsTouched: 0 }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Storage contract check failed");
  process.exitCode = 1;
});
