import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppBindings, AppEnv, QueueEvent } from "./env";
import { adminRoutes } from "./routes/admin";
import { publicRoutes } from "./routes/public";
import { tascoRoutes } from "./routes/tasco";
import {
  indexPendingDocuments,
  rebuildRestaurantDocuments,
} from "./search/indexing";
import { AppError } from "./shared/errors";
import { nowIso } from "./shared/ids";
import { requestContext } from "./shared/middleware";
import { processSource } from "./sources/repository";
import openApi from "../openapi/openapi.json";

export const app = new Hono<AppEnv>();

app.use("*", requestContext);

app.get("/", (c) =>
  c.json({
    name: "Tasco Restaurant Intelligence API",
    version: "v1",
    documentation: "/openapi.json",
  }),
);

app.get("/openapi.json", (c) => c.json(openApi));

app.get("/api/v1/health", async (c) => {
  let d1 = "ok";
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    d1 = "error";
  }
  return c.json({
    data: {
      status: d1 === "ok" ? "ok" : "degraded",
      services: {
        d1,
        r2: c.env.ARTIFACTS ? "configured" : "error",
        vectorize: c.env.RESTAURANT_SEARCH ? "configured" : "error",
        workersAi: c.env.AI ? "configured" : "error",
      },
    },
    meta: { requestId: c.get("requestId"), timestamp: nowIso() },
  });
});

app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1", publicRoutes);
app.route("/v1", tascoRoutes);
app.route("/", tascoRoutes);

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "The requested route was not found.",
        details: [],
      },
      meta: { requestId: c.get("requestId"), timestamp: nowIso() },
    },
    404,
  ),
);

app.onError((error, c) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
  console.error(
    JSON.stringify({
      timestamp: nowIso(),
      level: "error",
      requestId: c.get("requestId"),
      route: c.req.path,
      operation: c.req.method,
      status: appError.status,
      errorCode: appError.code,
      message: error.message,
    }),
  );
  return c.json(
    {
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
      meta: { requestId: c.get("requestId"), timestamp: nowIso() },
    },
    appError.status as ContentfulStatusCode,
  );
});

async function eventWasProcessed(
  db: D1Database,
  eventId: string,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare("SELECT event_id FROM processed_events WHERE event_id = ?1")
      .bind(eventId)
      .first(),
  );
}

async function processQueueEvent(
  env: AppBindings,
  event: QueueEvent,
): Promise<void> {
  if (await eventWasProcessed(env.DB, event.eventId)) return;
  if (event.eventType === "source.process") {
    await processSource(env, event.entityId);
  } else if (event.eventType === "restaurant.reindex") {
    const ids = await rebuildRestaurantDocuments(env, event.entityId);
    if (String(env.ENABLE_AI_SEARCH) === "true")
      await indexPendingDocuments(env, ids);
  } else if (event.eventType === "search.index") {
    await indexPendingDocuments(env, [event.entityId]);
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO processed_events (event_id, event_type, entity_id, processed_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(event.eventId, event.eventType, event.entityId, nowIso())
    .run();
}

async function handleQueue(
  batch: MessageBatch<QueueEvent>,
  env: AppBindings,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processQueueEvent(env, message.body);
      message.ack();
    } catch (error) {
      const permanent =
        error instanceof AppError &&
        [
          "UNSUPPORTED_SOURCE",
          "SOURCE_ACCESS_DENIED",
          "SOURCE_TOO_LARGE",
          "VALIDATION_ERROR",
        ].includes(error.code);
      console.error(
        JSON.stringify({
          timestamp: nowIso(),
          level: "error",
          eventId: message.body.eventId,
          sourceId:
            message.body.eventType === "source.process"
              ? message.body.entityId
              : undefined,
          operation: message.body.eventType,
          status: permanent ? "failed_permanent" : "failed_retryable",
          errorCode:
            error instanceof AppError ? error.code : "PROCESSING_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      if (message.body.eventType === "source.process") {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE sources SET processing_status = 'failed', error_code = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4",
          ).bind(
            error instanceof AppError ? error.code : "PROCESSING_FAILED",
            error instanceof Error ? error.message : String(error),
            nowIso(),
            message.body.entityId,
          ),
          env.DB.prepare(
            "UPDATE ingestion_jobs SET status = ?1, error_code = ?2, error_message = ?3, updated_at = ?4 WHERE source_id = ?5",
          ).bind(
            permanent ? "failed_permanent" : "failed_retryable",
            error instanceof AppError ? error.code : "PROCESSING_FAILED",
            error instanceof Error ? error.message : String(error),
            nowIso(),
            message.body.entityId,
          ),
        ]);
      }
      if (permanent) {
        await env.DEAD_LETTER_QUEUE.send({
          ...message.body,
          attempt: message.body.attempt + 1,
        });
        message.ack();
      } else {
        message.retry({
          delaySeconds: Math.min(300, 2 ** message.body.attempt),
        });
      }
    }
  }
}

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  queue(batch, env) {
    return handleQueue(batch, env);
  },
} satisfies ExportedHandler<AppBindings, QueueEvent>;
