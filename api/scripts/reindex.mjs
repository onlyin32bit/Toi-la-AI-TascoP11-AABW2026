import { postAdmin } from "./lib.mjs";

const result = await postAdmin(
  "/api/v1/admin/reindex",
  {},
  `reindex-${new Date().toISOString().slice(0, 13)}`,
);
console.log(JSON.stringify(result.data, null, 2));
