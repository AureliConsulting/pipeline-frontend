import { z } from "zod";
import { finalApprovalSchema } from "@aureli/shared";
import { ApiError, handled, json, parseBody, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedRun, runStatusOf, transitionRun } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/runs/[id]/final
 * Final checkpoint. Either complete the run (no upload), or approve the
 * optional Instantly upload. The upload approval:
 *  - requires the user to re-type the campaign title and lead count,
 *  - is idempotent: instantly_uploads has UNIQUE(run_id) and a client
 *    idempotency key, so repeated clicks/network retries can never create a
 *    second upload.
 * The actual upload is performed by the LOCAL runner with the locally stored
 * Instantly key — never by this server.
 */
export const POST = handled(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid run id");
  const input = await parseBody(request, finalApprovalSchema);
  const admin = createSupabaseAdminClient();
  const run = await getOwnedRun(admin, user.id, id);
  const status = runStatusOf(run);
  if (status !== "awaiting_final_approval") {
    throw new ApiError(409, `Run is not awaiting final approval (status: ${status})`);
  }

  if (input.action === "complete") {
    const warnings = (run.warnings as string[] | null) ?? [];
    await transitionRun(
      admin,
      id,
      status,
      warnings.length > 0 ? "completed_with_warnings" : "completed",
      { completed_at: new Date().toISOString() },
    );
    await decideFinalApproval(admin, id, user.id, { action: "complete" });
    return json({ ok: true, action: "complete" });
  }

  // approve_instantly — verify the typed confirmation against reality.
  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, title, user_id")
    .eq("id", String(run.campaign_id))
    .maybeSingle();
  if (!campaign || campaign.user_id !== user.id) throw new ApiError(404, "Campaign not found");
  if (input.confirm_title.trim() !== String(campaign.title).trim()) {
    throw new ApiError(422, "Confirmation failed: campaign title does not match");
  }
  const { data: readyArtifact } = await admin
    .from("artifacts")
    .select("id, row_count")
    .eq("run_id", id)
    .eq("artifact_type", "instantly_ready_csv")
    .maybeSingle();
  if (!readyArtifact) {
    throw new ApiError(409, "No Instantly-ready CSV was produced by this run");
  }
  const expected = readyArtifact.row_count ?? 0;
  if (input.confirm_lead_count !== expected) {
    throw new ApiError(422, `Confirmation failed: lead count is ${expected}, you typed ${input.confirm_lead_count}`);
  }

  // Idempotent creation. If a row already exists for this run, reuse it.
  const { data: existing } = await admin
    .from("instantly_uploads")
    .select("*")
    .eq("run_id", id)
    .maybeSingle();
  if (existing) {
    if (existing.status === "completed") {
      return json({ ok: true, action: "approve_instantly", upload: existing, deduplicated: true });
    }
    // Re-approve a failed upload (same row, same idempotency key).
    await admin
      .from("instantly_uploads")
      .update({ status: "approved", error: null })
      .eq("id", existing.id);
  } else {
    const { error: insertError } = await admin.from("instantly_uploads").insert({
      run_id: id,
      user_id: user.id,
      status: "approved",
      idempotency_key: input.idempotency_key,
      list_id: input.list_id,
      lead_count: expected,
      confirmation: {
        title: input.confirm_title,
        lead_count: input.confirm_lead_count,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      },
    });
    if (insertError) {
      // Unique violation = concurrent duplicate click; treat as success.
      const { data: raced } = await admin
        .from("instantly_uploads")
        .select("*")
        .eq("run_id", id)
        .maybeSingle();
      if (!raced) throw new ApiError(500, "Could not record upload approval");
    }
  }

  await transitionRun(admin, id, status, "uploading_to_instantly", {
    next_stage: "instantly_upload",
  });
  await decideFinalApproval(admin, id, user.id, {
    action: "approve_instantly",
    list_id: input.list_id,
  });
  return json({ ok: true, action: "approve_instantly" });
});

async function decideFinalApproval(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  runId: string,
  userId: string,
  decision: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("approval_requests")
    .update({
      status: "decided",
      decision: { ...decision, decided_by: userId },
      decided_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .eq("kind", "final")
    .eq("status", "pending");
}
