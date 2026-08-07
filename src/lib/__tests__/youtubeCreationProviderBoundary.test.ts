import assert from "node:assert/strict";
import {
  executeYoutubeCreationProviderBoundary,
  YoutubeProviderBoundaryError,
} from "@/lib/youtubeCreationProviderBoundary";

type FakeStatus = "claimed" | "provider_started" | "ambiguous" | "recovery" | "created";

class SerializableFakeClaimStore {
  status: FakeStatus = "claimed";
  ytChannelId?: string;
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: () => T): Promise<T> {
    const prior = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      return operation();
    } finally {
      release();
    }
  }

  async markProviderStarted(): Promise<{ started: boolean; status: string }> {
    return await this.transaction(() => {
      if (this.status !== "claimed") return { started: false, status: this.status };
      this.status = "provider_started";
      return { started: true, status: this.status };
    });
  }

  async markAmbiguous(): Promise<void> {
    await this.transaction(() => {
      if (this.status === "provider_started" || this.status === "recovery") {
        this.status = "ambiguous";
      }
    });
  }

  async beginRecovery() {
    return await this.transaction(() => {
      if (this.status === "created") {
        return { action: "reuse" as const, receipt: this.ytChannelId! };
      }
      if (this.status === "recovery") return { action: "wait" as const };
      assert.equal(this.status, "ambiguous");
      this.status = "recovery";
      return { action: "recover" as const };
    });
  }

  async markCreated(channelId: string): Promise<string> {
    return await this.transaction(() => {
      assert.ok(
        this.status === "provider_started" || this.status === "recovery",
        `cannot complete from ${this.status}`,
      );
      this.status = "created";
      this.ytChannelId = channelId;
      return channelId;
    });
  }
}

async function main(): Promise<void> {
  const store = new SerializableFakeClaimStore();
  const providerChannelId = `UC${"p".repeat(22)}`;
  let providerCreateCalls = 0;
  let providerRecoveryReads = 0;

  const createAttempt = () => executeYoutubeCreationProviderBoundary({
    action: "create" as const,
    markProviderStarted: async () => await store.markProviderStarted(),
    createExact: async (checkpointProviderStarted): Promise<{ channelId?: string }> => {
      await checkpointProviderStarted();
      providerCreateCalls += 1;
      // The provider committed, then the response disappeared before the task
      // could return any receipt — the dangerous real-world failure window.
      throw new Error("simulated lost provider response after commit");
    },
    markCreated: async (proof) => await store.markCreated(proof.channelId!),
    markAmbiguous: async () => await store.markAmbiguous(),
  });

  // Even if two workers are incorrectly admitted with the same stale `create`
  // decision, the serializable provider-start checkpoint admits only one.
  const racingAttempts = await Promise.allSettled([createAttempt(), createAttempt()]);
  assert.equal(racingAttempts.filter((result) => result.status === "rejected").length, 2);
  const errors = racingAttempts.flatMap((result) =>
    result.status === "rejected" && result.reason instanceof YoutubeProviderBoundaryError
      ? [result.reason]
      : []);
  assert.equal(errors.length, 2);
  assert.equal(errors.filter((error) => error.providerStarted).length, 1);
  assert.equal(providerCreateCalls, 1, "the fake provider create operation must run exactly once");
  assert.equal(store.status, "ambiguous");

  const recovered = await executeYoutubeCreationProviderBoundary({
    action: "recover",
    beginRecovery: async () => await store.beginRecovery(),
    recoverExact: async () => {
      providerRecoveryReads += 1;
      return { channelId: providerChannelId, providerSessionId: "fake-recovery-session" };
    },
    markCreated: async (proof) => await store.markCreated(proof.channelId!),
    markAmbiguous: async () => await store.markAmbiguous(),
  });
  assert.equal(recovered.kind, "recovered");
  assert.equal(store.status, "created");
  assert.equal(store.ytChannelId, providerChannelId);
  assert.equal(providerCreateCalls, 1, "reconciliation must never call provider create");
  assert.equal(providerRecoveryReads, 1);

  const replay = await executeYoutubeCreationProviderBoundary({
    action: "recover",
    beginRecovery: async () => await store.beginRecovery(),
    recoverExact: async () => {
      providerRecoveryReads += 1;
      return { channelId: providerChannelId };
    },
    markCreated: async (proof) => await store.markCreated(proof.channelId!),
    markAmbiguous: async () => await store.markAmbiguous(),
  });
  assert.equal(replay.kind, "reuse");
  assert.equal(providerCreateCalls, 1);
  assert.equal(providerRecoveryReads, 1, "a durable receipt replay does not touch the provider");

  const happyStore = new SerializableFakeClaimStore();
  let happyProviderCreates = 0;
  const happy = await executeYoutubeCreationProviderBoundary({
    action: "create",
    markProviderStarted: async () => await happyStore.markProviderStarted(),
    createExact: async (checkpointProviderStarted) => {
      await checkpointProviderStarted();
      happyProviderCreates += 1;
      return { channelId: providerChannelId, providerSessionId: "fake-create-session" };
    },
    markCreated: async (proof) => await happyStore.markCreated(proof.channelId!),
    markAmbiguous: async () => await happyStore.markAmbiguous(),
  });
  assert.equal(happy.kind, "created");
  assert.equal(happyStore.status, "created");
  assert.equal(happyProviderCreates, 1);

  console.log("YouTube transactional fake-provider boundary passed");
}

void main();
