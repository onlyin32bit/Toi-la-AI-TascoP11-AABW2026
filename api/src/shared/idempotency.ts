import { AppError } from "./errors";
import { nowIso } from "./ids";

interface IdempotencyRow {
  request_hash: string;
  response_status: number | null;
  response_json: string | null;
}

export async function getIdempotentResponse(
  db: D1Database,
  key: string,
  requestHash: string,
): Promise<{ status: number; body: unknown } | null> {
  const row = await db
    .prepare(
      "SELECT request_hash, response_status, response_json FROM idempotency_keys WHERE key = ?1",
    )
    .bind(key)
    .first<IdempotencyRow>();
  if (!row) return null;
  if (row.request_hash !== requestHash) {
    throw new AppError(
      "CONFLICT",
      "This idempotency key was used with a different request.",
      409,
    );
  }
  if (row.response_status === null || row.response_json === null) {
    throw new AppError(
      "CONFLICT",
      "An operation with this idempotency key is in progress.",
      409,
    );
  }
  return {
    status: row.response_status,
    body: JSON.parse(row.response_json) as unknown,
  };
}

export async function reserveIdempotencyKey(
  db: D1Database,
  key: string,
  operation: string,
  requestHash: string,
): Promise<void> {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      "INSERT INTO idempotency_keys (key, operation, request_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(key, operation, requestHash, createdAt, expiresAt)
    .run();
}

export async function completeIdempotencyKey(
  db: D1Database,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await db
    .prepare(
      "UPDATE idempotency_keys SET response_status = ?1, response_json = ?2 WHERE key = ?3",
    )
    .bind(status, JSON.stringify(body), key)
    .run();
}
