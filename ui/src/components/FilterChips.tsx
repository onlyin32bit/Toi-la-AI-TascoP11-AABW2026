import type { Diet, PriceLevel, Segment, SearchFilters } from "../types";
import { useI18n } from "../i18n/LanguageContext";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

// "business" is part of the backend contract but is not surfaced as a UI chip.
const SEGMENT_CHIPS: Segment[] = ["family", "romantic", "group", "fastfood"];
const DIET_CHIPS: Diet[] = ["vegetarian", "halal"];
const PRICE_CHIPS: PriceLevel[] = ["budget", "mid", "premium"];

interface FilterChipsProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

export function FilterChips({ filters, onChange }: FilterChipsProps) {
  const { t } = useI18n();

  return (
    <div className="bottom-sheet-scroll filter-rail flex gap-2 overflow-x-auto pb-1">
      <ToggleGroup
        type="single"
        value={filters.segment ?? ""}
        onValueChange={(value) => onChange({ ...filters, segment: (value || undefined) as Segment | undefined })}
        aria-label="Occasion"
        className="shrink-0"
      >
        {SEGMENT_CHIPS.map((s) => (
          <ToggleGroupItem key={s} value={s} aria-label={t(`segment.${s}`)}>
            {t(`segment.${s}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        type="single"
        value={filters.diet ?? ""}
        onValueChange={(value) => onChange({ ...filters, diet: (value || undefined) as Diet | undefined })}
        aria-label="Diet"
        className="shrink-0"
      >
        {DIET_CHIPS.map((d) => (
          <ToggleGroupItem key={d} value={d} aria-label={t(`diet.${d}`)}>
            {t(`diet.${d}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        type="single"
        value={filters.price ?? ""}
        onValueChange={(value) => onChange({ ...filters, price: (value || undefined) as PriceLevel | undefined })}
        aria-label="Price"
        className="shrink-0"
      >
        {PRICE_CHIPS.map((p) => (
          <ToggleGroupItem key={p} value={p} aria-label={t(`price.${p}`)}>
            {t(`price.${p}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        type="single"
        value={filters.time ?? ""}
        onValueChange={(value) => onChange({ ...filters, time: (value || undefined) as SearchFilters["time"] })}
        aria-label="Time"
        className="shrink-0"
      >
        <ToggleGroupItem value="now" aria-label={t("time.now")}>
          {t("time.now")}
        </ToggleGroupItem>
        <ToggleGroupItem value="late_night" aria-label={t("time.lateNight")}>
          {t("time.lateNight")}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
