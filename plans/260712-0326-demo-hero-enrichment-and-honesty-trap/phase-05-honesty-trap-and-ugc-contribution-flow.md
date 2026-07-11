---
phase: 05
priority: P0
status: done
depends_on: [01]
est: 60m
---

# Phase 05 — Honesty Trap → UGC Contribution Flow

## Overview

When the assistant answers "Không tìm thấy" (not found), inject a pulsing UGC suggestion chip below the response. Clicking it opens a lightweight contribution form pre-filled with the query text. On submit, a purple pending pin appears on the map at the user's current location.

This closes the demo loop: the trap proves honesty; the UGC chip converts that gap into a community contribution — both messages in one flow.

## Key Insights

- Trigger source: `assistantMessage.kind === "not-found"` (structured) OR text starts with "Không tìm thấy". Prefer structured detection.
- Chip position: directly below assistant's not-found reply, pulses purple.
- Modal: minimal 4 fields (name required, others optional).
- Persistence: `localStorage` under `tasco-ugc-queue` — array of entries. Load on mount → render pins immediately.
- Pin style: purple dashed border, "Chờ xác thực" popup badge.
- Location fallback: if `navigator.geolocation` unavailable, use city center from user's active city filter or default Hà Nội (`21.028511, 105.804817`).

## Requirements

- Chip only appears when the latest assistant reply is a not-found; earlier ones don't retain the chip.
- Modal traps focus, escape closes.
- Form validation: name required.
- UGC pins persist across reloads.
- Reset (Phase 02) clears the queue.

## Related Files

**Create:**
- `ui/src/lib/ugc-queue.ts`
- `ui/src/components/UgcSuggestChip.tsx`
- `ui/src/components/UgcContributeForm.tsx`

**Modify:**
- `ui/src/components/AssistantBox.tsx`
- `ui/src/components/MapView.tsx`
- `ui/src/App.tsx`
- `ui/src/App.css`
- `ui/src/i18n/translations.ts`

## Implementation Steps

### 1. `lib/ugc-queue.ts`

```ts
export interface UgcEntry {
  id: string;
  name: string;
  address?: string;
  dish?: string;
  dietTags?: string[];
  lat: number;
  lng: number;
  createdAt: string;
  status: "pending";
}

const KEY = "tasco-ugc-queue";

export function listUgc(): UgcEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as UgcEntry[];
  } catch {
    return [];
  }
}

export function enqueueUgc(
  input: Omit<UgcEntry, "id" | "createdAt" | "status">,
): UgcEntry {
  const entry: UgcEntry = {
    ...input,
    id: `ugc:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  try {
    const existing = listUgc();
    localStorage.setItem(KEY, JSON.stringify([...existing, entry]));
  } catch {
    /* ignore */
  }
  return entry;
}

export function clearUgc(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
```

### 2. `UgcSuggestChip.tsx`

```tsx
interface Props {
  suggestedName: string;
  onClick: () => void;
  label: string;   // localized text
}

export function UgcSuggestChip({ suggestedName, onClick, label }: Props) {
  return (
    <button
      type="button"
      className="ugc-chip"
      onClick={onClick}
      aria-label={`${label}: ${suggestedName}`}
    >
      <span className="ugc-chip-plus">➕</span>
      <span className="ugc-chip-text">{label}</span>
      {suggestedName && (
        <span className="ugc-chip-name">"{suggestedName}"</span>
      )}
    </button>
  );
}
```

### 3. `AssistantBox.tsx` modifications

- Track: `lastNotFoundQuery: string | null` (extract from latest not-found message).
- Detect not-found via `message.kind === "not-found"` OR fallback pattern match.
- Render chip below the latest not-found message only:

```tsx
{isLatestNotFound && (
  <div className="assistant-ugc-slot">
    <UgcSuggestChip
      suggestedName={extractedName}
      onClick={() => props.onUgcOpen(extractedName)}
      label={t("ugc.chip")}
    />
  </div>
)}
```

- Add prop: `onUgcOpen: (suggestedName: string) => void`.
- `extractedName` = the entity from the user's query; simplest: use the last user message text (trim, cap 60 chars).

### 4. `UgcContributeForm.tsx`

```tsx
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  initialName: string;
  userLat: number;
  userLng: number;
  onCancel: () => void;
  onSubmit: (data: {
    name: string;
    address?: string;
    dish?: string;
    dietTags?: string[];
    lat: number;
    lng: number;
  }) => void;
  t: (key: string) => string;
}

