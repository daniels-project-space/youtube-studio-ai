import { priceModelUsage } from "./modelUsage";

export const ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES = 65_536;
export const ARRANGEMENT_COMPOSER_FRAMING_TOKENS = 1_024;
export const ARRANGEMENT_COMPOSER_MAX_OUTPUT_TOKENS = 6_000;

export interface ArrangementComposerAdmission {
  budgetUsd: number;
  stageBudgetUsd?: number;
  beforeDispatch?: () => Promise<void>;
}

/** Conservative reservation, never an observed charge or provider invoice. */
export function arrangementComposerReservation(model: string): number {
  const priced = priceModelUsage({
    provider: "openrouter", model, kind: "text",
    inputTokens: ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES + ARRANGEMENT_COMPOSER_FRAMING_TOKENS,
    outputTokens: ARRANGEMENT_COMPOSER_MAX_OUTPUT_TOKENS,
  });
  if (priced.unpricedReason || priced.costUsd === undefined || !Number.isFinite(priced.costUsd) || priced.costUsd < 0) {
    throw new Error(`arrangement composer reservation is unpriced: ${priced.unpricedReason ?? model}`);
  }
  return priced.costUsd;
}

export function assertArrangementComposerAdmission(model: string, admission: ArrangementComposerAdmission): void {
  const required = arrangementComposerReservation(model);
  if (!Number.isFinite(admission.budgetUsd) || admission.budgetUsd <= 0 ||
    admission.stageBudgetUsd === undefined || !Number.isFinite(admission.stageBudgetUsd) ||
    admission.stageBudgetUsd < required || admission.stageBudgetUsd > admission.budgetUsd) {
    throw new Error("arrangement composer requires a sufficient compiler stage budget within the run budget");
  }
}

export function assertArrangementComposerInput(prompt: string, system: string): void {
  const encoder = new TextEncoder();
  if (encoder.encode(prompt).byteLength + encoder.encode(system).byteLength > ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES) {
    throw new Error(`arrangement composer input exceeds ${ARRANGEMENT_COMPOSER_MAX_INPUT_BYTES} UTF-8 bytes; refusing truncation`);
  }
}
