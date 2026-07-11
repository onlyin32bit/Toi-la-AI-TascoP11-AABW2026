export interface SearchFilters {
  city?: string | null | undefined;
  district?: string | null | undefined;
  maxPricePerPersonVnd?: number | null | undefined;
  maxDishPriceVnd?: number | null | undefined;
  vegetarianRequired?: boolean | undefined;
  veganRequired?: boolean | undefined;
  halalRequired?: boolean | undefined;
  familyFriendlyRequired?: boolean | undefined;
  minimumQualityScore?: number | undefined;
  openAt?: string | null | undefined;
}

export function mergeSearchFilters(
  parsed: SearchFilters,
  explicit: SearchFilters,
): SearchFilters {
  const result: SearchFilters = { ...parsed };
  for (const [key, value] of Object.entries(explicit)) {
    if (value !== undefined && value !== null)
      Object.assign(result, { [key]: value });
  }
  return result;
}
