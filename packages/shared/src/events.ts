import { z } from "zod";
import { PROTOCOL } from "./protocol";

const severity = z.enum(PROTOCOL.event_severities);
const eventType = z.enum(PROTOCOL.event_types);
const stage = z.enum(PROTOCOL.stages);

/**
 * One structured runner event. `seq` is a per-run monotonic counter assigned
 * by the runner; the server enforces UNIQUE (run_id, seq), which makes batch
 * transmission idempotent under retries.
 */
export const runnerEventSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    stage,
    ts: z.string().datetime({ offset: true }),
    severity,
    event_type: eventType,
    message: z.string().max(2000),
    current_item: z.number().int().nonnegative().nullish(),
    total_items: z.number().int().nonnegative().nullish(),
    exa_query_count: z.number().int().nonnegative().nullish(),
    retry_count: z.number().int().nonnegative().nullish(),
    cost_usd: z.number().nonnegative().nullish(),
    metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).nullish(),
  })
  .strict();

export type RunnerEvent = z.infer<typeof runnerEventSchema>;

export const eventBatchSchema = z
  .object({
    events: z.array(runnerEventSchema).min(1).max(PROTOCOL.limits.event_batch_max),
  })
  .strict();

/** Patterns that must never appear in stored logs. Applied server-side as a backstop; the runner redacts first. */
const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey|authorization|bearer|token|secret|password|cookie)\s*[=:]\s*\S+/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const idx = match.search(/[=:]/);
      return idx > 0 ? `${match.slice(0, idx + 1)}[redacted]` : "[redacted]";
    });
  }
  return out;
}
