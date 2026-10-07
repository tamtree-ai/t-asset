/** Fixed-window rate limiting maths (the counters live in `studio_rate_limits`). */

export type LimitRule = { limit: number; windowMs: number };

/** The start of the window containing `now`. */
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/** Seconds until the window `count` fell in ends, for a Retry-After and "try again in 12 minutes". */
export function retryAfterSeconds(now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStart(now, windowMs) + windowMs - now) / 1000));
}

export function minutesLabel(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "a minute" : `${m} minutes`;
}

export const RULES = {
  /** Five wrong passcodes per IP and share lock the gate for the rest of a 15-minute window. */
  gate: { limit: 5, windowMs: 15 * 60 * 1000 },
  /** The same for the owner's password, per address. */
  signin: { limit: 5, windowMs: 15 * 60 * 1000 },
  comment: { limit: 30, windowMs: 60 * 1000 },
  identify: { limit: 10, windowMs: 60 * 60 * 1000 },
  decide: { limit: 10, windowMs: 60 * 1000 },
} satisfies Record<string, LimitRule>;
