import { AppError } from "../shared/errors";

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [first, second] = parts as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function assertSafePublicUrl(
  value: string,
  allowedDomains: string[] = [],
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("VALIDATION_ERROR", "The source URL is invalid.", 400);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError(
      "UNSUPPORTED_SOURCE",
      "Only HTTP and HTTPS sources are supported.",
      400,
    );
  }
  if (url.username || url.password || !["", "80", "443"].includes(url.port)) {
    throw new AppError(
      "SOURCE_ACCESS_DENIED",
      "Credentials and non-standard ports are not allowed.",
      403,
    );
  }
  const host = url.hostname.toLocaleLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIpv4(host)
  ) {
    throw new AppError(
      "SOURCE_ACCESS_DENIED",
      "Private network sources are not allowed.",
      403,
    );
  }
  if (
    allowedDomains.length > 0 &&
    !allowedDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  ) {
    throw new AppError(
      "SOURCE_ACCESS_DENIED",
      "This source domain is not allowed.",
      403,
    );
  }
  return url;
}
