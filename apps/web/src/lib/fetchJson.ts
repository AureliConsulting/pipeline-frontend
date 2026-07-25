"use client";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json: jsonBody, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(jsonBody !== undefined ? { "content-type": "application/json" } : {}),
      ...rest.headers,
    },
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : rest.body,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    /* empty body */
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new HttpError(response.status, message, body);
  }
  return body as T;
}
