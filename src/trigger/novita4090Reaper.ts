/**
 * Disposable Novita RTX 4090 safety net.
 *
 * This is intentionally independent of the studio automation toggle: a
 * paused channel must never leave a paid GPU behind.  Normal render code asks
 * for deletion in its `finally`; this schedule handles Trigger crashes, lost
 * provider responses, expired boot windows, and managed instances that have
 * no durable lease at all.
 */
import { schedules } from "@trigger.dev/sdk";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../convex/_generated/api";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { NovitaGpuApiClient, type NovitaManagedInstance } from "@/lib/novitaFleet";
import { waitForNovitaRenderPoll } from "@/lib/novitaPollWait";
import { requireInternalQuerySecret } from "@/lib/youtubeConnector";

const MANAGED_WORKER_NAME = /^yt-render-4090-[a-z0-9][a-z0-9-]{0,120}$/;
// Workers heartbeat every minute. Two missed heartbeats avoid racing a
// delayed update while bounding crash recovery to the shortest safe window.
const STALE_AFTER_MS = 2 * 60_000;
const REAP_LIMIT = 32;

interface ReapCandidate {
  leaseId: string;
  workerName: string;
  instanceId?: string;
  status: string;
  reason: string;
  createAttemptToken?: string;
  createDispatchedAt?: number;
}

function convexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

function providerClient(): NovitaGpuApiClient {
  const apiKey = process.env.NOVITA_API_KEY;
  if (!apiKey) throw new Error("NOVITA_API_KEY is not configured");
  return new NovitaGpuApiClient(apiKey);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown provider teardown error";
  return message.replace(/[\u0000-\u001f]/g, " ").slice(0, 1_000);
}

function uniqueInstanceIds(candidate: ReapCandidate, instances: NovitaManagedInstance[]): string[] {
  const ids = new Set<string>();
  if (candidate.instanceId) ids.add(candidate.instanceId);
  for (const instance of instances) {
    if (instance.name === candidate.workerName && MANAGED_WORKER_NAME.test(instance.name)) {
      ids.add(instance.id);
    }
  }
  return [...ids];
}

async function idsWithProviderAbsenceProof(args: {
  novita: NovitaGpuApiClient;
  candidate: ReapCandidate;
  initialInstances: NovitaManagedInstance[];
}): Promise<string[]> {
  const initialIds = uniqueInstanceIds(args.candidate, args.initialInstances);
  if (initialIds.length) return initialIds;

  if (args.candidate.createDispatchedAt !== undefined) {
    // Novita's documented create API exposes no provider idempotency/retrieve
    // endpoint. Once the external POST boundary was persisted, an empty name
    // listing is not a deletion receipt: a timed-out accepted create may still
    // materialize. Keep the lease visibly unverified until we can delete a
    // concrete provider id instead of lying that billing is closed.
    throw new Error("provider create was dispatched without a reconciled instance id; absence cannot verify teardown");
  }

  // No external POST was durably dispatched, so this is a safe reservation or
  // pre-create claim cleanup. Two complete, separated listings avoid closing
  // while a concurrent list/update is merely becoming visible.
  await waitForNovitaRenderPoll({
    milliseconds: 15_000,
    idempotencyKey: `novita-reaper:${args.candidate.workerName}:absence-proof`,
  });
  const laterInstances = await args.novita.listManagedInstances();
  return uniqueInstanceIds(args.candidate, laterInstances);
}

function teardownReceipt(args: {
  workerName: string;
  instanceIds: string[];
  now: number;
  source: "lease_reaper" | "orphan_reaper";
  reason: string;
}) {
  // This is deliberately a teardown attestation, not an invented usage cost.
  // Actual render billing remains the direct renderer's receipt; the only
  // claim here is that provider-side removal/absence was verified.
  return {
    version: "novita-worker-teardown/v1",
    source: args.source,
    workerName: args.workerName,
    instanceIds: args.instanceIds,
    reason: args.reason,
    verification: "provider-delete-verified-or-absent",
    verifiedAt: args.now,
  };
}

async function markCandidateDeletionUnverified(
  convex: ConvexHttpClient,
  secret: string,
  candidate: ReapCandidate,
  error: unknown,
): Promise<void> {
  await convex.mutation(api.novitaWorkerLeases.markDeletionUnverified, {
    secret,
    workerName: candidate.workerName,
    now: Date.now(),
    error: safeError(error),
  });
}

async function reapLeaseCandidate(args: {
  convex: ConvexHttpClient;
  novita: NovitaGpuApiClient;
  secret: string;
  candidate: ReapCandidate;
  providerInstances: NovitaManagedInstance[];
}): Promise<"deleted" | "unverified"> {
  const { convex, novita, secret, candidate, providerInstances } = args;
  // Persist the teardown intent first.  If this task dies during a provider
  // call, the next scheduled run sees `delete_requested` and retries.
  await convex.mutation(api.novitaWorkerLeases.requestDeletion, {
    secret,
    workerName: candidate.workerName,
    now: Date.now(),
    reason: candidate.reason,
  });

  try {
    const instanceIds = await idsWithProviderAbsenceProof({
      novita,
      candidate,
      initialInstances: providerInstances,
    });
    // deleteAndVerify is idempotent for a provider-side 404, which lets the
    // lease recover a lost create/bind response without guessing whether the
    // corresponding instance ever existed.
    for (const instanceId of instanceIds) {
      await novita.deleteAndVerify(instanceId);
    }
    const now = Date.now();
    await convex.mutation(api.novitaWorkerLeases.markDeletedVerified, {
      secret,
      workerName: candidate.workerName,
      now,
      billingReceipt: teardownReceipt({
        workerName: candidate.workerName,
        instanceIds,
        now,
        source: "lease_reaper",
        reason: candidate.reason,
      }),
    });
    return "deleted";
  } catch (error) {
    await markCandidateDeletionUnverified(convex, secret, candidate, error);
    return "unverified";
  }
}

