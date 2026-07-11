import type { z } from "zod";
import type { fixtureMenuImportSchema } from "../routes/schemas";
import { createId, nowIso } from "../shared/ids";
import { normalizeText } from "../shared/normalization";
import { dietaryConfidence } from "./dietary";

type FixtureMenuRecord = z.infer<
  typeof fixtureMenuImportSchema
>["records"][number];

interface IdRow {
  id: string;
}

interface MenuItemRow {
  id: string;
  display_name: string;
  description: string | null;
  price_amount_vnd: number | null;
  price_text_raw: string | null;
  price_confidence: number | null;
  vegetarian_status: string;
  vegan_status: string;
  halal_status: string;
  spicy_level: number | null;
  extraction_confidence: number;
  evidence_json: string;
  section_name: string | null;
}

function dietaryStatus(
  tags: string[],
  target: "vegetarian" | "vegan" | "halal",
): string {
  const normalized = tags.map(normalizeText);
  const aliases =
    target === "vegetarian"
      ? ["vegetarian", "chay"]
      : target === "vegan"
        ? ["vegan", "thuan chay"]
        : ["halal"];
  return normalized.some((tag) => aliases.includes(tag))
    ? "explicit"
    : "unknown";
}

export async function importFixtureMenuItems(
  db: D1Database,
  records: FixtureMenuRecord[],
) {
  let imported = 0;
  let rejected = 0;
  const restaurantIds = new Set<string>();
  for (const record of records) {
    const restaurant = await db
      .prepare(
        `SELECT r.id FROM restaurants r
         JOIN restaurant_external_ids e ON e.restaurant_id = r.id
         WHERE e.provider = 'tasco' AND e.external_id = ?1`,
      )
      .bind(record.externalRestaurantId)
      .first<IdRow>();
    if (!restaurant) {
      rejected += 1;
      continue;
    }
    const timestamp = nowIso();
    const sourceHash = `tasco-menu:${record.externalRestaurantId}`;
    const source = await db
      .prepare(
        "SELECT id FROM sources WHERE restaurant_id = ?1 AND content_hash = ?2",
      )
      .bind(restaurant.id, sourceHash)
      .first<IdRow>();
    const sourceId = source?.id ?? createId("src");
    const menu = await db
      .prepare(
        "SELECT id FROM menus WHERE restaurant_id = ?1 AND source_id = ?2 AND status = 'published'",
      )
      .bind(restaurant.id, sourceId)
      .first<IdRow>();
    const menuId = menu?.id ?? createId("menu");
    const sectionName = record.category ?? "Món khác";
    const section = await db
      .prepare(
        "SELECT id FROM menu_sections WHERE menu_id = ?1 AND normalized_name = ?2",
      )
      .bind(menuId, normalizeText(sectionName))
      .first<IdRow>();
    const sectionId = section?.id ?? createId("section");
    const itemId = createId("item");
    await db.batch([
      db
        .prepare(
          `INSERT INTO sources (
            id, restaurant_id, type, content_hash, publisher_name, is_official, retrieved_at,
            processing_status, rights_status, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, 'tasco_menu', ?3, 'Tasco', 1, ?4, 'processed', 'provided_dataset', '{}', ?4, ?4)
          ON CONFLICT(restaurant_id, content_hash) DO NOTHING`,
        )
        .bind(sourceId, restaurant.id, sourceHash, timestamp),
      db
        .prepare(
          `INSERT INTO menus (id, restaurant_id, name, source_id, version, status, created_at, updated_at)
           VALUES (?1, ?2, 'Tasco menu', ?3, 1, 'published', ?4, ?4)
           ON CONFLICT(restaurant_id, source_id, version) DO UPDATE SET status = 'published', updated_at = excluded.updated_at`,
        )
        .bind(menuId, restaurant.id, sourceId, timestamp),
      db
        .prepare(
          `INSERT INTO menu_sections (id, menu_id, name, normalized_name, sort_order)
           VALUES (?1, ?2, ?3, ?4, 0) ON CONFLICT(menu_id, normalized_name) DO NOTHING`,
        )
        .bind(sectionId, menuId, sectionName, normalizeText(sectionName)),
      db
        .prepare(
          `INSERT INTO menu_items (
            id, menu_id, section_id, restaurant_id, display_name, normalized_name, description,
            price_amount_vnd, price_text_raw, price_confidence, vegetarian_status, vegan_status,
            halal_status, spicy_level, status, extraction_confidence, evidence_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16, ?17, ?17)
          ON CONFLICT(menu_id, normalized_name, price_text_raw) DO UPDATE SET
            description = excluded.description, price_amount_vnd = excluded.price_amount_vnd,
            vegetarian_status = excluded.vegetarian_status, vegan_status = excluded.vegan_status,
            halal_status = excluded.halal_status, status = excluded.status, updated_at = excluded.updated_at`,
        )
        .bind(
          itemId,
          menuId,
          sectionId,
          restaurant.id,
          record.name,
          normalizeText(record.name),
          record.description,
          record.priceAmountVnd,
          record.priceAmountVnd === null ? null : String(record.priceAmountVnd),
          record.priceAmountVnd === null ? null : 1,
          dietaryStatus(record.dietaryTags, "vegetarian"),
          dietaryStatus(record.dietaryTags, "vegan"),
          dietaryStatus(record.dietaryTags, "halal"),
          record.spicyLevel,
          record.available ? "active" : "unavailable",
          JSON.stringify({
            externalMenuItemId: record.externalMenuItemId,
            ingredients: record.ingredients,
          }),
          timestamp,
        ),
    ]);
    imported += 1;
    restaurantIds.add(restaurant.id);
  }
  return { imported, rejected, restaurantIds: [...restaurantIds] };
}

