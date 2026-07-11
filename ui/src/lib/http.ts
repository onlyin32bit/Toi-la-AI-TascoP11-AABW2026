// Shared fetch helper for the Go engine (all endpoints live on one origin —
// see PLAN.md/README.md route table; CORS is wide-open server-side).
export const ENGINE_BASE_URL =
  (import.meta.env.VITE_ENGINE_BASE_URL as string | undefined) ?? "http://localhost:8000";

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return undefined;
  }
}

export async function getJSON<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${ENGINE_BASE_URL}${path}`, { signal });
    if (!res.ok) throw new HttpError(`GET ${path} failed (${res.status})`, res.status, await parseErrorBody(res));
    return (await res.json()) as T;
  }, timeoutMs);
}

export async function postJSON<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${ENGINE_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new HttpError(`POST ${path} failed (${res.status})`, res.status, await parseErrorBody(res));
    return (await res.json()) as T;
  }, timeoutMs);
}

// Note: never set Content-Type manually for FormData — the browser must set
// the multipart boundary itself.
export async function postForm<T>(path: string, form: FormData, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${ENGINE_BASE_URL}${path}`, { method: "POST", body: form, signal });
    if (!res.ok) throw new HttpError(`POST ${path} failed (${res.status})`, res.status, await parseErrorBody(res));
    return (await res.json()) as T;
  }, timeoutMs);
}
