import { PROTOCOL, type RunStatus, type Stage } from "./protocol";

/**
 * Explicit run-state machine. Every server-side transition must go through
 * `canTransition` / `assertTransition`. The browser can never write statuses;
 * only API routes (session-authorized user actions) and runner routes
 * (runner-token-authorized) may request transitions, and both validate here.
 */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  draft: ["queued", "awaiting_runner", "cancelled"],
  awaiting_runner: [
    "queued",
    "stage_one_running",
    "stage_two_running",
    "fallback_resolver_running",
    "cancelled",
  ],
  queued: [
    "stage_one_running",
    "stage_two_running",
    "fallback_resolver_running",
    "awaiting_runner",
    "cancelled",
  ],
  stage_one_running: [
    "stage_one_retrying",
    "stage_one_failed",
    "awaiting_stage_one_approval",
    "cancelled",
  ],
  stage_one_retrying: [
    "stage_one_running",
    "stage_one_failed",
    "awaiting_stage_one_approval",
    "cancelled",
  ],
  stage_one_failed: ["queued", "cancelled"],
  awaiting_stage_one_approval: ["queued", "cancelled"],
  // stage_two's success edge advances to `queued` (next_stage=fallback_resolver),
  // not directly to awaiting_final_approval — the resolver runs automatically
  // as a mandatory third stage before the human final/Instantly checkpoint.
  stage_two_running: ["stage_two_retrying", "stage_two_failed", "queued", "cancelled"],
  stage_two_retrying: ["stage_two_running", "stage_two_failed", "queued", "cancelled"],
  stage_two_failed: ["queued", "cancelled"],
  fallback_resolver_running: [
    "fallback_resolver_retrying",
    "fallback_resolver_failed",
    "awaiting_final_approval",
    "cancelled",
  ],
  fallback_resolver_retrying: [
    "fallback_resolver_running",
    "fallback_resolver_failed",
    "awaiting_final_approval",
    "cancelled",
  ],
  fallback_resolver_failed: ["queued", "cancelled"],
  awaiting_final_approval: [
    "uploading_to_instantly",
    "completed",
    "completed_with_warnings",
    "cancelled",
  ],
  uploading_to_instantly: ["completed", "completed_with_warnings", "awaiting_final_approval"],
  completed: [],
  completed_with_warnings: [],
  cancelled: [],
};

export function isRunStatus(value: string): value is RunStatus {
  return (PROTOCOL.run_statuses as readonly string[]).includes(value);
}

export function isTerminal(status: RunStatus): boolean {
  return (PROTOCOL.terminal_statuses as readonly string[]).includes(status);
}

export function isClaimable(status: RunStatus): boolean {
  return (PROTOCOL.claimable_statuses as readonly string[]).includes(status);
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: RunStatus,
    public readonly to: RunStatus,
  ) {
    super(`Invalid run transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** The stage a runner should execute when it claims a run in the given state. */
export function stageForClaim(status: RunStatus, nextStage: Stage | null): Stage | null {
  if (!isClaimable(status)) return null;
  return nextStage ?? "stage_one";
}

/** Statuses in which the user may cancel the run. */
export function isCancellable(status: RunStatus): boolean {
  return !isTerminal(status) && status !== "uploading_to_instantly";
}

/** Human-readable labels for the UI. Keys are exhaustive over RunStatus. */
export const STATUS_LABELS: Record<RunStatus, string> = {
  draft: "Draft",
  awaiting_runner: "Awaiting runner",
  queued: "Queued",
  stage_one_running: "Sourcing & verification",
  stage_one_retrying: "Sourcing (retrying)",
  stage_one_failed: "Sourcing failed",
  awaiting_stage_one_approval: "Awaiting stage-one approval",
  stage_two_running: "Scoring & personalization",
  stage_two_retrying: "Scoring (retrying)",
  stage_two_failed: "Scoring failed",
  fallback_resolver_running: "Resolving fallbacks",
  fallback_resolver_retrying: "Resolving fallbacks (retrying)",
  fallback_resolver_failed: "Fallback resolution failed",
  awaiting_final_approval: "Awaiting final approval",
  uploading_to_instantly: "Uploading to Instantly",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  cancelled: "Cancelled",
};
