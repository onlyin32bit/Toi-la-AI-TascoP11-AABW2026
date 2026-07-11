---
phase: 04
priority: P0
status: done
depends_on: [01, 02, 03]
est: 45m
---

# Phase 04 — Provenance Badges + Field Attribution Reveal

## Overview

After enrichment completes, the POI card expands its Details section to show newly-filled fields (menu items, hours, price range, diet tags, address). Each field is tagged with a small brand-colored badge showing its source (Google / Foody / TikTok / ShopeeFood / UGC). Badges fade in with a stagger.

## Key Insights

- Brand icons as **inline SVGs** — no external requests, tiny footprint.
- Badges are non-interactive by default; `title` attr shows source name + confidence.
- Field values themselves fade in at the same time as the badges — the whole details block appears with a coordinated stagger.
- Details section stays hidden if `!isEnriched` to keep the "before" state clean.

## Requirements

- Distinct brand color per source: Google `#4285F4`, Foody `#E31837`, TikTok gradient (fallback `#25F4EE`), ShopeeFood `#EE4D2D`, UGC `#a78bfa`.
- Stagger: 80ms between rows, 400ms initial delay after enrichment complete.
- Accessible: badges have `aria-label`; details section announced via `aria-live="polite"` when it appears.
- Reduced motion: all rows appear instantly, no fade.

## Related Files

**Create:**
- `ui/src/components/ProvenanceBadge.tsx`
- `ui/src/components/source-icons.tsx`

**Modify:**
- `ui/src/components/ResultCard.tsx`
- `ui/src/App.css`
- `ui/src/i18n/translations.ts`

## Implementation Steps

### 1. `source-icons.tsx` — inline SVG components

```tsx
import type { EnrichmentSource } from "../types";

export function GoogleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.5 12.3c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-2 3.2-4.8 3.2-8z"/>
      <path d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.7 1.1-2.8 0-5.2-1.9-6-4.5H2.3v2.8A11 11 0 0 0 12 23z" opacity="0.7"/>
    </svg>
  );
}
export function FoodyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" opacity="0.15"/>
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="900" fill="currentColor">F</text>
    </svg>
  );
}
export function TiktokIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 3v3a4 4 0 0 0 4 4v3a7 7 0 0 1-4-1v6a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3h3z"/>
    </svg>
  );
}
export function ShopeeFoodIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" opacity="0.85"/>
    </svg>
  );
}
export function UgcIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6v1H4v-1z"/>
    </svg>
  );
}

export const SOURCE_META: Record<
  EnrichmentSource,
  { name: string; color: string; icon: () => JSX.Element }
> = {
  google:     { name: "Google Places", color: "var(--src-google)",     icon: GoogleIcon },
  foody:      { name: "Foody",         color: "var(--src-foody)",      icon: FoodyIcon },
  tiktok:     { name: "TikTok",        color: "var(--src-tiktok)",     icon: TiktokIcon },
  shopeefood: { name: "ShopeeFood",    color: "var(--src-shopeefood)", icon: ShopeeFoodIcon },
  ugc:        { name: "Cộng đồng",     color: "var(--src-ugc)",        icon: UgcIcon },
};
```

### 2. `ProvenanceBadge.tsx`

```tsx
import type { ProvenanceField } from "../types";
import { SOURCE_META } from "./source-icons";

interface Props {
  field: ProvenanceField;
  compact?: boolean;
  delayMs?: number;
}

export function ProvenanceBadge({ field, compact, delayMs = 0 }: Props) {
  const meta = SOURCE_META[field.source];
  const Icon = meta.icon;
  const confidencePct = Math.round(field.confidence * 100);

  return (
    <span
      className="prov-badge"
      data-source={field.source}
      style={{ ["--delay" as any]: `${delayMs}ms`, ["--src-color" as any]: meta.color }}
      title={`${meta.name} — độ tin cậy ${confidencePct}%`}
      aria-label={`Source: ${meta.name}, confidence ${confidencePct} percent`}
    >
      <Icon />
      {!compact && <span className="prov-badge-name">{meta.name}</span>}
    </span>
  );
}
```

### 3. Extend `ResultCard.tsx`

Add a `<div className="card-details">` block, rendered only when `result.isEnriched`:

