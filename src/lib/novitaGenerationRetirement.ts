/** New Studio generation is staged through Render Engine. Historical receipt
 * reads and provider teardown retain their separate, explicit paths. */
export const NOVITA_GENERATION_RETIRED =
  "Direct Novita generation is retired; stage this request through Render Engine.";

export function rejectNewNovitaGeneration(): void {
  throw new Error(NOVITA_GENERATION_RETIRED);
}
