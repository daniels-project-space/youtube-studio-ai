/** Bound retained-media I/O and drain started work before reporting failure. */
export async function forEachPreparedMedia<T>(
  items: readonly T[],
  visit: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        await visit(items[index], index);
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  }));
  if (failed) throw failure;
}
