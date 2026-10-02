/**
 * Run `fn` over `items` with at most `bound` in flight. Unlike a naive
 * `Promise.all` (unbounded fan-out), no more than `bound` workers are ever
 * running — the "bound is the safety mechanism" for upstreams that rate
 * limit or stampede.
 *
 * Failure semantics: when a worker reports an error (via `isError`), no NEW
 * items are dispatched; already in-flight workers settle, and the first
 * (by dispatch index) failing result's index is returned. This preserves
 * the serial loop's stop-on-first-error behavior without leaving earlier
 * successes unaccounted for.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  bound: number,
  fn: (item: T, index: number) => Promise<R>,
  isError?: (result: R) => boolean,
): Promise<{ results: R[]; failureIndex?: number }> {
  const results: R[] = new Array(items.length);
  let failureIndex: number | undefined;
  let stop = false;
  let next = 0;

  const workerCount = Math.max(1, Math.min(bound, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length && !stop) {
      const index = next;
      next += 1;
      const result = await fn(items[index], index);
      results[index] = result;
      if (isError?.(result)) {
        stop = true;
        if (failureIndex === undefined || index < failureIndex) {
          failureIndex = index;
        }
      }
    }
  });

  await Promise.all(workers);
  return { results, failureIndex };
}
