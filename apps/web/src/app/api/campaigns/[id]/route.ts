import { z } from "zod";
import { handled, json, parseBody, requireUser, ApiError } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedCampaign } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

export const GET = handled(async (_request: Request, { params }: Params) => {
  await requireUser();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) throw new ApiError(400, "Invalid campaign id");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select(
      "*, pipeline_runs(*, run_stages(*), approval_requests(*), instantly_uploads(*)), campaign_configs(id, name, updated_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: "Query failed" }, 500);
  if (!data) throw new ApiError(404, "Campaign not found");
  return json({ campaign: data });
});

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const PATCH = handled(async (request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) throw new ApiError(400, "Invalid campaign id");
  const patch = await parseBody(request, patchSchema);
  const admin = createSupabaseAdminClient();
  await getOwnedCampaign(admin, user.id, id);
  const { data, error } = await admin
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) return json({ error: "Update failed" }, 500);
  return json({ campaign: data });
});
