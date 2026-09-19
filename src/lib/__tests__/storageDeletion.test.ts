import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { deleteObjects, getR2Client, ObjectDeletionError } from "@/lib/storage";

Object.assign(process.env, {
  R2_ENDPOINT: "https://storage-fixture.invalid",
  R2_ACCESS_KEY_ID: "fixture", R2_SECRET_ACCESS_KEY: "fixture", R2_BUCKET: "fixture",
});

test("R2 HTTP 200 with per-object errors cannot become successful cleanup", async () => {
  const calls: DeleteObjectsCommand[] = [];
  const send = mock.method(getR2Client(), "send", async (command: unknown) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    calls.push(command);
    return { $metadata: { httpStatusCode: 200 }, Deleted: [{ Key: "test/a" }],
      Errors: [{ Key: "test/b", Code: "AccessDenied", Message: "provider detail must stay private" }] };
  });
  try {
    await assert.rejects(deleteObjects(["test/a", "test/b"]), (error: unknown) => {
      assert.ok(error instanceof ObjectDeletionError);
      assert.equal(error.confirmedDeleted, 1);
      assert.equal(error.requestedObjects, 2);
      assert.doesNotMatch(error.message, /AccessDenied|provider detail|test\//);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.Delete?.Quiet, false);
  } finally {
    send.mock.restore();
  }
});

test("unique exact keys use verbose acknowledgements and bounded batches", async () => {
  const keys = [...Array.from({ length: 1001 }, (_, i) => `test/${i}`), "test/ a ", "test/é"];
  const calls: DeleteObjectsCommand[] = [];
  const send = mock.method(getR2Client(), "send", async (command: unknown) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    calls.push(command);
    assert.equal(command.input.Bucket, "explicit-fixture");
    assert.equal(command.input.Delete?.Quiet, false);
    return { $metadata: { httpStatusCode: 200 }, Deleted: command.input.Delete?.Objects?.toReversed() };
  });
  try {
    assert.equal(await deleteObjects([...keys, keys[0]], "explicit-fixture"), keys.length);
    assert.deepEqual(calls.map((call) => call.input.Delete?.Objects?.length), [1000, 3]);
    assert.deepEqual(calls.flatMap((call) => call.input.Delete?.Objects?.map((row) => row.Key)), keys);
  } finally { send.mock.restore(); }
});

test("empty and invalid input sends no storage request", async () => {
  const send = mock.method(getR2Client(), "send", async () => { throw new Error("must not send"); });
  try {
    assert.equal(await deleteObjects([]), 0);
    for (const keys of [[""], ["test/a", ""], ["é".repeat(513)], [null as unknown as string]]) {
      await assert.rejects(deleteObjects(keys), (error: unknown) => {
        assert.ok(error instanceof ObjectDeletionError);
        assert.equal(error.confirmedDeleted, 0);
        return true;
      });
    }
    assert.equal(send.mock.callCount(), 0);
  } finally { send.mock.restore(); }
});

test("malformed, duplicate, foreign, or contradictory acknowledgements fail closed", async () => {
  const responses = [
    null, {}, { $metadata: {} },
    { $metadata: { httpStatusCode: 500 }, Deleted: [{ Key: "test/a" }] },
    { $metadata: { httpStatusCode: 200 }, Deleted: "test/a" },
    { $metadata: { httpStatusCode: 200 }, Deleted: [null] },
    { $metadata: { httpStatusCode: 200 }, Deleted: [{ Key: "another-run/a" }] },
    { $metadata: { httpStatusCode: 200 }, Deleted: [{ Key: "test/a" }, { Key: "test/a" }] },
    { $metadata: { httpStatusCode: 200 }, Errors: [{ Key: "test/a" }, { Key: "test/a" }] },
    { $metadata: { httpStatusCode: 200 }, Deleted: [{ Key: "test/a" }], Errors: [{ Key: "test/a" }] },
    { $metadata: { httpStatusCode: 200 }, Deleted: [{ Key: "test/a" }], Errors: {} },
  ];
  for (const response of responses) {
    const send = mock.method(getR2Client(), "send", async () => response);
    try {
      await assert.rejects(deleteObjects(["test/a"]), (error: unknown) => {
        assert.ok(error instanceof ObjectDeletionError);
        assert.equal(error.confirmedDeleted, 0);
        assert.equal(error.requestedObjects, 1);
        return true;
      });
      assert.equal(send.mock.callCount(), 1);
    } finally { send.mock.restore(); }
  }
});

test("partial failure in a later batch preserves confirmed counts and stops remaining batches", async () => {
  const keys = Array.from({ length: 2001 }, (_, i) => `test/${i}`);
  let count = 0;
  const send = mock.method(getR2Client(), "send", async (command: unknown) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    const rows = command.input.Delete!.Objects!;
    count++;
    return { $metadata: { httpStatusCode: 200 }, Deleted: count === 1 ? rows : rows.slice(0, 2),
      Errors: count === 1 ? [] : rows.slice(2).map((row) => ({ ...row, Code: "AccessDenied" })) };
  });
  try {
    await assert.rejects(deleteObjects(keys), (error: unknown) => {
      assert.ok(error instanceof ObjectDeletionError);
      assert.equal(error.confirmedDeleted, 1002);
      assert.equal(error.requestedObjects, 2001);
      return true;
    });
    assert.equal(count, 2);
  } finally { send.mock.restore(); }
});

