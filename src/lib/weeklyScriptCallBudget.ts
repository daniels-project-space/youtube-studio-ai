import { AsyncLocalStorage } from "node:async_hooks";
import { priceModelUsage, type ModelUsageSummary } from "./modelUsage";

type Request = { model: string; prompt: string; system?: string; maxTokens: number };
type State = { execute: <T>(request: Request, call: () => Promise<T>) => Promise<T> };
const active = new AsyncLocalStorage<State>();

/** Estimate for local admission, not a provider-enforced price or token limit. */
export function weeklyScriptCallReservation(request: Request): number {
  const inputTokens = Buffer.byteLength(request.prompt, "utf8") + Buffer.byteLength(request.system ?? "", "utf8") + 4096;
  const priced = priceModelUsage({ provider: "openrouter", model: request.model, kind: "text", inputTokens, outputTokens: request.maxTokens });
  if (priced.costUsd === undefined || !Number.isFinite(priced.costUsd) || priced.costUsd <= 0 || priced.unpricedReason) throw new Error("weekly script call cannot be reserved with the configured model rates");
  return priced.costUsd;
}

/** A durable stage claim protects cross-worker replay; this ledger serializes its provider calls. */
export function createWeeklyScriptCallBudget(maximumCostUsd: number, usage: () => ModelUsageSummary) {
  if (!Number.isFinite(maximumCostUsd) || maximumCostUsd <= 0) throw new Error("weekly script budget must be positive and finite");
  let tail = Promise.resolve();
  let blocked: string | undefined;
  const checkUsage = () => {
    const current = usage();
    if (current.unpricedCalls > 0 || !Number.isFinite(current.costUsd) || current.costUsd < 0) throw new Error("weekly script has unpriced or invalid provider usage");
    if (current.costUsd > maximumCostUsd) throw new Error("weekly script provider usage exceeded its local allowance");
    return current;
  };
  const state: State = {
    async execute<T>(request: Request, call: () => Promise<T>): Promise<T> {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>(resolve => { unlock = resolve; });
      await previous;
      try {
        if (blocked) throw new Error(blocked);
        const before = checkUsage();
        const reserved = weeklyScriptCallReservation(request);
        if (before.costUsd + reserved > maximumCostUsd) throw new Error("weekly script allowance cannot reserve the next provider call");
        let result: T;
        try { result = await call(); } catch (error) {
          blocked = "weekly script provider outcome is incomplete; retain the stage claim for reconciliation";
          throw error;
        }
        const after = checkUsage();
        if (after.calls !== before.calls + 1) throw new Error("weekly script provider call has no unique accounting record");
        return result;
      } catch (error) {
        blocked ??= error instanceof Error ? error.message : "weekly script admission failed";
        throw error;
      } finally {
        unlock();
      }
    },
  };
  return {
    run: <T>(fn: () => Promise<T>) => active.run(state, fn),
    assertComplete: () => { if (blocked) throw new Error(blocked); checkUsage(); },
  };
}

export function admitWeeklyScriptCall<T>(request: Request, call: () => Promise<T>): Promise<T> {
  const state = active.getStore();
  return state ? state.execute(request, call) : call();
}
