import type { SearchFilters } from "./filter-merge";

export interface ParsedQuery {
  semanticQuery: string;
  hardFilters: SearchFilters;
  softPreferences: {
    cuisines: string[];
    occasions: string[];
    ambience: string[];
    desiredDishes: string[];
    avoidedIngredients: string[];
  };
  target: "restaurant" | "dish" | "comparison" | "question";
}

function parseBudget(query: string): number | undefined {
  const match = /(\d{1,3}(?:[.,]\d{3})?|\d{1,3})\s*(k|nghìn|ngan|000)?/i.exec(
    query,
  );
  if (!match) return undefined;
  const compact = match[1]!.replace(/[.,]/g, "");
  const amount = Number(compact);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return match[2] || amount < 1000 ? amount * 1000 : amount;
}

export function parseQueryDeterministically(
  query: string,
  target: ParsedQuery["target"] = "restaurant",
): ParsedQuery {
  const lower = query.toLocaleLowerCase("vi");
  const required = (patterns: RegExp[]) =>
    patterns.some((pattern) => pattern.test(lower));
  const budget = parseBudget(lower);
  const hardFilters: SearchFilters = {};
  if (budget !== undefined) {
    if (target === "dish") hardFilters.maxDishPriceVnd = budget;
    else hardFilters.maxPricePerPersonVnd = budget;
  }
  if (
    required([
      /\bphải chay\b/,
      /\bvegetarian required\b/,
      /\bmón chay\b/,
      /\ban chay\b/,
    ])
  ) {
    hardFilters.vegetarianRequired = true;
  }
  if (required([/\bthuần chay\b/, /\bvegan required\b/]))
    hardFilters.veganRequired = true;
  if (required([/\bhalal\b/])) hardFilters.halalRequired = true;
  if (required([/gia đình/, /family(?: friendly| dining)?/]))
    hardFilters.familyFriendlyRequired = true;

  const ambience: string[] = [];
  if (/yên tĩnh|quiet/.test(lower)) ambience.push("quiet");
  if (/lãng mạn|romantic/.test(lower)) ambience.push("romantic");
  if (/bình dân|casual/.test(lower)) ambience.push("casual");
  return {
    semanticQuery: query,
    hardFilters,
    softPreferences: {
      cuisines: [],
      occasions: hardFilters.familyFriendlyRequired ? ["family"] : [],
      ambience,
      desiredDishes: [],
      avoidedIngredients: [],
    },
    target,
  };
}
