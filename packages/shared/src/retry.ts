import { PROTOCOL } from "./protocol";

/**
 * Retry policy shared conceptually with the runner (runner/aureli_runner/retry.py
 * implements the same rules; tests on both sides pin the same vectors).
 *
 * Transient errors: automatic retries with exponential backoff + jitter,
 * up to max_automatic_attempts. Permanent errors (bad credentials, malformed
 * CSV, invalid YAML, 4xx validation responses) are never auto-retried.
 */

export type ErrorClass = "transient" | "permanent";

const PERMANENT_MARKERS = [
  "invalid api key",
  "invalid credentials",
  "unauthorized",
  "forbidden",
  "payment required",
  "invalid yaml",
  "invalid json",
  "malformed csv",
  "missing required column",
  "validation error",
  "schema violation",
];

const TRANSIENT_MARKERS = [
  "timeout",
  "timed out",
  "temporarily unavailable",
  "connection reset",
  "connection refused",
  "rate limit",
  "too many requests",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "econnreset",
  "socket hang up",
];

export function classifyError(message: string, httpStatus?: number): ErrorClass {
  if (httpStatus !== undefined) {
    if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return "transient";
    if (httpStatus >= 400 && httpStatus < 500) return "permanent";
  }
  const lower = message.toLowerCase();
  if (PERMANENT_MARKERS.some((m) => lower.includes(m))) return "permanent";
  if (TRANSIENT_MARKERS.some((m) => lower.includes(m))) return "transient";
  // Unknown errors default to transient so a flaky network never permanently
  // fails a paid run before the attempt budget is exhausted.
  return "transient";
}

export interface RetryDecision {
  retry: boolean;
  delaySeconds: number;
  attempt: number;
}

/**
 * @param attempt 1-based attempt number that just failed.
 * @param random  injectable RNG in [0,1) for deterministic tests.
 */
export function nextRetry(
  attempt: number,
  errorClass: ErrorClass,
  random: () => number = Math.random,
): RetryDecision {
  const { max_automatic_attempts, base_delay_seconds, max_delay_seconds, jitter_fraction } =
    PROTOCOL.retry_policy;
  if (errorClass === "permanent" || attempt >= max_automatic_attempts) {
    return { retry: false, delaySeconds: 0, attempt };
  }
  const exp = base_delay_seconds * 2 ** (attempt - 1);
  const capped = Math.min(exp, max_delay_seconds);
  const jitter = capped * jitter_fraction * (random() * 2 - 1);
  return {
    retry: true,
    delaySeconds: Math.max(0.5, Math.round((capped + jitter) * 10) / 10),
    attempt: attempt + 1,
  };
}
