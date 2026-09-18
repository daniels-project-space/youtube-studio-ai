/**
 * Stops only the dedicated Qwen3-TTS OpenRelay VM after its worker has
 * atomically drained. The persistent 30 GB disk is retained by OpenRelay;
 * GPU billing stops and the next accepted Qwen request restarts this same VM.
 */
import { schedules } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import { OpenRelayVmClient } from "@/lib/openRelay";
import {
  drainOpenRelayQwenWorker,
  fetchOpenRelayQwenHealth,
  OPENRELAY_QWEN_IDLE_SECONDS,
  OPENRELAY_QWEN_VM_NAME,
} from "@/lib/openRelayQwen";

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimumLength) throw new Error(`${name} is missing or invalid`);
  return value;
}

function isPinnedQwenVm(vm: {
  name: string;
  public: boolean;
  gpuCount: number;
  gpuModelName: string;
  diskSizeGb: number;
}): boolean {
  return vm.name === OPENRELAY_QWEN_VM_NAME && !vm.public && vm.gpuCount === 1 &&
    vm.gpuModelName.includes("3090") && vm.diskSizeGb === 30;
}

export const openRelayQwenIdleReaper = schedules.task({
  id: "openrelay-qwen-idle-reaper",
  // A one-minute check means the externally observed 300-second idle ceiling
  // has at most one additional minute of provider billing before shutdown.
  cron: "* * * * *",
  maxDuration: 120,
  retry: { maxAttempts: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 20_000, factor: 2 },
  queue: { concurrencyLimit: 1 },
  run: async () => {
    const log = (message: string, extra?: Record<string, unknown>) =>
      console.log(`[openrelay-qwen-idle-reaper] ${message}`, extra ?? "");
    await bootstrapSecrets(log, {
      services: ["openrelay", "youtube"],
      required: [
        "OPENRELAY_API_KEY",
        "OPENRELAY_QWEN_VM_ID",
        "QWEN3_TTS_WORKER_URL",
        "QWEN3_TTS_WORKER_TOKEN",
      ],
    });

    const client = new OpenRelayVmClient({ apiKey: required("OPENRELAY_API_KEY", 32) });
    const id = required("OPENRELAY_QWEN_VM_ID", 36);
    const vm = await client.getVm(id);
    if (!isPinnedQwenVm(vm)) {
      throw new Error("refusing to manage an OpenRelay VM outside the pinned private Qwen 3090 / 30 GB identity");
    }
    if (vm.status !== "running") return { action: "noop", reason: `vm_${vm.status}` };

    // No blind provider stop: an unavailable endpoint could be actively
    // rendering. The worker itself reports busy/idle state and rejects new
    // work before this task requests the provider stop.
    const health = await fetchOpenRelayQwenHealth();
    if (health.draining) {
      await client.stopVm(id);
      return { action: "stopped", reason: "previous_drain_recovered", idleSeconds: health.idleSeconds };
    }
    if (health.busy || health.idleSeconds < OPENRELAY_QWEN_IDLE_SECONDS) {
      return { action: "noop", reason: health.busy ? "busy" : "below_idle_threshold", idleSeconds: health.idleSeconds };
    }

    if (!(await drainOpenRelayQwenWorker())) {
      return { action: "noop", reason: "became_busy", idleSeconds: health.idleSeconds };
    }
    await client.stopVm(id);
    log("stopped drained persistent Qwen VM", { idleSeconds: health.idleSeconds });
    return { action: "stopped", reason: "idle_drained", idleSeconds: health.idleSeconds };
  },
});
