# Brainstorm — Vehicle Preference Setting

**Date:** 2026-07-12
**Owner:** Hung Vu
**Type:** Feature design

---

## 1. Problem Statement

User yêu cầu: thêm setting chọn phương tiện di chuyển. Ranking hiện tại
(`lib/rank.ts`) giả định 1 "acceptable distance" duy nhất (geoDecay half-life
2km) không phân biệt user đi bộ hay lái xe. Kết quả cho người đi bộ và người
đi ô tô giống hệt → khoảng cách "hợp lý" khác nhau.

Feature này để user personalize theo phương tiện, ảnh hưởng:
1. Ranking (rerank theo bán kính hợp lý)
2. Hard-filter (loại POI quá xa cho vehicle đó)
3. Display ETA thay vì raw distance

---

## 2. Requirements

**Functional:**
- 4 vehicle types: Walk / Bike / Motorbike / Car
- Motorbike = default (VN context, phổ biến nhất)
- Persist trong `localStorage` giống theme (`tasco-vehicle`)
- Lenient hard-filter (chỉ cắt khi vô lý)
- Rerank via vehicle-specific geoDecay half-life
- ETA hiển thị thay tile "Distance" trên ResultCard
- I18n keys cho vehicle names (VI + EN)
- Không có userLoc → vehicle inert (không filter, không ETA)

**Non-functional:**
- Client-side, không đụng backend (chưa có)
- Không phá contract `PlaceResult` — thêm field optional
- Không phá backwards compat với filters cũ
- YAGNI: không add navigation deep-link, route optimization, live traffic

---

## 3. Approaches Evaluated

### A. Display-only ETA (rejected)
Chỉ hiện ETA per vehicle, không rerank.
- Pro: KISS, zero risk. Ship trong 1h.
- Con: Vehicle setting mà không đổi thứ tự → user hỏi "chọn để làm gì?"
- **Verdict:** Rejected — user muốn ranking impact.

### B. Rerank-only (rejected)
Đổi geoDecay theo vehicle, không hard-filter.
- Pro: Không bao giờ empty state.
- Con: Walk mode vẫn hiện POI 15km → confusing.
- **Verdict:** Rejected — user muốn hard-filter kèm.

### C. Aggressive strict filter (rejected sau discovery)
Walk >1.5km, Bike >5km, Motorbike >15km, Car >25km cứng.
- Pro: Ranking phản ánh reality.
- Con: Mock dataset thưa → dễ 0 results. Cần notFoundReason mới, UX empty.
- **Verdict:** Rejected — quá xâm lấn cho MVP.

### D. Lenient filter + rerank + ETA (CHOSEN)
Hard-filter chỉ cắt khi absurd, rerank làm phần lớn công việc.
- Pro: Balance UX vs signal fidelity. 0 results hiếm.
- Pro: Rerank sắc bén (walk half-life 0.6km) đã đủ demote POI xa.
- Con: User đi walk vẫn thấy POI 2.5km xa (nhưng sẽ ở cuối list).

---

## 4. Final Solution

### 4.1 Vehicle profile

| Vehicle    | Icon      | Hard-cap (km) | Half-life (km) | Speed (km/h) | Detour × |
|------------|-----------|---------------|----------------|--------------|----------|
| Walk       | 🚶       | 3             | 0.6            | 4.5          | 1.2      |
| Bike       | 🚲       | 10            | 1.5            | 15           | 1.3      |
| Motorbike  | 🛵 (default) | 25         | 3.5            | 30           | 1.35     |
| Car        | 🚗       | 40            | 6              | 22           | 1.4      |

Justification (VN traffic reality):
- Motorbike faster than car trong city vì len lỏi được
- Detour factor: haversine → road distance
- Half-life = "khoảng cách còn thấy hấp dẫn"
- Hard-cap = "còn giá trị hiển thị"

ETA formula:
```
etaMinutes = round((haversine_km × detour) / speed_km_h × 60)
```

### 4.2 Data model changes

**`types.ts`:**
```ts
export type Vehicle = "walk" | "bike" | "motorbike" | "car";

export interface SearchFilters {
  segment?: Segment;
  diet?: Diet;
  price?: PriceLevel;
  time?: "now" | "late_night";
  vehicle?: Vehicle;   // NEW
}

export interface PlaceResult {
  // ...existing...
  etaMinutes: number | null;   // NEW; null if no userLoc or no vehicle
}
```

### 4.3 Ranking changes (`lib/rank.ts`)

**Vehicle profile constant:**
```ts
const VEHICLE_PROFILES: Record<Vehicle, {
  hardCapKm: number;
  halfLifeKm: number;
  speedKmh: number;
  detour: number;
}> = {
  walk:      { hardCapKm: 3,  halfLifeKm: 0.6, speedKmh: 4.5, detour: 1.20 },
  bike:      { hardCapKm: 10, halfLifeKm: 1.5, speedKmh: 15,  detour: 1.30 },
  motorbike: { hardCapKm: 25, halfLifeKm: 3.5, speedKmh: 30,  detour: 1.35 },
  car:       { hardCapKm: 40, halfLifeKm: 6.0, speedKmh: 22,  detour: 1.40 },
};
```

