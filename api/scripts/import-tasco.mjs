import { chunks, list, postAdmin, readCsv } from "./lib.mjs";

const path =
  process.env.TASCO_POI_CSV ??
  "../resources/ai_maps_track6_dataset_participants.xlsm - Restaurant POI Dataset.csv";
const rows = await readCsv(path);
const records = rows.map((row) => ({
  tascoPoiId: row.restaurant_id,
  name: row.restaurant_name,
  address: row.address,
  district: row.district || null,
  city: row.city || null,
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  category: row.category || "restaurant",
  cuisine: row.cuisine_type || null,
  averagePriceVnd: row.avg_price_vnd ? Number(row.avg_price_vnd) : null,
  description: row.description_raw || null,
  openingHours: row.opening_hours || null,
  amenities: list(row.amenities_raw),
  recommendedSegments: list(row.recommended_segments),
}));

let imported = 0;
let updated = 0;
for (const [index, batch] of chunks(records).entries()) {
  const result = await postAdmin(
    "/api/v1/admin/imports/tasco-pois",
    { records: batch },
    `seed-tasco-${index}`,
  );
  imported += result.data.imported;
  updated += result.data.updated;
}
console.log(
  JSON.stringify({ imported, updated, total: records.length }, null, 2),
);
