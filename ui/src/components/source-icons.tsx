// Inline SVG brand icons for enrichment provenance badges.
// Kept minimal (12x12 viewBox, currentColor) to avoid external requests.
import type { ReactElement } from "react";
import type { EnrichmentSource } from "../types";

export function GoogleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22.5 12.3c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-2 3.2-4.8 3.2-8z" />
      <path
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.7 1.1-2.8 0-5.2-1.9-6-4.5H2.3v2.8A11 11 0 0 0 12 23z"
        opacity="0.7"
      />
    </svg>
  );
}

export function FoodyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="10" opacity="0.15" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="900" fill="currentColor">
        F
      </text>
    </svg>
  );
}

export function TiktokIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 3v3a4 4 0 0 0 4 4v3a7 7 0 0 1-4-1v6a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3h3z" />
    </svg>
  );
}

export function ShopeeFoodIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" opacity="0.85" />
    </svg>
  );
}

export function UgcIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6v1H4v-1z" />
    </svg>
  );
}

export const SOURCE_META: Record<
  EnrichmentSource,
  { name: string; color: string; Icon: () => ReactElement }
> = {
  google:     { name: "Google Places", color: "var(--src-google)",     Icon: GoogleIcon },
  foody:      { name: "Foody",         color: "var(--src-foody)",      Icon: FoodyIcon },
  tiktok:     { name: "TikTok",        color: "var(--src-tiktok)",     Icon: TiktokIcon },
  shopeefood: { name: "ShopeeFood",    color: "var(--src-shopeefood)", Icon: ShopeeFoodIcon },
  ugc:        { name: "Cộng đồng",     color: "var(--src-ugc)",        Icon: UgcIcon },
};
