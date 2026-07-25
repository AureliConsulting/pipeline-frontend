/**
 * Environment access. Only NEXT_PUBLIC_* values may reach the browser bundle.
 * The service-role key is read exclusively here, server-side, and this module
 * is imported only from server code (supabase/admin.ts guards with
 * "server-only").
 */

export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. See docs/setup-supabase.md.",
    );
  }
  return { url, anonKey };
}

export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server-only). See docs/setup-supabase.md.");
  }
  return key;
}
