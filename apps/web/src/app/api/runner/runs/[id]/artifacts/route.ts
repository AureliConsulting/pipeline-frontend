import { z } from "zod";
import { registerArtifactSchema } from "@aureli/shared";
import { ApiError, handled, json, parseBody } from "@/lib/api";
import { requireRunner, requireRunnerRun } from "@/lib/runnerAuth";
import { artifactStoragePath, signedUploadUrl } from "@/lib/runsService";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runner/runs/[id]/artifacts — register an output artifact and get
 * a signed upload URL. The storage path is constructed server-side from
 * (owner, run, stage, safe name): a runner can never choose a path outside
 * its user's run workspace.
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const { runner, admin } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const run = await requireRunnerRun(admin, runner, id);
  if (run.claimed_by !== runner.id) {
    throw new ApiError(409, "Run is not claimed by this runner", "not_claimed");
  }
  const input = await parseBody(request, registerArtifactSchema);
  const path = artifactStoragePath(runner.user_id, id, input.stage, input.file_name);
  const upload = await signedUploadUrl(admin, path);

  const { data: artifact, error } = await admin
    .from("artifacts")
    .upsert(
      {
        run_id: id,
        user_id: runner.user_id,
        stage: input.stage,
        artifact_type: input.artifact_type,
        file_name: input.file_name,
        storage_path: path,
        size_bytes: input.size_bytes,
        row_count: input.row_count ?? null,
        content_hash: input.content_hash ?? null,
        verified: false, // set true by PATCH after upload completes
      },
      { onConflict: "storage_path" },
    )
    .select("*")
    .single();
  if (error || !artifact) throw new ApiError(500, "Could not register artifact", "internal");

  return json({
    artifact_id: artifact.id,
    storage_path: path,
    signed_url: upload.signedUrl,
    token: upload.token,
  });
});

const confirmSchema = z
  .object({
    artifact_id: z.string().uuid(),
    size_bytes: z.number().int().nonnegative(),
    content_hash: z.string().max(128).nullish(),
  })
  .strict();

/** PATCH — confirm an upload finished; marks the artifact verified. */
export const PATCH = handled(async (request: Request, { params }: Params) => {
  const { runner } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const input = await parseBody(request, confirmSchema);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("artifacts")
    .update({
      verified: true,
      size_bytes: input.size_bytes,
      content_hash: input.content_hash ?? null,
    })
    .eq("id", input.artifact_id)
    .eq("run_id", id)
    .eq("user_id", runner.user_id)
    .select("id");
  if (error) throw new ApiError(500, "Confirm failed", "internal");
  if (!data || data.length === 0) throw new ApiError(404, "Artifact not found", "not_found");
  return json({ ok: true });
});
