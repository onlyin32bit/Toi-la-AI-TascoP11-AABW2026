export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const input =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function secureEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const leftDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(left),
  );
  const rightDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(right),
  );
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a[index]! ^ b[index]!;
  return difference === 0;
}
