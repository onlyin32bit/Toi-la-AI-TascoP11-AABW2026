import type { z } from "zod";
import type { fixtureReviewImportSchema } from "../routes/schemas";
import { createId, nowIso } from "../shared/ids";
import { normalizeText } from "../shared/normalization";

type ReviewRecord = z.infer<
  typeof fixtureReviewImportSchema
>["records"][number];

const ASPECT_PATTERNS = {
  food: ["mon an", "thuc an", "ngon", "do an", "food"],
  service: ["phuc vu", "nhan vien", "service"],
  price_value: ["gia", "dat", "re", "price"],
  cleanliness: ["sach", "ve sinh", "clean"],
  ambience: ["khong gian", "on", "yen tinh", "ambience"],
  parking: ["dau xe", "bai xe", "parking"],
  waiting_time: ["cho", "lau", "nhanh", "waiting"],
  family_suitability: ["gia dinh", "tre em", "family", "child"],
} as const;

export async function importFixtureReviews(
  db: D1Database,
  records: ReviewRecord[],
) {
  let imported = 0;
  let rejected = 0;
  const restaurantIds = new Set<string>();
  for (const record of records) {
    const restaurant = await db
      .prepare(
        `SELECT r.id FROM restaurants r JOIN restaurant_external_ids e ON e.restaurant_id = r.id
         WHERE e.provider = 'tasco' AND e.external_id = ?1`,
      )
      .bind(record.externalRestaurantId)
      .first<{ id: string }>();
    if (!restaurant) {
      rejected += 1;
      continue;
    }
    const timestamp = nowIso();
    const sourceHash = `review-dataset:${record.externalRestaurantId}`;
    const existingSource = await db
      .prepare(
        "SELECT id FROM sources WHERE restaurant_id = ?1 AND content_hash = ?2",
      )
      .bind(restaurant.id, sourceHash)
      .first<{ id: string }>();
    const sourceId = existingSource?.id ?? createId("src");
    await db.batch([
      db
        .prepare(
          `INSERT INTO sources (
            id, restaurant_id, type, content_hash, publisher_name, is_official, retrieved_at,
            processing_status, rights_status, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, 'review_dataset', ?3, 'Tasco sample reviews', 0, ?4, 'processed', 'provided_dataset', '{}', ?4, ?4)
          ON CONFLICT(restaurant_id, content_hash) DO NOTHING`,
        )
        .bind(sourceId, restaurant.id, sourceHash, timestamp),
      db
        .prepare(
          `INSERT INTO reviews (
            id, restaurant_id, source_id, external_review_id, text, rating, language,
            published_at, sentiment_score, created_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'vi', ?7, ?8, ?9)
          ON CONFLICT(source_id, external_review_id) DO UPDATE SET
            text = excluded.text, rating = excluded.rating, published_at = excluded.published_at,
            sentiment_score = excluded.sentiment_score`,
        )
        .bind(
          createId("review"),
          restaurant.id,
          sourceId,
          record.externalReviewId,
          record.text,
          record.rating,
          record.publishedAt,
          record.sentimentScore,
          timestamp,
        ),
    ]);
    imported += 1;
    restaurantIds.add(restaurant.id);
  }
  for (const restaurantId of restaurantIds)
    await recomputeReviewAspects(db, restaurantId);
  return { imported, rejected, restaurantIds: [...restaurantIds] };
}

export async function recomputeReviewAspects(
  db: D1Database,
  restaurantId: string,
): Promise<void> {
  const reviews = await db
    .prepare(
      "SELECT id, text, rating, sentiment_score FROM reviews WHERE restaurant_id = ?1",
    )
    .bind(restaurantId)
    .all<{
      id: string;
      text: string;
      rating: number | null;
      sentiment_score: number | null;
    }>();
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const [aspect, patterns] of Object.entries(ASPECT_PATTERNS)) {
    const evidence = reviews.results.filter((review) => {
      const normalized = normalizeText(review.text);
      return patterns.some((pattern) => normalized.includes(pattern));
    });
    if (evidence.length === 0) continue;
    const scores = evidence.map(
      (review) =>
        review.sentiment_score ??
        (review.rating === null ? 0 : (review.rating - 3) / 2),
    );
    const sentiment = Math.max(
      -1,
      Math.min(
        1,
        scores.reduce((sum, value) => sum + value, 0) / scores.length,
      ),
    );
    const summary =
      evidence.length >= 3
        ? `Several reviews mention ${aspect.replace("_", " ")}; aggregate sentiment is ${sentiment.toFixed(2)}.`
        : null;
    statements.push(
      db
        .prepare(
          `INSERT INTO review_aspect_aggregates (
            id, restaurant_id, aspect, sentiment_score, mention_count, summary, evidence_review_ids_json, generated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(restaurant_id, aspect) DO UPDATE SET
            sentiment_score = excluded.sentiment_score, mention_count = excluded.mention_count,
            summary = excluded.summary, evidence_review_ids_json = excluded.evidence_review_ids_json,
            generated_at = excluded.generated_at`,
        )
        .bind(
          createId("aspect"),
          restaurantId,
          aspect,
          sentiment,
          evidence.length,
          summary,
          JSON.stringify(evidence.map((review) => review.id)),
          timestamp,
        ),
    );
  }
  if (statements.length > 0) await db.batch(statements);
}
