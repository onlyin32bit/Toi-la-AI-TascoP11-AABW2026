import { Hono } from "hono";
import type { AppEnv, QueueEvent } from "../env";
import { listClaims, reviewClaim } from "../claims/repository";
import { importFixtureMenuItems } from "../menus/repository";
import {
  importTascoPois,
  recomputeRestaurantQuality,
} from "../restaurants/repository";
import { importFixtureReviews } from "../restaurants/reviews";
import {
  rebuildRestaurantDocuments,
  indexPendingDocuments,
} from "../search/indexing";
import { sha256 } from "../shared/crypto";
import { AppError } from "../shared/errors";
import {
  completeIdempotencyKey,
  getIdempotentResponse,
  reserveIdempotencyKey,
} from "../shared/idempotency";
import { createId, nowIso } from "../shared/ids";
import { parseJsonBody, positiveInteger, success } from "../shared/http";
import { requireAdmin, requireIdempotencyKey } from "../shared/middleware";
import {
  compareSchema,
  fixtureMenuImportSchema,
  fixtureReviewImportSchema,
  reprocessSchema,
  reviewClaimSchema,
  sourceUrlSchema,
  tascoImportSchema,
} from "./schemas";
import {
  createUploadedSource,
  createUrlSource,
  getSourceState,
  reprocessSource,
} from "../sources/repository";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAdmin);
adminRoutes.use("/imports/*", requireIdempotencyKey);
adminRoutes.use("/restaurants/:restaurantId/sources/*", requireIdempotencyKey);
adminRoutes.use("/sources/:sourceId/reprocess", requireIdempotencyKey);
adminRoutes.use("/claims/:claimId/review", requireIdempotencyKey);

async function enqueueReindex(
  c: Parameters<typeof success>[0],
  restaurantIds: string[],
): Promise<void> {
  await Promise.all(
    restaurantIds.map((restaurantId) =>
      c.env.INDEXING_QUEUE.send({
        eventId: createId("event"),
        eventType: "restaurant.reindex",
        entityId: restaurantId,
        attempt: 0,
        createdAt: nowIso(),
      } satisfies QueueEvent),
    ),
  );
}

adminRoutes.post("/imports/tasco-pois", async (c) => {
  const body = await parseJsonBody(c, tascoImportSchema);
  const key = c.req.header("Idempotency-Key")!;
  const requestHash = await sha256(JSON.stringify(body));
  const replay = await getIdempotentResponse(c.env.DB, key, requestHash);
  if (replay) return success(c, replay.body);
  await reserveIdempotencyKey(c.env.DB, key, "tasco.import", requestHash);
  const result = await importTascoPois(c.env.DB, body.records);
  await enqueueReindex(c, result.restaurantIds);
  const data = {
    imported: result.imported,
    updated: result.updated,
    rejected: result.rejected,
    restaurantIds: result.restaurantIds,
  };
  await completeIdempotencyKey(c.env.DB, key, 200, data);
  return success(c, data);
});

adminRoutes.post("/imports/menu-items", async (c) => {
  const body = await parseJsonBody(c, fixtureMenuImportSchema);
  const key = c.req.header("Idempotency-Key")!;
  const requestHash = await sha256(JSON.stringify(body));
  const replay = await getIdempotentResponse(c.env.DB, key, requestHash);
  if (replay) return success(c, replay.body);
  await reserveIdempotencyKey(
    c.env.DB,
    key,
    "menu.fixture.import",
    requestHash,
  );
  const result = await importFixtureMenuItems(c.env.DB, body.records);
  for (const restaurantId of result.restaurantIds)
    await recomputeRestaurantQuality(c.env.DB, restaurantId);
  await enqueueReindex(c, result.restaurantIds);
  await completeIdempotencyKey(c.env.DB, key, 200, result);
  return success(c, result);
});

adminRoutes.post("/imports/reviews", async (c) => {
  const body = await parseJsonBody(c, fixtureReviewImportSchema);
  const key = c.req.header("Idempotency-Key")!;
  const requestHash = await sha256(JSON.stringify(body));
  const replay = await getIdempotentResponse(c.env.DB, key, requestHash);
  if (replay) return success(c, replay.body);
  await reserveIdempotencyKey(
    c.env.DB,
    key,
    "reviews.fixture.import",
    requestHash,
  );
  const result = await importFixtureReviews(c.env.DB, body.records);
  await enqueueReindex(c, result.restaurantIds);
  await completeIdempotencyKey(c.env.DB, key, 200, result);
  return success(c, result);
});

