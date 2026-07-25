import { z } from "zod";
import { PROTOCOL } from "./protocol";
import { isSalesNavigatorSearchUrl } from "./csv";

/** Zod schemas for every API payload. Server routes must parse with these. */

export const inputTypeSchema = z.enum(["csv", "sales_navigator"]);
export type InputType = z.infer<typeof inputTypeSchema>;

export const createCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().default(""),
    input_type: inputTypeSchema,
    max_leads: z
      .number()
      .int()
      .min(1)
      .max(PROTOCOL.limits.max_leads_per_run),
  })
  .strict();

export const salesNavigatorSourceSchema = z
  .object({
    url: z
      .string()
      .max(4000)
      .refine(isSalesNavigatorSearchUrl, {
        message:
          "Must be a LinkedIn Sales Navigator search or list URL (https://www.linkedin.com/sales/search/... or /sales/lists/...).",
      }),
    requested_limit: z.number().int().min(1).max(PROTOCOL.limits.max_leads_per_run),
  })
  .strict();

export const prepareUploadSchema = z
  .object({
    file_name: z.string().min(1).max(255),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(PROTOCOL.limits.max_csv_upload_bytes),
  })
  .strict();

export const completeUploadSchema = z
  .object({
    storage_path: z.string().min(1).max(1024),
  })
  .strict();

export const saveConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    yaml_text: z.string().min(1).max(PROTOCOL.limits.max_yaml_bytes),
    campaign_id: z.string().uuid().nullish(),
  })
  .strict();

export const createRunSchema = z
  .object({
    campaign_id: z.string().uuid(),
    config_id: z.string().uuid(),
    mock: z.boolean().default(false),
    source: z.discriminatedUnion("type", [
      z.object({ type: z.literal("csv"), artifact_id: z.string().uuid() }).strict(),
      z
        .object({
          type: z.literal("sales_navigator"),
          url: salesNavigatorSourceSchema.shape.url,
          requested_limit: z.number().int().min(1).max(PROTOCOL.limits.max_leads_per_run),
        })
        .strict(),
    ]),
  })
  .strict();

export const stageOneApprovalSchema = z
  .object({
    action: z.enum(["approve", "retry_failed", "cancel"]),
  })
  .strict();

export const failureDecisionSchema = z
  .object({
    action: z.enum(PROTOCOL.failure_decisions),
  })
  .strict();

export const finalApprovalSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete") }).strict(),
  z
    .object({
      action: z.literal("approve_instantly"),
      /** Explicit confirmation: user re-types campaign title and lead count. */
      confirm_title: z.string().min(1),
      confirm_lead_count: z.number().int().nonnegative(),
      list_id: z.string().trim().min(1).max(200),
      /** Client-generated idempotency key so repeated clicks cannot double-upload. */
      idempotency_key: z.string().uuid(),
    })
    .strict(),
]);

/* ---------------------------- runner endpoints ---------------------------- */

export const pairRequestSchema = z
  .object({
    code: z.string().regex(/^[A-Z2-7]{8}$/, "Pairing code is 8 characters (A-Z, 2-7)."),
    runner_name: z.string().trim().min(1).max(100),
    platform: z.string().trim().max(50),
    runner_version: z.string().trim().max(50),
    protocol_version: z.string().trim().max(20),
  })
  .strict();

const credentialStatus = z.enum(PROTOCOL.credential_statuses);

export const heartbeatSchema = z
  .object({
    active_run_id: z.string().uuid().nullable(),
    runner_version: z.string().max(50),
    protocol_version: z.string().max(20),
    /** Status only — never values. Keys are credential names, e.g. EXA_API_KEY. */
    credentials: z.record(credentialStatus).refine(
      (record) => Object.keys(record).every((k) => /^[A-Z][A-Z0-9_]{2,64}$/.test(k)),
      { message: "Credential keys must be env-var style names." },
    ),
    last_connection_test_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const claimRequestSchema = z
  .object({
    protocol_version: z.string().max(20),
    /** When resuming, the runner asks for a specific run it already claimed. */
    resume_run_id: z.string().uuid().nullish(),
  })
  .strict();

export const stageCompleteSchema = z
  .object({
    stage: z.enum(PROTOCOL.stages),
    outcome: z.enum(["completed", "failed", "cancelled"]),
    counts: z
      .object({
        total_submitted: z.number().int().nonnegative().nullish(),
        discovered: z.number().int().nonnegative().nullish(),
        verified: z.number().int().nonnegative().nullish(),
        catch_all: z.number().int().nonnegative().nullish(),
        invalid: z.number().int().nonnegative().nullish(),
        duplicate: z.number().int().nonnegative().nullish(),
        rejected: z.number().int().nonnegative().nullish(),
        failed: z.number().int().nonnegative().nullish(),
        manual_review: z.number().int().nonnegative().nullish(),
        successful: z.number().int().nonnegative().nullish(),
        retried: z.number().int().nonnegative().nullish(),
        scored: z.number().int().nonnegative().nullish(),
        personalized: z.number().int().nonnegative().nullish(),
        send_ready: z.number().int().nonnegative().nullish(),
      })
      .partial()
      .default({}),
    error: z.string().max(4000).nullish(),
    error_class: z.enum(["transient", "permanent"]).nullish(),
    warnings: z.array(z.string().max(1000)).max(50).default([]),
  })
  .strict();

export const registerArtifactSchema = z
  .object({
    artifact_type: z.enum(PROTOCOL.artifact_types),
    file_name: z.string().min(1).max(255),
    size_bytes: z.number().int().nonnegative(),
    row_count: z.number().int().nonnegative().nullish(),
    content_hash: z.string().max(128).nullish(),
    stage: z.enum(PROTOCOL.stages),
  })
  .strict();

export const instantlyProgressSchema = z
  .object({
    idempotency_key: z.string().uuid(),
    state: z.enum(["started", "completed", "failed"]),
    uploaded_count: z.number().int().nonnegative().nullish(),
    error: z.string().max(2000).nullish(),
  })
  .strict();

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
export type StageCompleteInput = z.infer<typeof stageCompleteSchema>;
