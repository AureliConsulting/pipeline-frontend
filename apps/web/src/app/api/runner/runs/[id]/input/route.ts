import { z } from "zod";
import { ApiError, handled, json } from "@/lib/api";
import { requireRunner, requireRunnerRun } from "@/lib/runnerAuth";
import { signedDownloadUrl } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/runner/runs/[id]/input — short-lived signed URLs for the run's
 * inputs (source CSV when present) plus the configuration payload. Ownership
 * verified server-side; URLs expire in 10 minutes.
 */
export const GET = handled(async (request: Request, { params }: Params) => {
  const { runner, admin } = await requireRunner(request);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const run = await requireRunnerRun(admin, runner, id);
  if (run.claimed_by !== runner.id) {
    throw new ApiError(409, "Run is not claimed by this runner", "not_claimed");
  }

  const source = (run.source ?? {}) as Record<string, unknown>;
  let sourceCsvUrl: string | null = null;
  let sourceFileName: string | null = null;
  if (source.type === "csv" && typeof source.artifact_id === "string") {
    const { data: artifact } = await admin
      .from("artifacts")
      .select("storage_path, file_name, user_id")
      .eq("id", source.artifact_id)
      .maybeSingle();
    if (artifact && artifact.user_id === runner.user_id) {
      sourceCsvUrl = await signedDownloadUrl(admin, String(artifact.storage_path), 600);
      sourceFileName = String(artifact.file_name);
    }
  }

  const { data: config } = await admin
    .from("campaign_configs")
    .select("id, name, yaml_text, normalized_json, user_id")
    .eq("id", String(run.config_id))
    .maybeSingle();
  if (!config || config.user_id !== runner.user_id) {
    throw new ApiError(409, "Run has no valid configuration", "no_config");
  }

  const { data: campaign } = await admin
    .from("campaigns")
    .select("title, max_leads")
    .eq("id", String(run.campaign_id))
    .maybeSingle();

  return json({
    run_id: id,
    campaign_title: campaign?.title ?? "",
    max_leads: campaign?.max_leads ?? null,
    source: {
      type: source.type ?? null,
      url: source.url ?? null,
      requested_limit: source.requested_limit ?? null,
      csv_signed_url: sourceCsvUrl,
      csv_file_name: sourceFileName,
    },
    config: {
      id: config.id,
      name: config.name,
      yaml_text: config.yaml_text,
      normalized_json: config.normalized_json,
    },
    directive: run.directive ?? {},
    mock: run.mock === true,
  });
});
