import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "@aureli/shared";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Server-side artifact content fetch. Ownership is proven by the caller
 * already having RLS-scoped read access to the run row; the admin client
 * here is only used to stream the file out of private storage.
 */
export async function downloadArtifactText(
  runUserId: string,
  artifactId: string | undefined,
): Promise<string | null> {
  if (!artifactId) return null;
  try {
    const admin: SupabaseClient = createSupabaseAdminClient();
    const { data: full } = await admin
      .from("artifacts")
      .select("storage_path, user_id")
      .eq("id", artifactId)
      .maybeSingle();
    if (!full || full.user_id !== runUserId) return null;
    const { data: blob } = await admin.storage.from("artifacts").download(String(full.storage_path));
    if (!blob) return null;
    return await blob.text();
  } catch {
    return null;
  }
}

export interface ParsedCsvRows {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parses CSV text into header-keyed row objects (not the raw array-of-arrays form). */
export function parseCsvRows(text: string, maxRows?: number): ParsedCsvRows {
  const parsed = parseCsv(text, maxRows);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
  return { headers, rows };
}