export async function listRestaurantMenu(
  db: D1Database,
  restaurantId: string,
  filters: {
    branchId?: string | undefined;
    vegetarian?: boolean | undefined;
    vegan?: boolean | undefined;
    halal?: boolean | undefined;
    maxPriceVnd?: number | undefined;
    category?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  },
) {
  const conditions = [
    "mi.restaurant_id = ?",
    "m.status = 'published'",
    "mi.status = 'active'",
  ];
  const bindings: Array<string | number> = [restaurantId];
  if (filters.branchId) {
    conditions.push("m.branch_id = ?");
    bindings.push(filters.branchId);
  }
  if (filters.vegetarian)
    conditions.push("mi.vegetarian_status IN ('verified', 'explicit')");
  if (filters.vegan)
    conditions.push("mi.vegan_status IN ('verified', 'explicit')");
  if (filters.halal)
    conditions.push("mi.halal_status IN ('verified', 'explicit')");
  if (filters.maxPriceVnd !== undefined) {
    conditions.push("mi.price_amount_vnd <= ?");
    bindings.push(filters.maxPriceVnd);
  }
  if (filters.category) {
    conditions.push("ms.normalized_name = ?");
    bindings.push(normalizeText(filters.category));
  }
  if (filters.cursor) {
    conditions.push("mi.id > ?");
    bindings.push(filters.cursor);
  }
  bindings.push(filters.limit + 1);
  const query = `SELECT mi.*, ms.name AS section_name FROM menu_items mi
    JOIN menus m ON m.id = mi.menu_id
    LEFT JOIN menu_sections ms ON ms.id = mi.section_id
    WHERE ${conditions.join(" AND ")} ORDER BY mi.id LIMIT ?`;
  const rows = await db
    .prepare(query)
    .bind(...bindings)
    .all<MenuItemRow>();
  const hasMore = rows.results.length > filters.limit;
  const page = rows.results.slice(0, filters.limit);
  return {
    items: page.map((item) => ({
      id: item.id,
      name: item.display_name,
      description: item.description,
      category: item.section_name,
      priceAmountVnd: item.price_amount_vnd,
      priceTextRaw: item.price_text_raw,
      priceConfidence: item.price_confidence,
      dietary: {
        vegetarian: {
          status: item.vegetarian_status,
          confidence: dietaryConfidence(
            item.vegetarian_status,
            item.extraction_confidence,
          ),
        },
        vegan: {
          status: item.vegan_status,
          confidence: dietaryConfidence(
            item.vegan_status,
            item.extraction_confidence,
          ),
        },
        halal: {
          status: item.halal_status,
          confidence: dietaryConfidence(
            item.halal_status,
            item.extraction_confidence,
          ),
        },
      },
      spicyLevel: item.spicy_level,
      evidence: JSON.parse(item.evidence_json) as unknown,
    })),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}
