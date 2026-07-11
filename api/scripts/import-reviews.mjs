import { chunks, postAdmin, readCsv } from "./lib.mjs";

const path =
  process.env.TASCO_REVIEW_CSV ??
  "../resources/ai_maps_track6_dataset_participants.xlsm - Restaurant Reviews.csv";
const rows = await readCsv(path);
const sentiment = { "Tích cực": 0.75, "Trung lập": 0, "Tiêu cực": -0.75 };
const records = rows.map((row) => ({
  externalRestaurantId: row.restaurant_id,
  externalReviewId: row.review_id,
  text: row.review_text,
  rating: row.rating ? Number(row.rating) : null,
  publishedAt: row.review_date || null,
  sentimentScore: sentiment[row.sentiment_label] ?? null,
}));

let imported = 0;
let rejected = 0;
for (const [index, batch] of chunks(records, 500).entries()) {
  const result = await postAdmin(
    "/api/v1/admin/imports/reviews",
    { records: batch },
    `seed-reviews-${index}`,
  );
  imported += result.data.imported;
  rejected += result.data.rejected;
}
console.log(
  JSON.stringify({ imported, rejected, total: records.length }, null, 2),
);
