export interface ResolutionCandidate {
  id: string;
  status: "candidate" | "accepted" | "rejected" | "superseded" | "expired";
  confidence: number;
  trustWeight: number;
  freshnessFactor: number;
  evidenceQualityFactor: number;
  createdAt: string;
}

export function resolutionScore(candidate: ResolutionCandidate): number {
  return (
    candidate.confidence *
    candidate.trustWeight *
    candidate.freshnessFactor *
    candidate.evidenceQualityFactor
  );
}

export function choosePreferredClaim(
  candidates: ResolutionCandidate[],
): ResolutionCandidate | null {
  return (
    [...candidates]
      .filter(
        (candidate) => !["rejected", "expired"].includes(candidate.status),
      )
      .sort((left, right) => {
        if (left.status === "accepted" && right.status !== "accepted")
          return -1;
        if (right.status === "accepted" && left.status !== "accepted") return 1;
        const scoreDelta = resolutionScore(right) - resolutionScore(left);
        if (scoreDelta !== 0) return scoreDelta;
        return right.createdAt.localeCompare(left.createdAt);
      })[0] ?? null
  );
}

export const TRUST_WEIGHTS = {
  merchant_verified: 1,
  tasco_authoritative: 0.95,
  official_website: 0.9,
  official_social_post: 0.88,
  explicit_menu_text: 0.85,
  open_structured_data: 0.75,
  provided_review_data: 0.7,
  independent_social: 0.55,
  user_upload: 0.55,
  ai_visual_inference: 0.35,
} as const;
