import { menuItemClaimValueSchema } from "../routes/schemas";
import { AppError, notFound } from "../shared/errors";
import { createId, nowIso } from "../shared/ids";
import { normalizeText } from "../shared/normalization";
import { recomputeRestaurantQuality } from "../restaurants/repository";

interface ClaimRow {
  id: string;
  source_id: string;
  restaurant_id: string;
  branch_id: string | null;
  menu_item_id: string | null;
  predicate: string;
  value_json: string;
  basis: string;
  confidence: number;
  trust_weight: number;
  evidence_json: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export async function listClaims(
  db: D1Database,
  filters: {
    restaurantId?: string | undefined;
    sourceId?: string | undefined;
    predicate?: string | undefined;
    status?: string | undefined;
    minConfidence?: number | undefined;
    limit: number;
    cursor?: string | undefined;
  },
) {
  const conditions = ["1 = 1"];
  const bindings: Array<string | number> = [];
  for (const [column, value] of [
    ["restaurant_id", filters.restaurantId],
    ["source_id", filters.sourceId],
    ["predicate", filters.predicate],
    ["status", filters.status],
  ] as const) {
    if (value) {
      conditions.push(`${column} = ?`);
      bindings.push(value);
    }
  }
  if (filters.minConfidence !== undefined) {
    conditions.push("confidence >= ?");
    bindings.push(filters.minConfidence);
  }
  if (filters.cursor) {
    conditions.push("id > ?");
    bindings.push(filters.cursor);
  }
  bindings.push(filters.limit + 1);
  const rows = await db
    .prepare(
      `SELECT * FROM claims WHERE ${conditions.join(" AND ")} ORDER BY id LIMIT ?`,
    )
    .bind(...bindings)
    .all<ClaimRow>();
  const hasMore = rows.results.length > filters.limit;
  const page = rows.results.slice(0, filters.limit);
  return {
    items: page.map(toClaim),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

function toClaim(row: ClaimRow) {
  return {
    id: row.id,
    sourceId: row.source_id,
    restaurantId: row.restaurant_id,
    branchId: row.branch_id,
    menuItemId: row.menu_item_id,
    predicate: row.predicate,
    value: JSON.parse(row.value_json) as unknown,
    basis: row.basis,
    confidence: row.confidence,
    trustWeight: row.trust_weight,
    evidence: JSON.parse(row.evidence_json) as unknown,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function materializeMenuItem(
  db: D1Database,
  claim: ClaimRow,
  value: unknown,
): Promise<string> {
  const parsed = menuItemClaimValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      "AI_OUTPUT_INVALID",
      "The menu claim value is invalid.",
      422,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }
  const timestamp = nowIso();
  const existingMenu = await db
    .prepare(
      "SELECT id FROM menus WHERE restaurant_id = ?1 AND source_id = ?2 ORDER BY version DESC LIMIT 1",
    )
    .bind(claim.restaurant_id, claim.source_id)
    .first<{ id: string }>();
  const menuId = existingMenu?.id ?? createId("menu");
  let sectionId: string | null = null;
  if (parsed.data.section) {
    const existingSection = await db
      .prepare(
        "SELECT id FROM menu_sections WHERE menu_id = ?1 AND normalized_name = ?2",
      )
      .bind(menuId, normalizeText(parsed.data.section))
      .first<{ id: string }>();
    sectionId = existingSection?.id ?? createId("section");
  }
  const itemId = claim.menu_item_id ?? createId("item");
  const statements = [
    db
      .prepare(
        `INSERT INTO menus (id, restaurant_id, branch_id, name, source_id, version, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 'published', ?6, ?6)
         ON CONFLICT(restaurant_id, source_id, version) DO UPDATE SET status = 'published', updated_at = excluded.updated_at`,
      )
      .bind(
        menuId,
        claim.restaurant_id,
        claim.branch_id,
        parsed.data.menuName,
        claim.source_id,
        timestamp,
      ),
  ];
  if (sectionId && parsed.data.section) {
    statements.push(
      db
        .prepare(
          `INSERT INTO menu_sections (id, menu_id, name, normalized_name, sort_order)
           VALUES (?1, ?2, ?3, ?4, 0) ON CONFLICT(menu_id, normalized_name) DO NOTHING`,
        )
        .bind(
          sectionId,
          menuId,
          parsed.data.section,
          normalizeText(parsed.data.section),
        ),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO menu_items (
          id, menu_id, section_id, restaurant_id, display_name, normalized_name, description,
          price_amount_vnd, price_text_raw, price_confidence, vegetarian_status, vegan_status,
          halal_status, spicy_level, status, extraction_confidence, evidence_json, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'active', ?15, ?16, ?17, ?17)
        ON CONFLICT(menu_id, normalized_name, price_text_raw) DO UPDATE SET
          description = excluded.description, price_amount_vnd = excluded.price_amount_vnd,
          price_confidence = excluded.price_confidence, vegetarian_status = excluded.vegetarian_status,
          vegan_status = excluded.vegan_status, halal_status = excluded.halal_status,
          status = 'active', evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`,
      )
      .bind(
        itemId,
        menuId,
        sectionId,
        claim.restaurant_id,
        parsed.data.name,
        normalizeText(parsed.data.name),
        parsed.data.description,
        parsed.data.priceAmountVnd,
        parsed.data.priceTextRaw,
        parsed.data.priceConfidence,
        parsed.data.vegetarianStatus,
        parsed.data.veganStatus,
        parsed.data.halalStatus,
        parsed.data.spicyLevel,
        parsed.data.confidence,
        claim.evidence_json,
        timestamp,
      ),
  );
  await db.batch(statements);
  return itemId;
}

export async function reviewClaim(
  db: D1Database,
  claimId: string,
  input: {
    decision: "accept" | "reject" | "correct_and_accept";
    correctedValue: unknown;
    note: string | null;
  },
  actor: string,
  requestId: string,
) {
  const claim = await db
    .prepare("SELECT * FROM claims WHERE id = ?1")
    .bind(claimId)
    .first<ClaimRow>();
  if (!claim) throw notFound("Claim");
  if (claim.status !== "candidate")
    throw new AppError(
      "CONFLICT",
      "Only candidate claims can be reviewed.",
      409,
    );
  const timestamp = nowIso();
  const value =
    input.decision === "correct_and_accept"
      ? input.correctedValue
      : (JSON.parse(claim.value_json) as unknown);
  const status = input.decision === "reject" ? "rejected" : "accepted";
  let menuItemId = claim.menu_item_id;
  if (status === "accepted") {
    if (claim.predicate === "menu.item")
      menuItemId = await materializeMenuItem(db, claim, value);
    else if (
      claim.predicate === "restaurant.primary_cuisine" &&
      typeof value === "string"
    ) {
      await db
        .prepare(
          "UPDATE restaurants SET primary_cuisine = ?1, updated_at = ?2, last_enriched_at = ?2 WHERE id = ?3",
        )
        .bind(value, timestamp, claim.restaurant_id)
        .run();
    } else if (claim.predicate.startsWith("restaurant.")) {
      await db
        .prepare(
          `INSERT INTO restaurant_attributes (
            id, restaurant_id, predicate, value_json, evidence_claim_id, verification_status, confidence, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
          ON CONFLICT(restaurant_id, predicate) DO UPDATE SET
            value_json = excluded.value_json, evidence_claim_id = excluded.evidence_claim_id,
            verification_status = excluded.verification_status, confidence = excluded.confidence, updated_at = excluded.updated_at`,
        )
        .bind(
          createId("attr"),
          claim.restaurant_id,
          claim.predicate,
          JSON.stringify(value),
          claim.id,
          claim.basis === "visual_inference" || claim.basis === "llm_inference"
            ? "inferred"
            : "explicit",
          claim.confidence,
          timestamp,
        )
        .run();
    }
  }
  await db.batch([
    db
      .prepare(
        `UPDATE claims SET status = ?1, value_json = ?2, menu_item_id = ?3, reviewed_by = ?4,
         reviewed_at = ?5, updated_at = ?5 WHERE id = ?6`,
      )
      .bind(
        status,
        JSON.stringify(value),
        menuItemId,
        actor,
        timestamp,
        claim.id,
      ),
    db
      .prepare(
        `INSERT INTO audit_events (
          id, actor, action, entity_type, entity_id, before_json, after_json, note, request_id, created_at
        ) VALUES (?1, ?2, 'claim.review', 'claim', ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        createId("audit"),
        actor,
        claim.id,
        JSON.stringify(toClaim(claim)),
        JSON.stringify({ status, value, menuItemId }),
        input.note,
        requestId,
        timestamp,
      ),
  ]);
  const qualityScore = await recomputeRestaurantQuality(
    db,
    claim.restaurant_id,
  );
  return {
    claimId: claim.id,
    status,
    restaurantId: claim.restaurant_id,
    menuItemId,
    qualityScore,
  };
}
