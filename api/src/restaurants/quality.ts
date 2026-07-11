export interface QualityInput {
  hasIdentityAndCoordinates: boolean;
  hasBranchInformation: boolean;
  hasContactAndHours: boolean;
  hasCuisine: boolean;
  activeMenuItemCount: number;
  pricedMenuItemRatio: number;
  hasImageEvidence: boolean;
  hasExplicitDietaryInformation: boolean;
  hasOccasionOrAmenities: boolean;
  freshnessDays: number | null;
  verificationLevel:
    "unverified" | "source_supported" | "merchant_verified" | "tasco_verified";
  unresolvedConflictCount: number;
}

export interface QualityResult {
  score: number;
  components: Record<string, number>;
  missing: string[];
}

export function calculateQualityScore(input: QualityInput): QualityResult {
  const components = {
    identity: input.hasIdentityAndCoordinates ? 15 : 0,
    branchInformation: input.hasBranchInformation ? 10 : 0,
    contactAndHours: input.hasContactAndHours ? 10 : 0,
    cuisine: input.hasCuisine ? 10 : 0,
    structuredMenu: Math.min(20, input.activeMenuItemCount * 2),
    menuPriceCoverage: Math.round(
      Math.max(0, Math.min(1, input.pricedMenuItemRatio)) * 10,
    ),
    imageEvidence: input.hasImageEvidence ? 5 : 0,
    dietaryInformation: input.hasExplicitDietaryInformation ? 5 : 0,
    occasionAndAmenities: input.hasOccasionOrAmenities ? 5 : 0,
    freshness:
      input.freshnessDays === null
        ? 0
        : input.freshnessDays <= 30
          ? 5
          : input.freshnessDays <= 90
            ? 3
            : 1,
    verificationHealth:
      input.unresolvedConflictCount > 0
        ? 0
        : input.verificationLevel === "tasco_verified" ||
            input.verificationLevel === "merchant_verified"
          ? 5
          : input.verificationLevel === "source_supported"
            ? 3
            : 0,
  };
  const score = Object.values(components).reduce(
    (sum, value) => sum + value,
    0,
  );
  const missing: string[] = [];
  if (!input.hasContactAndHours)
    missing.push("Contact information or opening hours");
  if (!input.hasCuisine) missing.push("Cuisine classification");
  if (input.activeMenuItemCount === 0) missing.push("Structured current menu");
  if (!input.hasExplicitDietaryInformation)
    missing.push("Verified dietary information");
  return { score, components, missing };
}
