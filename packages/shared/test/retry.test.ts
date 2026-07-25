import { describe, expect, it } from "vitest";
import { classifyError, nextRetry, PROTOCOL } from "../src";

describe("error classification", () => {
  it("permanent: credentials, validation, malformed input", () => {
    expect(classifyError("Invalid API key supplied")).toBe("permanent");
    expect(classifyError("401 unauthorized")).toBe("permanent");
    expect(classifyError("Invalid YAML: mapping expected")).toBe("permanent");
    expect(classifyError("missing required column: email")).toBe("permanent");
    expect(classifyError("anything", 422)).toBe("permanent");
  });
  it("transient: network, rate limits, 5xx", () => {
    expect(classifyError("connection reset by peer")).toBe("transient");
    expect(classifyError("Too Many Requests")).toBe("transient");
    expect(classifyError("anything", 503)).toBe("transient");
    expect(classifyError("anything", 429)).toBe("transient");
  });
  it("unknown errors default to transient (never permanently fail a paid run early)", () => {
    expect(classifyError("weird unknown failure")).toBe("transient");
  });
});

describe("backoff schedule", () => {
  const mid = () => 0.5; // zero jitter

  it("caps automatic attempts at the protocol maximum (3)", () => {
    expect(PROTOCOL.retry_policy.max_automatic_attempts).toBe(3);
    expect(nextRetry(1, "transient", mid).retry).toBe(true);
    expect(nextRetry(2, "transient", mid).retry).toBe(true);
    expect(nextRetry(3, "transient", mid).retry).toBe(false);
  });

  it("never retries permanent errors", () => {
    expect(nextRetry(1, "permanent", mid).retry).toBe(false);
  });

  it("doubles delay with jitter bounds (pinned vectors, mirrored in pytest)", () => {
    expect(nextRetry(1, "transient", mid).delaySeconds).toBe(5);
    expect(nextRetry(2, "transient", mid).delaySeconds).toBe(10);
    // jitter extremes: ±25%
    expect(nextRetry(1, "transient", () => 1).delaySeconds).toBeCloseTo(6.3, 1);
    expect(nextRetry(1, "transient", () => 0).delaySeconds).toBeCloseTo(3.8, 1);
  });
});