async function reapUnleasedProviderWorker(args: {
  convex: ConvexHttpClient;
  novita: NovitaGpuApiClient;
  secret: string;
  instance: NovitaManagedInstance;
}): Promise<void> {
  // This deletion is deliberately limited to the exact name namespace whose
  // creation is controlled by this application.  Never sweep arbitrary Novita
  // account instances, even when a worker is stale.
  if (!MANAGED_WORKER_NAME.test(args.instance.name)) return;
  await args.novita.deleteAndVerify(args.instance.id);
  const now = Date.now();
  await args.convex.mutation(api.novitaWorkerLeases.recordOrphanDeletion, {
    secret: args.secret,
    workerName: args.instance.name,
    instanceId: args.instance.id,
    now,
    receipt: teardownReceipt({
      workerName: args.instance.name,
      instanceIds: [args.instance.id],
      now,
      source: "orphan_reaper",
      reason: "provider worker existed without an active durable lease",
    }),
  });
}

export const novita4090Reaper = schedules.task({
  id: "novita-4090-reaper",
  // Cost note (2026-08-17): every tick did an unconditional Convex query PLUS
  // a live Novita listManagedInstances() provider call, even when idle. A
  // cheap "skip the provider call if Convex has 0 candidates" pre-check was
  // considered and rejected: the provider listing below also drives the
  // ORPHAN sweep (an instance with NO Convex lease record at all, e.g. a
  // Trigger process that died before persisting anything -- see file header
  // comment). Convex has no signal for that case by definition, so gating on
  // "candidates.length === 0" would silently disable the orphan safety net.
  // Widened the cadence instead: 5 minutes still bounds an undetected GPU
  // leak to well under an hour, at 1/5th the invocation (and provider-call)
  // volume of the previous 1-minute cron.
  cron: "*/5 * * * *",
  maxDuration: 1_800,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 30_000, factor: 2 },
  // A provider delete can take several polls. Serializing this task prevents
  // concurrent schedules from racing the same instance and producing an
  // unverifiable receipt.
  queue: { concurrencyLimit: 1 },
  run: async () => {
    const log = (message: string, extra?: Record<string, unknown>) =>
      console.log(`[novita-4090-reaper] ${message}`, extra ?? "");
    await bootstrapSecrets(log, { required: ["NOVITA_API_KEY", "INTERNAL_QUERY_SECRET"] });

    const secret = requireInternalQuerySecret();
    const convex = convexClient();
    const novita = providerClient();
    const now = Date.now();
    const candidates = (await convex.query(api.novitaWorkerLeases.listReapCandidates, {
      secret,
      now,
      staleAfterMs: STALE_AFTER_MS,
      limit: REAP_LIMIT,
    })) as ReapCandidate[];

    // This provider-side listing is the second half of the safety contract:
    // it spots a worker whose Trigger process died before it persisted a lease.
    const providerInstances = (await novita.listManagedInstances()).filter((instance) =>
      MANAGED_WORKER_NAME.test(instance.name),
    );

    let deleted = 0;
    let deletionUnverified = 0;
    for (const candidate of candidates) {
      const result = await reapLeaseCandidate({
        convex,
        novita,
        secret,
        candidate,
        providerInstances,
      });
      if (result === "deleted") deleted++;
      else deletionUnverified++;
    }

    const candidateNames = new Set(candidates.map((candidate) => candidate.workerName));
    let orphaned = 0;
    let orphanDeletionUnverified = 0;
    for (const instance of providerInstances) {
      if (candidateNames.has(instance.name)) continue;
      const lease = await convex.query(api.novitaWorkerLeases.getByWorkerName, {
        secret,
        workerName: instance.name,
      });
      // An active lease is healthy unless it was already marked terminal.  The
      // latter is an invariant breach, so delete the remaining provider
      // resource rather than trusting a stale success record.
      if (lease && lease.status !== "deleted_verified") continue;
      try {
        await reapUnleasedProviderWorker({ convex, novita, secret, instance });
        orphaned++;
        log("removed orphaned managed worker", { workerName: instance.name });
      } catch (error) {
        orphanDeletionUnverified++;
        log("orphan deletion remains unverified", {
          workerName: instance.name,
          error: safeError(error),
        });
      }
    }

    const summary = {
      candidates: candidates.length,
      deleted,
      deletionUnverified,
      orphaned,
      orphanDeletionUnverified,
    };
    log("reconciliation complete", summary);
    return summary;
  },
});