export function UgcContributeForm({ open, initialName, userLat, userLng, onCancel, onSubmit, t }: Props) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState("");
  const [dish, setDish] = useState("");
  const [dietVeg, setDietVeg] = useState(false);
  const [dietHalal, setDietHalal] = useState(false);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canSubmit = name.trim().length >= 2;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const dietTags: string[] = [];
    if (dietVeg) dietTags.push("vegetarian");
    if (dietHalal) dietTags.push("halal");
    onSubmit({
      name: name.trim(),
      address: address.trim() || undefined,
      dish: dish.trim() || undefined,
      dietTags: dietTags.length ? dietTags : undefined,
      lat: userLat,
      lng: userLng,
    });
  };

  return (
    <div className="ugc-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="ugc-modal-panel" onSubmit={handleSubmit}>
        <header className="ugc-modal-header">
          <h2>{t("ugc.modal.title")}</h2>
          <button type="button" className="ugc-modal-close" onClick={onCancel} aria-label="Close">✕</button>
        </header>

        <div className="ugc-field">
          <label htmlFor="ugc-name">{t("ugc.field.name")} <span className="req">*</span></label>
          <input id="ugc-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="ugc-field">
          <label htmlFor="ugc-addr">{t("ugc.field.address")}</label>
          <input id="ugc-addr" type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                 placeholder={t("ugc.field.address.placeholder")} />
        </div>

        <div className="ugc-field">
          <label htmlFor="ugc-dish">{t("ugc.field.dish")}</label>
          <input id="ugc-dish" type="text" value={dish} onChange={(e) => setDish(e.target.value)} />
        </div>

        <div className="ugc-field">
          <span className="ugc-field-label">{t("ugc.field.dietTags")}</span>
          <div className="ugc-diet-row">
            <label><input type="checkbox" checked={dietVeg} onChange={(e) => setDietVeg(e.target.checked)} /> {t("diet.vegetarian")}</label>
            <label><input type="checkbox" checked={dietHalal} onChange={(e) => setDietHalal(e.target.checked)} /> {t("diet.halal")}</label>
          </div>
        </div>

        <footer className="ugc-modal-footer">
          <button type="button" className="ugc-btn ugc-btn-ghost" onClick={onCancel}>{t("ugc.cancel")}</button>
          <button type="submit" className="ugc-btn ugc-btn-primary" disabled={!canSubmit}>{t("ugc.submit")}</button>
        </footer>
      </form>
    </div>
  );
}
```

### 5. `MapView.tsx` — UGC pins layer

- Accept `ugcPins: UgcEntry[]` prop.
- Render a `LayerGroup` of `Marker`s with a divIcon:
  ```ts
  const ugcIcon = L.divIcon({
    className: "ugc-pin-marker",
    html: `<div class="ugc-pin-inner"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  ```
- Popup shows: name, `Chờ xác thực` badge, small timestamp.

### 6. `App.tsx` wiring

```tsx
import { listUgc, enqueueUgc, type UgcEntry } from "./lib/ugc-queue";
import { UgcContributeForm } from "./components/UgcContributeForm";

const [ugcOpen, setUgcOpen] = useState(false);
const [ugcSuggested, setUgcSuggested] = useState("");
const [ugcPins, setUgcPins] = useState<UgcEntry[]>(() => listUgc());

const handleUgcOpen = (suggestedName: string) => {
  setUgcSuggested(suggestedName);
  setUgcOpen(true);
};

const handleUgcSubmit = (data: Omit<UgcEntry, "id" | "createdAt" | "status">) => {
  const entry = enqueueUgc(data);
  setUgcPins(prev => [...prev, entry]);
  setUgcOpen(false);
  // Pan map to the new pin
  // (via a ref/setter to MapView, or by updating a `focusPin` state)
};

// Pass onUgcOpen to AssistantBox, ugcPins to MapView.
// Mount UgcContributeForm modal:
<UgcContributeForm
  open={ugcOpen}
  initialName={ugcSuggested}
  userLat={userLoc?.lat ?? 21.028511}
  userLng={userLoc?.lon ?? 105.804817}
  onCancel={() => setUgcOpen(false)}
  onSubmit={handleUgcSubmit}
  t={t}
/>
```

### 7. CSS

```css
/* UGC chip */
.ugc-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--src-ugc) 15%, transparent);
  color: var(--src-ugc);
  border: 1px solid color-mix(in srgb, var(--src-ugc) 40%, transparent);
  font-weight: 700; font-size: 12px;
  cursor: pointer;
  animation: ugc-chip-pulse 2.2s ease-in-out infinite;
}
.ugc-chip:hover { background: color-mix(in srgb, var(--src-ugc) 25%, transparent); }
.ugc-chip-plus { font-weight: 900; }
.ugc-chip-name {
  font-weight: 400; font-style: italic;
  color: color-mix(in srgb, var(--src-ugc) 80%, black);
}
@keyframes ugc-chip-pulse {
  0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--src-ugc) 45%, transparent); }
  50%     { box-shadow: 0 0 14px 4px color-mix(in srgb, var(--src-ugc) 35%, transparent); }
}
.assistant-ugc-slot { margin-top: 10px; }

/* UGC modal */
.ugc-modal-backdrop {
  position: fixed; inset: 0; z-index: 950;
  display: grid; place-items: center;
  background: color-mix(in srgb, black 55%, transparent);
  backdrop-filter: blur(10px);
  animation: term-backdrop-in 200ms ease-out;
}
.ugc-modal-panel {
  width: min(440px, 92vw);
  background: var(--color-card);
  border: 1px solid color-mix(in srgb, var(--src-ugc) 40%, transparent);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 20px 60px color-mix(in srgb, var(--src-ugc) 25%, transparent);
  animation: term-panel-in 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ugc-modal-header { display: flex; justify-content: space-between; align-items: center; }
.ugc-modal-header h2 { margin: 0; font-size: 16px; font-weight: 800; }
.ugc-modal-close { background: none; border: none; color: var(--color-muted-foreground); cursor: pointer; font-size: 14px; padding: 4px 8px; }
.ugc-modal-close:hover { color: var(--color-foreground); }
.ugc-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.ugc-field label, .ugc-field-label { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; font-size: 10px; color: var(--color-muted-foreground); }
.ugc-field input[type="text"] {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
  background: color-mix(in srgb, var(--color-background) 96%, transparent);
  color: var(--color-foreground);
  font-size: 13px;
  font-family: inherit;
}
.ugc-field input:focus { outline: 2px solid var(--src-ugc); outline-offset: 1px; }
.ugc-diet-row { display: flex; gap: 12px; font-size: 12px; text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--color-foreground); }
.ugc-diet-row label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
.req { color: var(--score-low); }

.ugc-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.ugc-btn {
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-weight: 700;
  cursor: pointer;
  font-size: 12px;
}
.ugc-btn-ghost {
  background: transparent;
  color: var(--color-muted-foreground);
  border-color: color-mix(in srgb, var(--color-border) 60%, transparent);
}
.ugc-btn-primary {
  background: var(--src-ugc);
  color: white;
  border-color: var(--src-ugc);
}
.ugc-btn-primary:disabled { opacity: 0.5; cursor: default; }

/* UGC map pin */
.ugc-pin-marker { position: relative; }
.ugc-pin-inner {
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 2px dashed var(--src-ugc);
  background: color-mix(in srgb, var(--src-ugc) 35%, transparent);
  animation: ugc-pin-pulse 2s ease-in-out infinite;
}
@keyframes ugc-pin-pulse {
  0%,100% { transform: scale(1); }
  50%     { transform: scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
  .ugc-chip, .ugc-pin-inner { animation: none; }
  .ugc-modal-backdrop, .ugc-modal-panel { animation: none; }
}
```

### 8. i18n

```ts
// VI
"ugc.chip":                     "Thêm quán này vào bản đồ",
"ugc.modal.title":              "Đóng góp quán ăn mới",
"ugc.field.name":               "Tên quán",
"ugc.field.address":            "Địa chỉ",
"ugc.field.address.placeholder":"Bỏ trống để dùng vị trí hiện tại",
"ugc.field.dish":               "Món nổi bật",
"ugc.field.dietTags":           "Nhãn ăn kiêng",
"ugc.submit":                   "Gửi đóng góp",
"ugc.cancel":                   "Hủy",
"ugc.pending.badge":            "Chờ xác thực",

// EN
"ugc.chip":                     "Add this place to map",
"ugc.modal.title":              "Contribute a new place",
"ugc.field.name":               "Name",
"ugc.field.address":            "Address",
"ugc.field.address.placeholder":"Leave blank to use current location",
"ugc.field.dish":               "Signature dish",
"ugc.field.dietTags":           "Diet tags",
"ugc.submit":                   "Submit",
"ugc.cancel":                   "Cancel",
"ugc.pending.badge":            "Pending verification",
```

## Todo

- [ ] Create `lib/ugc-queue.ts`
- [ ] Create `UgcSuggestChip.tsx`
- [ ] Create `UgcContributeForm.tsx`
- [ ] Modify `AssistantBox.tsx` — detect not-found, render chip
- [ ] Modify `MapView.tsx` — UGC pins layer with divIcon
- [ ] Modify `App.tsx` — state, handlers, mount modal, pass props
- [ ] Add CSS: chip pulse, modal, pin
- [ ] Add i18n strings
- [ ] Test: trap query → chip appears → click → modal → submit → pin on map
- [ ] Test: reload → pin persists
- [ ] Test: reset button → pin gone

## Success Criteria

- Assistant "not-found" reply shows pulsing purple chip within 100ms
- Click chip → modal opens with query name pre-filled
- Submit valid form → modal closes, pin drops on map at user location
- Map centers/pans to new pin
- Pin has purple dashed style + "Chờ xác thực" popup badge
- Reload preserves pin; reset clears it
- Reduced motion: no chip/pin pulse

## Risks

- Extracting "suggested name" from user query — regex-lite: strip verbs like "có ngon không", "có bán không". Fallback = raw query.
- Geolocation permission denied → fallback to Hà Nội center + helper text in modal.
- Chip stacking on multiple trap queries → only latest visible via `isLatestNotFound` check.

## Next Steps

Phase 06 (stretch) adds Dish Radar Scan + Split-slider polish.