test("a lost response reports only earlier confirmed objects without leaking provider details", async () => {
  let count = 0;
  const send = mock.method(getR2Client(), "send", async (command: unknown) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    if (++count === 2) throw new Error("private-provider-body");
    return { $metadata: { httpStatusCode: 200 }, Deleted: command.input.Delete?.Objects };
  });
  try {
    await assert.rejects(deleteObjects(Array.from({ length: 2001 }, (_, i) => `test/${i}`)), (error: unknown) => {
      assert.ok(error instanceof ObjectDeletionError);
      assert.equal(error.confirmedDeleted, 1000);
      assert.equal(error.requestedObjects, 2001);
      assert.doesNotMatch(error.message, /private-provider-body/);
      return true;
    });
    assert.equal(count, 2);
  } finally { send.mock.restore(); }
});

test("an empty deletion acknowledgement cannot stand in for object-level success", async () => {
  const send = mock.method(getR2Client(), "send", async () => ({ $metadata: { httpStatusCode: 200 } }));
  try {
    await assert.rejects(deleteObjects(["test/a"]), /delet/i);
  } finally {
    send.mock.restore();
  }
});

test("every batch needs current authority; revocation stops later requests and preserves earlier counts", async () => {
  const events: string[] = [];
  let checks = 0;
  const send = mock.method(getR2Client(), "send", async (command: unknown, options: { abortSignal: AbortSignal }) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    assert.ok(options.abortSignal instanceof AbortSignal);
    events.push("delete");
    return { $metadata: { httpStatusCode: 200 }, Deleted: command.input.Delete?.Objects };
  });
  try {
    await assert.rejects(deleteObjects(Array.from({ length: 2001 }, (_, i) => `test/${i}`), undefined, {
      beforeBatch: async () => {
        events.push("authorize");
        if (++checks === 2) throw new Error("private authority detail");
        return { expiresAt: Date.now() + 60_000 };
      },
    }), (error: unknown) => {
      assert.ok(error instanceof ObjectDeletionError);
      assert.equal(error.confirmedDeleted, 1000);
      assert.doesNotMatch(error.message, /private authority detail/);
      return true;
    });
    assert.deepEqual(events, ["authorize", "delete", "authorize"]);
  } finally { send.mock.restore(); }
});

test("expired or invalid authority never sends an SDK request", async () => {
  const send = mock.method(getR2Client(), "send", async () => { throw new Error("must not send"); });
  try {
    for (const expiresAt of [0, Date.now() - 1, NaN, Infinity]) {
      await assert.rejects(deleteObjects(["test/a"], undefined, { beforeBatch: async () => ({ expiresAt }) }), /authority/);
    }
    assert.equal(send.mock.callCount(), 0);
  } finally { send.mock.restore(); }
});

test("the grant deadline aborts an in-flight SDK operation and its retries", async () => {
  const keepAlive = setTimeout(() => {}, 500);
  let signal: AbortSignal | undefined;
  const send = mock.method(getR2Client(), "send", async (_command: unknown, options: { abortSignal: AbortSignal }) => {
    signal = options.abortSignal;
    await new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
  });
  try {
    await assert.rejects(deleteObjects(["test/a"], undefined, {
      beforeBatch: async () => ({ expiresAt: Date.now() + 25 }),
    }), (error: unknown) => {
      assert.ok(error instanceof ObjectDeletionError);
      assert.equal(error.confirmedDeleted, 0);
      return true;
    });
    assert.equal(signal?.aborted, true);
  } finally { clearTimeout(keepAlive); send.mock.restore(); }
});