**Hard-filter (in candidate filter):**
```ts
if (filters.vehicle && userLoc && distanceMeters !== null) {
  const cap = VEHICLE_PROFILES[filters.vehicle].hardCapKm * 1000;
  if (distanceMeters > cap) return false;
}
```

**Rerank (in scorePoi):**
```ts
const halfLife = filters.vehicle
  ? VEHICLE_PROFILES[filters.vehicle].halfLifeKm
  : 2;   // fallback = current behavior
geoDecay = Math.exp(-(distanceMeters / 1000) / halfLife);
```

**ETA compute (in scorePoi):**
```ts
let etaMinutes: number | null = null;
if (filters.vehicle && distanceMeters !== null) {
  const p = VEHICLE_PROFILES[filters.vehicle];
  etaMinutes = Math.round((distanceMeters / 1000) * p.detour / p.speedKmh * 60);
}
```

### 4.4 UI changes

**`FilterChips.tsx`** — add ToggleGroup thứ 5:
```tsx
<ToggleGroup type="single" value={filters.vehicle ?? ""} onValueChange={...}>
  <ToggleGroupItem value="walk">{t("vehicle.walk")}</ToggleGroupItem>
  <ToggleGroupItem value="bike">{t("vehicle.bike")}</ToggleGroupItem>
  <ToggleGroupItem value="motorbike">{t("vehicle.motorbike")}</ToggleGroupItem>
  <ToggleGroupItem value="car">{t("vehicle.car")}</ToggleGroupItem>
</ToggleGroup>
```

**`ResultCard.tsx`** — replace Distance tile:
```tsx
<div>
  <div className="...">ETA</div>
  <div className="...">
    {result.etaMinutes !== null
      ? `${result.etaMinutes} min`
      : result.distanceMeters !== null
        ? `${(result.distanceMeters/1000).toFixed(1)}km`
        : "--"}
  </div>
</div>
```

Fallback: nếu không có vehicle → hiện distance như cũ. Không breaking.

**`App.tsx`** — persist vehicle preference:
```ts
const [vehicle, setVehicleState] = useState<Vehicle | undefined>(readVehicle);
// on filters change, include vehicle
handleFiltersChange({ ...filters, vehicle })
```

**i18n keys** cần thêm (`i18n/translations.ts`):
- `vehicle.walk`, `vehicle.bike`, `vehicle.motorbike`, `vehicle.car`
- `result.eta` = "ETA" / "ETA"
- `reason.eta` = "{{min}} min bằng {{vehicle}}" — dùng trong reasoning line

---

## 5. Implementation Considerations & Risks

### Risks
- **Empty state** khi vehicle=walk + userLoc + city thưa → dù lenient vẫn có thể 0 results. Cần add `NotFoundReason.kind: "vehicleRange"` với message "Không có quán nào trong tầm đi bộ".
- **Vehicle set nhưng không có GPS** → filter vô hiệu. UI cần disable vehicle chip hoặc hiện tooltip "Bật GPS để dùng".
- **ETA không phản ánh traffic thật** — chỉ ước lượng. OK cho demo.
- **Detour factor** hardcoded — có thể cần tune sau khi có real data.

### Testing
- Unit test `scorePoi` với từng vehicle × distance combo
- Snapshot ranking order thay đổi đúng
- UI test: chọn vehicle → distance tile đổi thành ETA
- Test không có GPS → vehicle chip vô hại

### YAGNI checkpoints
- ❌ Không add: navigation deep-link, route optimization, live traffic API
- ❌ Không add: multi-modal ("walk + bus"), scheduling
- ✅ Chỉ add: 4 vehicle types, rerank+filter+ETA, persist

---

## 6. Success Metrics

- Chọn Walk trên phone thấy top 3 POI đều <2km
- Chọn Car top 3 có thể spread rộng hơn
- ETA đổi realtime khi swap vehicle (no re-fetch, client rerank)
- Persist qua reload
- Không breaking: user không set vehicle → hành vi = như cũ

---

## 7. Next Steps

1. Confirm final params bảng 4.1 (chỉ cần user OK, không cần retest)
2. Implementation plan: `/ck:plan` với brainstorm này làm context
3. Files sẽ chạm: `types.ts`, `lib/rank.ts`, `components/FilterChips.tsx`,
   `components/ResultCard.tsx`, `App.tsx`, `i18n/translations.ts`
4. Ước lượng effort: ~3-4h (UI + rank + i18n + test)

---

## Unresolved Questions

- Icon vehicle: dùng emoji (🚶🚲🛵🚗) hay SVG? Nucleo-isometric package chưa
  confirm có bike/motorbike icons — cần check khi implement, fallback emoji nếu
  không có (KISS).
- `NotFoundReason.kind: "vehicleRange"` — cần thêm i18n key mới hay ghép vào
  `generic`? Đề nghị thêm mới vì message-context riêng.
