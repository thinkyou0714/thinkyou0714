/**
 * Concurrency primitives for bulk / eval runs (roadmap #39): a bounded-concurrency work
 * pool with priority lanes, and a single-flight de-duplicator that coalesces identical
 * in-flight calls. Both are zero-dependency and independent of the client.
 */

interface Waiter {
  priority: number;
  resolve: () => void;
}

/**
 * Runs async tasks with at most `concurrency` in flight. Queued tasks are released
 * highest-priority-first (FIFO among equal priorities) so interactive work can jump ahead
 * of a long eval/bulk batch.
 */
export class WorkPool {
  private readonly concurrency: number;
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
  }

  async run<T>(task: () => Promise<T>, priority = 0): Promise<T> {
    if (this.active >= this.concurrency) {
      // Wait for a slot. We are woken by a hand-off (below), inheriting the freed slot —
      // so we must NOT increment `active` here, or two runners would share one slot.
      await new Promise<void>((resolve) => this.enqueue({ priority, resolve }));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      if (next)
        next.resolve(); // hand our slot directly to the next waiter (keep `active`)
      else this.active--; // no waiter: release the slot
    }
  }

  /** Map over items with the pool's concurrency limit; results preserve input order. */
  async map<I, O>(items: I[], fn: (item: I, index: number) => Promise<O>, priority = 0): Promise<O[]> {
    return Promise.all(items.map((item, index) => this.run(() => fn(item, index), priority)));
  }

  get activeCount(): number {
    return this.active;
  }

  get pending(): number {
    return this.waiters.length;
  }

  /** Insert keeping `waiters` sorted by descending priority, stable (FIFO) within a level. */
  private enqueue(waiter: Waiter): void {
    let i = 0;
    while (i < this.waiters.length && this.waiters[i].priority >= waiter.priority) i++;
    this.waiters.splice(i, 0, waiter);
  }
}

/**
 * Coalesces concurrent calls sharing a key into a single execution — the classic
 * single-flight / request-collapsing pattern. The in-flight entry is cleared once it
 * settles, so a later call with the same key re-executes.
 */
export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    // `Promise.resolve().then(task)` defers `task()` to a microtask, so even a SYNCHRONOUS
    // throw becomes a rejection of `promise` (not of `run`), and `set` below always runs
    // before the `finally` cleanup — otherwise a sync-throwing task would leave the key
    // stuck on a rejected promise forever.
    const promise = Promise.resolve()
      .then(task)
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inflight.size;
  }
}
