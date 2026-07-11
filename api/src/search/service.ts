import type { AppBindings } from "../env";
import type { SearchRequest } from "../routes/schemas";
import { generateEmbeddings } from "../ai/embeddings";
import { evaluateOpeningHours } from "../restaurants/opening-hours";
import { parseJson } from "../shared/json";
import { tokenize } from "../shared/normalization";
import { mergeSearchFilters, type SearchFilters } from "./filter-merge";
import { haversineDistanceMeters } from "./geo";
import { distanceScore, freshnessScore, rankCandidate } from "./ranking";
import { parseQueryDeterministically, type ParsedQuery } from "./query-parser";

interface CandidateRow {
  restaurant_id: string;
  canonical_name: string;
  description: string | null;
  primary_cuisine: string | null;
  average_price_per_person_vnd: number | null;
  quality_score: number;
  verification_level: string;
  updated_at: string;
  branch_id: string;
  address_text: string;
  district: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  opening_hours_json: string | null;
  family_friendly_json: string | null;
  occasions_json: string | null;
  amenities_json: string | null;
  review_mentions: number;
}

interface SearchMenuItemRow {
  id: string;
  restaurant_id: string;
  display_name: string;
  description: string | null;
  price_amount_vnd: number | null;
  vegetarian_status: string;
  vegan_status: string;
  halal_status: string;
  extraction_confidence: number;
  source_id: string;
}

export interface SearchOptions {
  target?: "restaurant" | "dish";
}

function tokenSimilarity(query: string[], document: string): number {
  if (query.length === 0) return 0;
  const documentTokens = new Set(tokenize(document));
  const matches = query.filter((token) => documentTokens.has(token)).length;
  return Math.min(1, matches / Math.max(2, Math.min(query.length, 8)));
}

function strictDietaryMatch(
  item: SearchMenuItemRow,
  filters: SearchFilters,
): boolean {
  const explicit = (status: string) =>
    status === "verified" || status === "explicit";
  if (filters.vegetarianRequired && !explicit(item.vegetarian_status))
    return false;
  if (filters.veganRequired && !explicit(item.vegan_status)) return false;
  if (filters.halalRequired && !explicit(item.halal_status)) return false;
  return true;
}

async function vectorScores(
  env: AppBindings,
  query: string,
  filters: SearchFilters,
  target: "restaurant" | "dish",
): Promise<Map<string, number>> {
  if (String(env.ENABLE_AI_SEARCH) !== "true") return new Map();
  try {
    const [embedding] = await generateEmbeddings(env, [query]);
    if (!embedding) return new Map();
    const metadataFilter: VectorizeVectorMetadataFilter = {
      documentType: {
        $eq: target === "dish" ? "menu_item" : "restaurant_profile",
      },
    };
    if (filters.city) metadataFilter["city"] = { $eq: filters.city };
    if (filters.district)
      metadataFilter["district"] = { $eq: filters.district };
    if (filters.vegetarianRequired)
      metadataFilter["vegetarianExplicit"] = { $eq: true };
    if (filters.veganRequired) metadataFilter["veganExplicit"] = { $eq: true };
    if (filters.halalRequired) metadataFilter["halalExplicit"] = { $eq: true };
    if (filters.familyFriendlyRequired)
      metadataFilter["familyFriendly"] = { $eq: true };
    if (filters.minimumQualityScore !== undefined) {
      metadataFilter["qualityScore"] = { $gte: filters.minimumQualityScore };
    }
    const response = await env.RESTAURANT_SEARCH.query(embedding, {
      topK: 100,
      namespace: "vietnam-restaurants",
      returnMetadata: "all",
      filter: metadataFilter,
    });
    const scores = new Map<string, number>();
    for (const match of response.matches) {
      if (typeof match.metadata?.["restaurantId"] === "string") {
        const id = match.metadata["restaurantId"];
        scores.set(id, Math.max(scores.get(id) ?? 0, match.score));
      }
    }
    return scores;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        operation: "vector.search",
        error: String(error),
      }),
    );
    return new Map();
  }
}

