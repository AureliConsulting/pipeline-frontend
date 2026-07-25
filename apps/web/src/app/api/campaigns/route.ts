import { createCampaignSchema } from "@aureli/shared";
import { handled, json, parseBody, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/campaigns?search=&limit= — searchable list (title, trigram-indexed). */
export const GET = handled(async (request: Request) => {
  await requireUser();
  const supabase = await createSupabaseServerClient(); // RLS scopes to owner
  const url = new URL(request.url);
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  let query = supabase
    .from("campaigns")
    .select(
      "id, title, description, input_type, max_leads, created_at, updated_at, pipeline_runs(id, status, current_stage, lead_count, mock, created_at, updated_at)",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (search) {
    // Escape LIKE wildcards in user input.
    const escaped = search.replace(/[%_\\]/g, (c) => `\\${c}`);
    query = query.ilike("title", `%${escaped}%`);
  }
  const { data, error } = await query;
  if (error) return json({ error: "Query failed" }, 500);
  return json({ campaigns: data ?? [] });
});

/** POST /api/campaigns — create a campaign shell (step 1 of the wizard). */
export const POST = handled(async (request: Request) => {
  const user = await requireUser();
  const input = await parseBody(request, createCampaignSchema);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("campaigns")
    .insert({
      user_id: user.id,
      title: input.title,
      description: input.description,
      input_type: input.input_type,
      max_leads: input.max_leads,
    })
    .select("*")
    .single();
  if (error) return json({ error: "Could not create campaign" }, 500);
  return json({ campaign: data }, 201);
});
