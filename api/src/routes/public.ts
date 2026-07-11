import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listRestaurantMenu } from "../menus/repository";
import { getRestaurantProfile } from "../restaurants/repository";
import { recommendationQuery, searchRestaurants } from "../search/service";
import { AppError } from "../shared/errors";
import { createId, nowIso } from "../shared/ids";
import { parseJsonBody, positiveInteger, success } from "../shared/http";
import {
  assistantSchema,
  compareSchema,
  dishSearchSchema,
  recommendationSchema,
  searchSchema,
} from "./schemas";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/restaurants/:restaurantId", async (c) => {
  const profile = await getRestaurantProfile(
    c.env.DB,
    c.req.param("restaurantId"),
  );
  if (!profile)
    throw new AppError("NOT_FOUND", "Restaurant was not found.", 404);
  return success(c, profile);
});

publicRoutes.get("/restaurants/:restaurantId/menu", async (c) => {
  const maxPriceText = c.req.query("maxPriceVnd");
  const maxPriceVnd =
    maxPriceText === undefined ? undefined : Number(maxPriceText);
  if (
    maxPriceVnd !== undefined &&
    (!Number.isInteger(maxPriceVnd) || maxPriceVnd <= 0)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "maxPriceVnd must be a positive integer.",
      400,
    );
  }
  const data = await listRestaurantMenu(c.env.DB, c.req.param("restaurantId"), {
    branchId: c.req.query("branchId"),
    vegetarian: c.req.query("vegetarian") === "true",
    vegan: c.req.query("vegan") === "true",
    halal: c.req.query("halal") === "true",
    maxPriceVnd,
    category: c.req.query("category"),
    limit: positiveInteger(c.req.query("limit"), 50, 100),
    cursor: c.req.query("cursor"),
  });
  return success(c, data);
});

publicRoutes.post("/search", async (c) => {
  const body = await parseJsonBody(c, searchSchema);
  return success(c, await searchRestaurants(c.env, body));
});

publicRoutes.post("/search/dishes", async (c) => {
  const body = await parseJsonBody(c, dishSearchSchema);
  const request = {
    query: body.query,
    location: body.location,
    filters: { ...body.filters, maxDishPriceVnd: body.filters.maxPriceVnd },
    limit: body.limit,
    includeEvidence: body.includeEvidence,
  };
  const search = await searchRestaurants(c.env, request, { target: "dish" });
  return success(c, {
    parsedIntent: search.parsedIntent,
    groups: search.results.map((result) => ({
      restaurant: result.restaurant,
      branch: result.branch,
      items: result.matchedItems,
    })),
  });
});

publicRoutes.post("/recommendations", async (c) => {
  const body = await parseJsonBody(c, recommendationSchema);
  const query = recommendationQuery(body.preferences);
  const data = await searchRestaurants(c.env, {
    query: query || "restaurant nearby",
    location: body.location,
    filters: {
      cuisines: body.preferences.cuisines,
      maxPricePerPersonVnd: body.preferences.budgetPerPersonVnd,
      vegetarianRequired: body.preferences.vegetarian,
      veganRequired: false,
      halalRequired: false,
      familyFriendlyRequired: body.preferences.occasion === "family",
      minimumQualityScore: 0,
    },
    limit: body.limit,
    includeEvidence: true,
  });
  return success(c, {
    methodology: "content_based",
    results: data.results,
    caveat:
      "Recommendations use supplied preferences and restaurant content, not behavioral personalization.",
  });
});

publicRoutes.post("/restaurants/compare", async (c) => {
  const body = await parseJsonBody(c, compareSchema);
  const profiles = await Promise.all(
    body.restaurantIds.map((id) => getRestaurantProfile(c.env.DB, id)),
  );
  if (profiles.some((profile) => profile === null))
    throw new AppError(
      "NOT_FOUND",
      "One or more restaurants were not found.",
      404,
    );
  const restaurants = profiles.map((profile) => ({
    id: profile!.id,
    name: profile!.canonicalName,
    cuisine: profile!.primaryCuisine,
    averagePricePerPersonVnd: profile!.averagePricePerPersonVnd,
    qualityScore: profile!.qualityScore,
    verificationLevel: profile!.verificationLevel,
    branches: profile!.branches,
    currentMenu: profile!.currentMenu,
    attributes: profile!.attributes,
    reviewInsights: profile!.reviewInsights,
  }));
  return success(c, { restaurants, summary: null });
});

publicRoutes.post("/assistant/messages", async (c) => {
  const body = await parseJsonBody(c, assistantSchema);
  const sessionId = body.sessionId ?? createId("session");
  const search = await searchRestaurants(c.env, {
    query: body.message,
    location: body.location
      ? { ...body.location, radiusMeters: 10_000 }
      : undefined,
    filters: {
      cuisines: [],
      vegetarianRequired: false,
      veganRequired: false,
      halalRequired: false,
      familyFriendlyRequired: false,
      minimumQualityScore: 0,
    },
    limit: 5,
    includeEvidence: true,
  });
  const citations = search.results.flatMap((result, index) => {
    const item = result.matchedItems[0];
    if (!item) return [];
    return [
      {
        marker: index + 1,
        restaurantId: result.restaurant.id,
        menuItemId: item.id,
        sourceId: item.sourceId,
      },
    ];
  });
  const answer =
    search.results.length === 0
      ? "I could not find a supported restaurant record matching that request."
      : `I found ${search.results.length} supported option(s): ${search.results
          .map(
            (result, index) =>
              `${result.restaurant.name}${citations[index] ? ` [${index + 1}]` : ""}`,
          )
          .join(", ")}.`;
  const unknowns = ["Current dish availability has not been verified."];
  const timestamp = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO assistant_sessions (id, created_at, updated_at) VALUES (?1, ?2, ?2)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    ).bind(sessionId, timestamp),
    c.env.DB.prepare(
      "INSERT INTO assistant_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, 'user', ?3, ?4)",
    ).bind(createId("message"), sessionId, body.message, timestamp),
    c.env.DB.prepare(
      "INSERT INTO assistant_messages (id, session_id, role, content, citations_json, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5)",
    ).bind(
      createId("message"),
      sessionId,
      answer,
      JSON.stringify(citations),
      timestamp,
    ),
  ]);
  return success(c, {
    sessionId,
    answer,
    citations,
    results: search.results,
    unknowns,
  });
});
