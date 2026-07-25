import { handled, json, requireUser } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/runners — the user's paired runner devices (RLS-scoped). */
export const GET = handled(async () => {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("runner_devices")
    .select(
      "id, name, status, platform, runner_version, protocol_version, credential_report, last_connection_test_at, last_seen_at, paired_at, revoked_at",
    )
    .order("paired_at", { ascending: false });
  if (error) return json({ error: "Query failed" }, 500);
  return json({ runners: data ?? [] });
});
