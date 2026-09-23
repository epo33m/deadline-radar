/**
 * Run `fn` over `items` with at most `limit` executions in flight,
 * preserving result order. In-repo alternative to `p-limit` (no new
 * dependency): bounds network fan-out (Resend sends) below the postgres.js
 * pool ceiling so parallel sends + claims never starve the next batch fetch.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const workerCount = Math.min(Math.max(1, Math.floor(limit)), items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );
  return results;
}
