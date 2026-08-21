import assert from "node:assert/strict";

import { artifactContract, validateArtifact } from "@/engine/artifactSchemas";
import type { StageContext } from "@/engine/types";
import {
  appendScriptSelfDedupCorpusEntry,
  assertLocalScriptSelfDedupPass,
  createLocalScriptLexicalCorpusEntry,
  evaluateLocalScriptSelfDedup,
  parseScriptSelfDedupCorpusDocument,
  serializeScriptSelfDedupCorpus,
} from "@/lib/scriptSelfDedup";
import {
  loadLocalScriptSelfDedupCorpus,
  localScriptSelfDedupIndexKey,
  originalityGate,
  runLocalScriptSelfDedup,
  saveLocalScriptSelfDedupCorpus,
  type LocalScriptSelfDedupLeaseArgs,
  type LocalScriptSelfDedupReservationAuthority,
} from "@/trigger/blocks/complianceBlocks";

const SCRIPT = "A small river changed course after the spring flood, reshaping the valley farms for decades.";

function reserve(
  corpus: ReturnType<typeof parseScriptSelfDedupCorpusDocument>,
  script = SCRIPT,
  runId = "run-first",
) {
  const evaluation = evaluateLocalScriptSelfDedup({
    script,
    corpus,
    corpusSource: corpus.entries.length ? "local_script_index" : "empty",
  });
  assert.equal(evaluation.receipt.checkStatus, "measured");
  assert.equal(evaluation.receipt.passesLexicalSelfDedup, true);
  return appendScriptSelfDedupCorpusEntry(corpus, createLocalScriptLexicalCorpusEntry({
    candidate: evaluation.candidate,
    runId,
    topic: "river history",
    recordedAtMs: 1_700_000_000_000,
  }));
}

