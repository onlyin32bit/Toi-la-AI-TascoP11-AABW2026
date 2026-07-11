import type { Context } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../env";
import { AppError } from "./errors";

export function meta(c: Context<AppEnv>) {
  return {
    requestId: c.get("requestId"),
    timestamp: new Date().toISOString(),
  };
}

export function success(c: Context<AppEnv>, data: unknown) {
  return c.json({ data, meta: meta(c) });
}

export async function parseJsonBody<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "The request body must be valid JSON.",
      400,
    );
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The request could not be processed.",
      400,
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function positiveInteger(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The query parameters are invalid.",
      400,
      [{ path: "limit", message: `Must be an integer between 1 and ${max}.` }],
    );
  }
  return parsed;
}
