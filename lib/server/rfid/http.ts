import "server-only";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public retryAfterSeconds?: number) { super(code); }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleApi(work: () => Promise<Response>, operation = "api"): Promise<Response> {
  const startedAt = Date.now();
  let status = 503;
  let failure: string | null = null;
  try { const response = await work(); status = response.status; return response; }
  catch (error) {
    if (error instanceof ApiError) {
      status = error.status;
      failure = error.code;
      const retryAfterSeconds = error.status === 429 ? Math.max(1, Math.ceil(error.retryAfterSeconds ?? 60)) : undefined;
      const response = json({ error: error.code, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, error.status);
      if (retryAfterSeconds) response.headers.set("Retry-After", String(retryAfterSeconds));
      return response;
    }
    // Never serialize SDK errors, request bodies, or credentials.
    return json({ error: "server-unavailable" }, 503);
  } finally {
    // Fixed fields only: no bodies, tokens, UIDs, names, or SDK errors.
    console.info(JSON.stringify({ metric: "integration-request", operation, status, failure,
      durationMs: Date.now() - startedAt }));
  }
}

export function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(value);
  if (!match) throw new ApiError(401, "unauthorized");
  return match[1];
}

export async function readBody(request: Request, maxBytes = 2048): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new ApiError(415, "json-required");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new ApiError(413, "body-too-large");
  }
  if (!request.body) throw new ApiError(400, "invalid-body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, "body-too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(400, "invalid-json"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(400, "invalid-body");
  return data as Record<string, unknown>;
}
