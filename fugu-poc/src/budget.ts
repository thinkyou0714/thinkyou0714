/**
 * Client-side spend guard (circuit breaker). Tracks accumulated USD cost and refuses
 * further requests once a configured limit would be exceeded. Zero dependencies.
 */

import { FuguBudgetError } from "./errors.ts";

export interface BudgetOptions {
  /** Hard limit in USD. */
  limitUsd: number;
  /** Called once when spend first crosses each ratio (default 0.5, 0.75, 0.9). */
  onWarn?: (spentUsd: number, limitUsd: number, ratio: number) => void;
  warnRatios?: number[];
}

export class BudgetGuard {
  readonly limitUsd: number;
  private spentUsd = 0;
  private readonly onWarn?: (spentUsd: number, limitUsd: number, ratio: number) => void;
  private readonly warnRatios: number[];
  private readonly warned = new Set<number>();

  constructor(options: BudgetOptions) {
    this.limitUsd = options.limitUsd;
    this.onWarn = options.onWarn;
    this.warnRatios = (options.warnRatios ?? [0.5, 0.75, 0.9]).slice().sort((a, b) => a - b);
  }

  get spent(): number {
    return this.spentUsd;
  }

  get remaining(): number {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }

  /** Throw if already over budget (optionally accounting for an estimated next cost). */
  check(estimatedUsd = 0): void {
    if (this.spentUsd + estimatedUsd > this.limitUsd) {
      throw new FuguBudgetError(
        `Budget exceeded: spent $${this.spentUsd.toFixed(4)}` +
          (estimatedUsd ? ` + est $${estimatedUsd.toFixed(4)}` : "") +
          ` > limit $${this.limitUsd.toFixed(4)}`,
      );
    }
  }

  /** Record actual spend after a request; fires warn callbacks at threshold crossings. */
  record(costUsd: number | undefined): void {
    if (!costUsd || costUsd <= 0) return;
    this.spentUsd += costUsd;
    const ratio = this.limitUsd > 0 ? this.spentUsd / this.limitUsd : Number.POSITIVE_INFINITY;
    for (const r of this.warnRatios) {
      if (ratio >= r && !this.warned.has(r)) {
        this.warned.add(r);
        this.onWarn?.(this.spentUsd, this.limitUsd, r);
      }
    }
  }
}
