import { createRunSchema, PROTOCOL } from "@aureli/shared";
import { ApiError, handled, json, parseBody, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedCampaign, transitionRun, runStatusOf } from "@/lib/runsService";

export const dynamic = "force-dynamic";

/**
 * POST /api/runs — finalize and queue a run (wizard step 4 "Start Pipeline").
 * CSV campaigns reuse the draft run created during upload; Sales Navigator
 * campaigns create the run here.
 */
export const POST = handled(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, createRunSchema);
  const admin = createSupabaseAdminClient();
  const campaign = await getOwnedCampaign(admin, user.id, input.campaign_id);

  // Config must exist and belong to the user.
  const { data: config } = await admin
    .from("campaign_configs")
    .select("id, user_id")
    .eq("id", input.config_id)
    .maybeSingle();
  if (!config || config.user_id !== user.id) throw new ApiError(404, "Configuration not found");

  let runId: string;
  let leadCount: number | null = null;
  let source: Record<string, unknown>;

  if (input.source.type === "csv") {
    if (campaign.input_type !== "csv") throw new ApiError(409, "Campaign input type is not CSV");
    // Artifact must belong to this user and be a validated source CSV.
    const { data: artifact } = await admin
      .from("artifacts")
      .select("id, run_id, user_id, artifact_type, verified, row_count")
      .eq("id", input.source.artifact_id)
      .maybeSingle();
    if (!artifact || artifact.user_id !== user.id || artifact.artifact_type !== "source_csv") {
      throw new ApiError(404, "Source CSV not found");
    }
    if (!artifact.verified) {
      throw new ApiError(422, "The uploaded CSV failed validation. Fix the file and re-upload.");
    }
    if ((artifact.row_count ?? 0) > Number(campaign.max_leads)) {
      throw new ApiError(422, "CSV exceeds the campaign's maximum lead count");
    }
    runId = String(artifact.run_id);
    leadCount = artifact.row_count ?? null;
    const { data: runRow } = await admin
      .from("pipeline_runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (!runRow || runRow.user_id !== user.id) throw new ApiError(404, "Run not found");
    if (runStatusOf(runRow as Record<string, unknown>) !== "draft") {
      throw new ApiError(409, "This upload already started a run");
    }
    source = (runRow.source as Record<string, unknown>) ?? { type: "csv", artifact_id: artifact.id };
  } else {
    if (campaign.input_type !== "sales_navigator") {
      throw new ApiError(409, "Campaign input type is not Sales Navigator");
    }
    if (input.source.requested_limit > Number(campaign.max_leads)) {
      throw new ApiError(422, "Requested limit exceeds the campaign's maximum lead count");
    }
    const { data: created, error } = await admin
      .from("pipeline_runs")
      .insert({
        user_id: user.id,
        campaign_id: campaign.id,
        status: "draft",
        source: {
          type: "sales_navigator",
          url: input.source.url,
          requested_limit: input.source.requested_limit,
        },
        lead_count: input.source.requested_limit,
      })
      .select("*")
      .single();
    if (error || !created) throw new ApiError(500, "Could not create run");
    runId = String(created.id);
    leadCount = input.source.requested_limit;
    source = created.source as Record<string, unknown>;
  }

  // Route to queued or awaiting_runner depending on runner liveness.
  const cutoff = new Date(
    Date.now() - PROTOCOL.limits.runner_offline_after_seconds * 1000,
  ).toISOString();
  const { data: liveRunners } = await admin
    .from("runner_devices")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .gte("last_seen_at", cutoff)
    .limit(1);
  const target = liveRunners && liveRunners.length > 0 ? "queued" : "awaiting_runner";

  await transitionRun(admin, runId, "draft", target, {
    config_id: input.config_id,
    mock: input.mock,
    next_stage: "stage_one",
    source,
    lead_count: leadCount,
    directive: {},
    allow_partial: input.allow_partial,
    fallback_rule_set_id: input.fallback_rule_set_id ?? campaign.fallback_rule_set_id ?? null,
  });

  // Pre-create stage rows for the progress UI.
  await admin.from("run_stages").upsert(
    [
      { run_id: runId, user_id: user.id, stage: "stage_one", status: "pending" },
      { run_id: runId, user_id: user.id, stage: "stage_two", status: "pending" },
      { run_id: runId, user_id: user.id, stage: "fallback_resolver", status: "pending" },
    ],
    { onConflict: "run_id,stage", ignoreDuplicates: true },
  );

  return json({ run_id: runId, status: target }, 201);
});
