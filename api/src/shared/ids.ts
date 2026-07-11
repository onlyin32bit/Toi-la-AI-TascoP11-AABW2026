const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(timestamp: number): string {
  let value = timestamp;
  let result = "";
  for (let index = 0; index < 10; index += 1) {
    result = ENCODING[value % 32] + result;
    value = Math.floor(value / 32);
  }
  return result;
}

export function createId(prefix: string, timestamp = Date.now()): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  let suffix = "";
  for (const byte of random) suffix += ENCODING[byte & 31];
  return `${prefix}_${encodeTime(timestamp)}${suffix}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
