/**
 * A size-bounded least-recently-used cache. Each entry has a cost (bytes
 * for file contents); the oldest entries are evicted once the total cost
 * exceeds the budget.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; cost: number }>();
  private total = 0;

  constructor(
    private readonly maxCost: number,
    private readonly costOf: (value: V) => number = () => 1,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    // Re-insert to mark as most recently used (Map keeps insertion order).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const cost = this.costOf(value);
    const existing = this.entries.get(key);
    if (existing) {
      this.total -= existing.cost;
      this.entries.delete(key);
    }
    if (cost > this.maxCost) {
      return;
    }
    this.entries.set(key, { value, cost });
    this.total += cost;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.maxCost) {
        break;
      }
      this.entries.delete(oldest);
      this.total -= entry.cost;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }
}
