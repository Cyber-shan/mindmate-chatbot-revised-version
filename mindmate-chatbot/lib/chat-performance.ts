/** Timings contain durations only, never conversation text or credentials. */
export class ChatTimings {
  private readonly startedAt = performance.now();
  private readonly durations = new Map<string, number>();

  elapsed(): number { return performance.now() - this.startedAt; }

  record(name: string, milliseconds: number = this.elapsed()): void {
    this.durations.set(name, Number(milliseconds.toFixed(1)));
  }

  async measure<T>(name: string, operation: () => PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try { return await operation(); }
    finally { this.record(name, performance.now() - start); }
  }

  snapshot(): Record<string, number> { return Object.fromEntries(this.durations); }

  header(): string {
    return [...this.durations].map(([name, duration]) => `${name};dur=${duration}`).join(", ");
  }
}
