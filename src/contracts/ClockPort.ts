/**
 * ClockPort
 * ---------
 * Abstracts "time" so orchestration + retry/backoff logic doesn't depend on Date.now()
 * (and so timing can be faked in tests / demos).
 *
 * Used for:
 * - measuring phase durations (metrics)
 * - backoff sleeps between retries
 * - timestamping logs / events
 */

export interface ClockPort {
  /** Current wall-clock time in milliseconds since Unix epoch. */
  nowMs(): number;

  /** Convenience timestamp for logs. */
  nowIso(): string;

  /** Sleep for a duration (ms). */
  sleep(ms: number): Promise<void>;
}

/**
 * RealClock
 * ---------
 * Default runtime implementation.
 * (Even in a non-runnable repo, this is harmless + self-contained.)
 */
export class RealClock implements ClockPort {
  nowMs(): number {
    return Date.now();
  }

  nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * FakeClock
 * ---------
 * Useful for deterministic tests, or for docs/examples that "simulate" time passing.
 */
export class FakeClock implements ClockPort {
  private t: number;

  constructor(startMs: number = 0) {
    this.t = startMs;
  }

  nowMs(): number {
    return this.t;
  }

  nowIso(): string {
    return new Date(this.t).toISOString();
  }

  async sleep(ms: number): Promise<void> {
    this.t += Math.max(0, ms);
  }

  /** Manually advance time without sleeping. */
  advance(ms: number): void {
    this.t += Math.max(0, ms);
  }

  /** Set an absolute time. */
  set(ms: number): void {
    this.t = ms;
  }
}
