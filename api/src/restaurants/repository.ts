import type { TascoPoiRecord } from "../routes/schemas";
import { createId, nowIso } from "../shared/ids";
import { normalizeRestaurantName } from "../shared/normalization";
import { dailyHours } from "./opening-hours";
import { calculateQualityScore } from "./quality";
import { parseJson } from "../shared/json";

interface RestaurantIdRow {
  id: string;
}

interface RestaurantRow {
  id: string;
  tasco_poi_id: string | null;
  canonical_name: string;
  normalized_name: string;
  description: string | null;
  status: string;
  primary_cuisine: string | null;
  cuisine_tags_json: string;
  price_min_vnd: number | null;
  price_max_vnd: number | null;
  average_price_per_person_vnd: number | null;
  quality_score: number;
  verification_level: string;
  created_at: string;
  updated_at: string;
  last_enriched_at: string | null;
}

interface BranchRow {
  id: string;
  restaurant_id: string;
  name: string | null;
  address_text: string;
  ward: string | null;
  district: string | null;
  city: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  website_url: string | null;
  opening_hours_json: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

interface AttributeRow {
  predicate: string;
  value_json: string;
  verification_status: string;
  confidence: number;
  updated_at: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  rejected: number;
  restaurantIds: string[];
  sourceIds: string[];
}

function initialQuality(record: TascoPoiRecord): number {
  return calculateQualityScore({
    hasIdentityAndCoordinates: true,
    hasBranchInformation: Boolean(record.address && record.city),
    hasContactAndHours: Boolean(
      record.phone || record.websiteUrl || record.openingHours,
    ),
    hasCuisine: Boolean(record.cuisine),
    activeMenuItemCount: 0,
    pricedMenuItemRatio: 0,
    hasImageEvidence: false,
    hasExplicitDietaryInformation: false,
    hasOccasionOrAmenities:
      record.amenities.length > 0 || record.recommendedSegments.length > 0,
    freshnessDays: 0,
    verificationLevel: "tasco_verified",
    unresolvedConflictCount: 0,
  }).score;
}

export async function importTascoPois(
  db: D1Database,
  records: TascoPoiRecord[],
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    updated: 0,
    rejected: 0,
    restaurantIds: [],
    sourceIds: [],
  };
  for (const record of records) {
    const timestamp = nowIso();
    const existing = await db
      .prepare("SELECT id FROM restaurants WHERE tasco_poi_id = ?1")
      .bind(record.tascoPoiId)
      .first<RestaurantIdRow>();
    const restaurantId = existing?.id ?? createId("rest");
    const existingBranch = await db
      .prepare(
        "SELECT id FROM restaurant_branches WHERE restaurant_id = ?1 AND address_text = ?2",
      )
      .bind(restaurantId, record.address)
      .first<RestaurantIdRow>();
    const branchId = existingBranch?.id ?? createId("branch");
    const sourceHash = `tasco:${record.tascoPoiId}`;
    const existingSource = await db
      .prepare(
        "SELECT id FROM sources WHERE restaurant_id = ?1 AND content_hash = ?2",
      )
      .bind(restaurantId, sourceHash)
      .first<RestaurantIdRow>();
    const sourceId = existingSource?.id ?? createId("src");
    const quality = initialQuality(record);
    const familyFriendly = record.amenities.some((value) =>
      /trẻ em|tre em|ghế trẻ/i.test(value),
    );
    const statements = [
      db
        .prepare(
          `INSERT INTO restaurants (
            id, tasco_poi_id, canonical_name, normalized_name, description, status, primary_cuisine,
            cuisine_tags_json, average_price_per_person_vnd, quality_score, verification_level,
            created_at, updated_at, last_enriched_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, 'tasco_verified', ?10, ?10, ?10)
          ON CONFLICT(tasco_poi_id) DO UPDATE SET
            canonical_name = excluded.canonical_name,
            normalized_name = excluded.normalized_name,
            description = COALESCE(excluded.description, restaurants.description),
            primary_cuisine = COALESCE(excluded.primary_cuisine, restaurants.primary_cuisine),
            cuisine_tags_json = excluded.cuisine_tags_json,
            average_price_per_person_vnd = COALESCE(excluded.average_price_per_person_vnd, restaurants.average_price_per_person_vnd),
            quality_score = MAX(restaurants.quality_score, excluded.quality_score),
            verification_level = 'tasco_verified', updated_at = excluded.updated_at, last_enriched_at = excluded.last_enriched_at`,
        )
        .bind(
          restaurantId,
          record.tascoPoiId,
          record.name,
          normalizeRestaurantName(record.name),
          record.description ?? null,
          record.cuisine ?? null,
          JSON.stringify(record.cuisine ? [record.cuisine] : []),
          record.averagePriceVnd ?? null,
          quality,
          timestamp,
        ),
      db
        .prepare(
          `INSERT INTO restaurant_branches (
            id, restaurant_id, address_text, ward, district, city, latitude, longitude, phone,
            website_url, opening_hours_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
          ON CONFLICT(restaurant_id, address_text) DO UPDATE SET
            ward = excluded.ward, district = excluded.district, city = excluded.city,
            latitude = excluded.latitude, longitude = excluded.longitude,
            phone = COALESCE(excluded.phone, restaurant_branches.phone),
            website_url = COALESCE(excluded.website_url, restaurant_branches.website_url),
            opening_hours_json = COALESCE(excluded.opening_hours_json, restaurant_branches.opening_hours_json),
            updated_at = excluded.updated_at`,
        )
        .bind(
          branchId,
          restaurantId,
          record.address,
          record.ward ?? null,
          record.district ?? null,
          record.city ?? null,
          record.latitude,
          record.longitude,
          record.phone ?? null,
          record.websiteUrl ?? null,
          dailyHours(record.openingHours ?? null),
          timestamp,
        ),
      db
        .prepare(
          `INSERT INTO restaurant_external_ids (id, restaurant_id, provider, external_id, created_at)
           VALUES (?1, ?2, 'tasco', ?3, ?4) ON CONFLICT(provider, external_id) DO NOTHING`,
        )
        .bind(createId("ext"), restaurantId, record.tascoPoiId, timestamp),
      db
        .prepare(
          `INSERT INTO sources (
            id, restaurant_id, branch_id, type, content_hash, publisher_name, is_official,
            retrieved_at, processing_status, rights_status, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, 'tasco_poi', ?4, 'Tasco', 1, ?5, 'processed', 'provided_dataset', ?6, ?5, ?5)
          ON CONFLICT(restaurant_id, content_hash) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
        )
        .bind(
          sourceId,
          restaurantId,
          branchId,
          sourceHash,
          timestamp,
          JSON.stringify(record),
        ),
      db
        .prepare(
          `INSERT INTO restaurant_attributes (
            id, restaurant_id, predicate, value_json, verification_status, confidence, updated_at
          ) VALUES (?1, ?2, 'restaurant.amenities', ?3, 'explicit', 0.95, ?4)
          ON CONFLICT(restaurant_id, predicate) DO UPDATE SET value_json = excluded.value_json, confidence = excluded.confidence, updated_at = excluded.updated_at`,
        )
        .bind(
          createId("attr"),
          restaurantId,
          JSON.stringify(record.amenities),
          timestamp,
        ),
      db
        .prepare(
          `INSERT INTO restaurant_attributes (
            id, restaurant_id, predicate, value_json, verification_status, confidence, updated_at
          ) VALUES (?1, ?2, 'restaurant.dining_occasion', ?3, 'explicit', 0.95, ?4)
          ON CONFLICT(restaurant_id, predicate) DO UPDATE SET value_json = excluded.value_json, confidence = excluded.confidence, updated_at = excluded.updated_at`,
        )
        .bind(
          createId("attr"),
          restaurantId,
          JSON.stringify(record.recommendedSegments),
          timestamp,
        ),
      db
        .prepare(
          `INSERT INTO restaurant_attributes (
            id, restaurant_id, predicate, value_json, verification_status, confidence, updated_at
          ) VALUES (?1, ?2, 'restaurant.family_friendly', ?3, 'explicit', 0.95, ?4)
          ON CONFLICT(restaurant_id, predicate) DO UPDATE SET value_json = excluded.value_json, confidence = excluded.confidence, updated_at = excluded.updated_at`,
        )
        .bind(
          createId("attr"),
          restaurantId,
          JSON.stringify(familyFriendly),
          timestamp,
        ),
    ];
    await db.batch(statements);
    result[existing ? "updated" : "imported"] += 1;
    result.restaurantIds.push(restaurantId);
    result.sourceIds.push(sourceId);
  }
  return result;
}

export async function getRestaurantProfile(
  db: D1Database,
  restaurantId: string,
) {
  const restaurant = await db
    .prepare("SELECT * FROM restaurants WHERE id = ?1")
    .bind(restaurantId)
    .first<RestaurantRow>();
  if (!restaurant) return null;
  const [
    branchesResult,
    attributesResult,
    sourcesResult,
    menuResult,
    reviewsResult,
  ] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM restaurant_branches WHERE restaurant_id = ?1 ORDER BY created_at",
      )
      .bind(restaurantId)
      .all<BranchRow>(),
    db
      .prepare(
        "SELECT predicate, value_json, verification_status, confidence, updated_at FROM restaurant_attributes WHERE restaurant_id = ?1",
      )
      .bind(restaurantId)
      .all<AttributeRow>(),
    db
      .prepare(
        `SELECT id, type, original_url, is_official, published_at, retrieved_at, processing_status, rights_status
         FROM sources WHERE restaurant_id = ?1 ORDER BY retrieved_at DESC LIMIT 20`,
      )
      .bind(restaurantId)
      .all<Record<string, string | number | null>>(),
    db
      .prepare(
        `SELECT m.id, m.name, m.version, m.updated_at, COUNT(mi.id) AS item_count,
          MIN(mi.price_amount_vnd) AS min_price_vnd, MAX(mi.price_amount_vnd) AS max_price_vnd
         FROM menus m LEFT JOIN menu_items mi ON mi.menu_id = m.id AND mi.status = 'active'
         WHERE m.restaurant_id = ?1 AND m.status = 'published' GROUP BY m.id ORDER BY m.version DESC LIMIT 1`,
      )
      .bind(restaurantId)
      .first<Record<string, string | number | null>>(),
    db
      .prepare(
        `SELECT aspect, sentiment_score, mention_count, summary, generated_at
         FROM review_aspect_aggregates WHERE restaurant_id = ?1 AND mention_count >= 3`,
      )
      .bind(restaurantId)
      .all<Record<string, string | number | null>>(),
  ]);
  return {
    id: restaurant.id,
    tascoPoiId: restaurant.tasco_poi_id,
    canonicalName: restaurant.canonical_name,
    normalizedName: restaurant.normalized_name,
    description: restaurant.description,
    status: restaurant.status,
    primaryCuisine: restaurant.primary_cuisine,
    cuisineTags: parseJson<string[]>(restaurant.cuisine_tags_json, []),
    priceMinVnd: restaurant.price_min_vnd,
    priceMaxVnd: restaurant.price_max_vnd,
    averagePricePerPersonVnd: restaurant.average_price_per_person_vnd,
    qualityScore: restaurant.quality_score,
    verificationLevel: restaurant.verification_level,
    freshness: {
      updatedAt: restaurant.updated_at,
      lastEnrichedAt: restaurant.last_enriched_at,
    },
    branches: branchesResult.results.map((branch) => ({
      id: branch.id,
      name: branch.name,
      addressText: branch.address_text,
      ward: branch.ward,
      district: branch.district,
      city: branch.city,
      countryCode: branch.country_code,
      latitude: branch.latitude,
      longitude: branch.longitude,
      phone: branch.phone,
      websiteUrl: branch.website_url,
      openingHours: parseJson<unknown>(branch.opening_hours_json, null),
      timezone: branch.timezone,
    })),
    attributes: attributesResult.results.map((attribute) => ({
      predicate: attribute.predicate,
      value: parseJson<unknown>(attribute.value_json, null),
      verificationStatus: attribute.verification_status,
      confidence: attribute.confidence,
      updatedAt: attribute.updated_at,
    })),
    currentMenu: menuResult,
    reviewInsights: reviewsResult.results,
    sources: sourcesResult.results,
  };
}

export async function recomputeRestaurantQuality(
  db: D1Database,
  restaurantId: string,
): Promise<number> {
  const profile = await getRestaurantProfile(db, restaurantId);
  if (!profile) return 0;
  const stats = await db
    .prepare(
      `SELECT COUNT(*) AS item_count,
        SUM(CASE WHEN price_amount_vnd IS NOT NULL THEN 1 ELSE 0 END) AS priced_count,
        SUM(CASE WHEN vegetarian_status IN ('verified', 'explicit') OR vegan_status IN ('verified', 'explicit') OR halal_status IN ('verified', 'explicit') THEN 1 ELSE 0 END) AS dietary_count
       FROM menu_items WHERE restaurant_id = ?1 AND status = 'active'`,
    )
    .bind(restaurantId)
    .first<{
      item_count: number;
      priced_count: number;
      dietary_count: number;
    }>();
  const itemCount = stats?.item_count ?? 0;
  const quality = calculateQualityScore({
    hasIdentityAndCoordinates: profile.branches.length > 0,
    hasBranchInformation: profile.branches.some((branch) =>
      Boolean(branch.addressText && branch.city),
    ),
    hasContactAndHours: profile.branches.some((branch) =>
      Boolean(branch.phone || branch.websiteUrl || branch.openingHours),
    ),
    hasCuisine: Boolean(profile.primaryCuisine),
    activeMenuItemCount: itemCount,
    pricedMenuItemRatio:
      itemCount > 0 ? (stats?.priced_count ?? 0) / itemCount : 0,
    hasImageEvidence: profile.sources.some((source) =>
      String(source["type"]).includes("image"),
    ),
    hasExplicitDietaryInformation: (stats?.dietary_count ?? 0) > 0,
    hasOccasionOrAmenities: profile.attributes.length > 0,
    freshnessDays: 0,
    verificationLevel: profile.verificationLevel as
      | "unverified"
      | "source_supported"
      | "merchant_verified"
      | "tasco_verified",
    unresolvedConflictCount: 0,
  });
  const timestamp = nowIso();
  const statements = Object.entries(quality.components).map(
    ([component, score]) =>
      db
        .prepare(
          `INSERT INTO quality_score_components (id, restaurant_id, component, score, max_score, computed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(restaurant_id, component) DO UPDATE SET score = excluded.score, max_score = excluded.max_score, computed_at = excluded.computed_at`,
        )
        .bind(
          createId("quality"),
          restaurantId,
          component,
          score,
          component === "identity"
            ? 15
            : component === "structuredMenu"
              ? 20
              : component === "menuPriceCoverage"
                ? 10
                : component === "contactAndHours" ||
                    component === "branchInformation" ||
                    component === "cuisine"
                  ? 10
                  : 5,
          timestamp,
        ),
  );
  statements.push(
    db
      .prepare(
        "UPDATE restaurants SET quality_score = ?1, updated_at = ?2 WHERE id = ?3",
      )
      .bind(quality.score, timestamp, restaurantId),
  );
  await db.batch(statements);
  return quality.score;
}
