import { readFile } from "node:fs/promises";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...values] = rows;
  return values
    .filter((value) => value.some(Boolean))
    .map((value) =>
      Object.fromEntries(
        headers.map((header, index) => [header, value[index] ?? ""]),
      ),
    );
}

export async function readCsv(path) {
  return parseCsv(await readFile(path, "utf8"));
}

export function list(value) {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export async function postAdmin(path, body, idempotencyKey) {
  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:8787";
  const apiKey = process.env.ADMIN_API_KEY ?? "local-development-key";
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(result)}`);
  return result;
}

export function chunks(values, size = 100) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}
