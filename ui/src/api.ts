// Thin API layer matching the /v1/recommend contract in PLAN.md §8. Today
// every function is backed by lib/rank.ts running over local fixture data
// (no backend exists yet). When the real engine/serve.py backend ships,
// swap only the function bodies below for `fetch(...)` calls — call sites
// in components never need to change.
import { recommend as localRecommend, getPoi as localGetPoi } from "./lib/rank";
import type { PlaceDetail, SearchFilters, SearchResponse, UserLocation } from "./types";

export async function recommend(
  query: string,
  filters: SearchFilters,
  userLoc?: UserLocation,
): Promise<SearchResponse> {
  return localRecommend({ query, filters, userLoc });
}

export async function getPoi(id: string): Promise<PlaceDetail | null> {
  return localGetPoi(id) ?? null;
}
