export interface ParsedPrice {
  amountVnd: number | null;
  confidence: number;
  raw: string;
  kind: "exact" | "ambiguous" | "market_price" | "variant" | "invalid";
}

const MARKET_PRICE = /^(theo thời giá|thời giá|market price|market)$/i;
const VARIANT = /^(s\s*\/\s*m\s*\/\s*l|s\s+m\s+l)$/i;

export function parseVietnamesePrice(input: string): ParsedPrice {
  const raw = input.trim();
  if (!raw) return { amountVnd: null, confidence: 0, raw, kind: "invalid" };
  if (MARKET_PRICE.test(raw))
    return { amountVnd: null, confidence: 1, raw, kind: "market_price" };
  if (VARIANT.test(raw))
    return { amountVnd: null, confidence: 1, raw, kind: "variant" };

  const lowered = raw.toLocaleLowerCase("vi");
  const explicitThousands = /(?:k|nghìn|ngan)\b/.test(lowered);
  const digits = lowered.replace(/(?:vnd|vnđ|đ|d|k|nghìn|ngan)/g, "").trim();
  if (!/^\d{1,3}(?:[.,]\d{3})*$|^\d+$/.test(digits)) {
    return { amountVnd: null, confidence: 0, raw, kind: "invalid" };
  }

  const compact = digits.replace(/[.,]/g, "");
  const numeric = Number.parseInt(compact, 10);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    return { amountVnd: null, confidence: 0, raw, kind: "invalid" };
  }

  if (explicitThousands) {
    const base =
      digits.includes(".") || digits.includes(",") ? numeric : numeric * 1000;
    return { amountVnd: base, confidence: 0.99, raw, kind: "exact" };
  }
  if (/[.,]\d{3}/.test(digits) || numeric >= 1000) {
    return { amountVnd: numeric, confidence: 0.98, raw, kind: "exact" };
  }
  if (numeric <= 999) {
    return {
      amountVnd: numeric * 1000,
      confidence: 0.45,
      raw,
      kind: "ambiguous",
    };
  }
  return { amountVnd: numeric, confidence: 0.8, raw, kind: "exact" };
}
