import { readFile } from "node:fs/promises";

const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8787";
const cases = JSON.parse(
  await readFile("test/fixtures/search-evaluation.json", "utf8"),
);
let recallAt5 = 0;
let recallAt10 = 0;
let reciprocalRank = 0;
let duplicateRestaurants = 0;
let hardFilterViolations = 0;

for (const entry of cases) {
  const response = await fetch(`${baseUrl}/api/v1/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: entry.query,
      filters: entry.filters ?? {},
      limit: 10,
      includeEvidence: true,
    }),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  const results = payload.data.results;
  const names = results.map((result) => result.restaurant.name);
  const rank = names.findIndex((name) =>
    entry.expectedRestaurantNames.includes(name),
  );
  if (rank >= 0 && rank < 5) recallAt5 += 1;
  if (rank >= 0 && rank < 10) recallAt10 += 1;
  if (rank >= 0) reciprocalRank += 1 / (rank + 1);
  duplicateRestaurants += names.length - new Set(names).size;
  if (entry.filters?.maxPricePerPersonVnd) {
    hardFilterViolations += results.filter(
      (result) =>
        result.restaurant.averagePricePerPersonVnd >
        entry.filters.maxPricePerPersonVnd,
    ).length;
  }
}

console.log(
  JSON.stringify(
    {
      cases: cases.length,
      recallAt5: recallAt5 / cases.length,
      recallAt10: recallAt10 / cases.length,
      meanReciprocalRank: reciprocalRank / cases.length,
      hardFilterViolations,
      duplicateRestaurants,
    },
    null,
    2,
  ),
);
