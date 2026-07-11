import { Hono } from "hono";
import type { AppEnv } from "../env";
import { searchRestaurants } from "../search/service";
import { AppError } from "../shared/errors";
import { positiveInteger } from "../shared/http";

export const tascoRoutes = new Hono<AppEnv>();

tascoRoutes.get("/search", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query) throw new AppError("VALIDATION_ERROR", "q is required.", 400);
  const latitude =
    c.req.query("lat") === undefined ? undefined : Number(c.req.query("lat"));
  const longitude =
    c.req.query("lon") === undefined ? undefined : Number(c.req.query("lon"));
  const radiusMeters =
    c.req.query("radiusMeters") === undefined
      ? 10_000
      : Number(c.req.query("radiusMeters"));
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const search = await searchRestaurants(c.env, {
    query,
    location: hasLocation
      ? { latitude: latitude!, longitude: longitude!, radiusMeters }
      : undefined,
    filters: {
      cuisines: [],
      vegetarianRequired: false,
      veganRequired: false,
      halalRequired: false,
      familyFriendlyRequired: false,
      minimumQualityScore: 0,
    },
    limit: positiveInteger(c.req.query("limit"), 10, 20),
    includeEvidence: false,
  });
  return c.json({
    query,
    results: search.results.map((result) => ({
      id: result.restaurant.id,
      type: "restaurant",
      name: result.restaurant.name,
      label: result.restaurant.name,
      address: result.branch.address,
      category: result.restaurant.primaryCuisine ?? "restaurant",
      coordinates: null,
      distanceMeters: result.branch.distanceMeters,
      score: result.score,
      source: "tasco-restaurant-intelligence",
    })),
    meta: { limit: search.results.length, lang: c.req.query("lang") ?? "vi" },
  });
});
