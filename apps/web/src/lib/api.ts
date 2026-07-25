import "server-only";
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { redactSecrets } from "@aureli/shared";
import { createSupabaseServerClient } from "./supabase/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Wraps a route handler: converts ApiError to a JSON error response and makes
 * sure no secret or stack detail ever reaches the client.
 */
export function handled<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ error: redactSecrets(error.message), code: error.code ?? null }, error.status);
      }
      console.error("Unhandled API error:", error);
      return json({ error: "Internal error", code: "internal" }, 500);
    }
  };
}

/** Session guard for user-facing API routes. */
export async function requireUser(): Promise<{ id: string; email: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, "Not authenticated", "unauthorized");
  return { id: user.id, email: user.email ?? "" };
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "Request body must be JSON", "bad_json");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ApiError(422, `Validation failed: ${detail}`, "validation");
  }
  return result.data;
}
