import type { AppBindings } from "../env";
import { generateEmbeddings } from "../ai/embeddings";
import { sha256 } from "../shared/crypto";
import { AppError } from "../shared/errors";
import { createId, nowIso } from "../shared/ids";
import { parseJson } from "../shared/json";

interface IndexRestaurantRow {
  id: string;
  canonical_name: string;
  primary_cuisine: string | null;
  description: string | null;
  average_price_per_person_vnd: number | null;
  quality_score: number;
  updated_at: string;
  branch_id: string;
  district: string | null;
  city: string | null;
}

interface IndexMenuItemRow {
  id: string;
  restaurant_id: string;
  display_name: string;
  description: string | null;
  price_amount_vnd: number | null;
  vegetarian_status: string;
  vegan_status: string;
  halal_status: string;
  section_name: string | null;
}

interface SearchDocumentRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  menu_item_id: string | null;
  type: string;
  embedding_text: string;
  metadata_json: string;
}

function isExplicit(status: string): boolean {
  return status === "verified" || status === "explicit";
}

async function upsertDocument(
  env: AppBindings,
  input: {
    restaurantId: string;
    branchId: string | null;
    menuItemId: string | null;
    type: "restaurant_profile" | "menu_item";
    title: string;
    body: string;
    embeddingText: string;
    metadata: Record<string, string | number | boolean>;
  },
): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT id, embedding_hash FROM search_documents
       WHERE restaurant_id = ?1 AND type = ?2 AND COALESCE(menu_item_id, '') = COALESCE(?3, '') LIMIT 1`,
  )
    .bind(input.restaurantId, input.type, input.menuItemId)
    .first<{ id: string; embedding_hash: string }>();
  const id = existing?.id ?? createId("doc");
  const normalizedText = input.embeddingText.trim().replace(/\s+/g, " ");
  const embeddingHash = await sha256(
    `${env.EMBEDDING_MODEL}\n${input.type}\n${normalizedText}`,
  );
  const timestamp = nowIso();
  const vectorStatus =
    existing?.embedding_hash === embeddingHash ? "indexed" : "pending";
  await env.DB.prepare(
    `INSERT INTO search_documents (
        id, restaurant_id, branch_id, menu_item_id, type, title, body, embedding_text,
        embedding_hash, embedding_model, vector_status, metadata_json, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
      ON CONFLICT(id) DO UPDATE SET
        branch_id = excluded.branch_id, title = excluded.title, body = excluded.body,
        embedding_text = excluded.embedding_text, embedding_hash = excluded.embedding_hash,
        embedding_model = excluded.embedding_model, vector_status = excluded.vector_status,
        metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      input.restaurantId,
      input.branchId,
      input.menuItemId,
      input.type,
      input.title,
      input.body,
      normalizedText,
      embeddingHash,
      env.EMBEDDING_MODEL,
      vectorStatus,
      JSON.stringify(input.metadata),
      timestamp,
    )
    .run();
  return id;
}

