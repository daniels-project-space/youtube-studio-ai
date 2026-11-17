export type PendingPrivateBenchmark = { requestKey: string; maximumCostUsd: number };

type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storageKey(channelId: string) {
  return `youtube-automation:private-benchmark:${channelId}`;
}

export function readPendingPrivateBenchmark(storage: RequestStorage, channelId: string): PendingPrivateBenchmark | null {
  const raw = storage.getItem(storageKey(channelId));
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The previous private request cannot be read. Check its status before starting another."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The previous private request is invalid. Check its status before starting another.");
  const { requestKey, maximumCostUsd } = value as Partial<PendingPrivateBenchmark>;
  if (typeof requestKey !== "string" || !requestKey || typeof maximumCostUsd !== "number" || !Number.isFinite(maximumCostUsd) || maximumCostUsd <= 0 || maximumCostUsd > 100) {
    throw new Error("The previous private request is invalid. Check its status before starting another.");
  }
  return { requestKey, maximumCostUsd };
}

export function preparePrivateBenchmark(storage: RequestStorage, channelId: string, maximumCostUsd: number, newKey: () => string): PendingPrivateBenchmark {
  const pending = readPendingPrivateBenchmark(storage, channelId);
  if (pending) {
    if (pending.maximumCostUsd !== maximumCostUsd) throw new Error("Retry the pending private request with its original cost ceiling first.");
    return pending;
  }
  const request = { requestKey: newKey(), maximumCostUsd };
  storage.setItem(storageKey(channelId), JSON.stringify(request));
  const saved = readPendingPrivateBenchmark(storage, channelId);
  if (!saved || saved.requestKey !== request.requestKey || saved.maximumCostUsd !== maximumCostUsd) throw new Error("Could not safely save the private request for retries.");
  return saved;
}

export function clearAcceptedPrivateBenchmark(storage: RequestStorage, channelId: string, requestKey: string): void {
  if (readPendingPrivateBenchmark(storage, channelId)?.requestKey === requestKey) storage.removeItem(storageKey(channelId));
}
