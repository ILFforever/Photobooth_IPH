/**
 * LRU (Least Recently Used) Cache implementation.
 * Automatically evicts oldest entries when capacity is reached.
 */

export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    if (maxSize <= 0) {
      throw new Error('maxSize must be greater than 0');
    }
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /** Get a value by key. Marks the entry as recently used. */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end (most recently used)
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /** Set a value. Evicts oldest entry if at capacity. */
  set(key: K, value: V): void {
    // Remove existing entry if present (will be re-added at end)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Evict oldest if at capacity
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  /** Check if a key exists. Does not update usage order. */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /** Remove a specific entry. */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Get current number of entries. */
  get size(): number {
    return this.cache.size;
  }

  /** Get all keys (ordered from least to most recently used). */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /** Get all values (ordered from least to most recently used). */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /** Get all entries as [key, value] pairs. */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}
