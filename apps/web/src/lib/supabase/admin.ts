import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "../env";

/**
 * Privileged client. SERVER ONLY — the "server-only" import makes any attempt
 * to pull this into a client bundle a build error. Used by API routes after
 * they have independently verified ownership (session) or runner identity
 * (token hash). Never exposed to RLS-bypassing reads on behalf of the browser
 * without an explicit ownership check first.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const { url } = publicEnv();
  return createClient(url, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