adminRoutes.post("/restaurants/:restaurantId/sources/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "A multipart file field is required.",
      400,
      [{ path: "file", message: "Required." }],
    );
  }
  const sourceType = String(form.get("sourceType") ?? "merchant_upload");
  const rightsStatus = String(form.get("rightsStatus") ?? "user_submitted");
  const allowedRights = [
    "provided_dataset",
    "merchant_authorized",
    "user_submitted",
    "public_reference",
    "unknown",
  ];
  if (!allowedRights.includes(rightsStatus)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "The rightsStatus value is invalid.",
      400,
    );
  }
  const data = await createUploadedSource(c.env, {
    restaurantId: c.req.param("restaurantId"),
    branchId: form.get("branchId") ? String(form.get("branchId")) : null,
    sourceType,
    publisherName: form.get("publisherName")
      ? String(form.get("publisherName"))
      : null,
    isOfficial: String(form.get("isOfficial")) === "true",
    publishedAt: form.get("publishedAt")
      ? String(form.get("publishedAt"))
      : null,
    rightsStatus,
    file,
    force: c.req.query("force") === "true",
  });
  return c.json(
    { data, meta: { requestId: c.get("requestId"), timestamp: nowIso() } },
    202,
  );
});

adminRoutes.post("/restaurants/:restaurantId/sources/url", async (c) => {
  const body = await parseJsonBody(c, sourceUrlSchema);
  const data = await createUrlSource(c.env, {
    restaurantId: c.req.param("restaurantId"),
    branchId: body.branchId,
    url: body.url,
    sourceType: body.sourceType,
    isOfficial: body.isOfficial,
  });
  return c.json(
    { data, meta: { requestId: c.get("requestId"), timestamp: nowIso() } },
    202,
  );
});

adminRoutes.get("/sources/:sourceId", async (c) => {
  const data = await getSourceState(c.env.DB, c.req.param("sourceId"));
  if (!data) throw new AppError("NOT_FOUND", "Source was not found.", 404);
  return success(c, data);
});

adminRoutes.post("/sources/:sourceId/reprocess", async (c) => {
  const body = await parseJsonBody(c, reprocessSchema);
  const data = await reprocessSource(
    c.env,
    c.req.param("sourceId"),
    body.fromStep,
    body.force,
  );
  return c.json(
    { data, meta: { requestId: c.get("requestId"), timestamp: nowIso() } },
    202,
  );
});

adminRoutes.get("/claims", async (c) => {
  const minConfidenceText = c.req.query("minConfidence");
  const minConfidence =
    minConfidenceText === undefined ? undefined : Number(minConfidenceText);
  if (
    minConfidence !== undefined &&
    (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "minConfidence must be between 0 and 1.",
      400,
    );
  }
  const data = await listClaims(c.env.DB, {
    restaurantId: c.req.query("restaurantId"),
    sourceId: c.req.query("sourceId"),
    predicate: c.req.query("predicate"),
    status: c.req.query("status"),
    minConfidence,
    limit: positiveInteger(c.req.query("limit"), 50, 100),
    cursor: c.req.query("cursor"),
  });
  return success(c, data);
});

adminRoutes.post("/claims/:claimId/review", async (c) => {
  const body = await parseJsonBody(c, reviewClaimSchema);
  const data = await reviewClaim(
    c.env.DB,
    c.req.param("claimId"),
    body,
    "admin_api_key",
    c.get("requestId"),
  );
  await enqueueReindex(c, [data.restaurantId]);
  return success(c, data);
});

adminRoutes.post("/restaurants/:restaurantId/quality/recompute", async (c) => {
  const score = await recomputeRestaurantQuality(
    c.env.DB,
    c.req.param("restaurantId"),
  );
  return success(c, {
    restaurantId: c.req.param("restaurantId"),
    qualityScore: score,
  });
});

adminRoutes.post("/reindex", async (c) => {
  const body = await parseJsonBody(
    c,
    compareSchema.pick({ restaurantIds: true }).partial(),
  );
  const restaurantIds =
    body.restaurantIds ??
    (
      await c.env.DB.prepare(
        "SELECT id FROM restaurants WHERE status = 'active'",
      ).all<{ id: string }>()
    ).results.map((row) => row.id);
  let documents = 0;
  for (const restaurantId of restaurantIds)
    documents += (await rebuildRestaurantDocuments(c.env, restaurantId)).length;
  let indexed = 0;
  if (String(c.env.ENABLE_AI_SEARCH) === "true")
    indexed = await indexPendingDocuments(c.env);
  return success(c, { restaurants: restaurantIds.length, documents, indexed });
});
