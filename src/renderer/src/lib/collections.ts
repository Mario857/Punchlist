import { invariant } from './guards';

const MIN_CHUNK_SIZE = 1;

export function groupBy<TItem, TKey>(
  items: readonly TItem[],
  getKey: (item: TItem) => TKey,
): Map<TKey, TItem[]> {
  const groups = new Map<TKey, TItem[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Last item wins on a duplicate key, matching plain `Map.set` semantics. */
export function keyBy<TItem, TKey>(
  items: readonly TItem[],
  getKey: (item: TItem) => TKey,
): Map<TKey, TItem> {
  const result = new Map<TKey, TItem>();
  for (const item of items) result.set(getKey(item), item);
  return result;
}

export function chunk<TItem>(items: readonly TItem[], size: number): TItem[][] {
  invariant(size >= MIN_CHUNK_SIZE, `chunk size must be at least ${MIN_CHUNK_SIZE}, got ${size}`);

  const chunks: TItem[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
