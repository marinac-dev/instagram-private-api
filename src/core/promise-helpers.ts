import { IgResponseError } from '../errors';

/**
 * Runs `fn` and, when it fails with an {@link IgResponseError}, delegates the error to
 * `handler` — which may swallow it (e.g. transcode-pending 202 responses) or throw a
 * richer error. Any other error is rethrown untouched.
 *
 * Replaces the former `Bluebird.try(fn).catch(IgResponseError, handler)` pattern.
 */
export async function withIgResponseErrorHandler<T>(
  fn: () => Promise<T> | T,
  handler: (error: IgResponseError) => unknown,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof IgResponseError) {
      await handler(error);
      return undefined;
    }
    throw error;
  }
}

/**
 * Maps over items with a bounded number of concurrently running tasks.
 * Replaces `Bluebird.map(items, mapper, { concurrency })`.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