export async function searchRestaurants(
  env: AppBindings,
  request: SearchRequest,
  options: SearchOptions = {},
) {
  const target = options.target ?? "restaurant";
  const parsed = parseQueryDeterministically(request.query, target);
  const explicitFilters: SearchFilters = {
    ...request.filters,
  };
  const filters = mergeSearchFilters(parsed.hardFilters, explicitFilters);
  const candidates = await env.DB.prepare(
    `SELECT r.id AS restaurant_id, r.canonical_name, r.description, r.primary_cuisine,
        r.average_price_per_person_vnd, r.quality_score, r.verification_level, r.updated_at,
        b.id AS branch_id, b.address_text, b.district, b.city, b.latitude, b.longitude, b.opening_hours_json,
        (SELECT value_json FROM restaurant_attributes a WHERE a.restaurant_id = r.id AND a.predicate = 'restaurant.family_friendly') AS family_friendly_json,
        (SELECT value_json FROM restaurant_attributes a WHERE a.restaurant_id = r.id AND a.predicate = 'restaurant.dining_occasion') AS occasions_json,
        (SELECT value_json FROM restaurant_attributes a WHERE a.restaurant_id = r.id AND a.predicate = 'restaurant.amenities') AS amenities_json,
        COALESCE((SELECT SUM(mention_count) FROM review_aspect_aggregates ra WHERE ra.restaurant_id = r.id), 0) AS review_mentions
       FROM restaurants r JOIN restaurant_branches b ON b.restaurant_id = r.id
       WHERE r.status = 'active' AND r.quality_score >= ?1
         AND (?2 IS NULL OR b.city = ?2) AND (?3 IS NULL OR b.district = ?3)
       ORDER BY r.quality_score DESC LIMIT 300`,
  )
    .bind(
      filters.minimumQualityScore ?? 0,
      filters.city ?? null,
      filters.district ?? null,
    )
    .all<CandidateRow>();
  const restaurantIds = [
    ...new Set(candidates.results.map((candidate) => candidate.restaurant_id)),
  ];
  if (restaurantIds.length === 0) {
    return { parsedIntent: { ...parsed, filters }, results: [] };
  }
  const placeholders = restaurantIds.map(() => "?").join(",");
  const menuRows = await env.DB.prepare(
    `SELECT mi.id, mi.restaurant_id, mi.display_name, mi.description, mi.price_amount_vnd,
        mi.vegetarian_status, mi.vegan_status, mi.halal_status, mi.extraction_confidence, m.source_id
       FROM menu_items mi JOIN menus m ON m.id = mi.menu_id
       WHERE mi.restaurant_id IN (${placeholders}) AND mi.status = 'active' AND m.status = 'published' LIMIT 3000`,
  )
    .bind(...restaurantIds)
    .all<SearchMenuItemRow>();
  const itemsByRestaurant = new Map<string, SearchMenuItemRow[]>();
  for (const item of menuRows.results) {
    const items = itemsByRestaurant.get(item.restaurant_id) ?? [];
    items.push(item);
    itemsByRestaurant.set(item.restaurant_id, items);
  }
  const vectors = await vectorScores(
    env,
    parsed.semanticQuery,
    filters,
    target,
  );
  const queryTokens = tokenize(parsed.semanticQuery);
  const results = [];
  for (const candidate of candidates.results) {
    const allItems = itemsByRestaurant.get(candidate.restaurant_id) ?? [];
    const eligibleItems = allItems.filter((item) => {
      if (!strictDietaryMatch(item, filters)) return false;
      if (
        typeof filters.maxDishPriceVnd === "number" &&
        (item.price_amount_vnd === null ||
          item.price_amount_vnd > filters.maxDishPriceVnd)
      ) {
        return false;
      }
      return true;
    });
    if (
      (filters.vegetarianRequired ||
        filters.veganRequired ||
        filters.halalRequired ||
        filters.maxDishPriceVnd !== undefined) &&
      eligibleItems.length === 0
    ) {
      continue;
    }
    if (
      typeof filters.maxPricePerPersonVnd === "number" &&
      (candidate.average_price_per_person_vnd === null ||
        candidate.average_price_per_person_vnd > filters.maxPricePerPersonVnd)
    ) {
      continue;
    }
    const familyFriendly = parseJson<boolean>(
      candidate.family_friendly_json,
      false,
    );
    if (filters.familyFriendlyRequired && !familyFriendly) continue;
    let distanceMeters: number | null = null;
    if (request.location) {
      distanceMeters = haversineDistanceMeters(
        {
          latitude: request.location.latitude,
          longitude: request.location.longitude,
        },
        { latitude: candidate.latitude, longitude: candidate.longitude },
      );
      if (distanceMeters > request.location.radiusMeters) continue;
    }
    const openingState = filters.openAt
      ? evaluateOpeningHours(candidate.opening_hours_json, filters.openAt)
      : ("unknown" as const);
    if (filters.openAt && openingState !== "open") continue;

    const matchedItems = eligibleItems
      .map((item) => ({
        item,
        similarity: tokenSimilarity(
          queryTokens,
          `${item.display_name} ${item.description ?? ""}`,
        ),
      }))
      .filter((entry) => entry.similarity > 0 || target !== "dish")
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 5);
    if (target === "dish" && matchedItems.length === 0) continue;
    const profileText = [
      candidate.canonical_name,
      candidate.description ?? "",
      candidate.primary_cuisine ?? "",
      JSON.stringify(parseJson(candidate.occasions_json, [])),
      JSON.stringify(parseJson(candidate.amenities_json, [])),
    ].join(" ");
    const deterministicSemantic = Math.max(
      tokenSimilarity(queryTokens, profileText),
      ...matchedItems.map((entry) => entry.similarity),
    );
    const semantic = Math.max(
      vectors.get(candidate.restaurant_id) ?? 0,
      deterministicSemantic,
    );
    if (semantic === 0 && queryTokens.length > 0) continue;
    const preference =
      parsed.softPreferences.ambience.length > 0
        ? tokenSimilarity(parsed.softPreferences.ambience, profileText)
        : 0.5;
    const scoreComponents = {
      semantic,
      preference,
      distance: distanceScore(
        distanceMeters,
        request.location?.radiusMeters ?? null,
      ),
      quality: candidate.quality_score / 100,
      review: Math.min(1, candidate.review_mentions / 20),
      freshness: freshnessScore(candidate.updated_at),
    };
    const reasons = [
      `Matched restaurant profile or menu with semantic score ${semantic.toFixed(2)}.`,
    ];
    if (matchedItems.length > 0)
      reasons.push(`${matchedItems.length} menu item(s) matched the request.`);
    if (familyFriendly)
      reasons.push("Family suitability is explicitly source-supported.");
    if (distanceMeters !== null)
      reasons.push(`The branch is ${distanceMeters} meters away.`);
    results.push({
      restaurant: {
        id: candidate.restaurant_id,
        name: candidate.canonical_name,
        primaryCuisine: candidate.primary_cuisine,
        averagePricePerPersonVnd: candidate.average_price_per_person_vnd,
        qualityScore: candidate.quality_score,
        verificationLevel: candidate.verification_level,
      },
      branch: {
        id: candidate.branch_id,
        address: candidate.address_text,
        district: candidate.district,
        city: candidate.city,
        distanceMeters,
        isOpenAtRequestedTime: filters.openAt ? openingState === "open" : null,
        openingState,
      },
      score: rankCandidate(scoreComponents),
      scoreComponents,
      matchedItems: matchedItems.map(({ item, similarity }) => ({
        id: item.id,
        name: item.display_name,
        priceAmountVnd: item.price_amount_vnd,
        similarityScore: similarity,
        dietary: {
          vegetarian: item.vegetarian_status,
          vegan: item.vegan_status,
          halal: item.halal_status,
        },
        sourceId: item.source_id,
      })),
      reasons,
      evidence: request.includeEvidence
        ? [...new Set(matchedItems.map(({ item }) => item.source_id))].map(
            (sourceId) => ({ sourceId, type: "menu_text" }),
          )
        : [],
    });
  }
  results.sort((left, right) => right.score - left.score);
  return {
    parsedIntent: { ...parsed, filters },
    results: results.slice(0, request.limit),
  };
}

export function recommendationQuery(input: {
  cuisines: string[];
  likedDishes: string[];
  occasion: string | null;
  ambience: string[];
}): string {
  return [
    ...input.cuisines,
    ...input.likedDishes,
    input.occasion ?? "",
    ...input.ambience,
  ]
    .filter(Boolean)
    .join(" ");
}

export function parsedIntentForResponse(parsed: ParsedQuery) {
  return parsed;
}
