import { z } from "zod";
import { ApiError, handled, json, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** POST /api/runners/[id]/revoke — immediately invalidates the runner token. */
export const POST = handled(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid runner id");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("runner_devices")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id) // ownership enforced in the write predicate
    .select("id");
  if (error) throw new ApiError(500, "Revoke failed");
  if (!data || data.length === 0) throw new ApiError(404, "Runner not found");
  return json({ ok: true });
});