export async function rebuildRestaurantDocuments(
  env: AppBindings,
  restaurantId: string,
): Promise<string[]> {
  const restaurant = await env.DB.prepare(
    `SELECT r.id, r.canonical_name, r.primary_cuisine, r.description, r.average_price_per_person_vnd,
        r.quality_score, r.updated_at, b.id AS branch_id, b.district, b.city
       FROM restaurants r JOIN restaurant_branches b ON b.restaurant_id = r.id
       WHERE r.id = ?1 AND r.status = 'active' ORDER BY b.created_at LIMIT 1`,
  )
    .bind(restaurantId)
    .first<IndexRestaurantRow>();
  if (!restaurant) return [];
  const [attributes, menuItems] = await Promise.all([
    env.DB.prepare(
      "SELECT predicate, value_json FROM restaurant_attributes WHERE restaurant_id = ?1 AND verification_status != 'inferred'",
    )
      .bind(restaurantId)
      .all<{ predicate: string; value_json: string }>(),
    env.DB.prepare(
      `SELECT mi.id, mi.restaurant_id, mi.display_name, mi.description, mi.price_amount_vnd,
          mi.vegetarian_status, mi.vegan_status, mi.halal_status, ms.name AS section_name
         FROM menu_items mi JOIN menus m ON m.id = mi.menu_id
         LEFT JOIN menu_sections ms ON ms.id = mi.section_id
         WHERE mi.restaurant_id = ?1 AND mi.status = 'active' AND m.status = 'published'`,
    )
      .bind(restaurantId)
      .all<IndexMenuItemRow>(),
  ]);
  const attributeText = attributes.results
    .map(
      (attribute) =>
        `${attribute.predicate}: ${JSON.stringify(parseJson(attribute.value_json, null))}`,
    )
    .join(". ");
  const highlights = menuItems.results
    .slice(0, 12)
    .map((item) => item.display_name)
    .join(", ");
  const priceText = restaurant.average_price_per_person_vnd
    ? `${restaurant.average_price_per_person_vnd} VND per person`
    : "unknown";
  const profileText = `Restaurant: ${restaurant.canonical_name}.
Location: ${restaurant.district ?? ""}, ${restaurant.city ?? ""}.
Cuisine: ${restaurant.primary_cuisine ?? "unknown"}.
Price per person: ${priceText}.
Attributes: ${attributeText || "none explicitly supported"}.
Menu highlights: ${highlights || "none published"}.`;
  const familyFriendly = attributes.results.some(
    (attribute) =>
      attribute.predicate === "restaurant.family_friendly" &&
      parseJson<boolean>(attribute.value_json, false),
  );
  const ids = [
    await upsertDocument(env, {
      restaurantId,
      branchId: restaurant.branch_id,
      menuItemId: null,
      type: "restaurant_profile",
      title: restaurant.canonical_name,
      body: profileText,
      embeddingText: profileText,
      metadata: {
        restaurantId,
        branchId: restaurant.branch_id,
        menuItemId: "",
        documentType: "restaurant_profile",
        city: restaurant.city ?? "",
        district: restaurant.district ?? "",
        primaryCuisine: restaurant.primary_cuisine ?? "",
        vegetarianExplicit: false,
        veganExplicit: false,
        halalExplicit: false,
        familyFriendly,
        priceAmountVnd: restaurant.average_price_per_person_vnd ?? -1,
        qualityScore: restaurant.quality_score,
        updatedAtEpoch: Math.floor(
          new Date(restaurant.updated_at).getTime() / 1000,
        ),
      },
    }),
  ];
  for (const item of menuItems.results) {
    const dietary = [
      isExplicit(item.vegetarian_status)
        ? "vegetarian explicitly supported"
        : "",
      isExplicit(item.vegan_status) ? "vegan explicitly supported" : "",
      isExplicit(item.halal_status) ? "halal explicitly supported" : "",
    ]
      .filter(Boolean)
      .join(", ");
    const embeddingText = `Dish: ${item.display_name}.
Restaurant: ${restaurant.canonical_name}.
Cuisine: ${restaurant.primary_cuisine ?? "unknown"}.
Category: ${item.section_name ?? "unknown"}.
Description: ${item.description ?? "not supplied"}.
Price: ${item.price_amount_vnd ?? "unknown"} VND.
Dietary information: ${dietary || "unknown"}.
Location: ${restaurant.district ?? ""}, ${restaurant.city ?? ""}.`;
    ids.push(
      await upsertDocument(env, {
        restaurantId,
        branchId: restaurant.branch_id,
        menuItemId: item.id,
        type: "menu_item",
        title: item.display_name,
        body: embeddingText,
        embeddingText,
        metadata: {
          restaurantId,
          branchId: restaurant.branch_id,
          menuItemId: item.id,
          documentType: "menu_item",
          city: restaurant.city ?? "",
          district: restaurant.district ?? "",
          primaryCuisine: restaurant.primary_cuisine ?? "",
          vegetarianExplicit: isExplicit(item.vegetarian_status),
          veganExplicit: isExplicit(item.vegan_status),
          halalExplicit: isExplicit(item.halal_status),
          familyFriendly,
          priceAmountVnd: item.price_amount_vnd ?? -1,
          qualityScore: restaurant.quality_score,
          updatedAtEpoch: Math.floor(
            new Date(restaurant.updated_at).getTime() / 1000,
          ),
        },
      }),
    );
  }
  return ids;
}

export async function indexPendingDocuments(
  env: AppBindings,
  requestedIds: string[] = [],
): Promise<number> {
  const conditions =
    requestedIds.length > 0
      ? `id IN (${requestedIds.map(() => "?").join(",")})`
      : "vector_status IN ('pending', 'stale', 'failed')";
  const documents = await env.DB.prepare(
    `SELECT id, restaurant_id, branch_id, menu_item_id, type, embedding_text, metadata_json
       FROM search_documents WHERE ${conditions} LIMIT 100`,
  )
    .bind(...requestedIds)
    .all<SearchDocumentRow>();
  if (documents.results.length === 0) return 0;
  const vectors = await generateEmbeddings(
    env,
    documents.results.map((document) => document.embedding_text),
  );
  const indexDetails = await env.RESTAURANT_SEARCH.describe();
  if (
    "dimensions" in indexDetails.config &&
    indexDetails.config.dimensions !== vectors[0]?.length
  ) {
    throw new AppError(
      "VECTOR_INDEX_UNAVAILABLE",
      `Vectorize expects ${indexDetails.config.dimensions} dimensions but ${env.EMBEDDING_MODEL} returned ${vectors[0]?.length ?? 0}.`,
      503,
    );
  }
  const mutation = await env.RESTAURANT_SEARCH.upsert(
    documents.results.map((document, index) => ({
      id: document.id,
      values: vectors[index]!,
      namespace: "vietnam-restaurants",
      metadata: parseJson<Record<string, VectorizeVectorMetadata>>(
        document.metadata_json,
        {},
      ),
    })),
  );
  const timestamp = nowIso();
  const mutationReference =
    "mutationId" in mutation
      ? mutation.mutationId
      : JSON.stringify(mutation.ids);
  await env.DB.batch(
    documents.results.map((document) =>
      env.DB.prepare(
        "UPDATE search_documents SET vector_status = 'indexed', vector_mutation_id = ?1, indexed_at = ?2, updated_at = ?2 WHERE id = ?3",
      ).bind(mutationReference, timestamp, document.id),
    ),
  );
  return documents.results.length;
}
