import {
  menuExtractionSchema,
  type MenuExtraction,
} from "../ai/schemas/menu-extraction";
import type { AppBindings, QueueEvent } from "../env";
import { parseVietnamesePrice } from "../menus/price";
import { TRUST_WEIGHTS } from "../claims/resolution";
import { AppError, notFound } from "../shared/errors";
import { sha256 } from "../shared/crypto";
import { createId, nowIso } from "../shared/ids";
import { normalizeText } from "../shared/normalization";
import { assertSafePublicUrl } from "./url-policy";

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "text/plain",
  "application/json",
]);

interface SourceRow {
  id: string;
  restaurant_id: string | null;
  branch_id: string | null;
  type: string;
  original_url: string | null;
  r2_object_key: string | null;
  content_hash: string | null;
  mime_type: string | null;
  processing_status: string;
  metadata_json: string;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectMimeType(
  bytes: Uint8Array,
  declaredType: string,
): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  if (new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp") {
    return declaredType === "video/quicktime" ? "video/quicktime" : "video/mp4";
  }
  if (declaredType === "application/json") {
    try {
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
      );
      return "application/json";
    } catch {
      return null;
    }
  }
  if (declaredType === "text/plain") {
    try {
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      return "text/plain";
    } catch {
      return null;
    }
  }
  return null;
}

function ingestionType(mimeType: string): string {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "menu_pdf";
  if (mimeType.startsWith("image/")) return "menu_image";
  return "menu_image";
}

