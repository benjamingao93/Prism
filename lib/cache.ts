/** Minimal in-memory TTL + LRU cache. Process-local; cleared on restart. */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

/** Survive dev-server hot reloads by parking caches on globalThis. */
export function globalCache<V>(name: string, maxEntries: number, ttlMs: number): TtlCache<V> {
  const g = globalThis as unknown as { __babelCaches?: Map<string, TtlCache<unknown>> };
  g.__babelCaches ??= new Map();
  let cache = g.__babelCaches.get(name) as TtlCache<V> | undefined;
  if (!cache) {
    cache = new TtlCache<V>(maxEntries, ttlMs);
    g.__babelCaches.set(name, cache as TtlCache<unknown>);
  }
  return cache;
}