```tsx
{result.isEnriched && result.provenance && (
  <div className="card-details" aria-live="polite">
    {result.enrichedMenuItems && result.provenance.menu && (
      <div className="card-detail-row" style={{ ["--row-delay" as any]: "400ms" }}>
        <span className="card-detail-label">{t("field.menu")}</span>
        <span className="card-detail-value">
          {result.enrichedMenuItems.slice(0, 3).join(" • ")}
          {result.enrichedMenuItems.length > 3 && ` +${result.enrichedMenuItems.length - 3}`}
        </span>
        <ProvenanceBadge field={result.provenance.menu} delayMs={400} compact />
      </div>
    )}
    {result.enrichedHours && result.provenance.hours && (
      <div className="card-detail-row" style={{ ["--row-delay" as any]: "480ms" }}>
        <span className="card-detail-label">{t("field.hours")}</span>
        <span className="card-detail-value">{result.enrichedHours}</span>
        <ProvenanceBadge field={result.provenance.hours} delayMs={480} compact />
      </div>
    )}
    {result.enrichedPriceRange && result.provenance.priceRange && (
      <div className="card-detail-row" style={{ ["--row-delay" as any]: "560ms" }}>
        <span className="card-detail-label">{t("field.priceRange")}</span>
        <span className="card-detail-value">{result.enrichedPriceRange}</span>
        <ProvenanceBadge field={result.provenance.priceRange} delayMs={560} compact />
      </div>
    )}
    {result.enrichedDietTags && result.provenance.dietTags && (
      <div className="card-detail-row" style={{ ["--row-delay" as any]: "640ms" }}>
        <span className="card-detail-label">{t("field.dietTags")}</span>
        <span className="card-detail-value">{result.enrichedDietTags.join(", ")}</span>
        <ProvenanceBadge field={result.provenance.dietTags} delayMs={640} compact />
      </div>
    )}
  </div>
)}
```

### 4. CSS

```css
:root {
  --src-google:     #4285F4;
  --src-foody:      #E31837;
  --src-tiktok:     #25F4EE;
  --src-shopeefood: #EE4D2D;
  --src-ugc:        #a78bfa;
}

.card-details {
  display: flex; flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed color-mix(in srgb, var(--color-border) 60%, transparent);
}
.card-detail-row {
  display: grid;
  grid-template-columns: 80px 1fr auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0;
  animation: card-row-in 280ms ease-out forwards;
  animation-delay: var(--row-delay, 0ms);
}
@keyframes card-row-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
.card-detail-label {
  color: var(--color-muted-foreground);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.card-detail-value {
  color: var(--color-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prov-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--src-color) 12%, transparent);
  color: var(--src-color);
  border: 1px solid color-mix(in srgb, var(--src-color) 30%, transparent);
  opacity: 0;
  animation: prov-fade 300ms ease-out forwards;
  animation-delay: var(--delay, 0ms);
  cursor: help;
}
.prov-badge svg { display: block; }
.prov-badge-name { line-height: 1; }
@keyframes prov-fade {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .card-detail-row, .prov-badge {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
```

### 5. i18n

```ts
// VI
"field.menu":        "Thực đơn",
"field.hours":       "Giờ mở cửa",
"field.priceRange":  "Khoảng giá",
"field.dietTags":    "Nhãn ăn kiêng",
// EN
"field.menu":        "Menu",
"field.hours":       "Open hours",
"field.priceRange":  "Price range",
"field.dietTags":    "Diet tags",
```

## Todo

- [ ] Create `source-icons.tsx`
- [ ] Create `ProvenanceBadge.tsx`
- [ ] Extend `ResultCard.tsx` with details section
- [ ] Add CSS: `.card-details`, `.card-detail-row`, `.prov-badge`, source color vars
- [ ] Add i18n strings
- [ ] Visual test on enriched card: rows stagger in over ~400-800ms window
- [ ] Test on narrow viewport (< 400px): text truncates cleanly

## Success Criteria

- After enrichment: card grows to show 4 detail rows, each with a brand-colored badge
- Rows fade in with visible stagger, badges appear alongside
- Reduced motion: everything visible instantly
- Card doesn't overflow horizontally on narrow phones
- Hovering a badge shows tooltip with source name + confidence

## Risks

- Long menu strings on narrow viewport → truncate at 3 items + `+N` count
- Card growing too tall on enrich → dock scrolls, acceptable

## Next Steps

Phase 05 closes the loop with Honesty Trap → UGC.
