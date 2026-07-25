import { heartbeatSchema, protocolWarning } from "@aureli/shared";
import { handled, json, parseBody } from "@/lib/api";
import { requireRunner } from "@/lib/runnerAuth";
import { enforceRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/runner/heartbeat — liveness + credential STATUS report.
 * Credential values never travel; the schema only admits status enums.
 */
export const POST = handled(async (request: Request) => {
  const { runner, admin } = await requireRunner(request);
  await enforceRateLimit(admin, `hb:${runner.id}`, 30, 60);
  const input = await parseBody(request, heartbeatSchema);

  await admin
    .from("runner_devices")
    .update({
      last_seen_at: new Date().toISOString(),
      runner_version: input.runner_version,
      protocol_version: input.protocol_version,
      credential_report: input.credentials,
      last_connection_test_at: input.last_connection_test_at,
    })
    .eq("id", runner.id);

  await admin.from("runner_heartbeats").insert({
    runner_device_id: runner.id,
    user_id: runner.user_id,
    active_run_id: input.active_run_id,
  });
  // Trim heartbeat history (keep the most recent 50 per device).
  const { data: old } = await admin
    .from("runner_heartbeats")
    .select("id")
    .eq("runner_device_id", runner.id)
    .order("created_at", { ascending: false })
    .range(50, 200);
  if (old && old.length > 0) {
    await admin
      .from("runner_heartbeats")
      .delete()
      .in("id", old.map((r) => r.id));
  }

  return json({
    ok: true,
    protocol_warning: protocolWarning(input.protocol_version),
  });
});
