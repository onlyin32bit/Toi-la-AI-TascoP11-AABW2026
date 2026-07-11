import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { AppError } from "./errors";
import { createId } from "./ids";
import { secureEqual } from "./crypto";

export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header("X-Request-Id")?.trim();
  const requestId =
    incoming && incoming.length <= 128 ? incoming : createId("req");
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  const startedAt = Date.now();
  await next();
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      requestId,
      route: c.req.path,
      operation: c.req.method,
      durationMs: Date.now() - startedAt,
      status: c.res.status,
    }),
  );
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const configured = c.env.ADMIN_API_KEY;
  if (!configured)
    throw new AppError("FORBIDDEN", "Admin API access is not configured.", 403);
  const header = c.req.header("Authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !(await secureEqual(supplied, configured))) {
    throw new AppError(
      "UNAUTHORIZED",
      "A valid admin API key is required.",
      401,
    );
  }
  await next();
});

export const requireIdempotencyKey = createMiddleware<AppEnv>(
  async (c, next) => {
    const key = c.req.header("Idempotency-Key")?.trim();
    if (!key || key.length > 200) {
      throw new AppError(
        "VALIDATION_ERROR",
        "A valid Idempotency-Key header is required.",
        400,
        [
          {
            path: "Idempotency-Key",
            message: "Required and must not exceed 200 characters.",
          },
        ],
      );
    }
    await next();
  },
);