function missingObject(): Error & { name: string } {
  return Object.assign(new Error("fixture object missing"), { name: "NoSuchKey" });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * This is a test double for the Convex transaction boundary. Each acquire is
 * synchronous from the caller's perspective, exactly as a single serialized
 * database mutation is; production uses `api.scriptSelfDedupLeases.*`.
 */
class InMemoryAtomicLeaseAuthority implements LocalScriptSelfDedupReservationAuthority {
  private holder: LocalScriptSelfDedupLeaseArgs | undefined;
  private readonly busySeen = deferred();

  async acquire(args: LocalScriptSelfDedupLeaseArgs) {
    if (!this.holder) {
      this.holder = { ...args };
      return { kind: "acquired" as const, leaseExpiresAt: 9_999_999 };
    }
    if (this.holder.leaseToken === args.leaseToken) {
      return { kind: "acquired" as const, leaseExpiresAt: 9_999_999 };
    }
    this.busySeen.resolve();
    return { kind: "busy" as const, retryAfterMs: 1 };
  }

  async renew(args: LocalScriptSelfDedupLeaseArgs): Promise<boolean> {
    return this.holder?.leaseToken === args.leaseToken && this.holder.runId === args.runId;
  }

  async release(args: LocalScriptSelfDedupLeaseArgs): Promise<boolean> {
    if (this.holder?.leaseToken !== args.leaseToken || this.holder.runId !== args.runId) return false;
    this.holder = undefined;
    return true;
  }

  async waitUntilBusy(): Promise<void> {
    await this.busySeen.promise;
  }
}

async function duplicateNarrationIsRejected(): Promise<void> {
  const firstCorpus = reserve(parseScriptSelfDedupCorpusDocument([]));
  const duplicate = evaluateLocalScriptSelfDedup({
    script: SCRIPT,
    corpus: firstCorpus,
    corpusSource: "local_script_index",
  });
  assert.equal(duplicate.receipt.checkStatus, "measured");
  assert.equal(duplicate.receipt.comparableCorpusEntries, 1);
  assert.equal(duplicate.receipt.highestLexicalShingleSimilarity, 1);
  assert.equal(duplicate.receipt.passesLexicalSelfDedup, false);
  assert.throws(() => assertLocalScriptSelfDedupPass(duplicate.receipt), /local lexical script self-dedup measured 100\.0% overlap/);
}

function receiptIsStableAndNarrowlyNamed(): void {
  const corpus = reserve(parseScriptSelfDedupCorpusDocument([]));
  const first = evaluateLocalScriptSelfDedup({
    script: "  A small river changed course after the spring flood, reshaping the valley farms for decades.  ",
    corpus,
    corpusSource: "local_script_index",
  }).receipt;
  const repeat = evaluateLocalScriptSelfDedup({
    script: "A small river changed course after the spring flood, reshaping the valley farms for decades.",
    corpus,
    corpusSource: "local_script_index",
  }).receipt;
  assert.deepEqual(first, repeat, "receipt data must be deterministic and must not contain a wall-clock timestamp");
  assert.equal(first.comparisonMethod, "lexical-shingle-jaccard/v1");
  assert.equal(first.passesLexicalSelfDedup, false);
  assert.ok(!("semanticSimilarity" in first), "a lexical receipt must not masquerade as semantic evidence");
  assert.ok(!("visualOriginality" in first), "a script receipt must not masquerade as visual evidence");

  const receiptArtifact = artifactContract("scriptSelfDedupReceipt");
  assert.equal(receiptArtifact.type, "LocalScriptSelfDedupReceipt");
  const passingReceipt = evaluateLocalScriptSelfDedup({
    script: "A mountain observatory recorded a new pattern in the winter constellations.",
    corpus,
    corpusSource: "local_script_index",
  }).receipt;
  assert.equal(passingReceipt.passesLexicalSelfDedup, true);
  assert.doesNotThrow(() => validateArtifact(receiptArtifact, passingReceipt));
  assert.throws(() => validateArtifact(receiptArtifact, first), /passesLexicalSelfDedup/,
    "a receipt that failed the comparison cannot be emitted as a successful gate artifact");
  assert.doesNotThrow(() => validateArtifact(artifactContract("originalityOk"), true));
  assert.throws(() => validateArtifact(artifactContract("originalityOk"), false));
}

async function legacyEntriesRemainVisibleButNonComparable(): Promise<void> {
  const legacy = [{
    ts: 1_600_000_000_000,
    runId: "legacy-run",
    topic: "legacy topic",
    vector: [0.1, 0.2, 0.3],
  }];
  const parsed = parseScriptSelfDedupCorpusDocument(legacy);
  assert.equal(parsed.comparableEntries.length, 0);
  assert.equal(parsed.legacyUnmeasuredEntries.length, 1);

  const measured = evaluateLocalScriptSelfDedup({
    script: SCRIPT,
    corpus: parsed,
    corpusSource: "legacy_embedding_index",
  }).receipt;
  assert.equal(measured.checkStatus, "measured");
  assert.equal(measured.comparableCorpusEntries, 0);
  assert.equal(measured.legacyUnmeasuredCorpusEntries, 1);
  assert.equal(measured.passesLexicalSelfDedup, true,
    "only the actually comparable lexical corpus is eligible for the local comparison");

  const migrated = reserve(parsed, "A different local script creates a measurable lexical corpus entry.", "run-migrated");
  const serialized = JSON.parse(serializeScriptSelfDedupCorpus(migrated)) as { entries: unknown[] };
  assert.deepEqual(serialized.entries[0], legacy[0], "legacy vectors must be retained verbatim rather than re-labeled as lexical evidence");
}

async function r2OwnedCorpusPathSupportsAFirstNormalUpload(): Promise<void> {
  const bytesByKey = new Map<string, Uint8Array>();
  const ctx = { keyPrefix: "owner/test/channel/river/" };
  const readObject = async (key: string): Promise<Uint8Array> => {
    const bytes = bytesByKey.get(key);
    if (!bytes) throw missingObject();
    return bytes;
  };
  const writeObject = async (key: string, body: Uint8Array): Promise<void> => {
    bytesByKey.set(key, body);
  };

  const initial = await loadLocalScriptSelfDedupCorpus(ctx, readObject);
  assert.equal(initial.source, "empty");
  const evaluation = evaluateLocalScriptSelfDedup({
    script: SCRIPT,
    corpus: initial.corpus,
    corpusSource: initial.source,
  });
  assert.equal(evaluation.receipt.checkStatus, "measured", "an empty/new corpus is a real local check, not a skipped pass");
  assert.equal(evaluation.receipt.passesLexicalSelfDedup, true);
  const next = appendScriptSelfDedupCorpusEntry(initial.corpus, createLocalScriptLexicalCorpusEntry({
    candidate: evaluation.candidate,
    runId: "run-r2-first",
    topic: "river history",
    recordedAtMs: 1_700_000_000_001,
  }));
  await saveLocalScriptSelfDedupCorpus(ctx, next, writeObject);
  assert.ok(bytesByKey.has(localScriptSelfDedupIndexKey(ctx)), "the measured entry must be persisted in the channel's R2-owned corpus");

  const reloaded = await loadLocalScriptSelfDedupCorpus(ctx, readObject);
  assert.equal(reloaded.source, "local_script_index");
  assert.equal(reloaded.corpus.comparableEntries.length, 1);
  assert.deepEqual(originalityGate.produces, ["originalityOk", "maxLexicalShingleSimilarity", "scriptSelfDedupReceipt"]);

  const gateBytes = new Map<string, Uint8Array>();
  const gateRead = async (key: string): Promise<Uint8Array> => {
    const bytes = gateBytes.get(key);
    if (!bytes) throw missingObject();
    return bytes;
  };
  const gateWrite = async (key: string, body: Uint8Array): Promise<void> => {
    gateBytes.set(key, body);
  };
  const gateContext: StageContext = {
    ownerId: "owner-test",
    runId: "run-gate-first",
    channelId: "channel-test",
    keyPrefix: ctx.keyPrefix,
    params: {},
    store: { narrationText: SCRIPT, topic: "river history" },
    budgetUsd: 0,
    log: () => {},
  };
  const gateAuthority = new InMemoryAtomicLeaseAuthority();
  const gateOutput = await runLocalScriptSelfDedup(gateContext, {
    readObject: gateRead,
    writeObject: gateWrite,
    now: () => 1_700_000_000_002,
    reservationAuthority: gateAuthority,
    createLeaseToken: () => "lease-gate-first",
  });
  assert.equal(gateOutput.originalityOk, true);
  assert.equal(gateOutput.scriptSelfDedupReceipt.checkStatus, "measured");
  assert.equal(gateOutput.scriptSelfDedupReceipt.corpusSource, "empty");
  await assert.rejects(
    runLocalScriptSelfDedup({ ...gateContext, runId: "run-gate-duplicate" }, {
      readObject: gateRead,
      writeObject: gateWrite,
      now: () => 1_700_000_000_003,
      reservationAuthority: gateAuthority,
      createLeaseToken: () => "lease-gate-duplicate",
    }),
    /local lexical script self-dedup measured 100\.0% overlap/,
    "the gate must reject an R2-corpus duplicate rather than return a false pass",
  );
  await assert.rejects(
    runLocalScriptSelfDedup({ ...gateContext, runId: "run-gate-r2-unavailable" }, {
      readObject: async () => {
        throw new Error("R2 fixture unavailable");
      },
      writeObject: gateWrite,
      reservationAuthority: gateAuthority,
      createLeaseToken: () => "lease-gate-unavailable",
    }),
    /could not read the local script self-dedup corpus/,
    "an unavailable corpus is not an empty corpus and must never become a successful originality decision",
  );
}

async function concurrentReservationsSerializeTheR2ReadCompareWriteWindow(): Promise<void> {
  const bytesByKey = new Map<string, Uint8Array>();
  const authority = new InMemoryAtomicLeaseAuthority();
  const firstWriteStarted = deferred();
  const allowFirstWrite = deferred();
  let writeCount = 0;
  const prefix = "owner/test/channel/concurrent/";
  const readObject = async (key: string): Promise<Uint8Array> => {
    const bytes = bytesByKey.get(key);
    if (!bytes) throw missingObject();
    return bytes;
  };
  const writeObject = async (key: string, body: Uint8Array): Promise<void> => {
    writeCount += 1;
    if (writeCount === 1) {
      firstWriteStarted.resolve();
      await allowFirstWrite.promise;
    }
    bytesByKey.set(key, body);
  };
  const base: Omit<StageContext, "runId"> = {
    ownerId: "owner-test",
    channelId: "channel-test",
    keyPrefix: prefix,
    params: {},
    store: { narrationText: SCRIPT, topic: "river history" },
    budgetUsd: 0,
    log: () => {},
  };
  const runtime = (leaseToken: string) => ({
    readObject,
    writeObject,
    reservationAuthority: authority,
    createLeaseToken: () => leaseToken,
    sleep: async () => await new Promise<void>((resolve) => setTimeout(resolve, 0)),
    now: () => 1_700_000_000_100,
  });

  const first = runLocalScriptSelfDedup({ ...base, runId: "run-concurrent-first" }, runtime("lease-first"));
  await firstWriteStarted.promise;
  const second = runLocalScriptSelfDedup({ ...base, runId: "run-concurrent-second" }, runtime("lease-second"));
  await authority.waitUntilBusy();
  allowFirstWrite.resolve();

  const firstOutput = await first;
  assert.equal(firstOutput.originalityOk, true);
  await assert.rejects(
    second,
    /local lexical script self-dedup measured 100\.0% overlap/,
    "the second concurrent run must re-read the persisted corpus after acquiring the durable channel lease",
  );
  const corpus = await loadLocalScriptSelfDedupCorpus({ keyPrefix: prefix }, readObject);
  assert.equal(corpus.corpus.comparableEntries.length, 1,
    "concurrent duplicate attempts must leave one reserved lexical corpus entry, not a last-write-wins overwrite");
}

async function main(): Promise<void> {
  await duplicateNarrationIsRejected();
  receiptIsStableAndNarrowlyNamed();
  await legacyEntriesRemainVisibleButNonComparable();
  await r2OwnedCorpusPathSupportsAFirstNormalUpload();
  await concurrentReservationsSerializeTheR2ReadCompareWriteWindow();
  console.log("Local script self-dedup tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
