import { chunks, list, postAdmin, readCsv } from "./lib.mjs";

const path =
  process.env.TASCO_MENU_CSV ??
  "../resources/ai_maps_track6_dataset_participants.xlsm - Menu Dataset.csv";
const rows = await readCsv(path);
const spicy = { "Không cay": 0, "Cay nhẹ": 1, "Cay vừa": 2, "Cay nhiều": 4 };
const records = rows.map((row) => ({
  externalRestaurantId: row.restaurant_id,
  externalMenuItemId: row.menu_item_id,
  name: row.dish_name,
  category: row.menu_category || null,
  priceAmountVnd: row.price_vnd ? Number(row.price_vnd) : null,
  description: row.description || null,
  ingredients: list(row.ingredients),
  dietaryTags: list(row.dietary_tags),
  spicyLevel: spicy[row.spicy_level] ?? null,
  available: row.availability_status !== "Tạm hết",
}));

let imported = 0;
let rejected = 0;
for (const [index, batch] of chunks(records, 500).entries()) {
  const result = await postAdmin(
    "/api/v1/admin/imports/menu-items",
    { records: batch },
    `seed-menus-${index}`,
  );
  imported += result.data.imported;
  rejected += result.data.rejected;
}
console.log(
  JSON.stringify({ imported, rejected, total: records.length }, null, 2),
);
