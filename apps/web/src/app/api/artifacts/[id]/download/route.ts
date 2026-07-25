import { z } from "zod";
import { ApiError, handled, json, requireUser } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { signedDownloadUrl } from "@/lib/runsService";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/artifacts/[id]/download
 * Server-side ownership check, then a short-lived signed URL (5 minutes).
 * 404 for anything not owned — existence of other users' artifacts is never
 * revealed.
 */
export const GET = handled(async (_request: Request, { params }: Params) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid artifact id");
  const admin = createSupabaseAdminClient();
  const { data: artifact, error } = await admin
    .from("artifacts")
    .select("id, user_id, storage_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(500, "Lookup failed");
  if (!artifact || artifact.user_id !== user.id) throw new ApiError(404, "Artifact not found");
  const url = await signedDownloadUrl(admin, String(artifact.storage_path), 300);
  return json({ url, file_name: artifact.file_name, expires_in: 300 });
});
