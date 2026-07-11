export type DietaryStatus =
  "verified" | "explicit" | "inferred" | "unknown" | `not_${string}`;

export function satisfiesRequiredDietaryStatus(status: DietaryStatus): boolean {
  return status === "verified" || status === "explicit";
}

export function dietaryConfidence(
  status: string,
  extractionConfidence: number,
): number | null {
  if (status === "unknown") return null;
  if (status === "verified") return 1;
  if (status === "explicit") return extractionConfidence;
  if (status === "inferred") return Math.min(extractionConfidence, 0.6);
  return 1;
}