export async function createUploadedSource(
  env: AppBindings,
  input: {
    restaurantId: string;
    branchId: string | null;
    sourceType: string;
    publisherName: string | null;
    isOfficial: boolean;
    publishedAt: string | null;
    rightsStatus: string;
    file: File;
    force: boolean;
  },
) {
  const restaurant = await env.DB.prepare(
    "SELECT id FROM restaurants WHERE id = ?1",
  )
    .bind(input.restaurantId)
    .first();
  if (!restaurant) throw notFound("Restaurant");
  const maxBytes = Number(env.MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(maxBytes) || input.file.size > maxBytes) {
    throw new AppError(
      "SOURCE_TOO_LARGE",
      `The source exceeds the ${maxBytes} byte limit.`,
      413,
    );
  }
  const buffer = await input.file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const mimeType = detectMimeType(bytes, input.file.type);
  if (!mimeType || !ACCEPTED_TYPES.has(mimeType)) {
    throw new AppError(
      "UNSUPPORTED_SOURCE",
      "The uploaded file type is not supported.",
      415,
    );
  }
  const contentHash = await sha256(buffer);
  const duplicate = await env.DB.prepare(
    "SELECT id FROM sources WHERE restaurant_id = ?1 AND content_hash = ?2",
  )
    .bind(input.restaurantId, contentHash)
    .first<{ id: string }>();
  if (duplicate && !input.force)
    throw new AppError("CONFLICT", `Duplicate source ${duplicate.id}.`, 409);

  const timestamp = nowIso();
  const sourceId = createId("src");
  const jobId = createId("job");
  const objectKey = `sources/${sourceId}/original`;
  await env.ARTIFACTS.put(objectKey, buffer, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sourceId, contentHash },
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sources (
          id, restaurant_id, branch_id, type, r2_object_key, content_hash, mime_type, publisher_name,
          is_official, published_at, retrieved_at, processing_status, rights_status, metadata_json,
          created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'queued', ?12, ?13, ?11, ?11)`,
    ).bind(
      sourceId,
      input.restaurantId,
      input.branchId,
      input.sourceType,
      objectKey,
      contentHash,
      mimeType,
      input.publisherName,
      Number(input.isOfficial),
      input.publishedAt,
      timestamp,
      input.rightsStatus,
      JSON.stringify({ originalFilename: input.file.name }),
    ),
    env.DB.prepare(
      `INSERT INTO ingestion_jobs (
          id, source_id, type, status, current_step, attempts, created_at, updated_at
        ) VALUES (?1, ?2, ?3, 'queued', 'stored', 0, ?4, ?4)`,
    ).bind(jobId, sourceId, ingestionType(mimeType), timestamp),
  ]);
  await env.SOURCE_INGESTION_QUEUE.send({
    eventId: createId("event"),
    eventType: "source.process",
    entityId: sourceId,
    attempt: 0,
    createdAt: timestamp,
  } satisfies QueueEvent);
  return { sourceId, jobId, status: "queued" };
}

export async function createUrlSource(
  env: AppBindings,
  input: {
    restaurantId: string;
    branchId: string | null;
    url: string;
    sourceType: string;
    isOfficial: boolean;
  },
) {
  const allowedDomains = env.ALLOWED_SOURCE_DOMAINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const url = assertSafePublicUrl(input.url, allowedDomains);
  const restaurant = await env.DB.prepare(
    "SELECT id FROM restaurants WHERE id = ?1",
  )
    .bind(input.restaurantId)
    .first();
  if (!restaurant) throw notFound("Restaurant");
  const contentHash = await sha256(`url:${url.toString()}`);
  const duplicate = await env.DB.prepare(
    "SELECT id FROM sources WHERE restaurant_id = ?1 AND content_hash = ?2",
  )
    .bind(input.restaurantId, contentHash)
    .first<{ id: string }>();
  if (duplicate)
    throw new AppError("CONFLICT", `Duplicate source ${duplicate.id}.`, 409);
  const timestamp = nowIso();
  const sourceId = createId("src");
  const jobId = createId("job");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sources (
          id, restaurant_id, branch_id, type, original_url, content_hash, is_official,
          retrieved_at, processing_status, rights_status, metadata_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', 'public_reference', '{}', ?8, ?8)`,
    ).bind(
      sourceId,
      input.restaurantId,
      input.branchId,
      input.sourceType,
      url.toString(),
      contentHash,
      Number(input.isOfficial),
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO ingestion_jobs (id, source_id, type, status, current_step, attempts, created_at, updated_at)
         VALUES (?1, ?2, 'webpage', 'queued', 'validate_url', 0, ?3, ?3)`,
    ).bind(jobId, sourceId, timestamp),
  ]);
  await env.SOURCE_INGESTION_QUEUE.send({
    eventId: createId("event"),
    eventType: "source.process",
    entityId: sourceId,
    attempt: 0,
    createdAt: timestamp,
  } satisfies QueueEvent);
  return { sourceId, jobId, status: "queued" };
}

export async function getSourceState(db: D1Database, sourceId: string) {
  const source = await db
    .prepare("SELECT id, processing_status FROM sources WHERE id = ?1")
    .bind(sourceId)
    .first<{ id: string; processing_status: string }>();
  if (!source) return null;
  const [job, counts] = await Promise.all([
    db
      .prepare(
        "SELECT current_step, status, attempts, error_code, error_message FROM ingestion_jobs WHERE source_id = ?1",
      )
      .bind(sourceId)
      .first<Record<string, string | number | null>>(),
    db
      .prepare(
        "SELECT status, COUNT(*) AS count FROM claims WHERE source_id = ?1 GROUP BY status",
      )
      .bind(sourceId)
      .all<{ status: string; count: number }>(),
  ]);
  const claimCounts = { candidate: 0, accepted: 0, rejected: 0 };
  for (const row of counts.results) {
    if (row.status in claimCounts)
      claimCounts[row.status as keyof typeof claimCounts] = row.count;
  }
  const currentStep = String(job?.["current_step"] ?? "queued");
  const knownSteps = [
    "fetch",
    "stored",
    "preprocessing",
    "ocr",
    "structured_extraction",
    "claim_validation",
  ];
  const currentIndex = knownSteps.indexOf(currentStep);
  return {
    id: source.id,
    processingStatus: source.processing_status,
    job,
    steps: knownSteps.map((name, index) => ({
      name,
      status:
        currentIndex > index || job?.["status"] === "completed"
          ? "completed"
          : currentIndex === index
            ? "running"
            : "pending",
    })),
    claimCounts,
  };
}

export async function reprocessSource(
  env: AppBindings,
  sourceId: string,
  fromStep: string,
  force: boolean,
) {
  const source = await env.DB.prepare("SELECT id FROM sources WHERE id = ?1")
    .bind(sourceId)
    .first();
  if (!source) throw notFound("Source");
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE sources SET processing_status = 'queued', error_code = NULL, error_message = NULL, updated_at = ?1 WHERE id = ?2",
    ).bind(timestamp, sourceId),
    env.DB.prepare(
      `UPDATE ingestion_jobs SET status = 'queued', current_step = ?1, attempts = CASE WHEN ?2 THEN 0 ELSE attempts END,
         error_code = NULL, error_message = NULL, updated_at = ?3 WHERE source_id = ?4`,
    ).bind(fromStep, Number(force), timestamp, sourceId),
  ]);
  await env.SOURCE_INGESTION_QUEUE.send({
    eventId: createId("event"),
    eventType: "source.process",
    entityId: sourceId,
    attempt: 0,
    createdAt: timestamp,
  } satisfies QueueEvent);
  return { sourceId, status: "queued", fromStep };
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes)
    throw new AppError(
      "SOURCE_TOO_LARGE",
      "The remote source is too large.",
      413,
    );
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError(
        "SOURCE_TOO_LARGE",
        "The remote source is too large.",
        413,
      );
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined.buffer;
}

async function fetchPublicSource(
  env: AppBindings,
  source: SourceRow,
): Promise<void> {
  let url = source.original_url;
  if (!url)
    throw new AppError("UNSUPPORTED_SOURCE", "The source URL is missing.", 400);
  const allowedDomains = env.ALLOWED_SOURCE_DOMAINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const safe = assertSafePublicUrl(url, allowedDomains);
    response = await fetch(safe, {
      redirect: "manual",
      headers: { "User-Agent": "TascoRestaurantIntelligence/1.0" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location)
      throw new AppError(
        "SOURCE_ACCESS_DENIED",
        "The redirect target is missing.",
        403,
      );
    url = new URL(location, safe).toString();
    response = null;
  }
  if (!response)
    throw new AppError(
      "SOURCE_ACCESS_DENIED",
      "The source exceeded the redirect limit.",
      403,
    );
  if (!response.ok)
    throw new AppError(
      "SOURCE_ACCESS_DENIED",
      `The source returned HTTP ${response.status}.`,
      403,
    );
  const bytes = await readBounded(response, Number(env.MAX_UPLOAD_BYTES));
  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ??
    "application/octet-stream";
  const objectKey = `sources/${source.id}/snapshot.json`;
  await env.ARTIFACTS.put(
    objectKey,
    JSON.stringify({ url, contentType, body: new TextDecoder().decode(bytes) }),
    {
      httpMetadata: { contentType: "application/json" },
    },
  );
  await env.DB.prepare(
    "UPDATE sources SET r2_object_key = ?1, mime_type = ?2, processing_status = 'needs_review', updated_at = ?3 WHERE id = ?4",
  )
    .bind(objectKey, contentType, nowIso(), source.id)
    .run();
}

function extractionFromPlainText(text: string): MenuExtraction {
  const items = text
    .split(/\r?\n/)
    .map((line, index) => {
      const match = /^(.+?)\s*[.\-–—]{2,}\s*(.+)$/.exec(line.trim());
      if (!match) return null;
      const price = parseVietnamesePrice(match[2]!);
      return {
        name: match[1]!.trim(),
        description: null,
        priceText: match[2]!.trim(),
        priceAmountVnd: price.amountVnd,
        category: null,
        dietaryClaims: [],
        evidence: { page: 1, blockIds: [`line_${index + 1}`] },
        confidence: price.kind === "ambiguous" ? 0.55 : 0.85,
      };
    })
    .filter((item) => item !== null);
  return {
    menuTitle: null,
    currency: "VND",
    sections: [{ name: "Menu", items }],
  };
}

async function saveMenuClaims(
  env: AppBindings,
  source: SourceRow,
  extraction: MenuExtraction,
): Promise<number> {
  if (!source.restaurant_id)
    throw new AppError(
      "PROCESSING_FAILED",
      "The source has no restaurant.",
      422,
    );
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const section of extraction.sections) {
    for (const item of section.items) {
      const value = {
        menuName: extraction.menuTitle ?? "Extracted menu",
        section: section.name,
        name: item.name,
        description: item.description,
        priceAmountVnd: item.priceAmountVnd,
        priceTextRaw: item.priceText,
        priceConfidence: item.confidence,
        vegetarianStatus: item.dietaryClaims.some(
          (claim) => claim.type === "vegetarian",
        )
          ? "explicit"
          : "unknown",
        veganStatus: item.dietaryClaims.some((claim) => claim.type === "vegan")
          ? "explicit"
          : "unknown",
        halalStatus: item.dietaryClaims.some((claim) => claim.type === "halal")
          ? "explicit"
          : "unknown",
        spicyLevel: null,
        confidence: item.confidence,
      };
      const extractionKey = await sha256(
        `${normalizeText(section.name)}:${normalizeText(item.name)}:${item.priceText ?? ""}`,
      );
      statements.push(
        env.DB.prepare(
          `INSERT INTO claims (
              id, source_id, restaurant_id, branch_id, predicate, value_json, basis, confidence,
              trust_weight, evidence_json, extraction_key, status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, 'menu.item', ?5, 'ocr_explicit', ?6, ?7, ?8, ?9, 'candidate', ?10, ?10)
            ON CONFLICT(source_id, extraction_key) DO UPDATE SET
              value_json = excluded.value_json, confidence = excluded.confidence,
              evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`,
        ).bind(
          createId("claim"),
          source.id,
          source.restaurant_id,
          source.branch_id,
          JSON.stringify(value),
          item.confidence,
          TRUST_WEIGHTS.explicit_menu_text,
          JSON.stringify(item.evidence),
          extractionKey,
          timestamp,
        ),
      );
    }
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return statements.length;
}

export async function processSource(
  env: AppBindings,
  sourceId: string,
): Promise<void> {
  const source = await env.DB.prepare("SELECT * FROM sources WHERE id = ?1")
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) throw notFound("Source");
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE sources SET processing_status = 'processing', updated_at = ?1 WHERE id = ?2",
    ).bind(timestamp, sourceId),
    env.DB.prepare(
      "UPDATE ingestion_jobs SET status = 'running', attempts = attempts + 1, locked_at = ?1, updated_at = ?1 WHERE source_id = ?2",
    ).bind(timestamp, sourceId),
  ]);
  if (source.original_url) {
    await fetchPublicSource(env, source);
  } else if (
    source.r2_object_key &&
    ["text/plain", "application/json"].includes(source.mime_type ?? "")
  ) {
    const object = await env.ARTIFACTS.get(source.r2_object_key);
    if (!object)
      throw new AppError(
        "PROCESSING_FAILED",
        "The source artifact is missing.",
        500,
      );
    const text = await object.text();
    let extraction: MenuExtraction;
    if (source.mime_type === "application/json") {
      const parsed = menuExtractionSchema.safeParse(
        JSON.parse(text) as unknown,
      );
      if (!parsed.success)
        throw new AppError(
          "AI_OUTPUT_INVALID",
          "The menu extraction artifact is invalid.",
          422,
        );
      extraction = parsed.data;
    } else {
      extraction = extractionFromPlainText(text);
    }
    const count = await saveMenuClaims(env, source, extraction);
    await env.DB.prepare(
      "UPDATE sources SET processing_status = ?1, metadata_json = ?2, updated_at = ?3 WHERE id = ?4",
    )
      .bind(
        count > 0 ? "needs_review" : "processed",
        JSON.stringify({ extractedClaimCount: count }),
        nowIso(),
        source.id,
      )
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE sources SET processing_status = 'needs_review', error_code = 'OCR_PROVIDER_REQUIRED', updated_at = ?1 WHERE id = ?2",
    )
      .bind(nowIso(), source.id)
      .run();
  }
  await env.DB.prepare(
    "UPDATE ingestion_jobs SET status = 'completed', current_step = 'claim_validation', completed_at = ?1, updated_at = ?1 WHERE source_id = ?2",
  )
    .bind(nowIso(), source.id)
    .run();
}
