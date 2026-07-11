export interface MatchFeatures {
  nameSimilarity: number;
  addressSimilarity: number;
  geographicProximity: number;
  phoneEqual: boolean;
  websiteDomainEqual: boolean;
  tascoPoiIdEqual?: boolean;
}

export interface MatchResult {
  score: number;
  decision: "link" | "review" | "separate";
  explanation: string[];
}

export function scoreEntityMatch(features: MatchFeatures): MatchResult {
  if (features.tascoPoiIdEqual) {
    return {
      score: 1,
      decision: "link",
      explanation: ["Exact Tasco POI identifier"],
    };
  }
  const score = Number(
    (
      0.35 * features.nameSimilarity +
      0.2 * features.addressSimilarity +
      0.2 * features.geographicProximity +
      0.15 * Number(features.phoneEqual) +
      0.1 * Number(features.websiteDomainEqual)
    ).toFixed(4),
  );
  const decision =
    score >= 0.9 ? "link" : score >= 0.72 ? "review" : "separate";
  const explanation: string[] = [];
  if (features.phoneEqual) explanation.push("Phone numbers match");
  if (features.websiteDomainEqual) explanation.push("Website domains match");
  if (features.geographicProximity >= 0.9)
    explanation.push("Locations are very close");
  if (features.nameSimilarity >= 0.9)
    explanation.push("Names are highly similar");
  return { score, decision, explanation };
}
