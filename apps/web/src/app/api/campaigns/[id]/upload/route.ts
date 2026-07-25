import { z } from "zod";
import {
  prepareUploadSchema,
  completeUploadSchema,
  validateLeadCsv,
  safeFileName,
  PROTOCOL,
} from "@aureli/shared";
import { ApiError, handled, json, parseBody, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ARTIFACTS_BUCKET,
  artifactStoragePath,
  getOwnedCampaign,
  signedUploadUrl,
} from "@/lib/runsService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

async function ensureDraftRun(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  campaignId: string,
): Promise<Record<string, unknown>> {
  const { data: existing } = await admin
    .from("pipeline_runs")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as Record<string, unknown>;
  const { data, error } = await admin
    .from("pipeline_runs")
    .insert({ user_id: userId, campaign_id: campaignId, status: "draft" })
    .select("*")
    .single();
  if (error || !data) throw new ApiError(500, "Could not create draft run");
  return data as Record<string, unknown>;
}

/**
 * POST — prepare a CSV upload: creates/reuses the campaign's draft run and
 * returns a short-lived signed upload URL scoped to the caller's own folder.
 * The file goes browser -> storage directly (Vercel body limits don't apply).
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: campaignId } = await params;
  if (!z.string().uuid().safeParse(campaignId).success) throw new ApiError(400, "Invalid id");
  const input = await parseBody(request, prepareUploadSchema);
  if (!/\.csv$/i.test(input.file_name)) {
    throw new ApiError(422, "Only .csv files are accepted");
  }
  const admin = createSupabaseAdminClient();
  const campaign = await getOwnedCampaign(admin, user.id, campaignId);
  if (campaign.input_type !== "csv") {
    throw new ApiError(409, "This campaign uses a Sales Navigator URL source");
  }
  const run = await ensureDraftRun(admin, user.id, campaignId);
  const path = artifactStoragePath(user.id, String(run.id), "stage_one", input.file_name);
  const upload = await signedUploadUrl(admin, path);
  return json({
    run_id: run.id,
    storage_path: upload.path,
    token: upload.token,
    signed_url: upload.signedUrl,
    max_bytes: PROTOCOL.limits.max_csv_upload_bytes,
  });
});

/**
 * PUT — complete an upload: server downloads the object, validates it against
 * the canonical schema, registers the source_csv artifact, and stores the
 * validation summary on the draft run. Runs are blocked until validation passes.
 */
export const PUT = handled(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id: campaignId } = await params;
  const { storage_path } = await parseBody(request, completeUploadSchema);
  const admin = createSupabaseAdminClient();
  const campaign = await getOwnedCampaign(admin, user.id, campaignId);
  const run = await ensureDraftRun(admin, user.id, campaignId);

  // Path must be inside this user's folder for this run (anti-traversal).
  const expectedPrefix = `${user.id}/${String(run.id)}/stage_one/`;
  if (!storage_path.startsWith(expectedPrefix) || storage_path.includes("..")) {
    throw new ApiError(403, "Storage path is outside your run workspace");
  }

  const { data: blob, error: dlError } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .download(storage_path);
  if (dlError || !blob) throw new ApiError(404, "Uploaded file not found in storage");
  if (blob.size > PROTOCOL.limits.max_csv_upload_bytes) {
    throw new ApiError(422, "File exceeds the size limit");
  }
  const text = await blob.text();
  const validation = validateLeadCsv(text, { maxRows: Number(campaign.max_leads) });

  const fileName = safeFileName(storage_path.split("/").pop() ?? "source.csv");
  const { data: artifact, error: artError } = await admin
    .from("artifacts")
    .upsert(
      {
        run_id: run.id,
        user_id: user.id,
        stage: "stage_one",
        artifact_type: "source_csv",
        file_name: fileName,
        storage_path,
        size_bytes: blob.size,
        row_count: validation.totalRows,
        verified: validation.ok,
      },
      { onConflict: "storage_path" },
    )
    .select("*")
    .single();
  if (artError || !artifact) throw new ApiError(500, "Could not register artifact");

  const summary = {
    ok: validation.ok,
    totalRows: validation.totalRows,
    missingRequired: validation.missingRequired,
    unexpectedColumns: validation.unexpectedColumns.slice(0, 30),
    duplicateRowCount: validation.duplicateRowCount,
    errors: validation.errors,
    warnings: validation.warnings,
  };
  await admin
    .from("pipeline_runs")
    .update({
      source: { type: "csv", artifact_id: artifact.id, validation: summary },
      lead_count: validation.totalRows,
    })
    .eq("id", run.id)
    .eq("user_id", user.id);

  return json({ run_id: run.id, artifact_id: artifact.id, validation: { ...summary, preview: validation.preview } });
});
