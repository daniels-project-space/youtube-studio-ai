import { AsyncLocalStorage } from "node:async_hooks";

export type ModuleCritiqueReceipt = {
  label: string;
  scores: number[];
  passes: boolean[];
  fatalIterations: boolean[];
  issueCounts: number[];
  accepted: boolean;
  fatal: boolean;
  completed: boolean;
};

type CritiqueState = { receipts: ModuleCritiqueReceipt[] };
const storage = new AsyncLocalStorage<CritiqueState>();

export function createModuleCritiqueScope() {
  const state: CritiqueState = { receipts: [] };
  return {
    run<T>(fn: () => T): T {
      return storage.run(state, fn);
    },
    snapshot(): ModuleCritiqueReceipt[] {
      return state.receipts.map((receipt) => ({
        ...receipt,
        scores: [...receipt.scores],
        passes: [...receipt.passes],
        fatalIterations: [...receipt.fatalIterations],
        issueCounts: [...receipt.issueCounts],
      }));
    },
  };
}

export function recordModuleCritique(receipt: ModuleCritiqueReceipt): void {
  const state = storage.getStore();
  if (!state) return;
  state.receipts.push({
    ...receipt,
    label: receipt.label.trim().slice(0, 120),
    scores: [...receipt.scores],
    passes: [...receipt.passes],
    fatalIterations: [...receipt.fatalIterations],
    issueCounts: [...receipt.issueCounts],
  });
}
