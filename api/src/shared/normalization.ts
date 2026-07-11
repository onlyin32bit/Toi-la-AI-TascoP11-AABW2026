export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export const normalizeRestaurantName = normalizeText;

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("84")) return `+${digits}`;
  if (digits.startsWith("0")) return `+84${digits.slice(1)}`;
  return digits.length > 0 ? `+${digits}` : "";
}

export function normalizeAddress(value: string): string {
  return normalizeText(value)
    .replace(/\b(tp|thanh pho)\b/g, "")
    .replace(/\b(q|quan)\s*(\d+)\b/g, "quan $2")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  return [
    ...new Set(
      normalizeText(value)
        .split(" ")
        .filter((token) => token.length > 1),
    ),
  ];
}
