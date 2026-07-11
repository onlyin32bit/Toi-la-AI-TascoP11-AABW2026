import { useRef } from "react";
import { IconArrowDown, IconPin } from "nucleo-isometric";
import type { PlaceResult, SearchFilters, Vehicle } from "../types";
import { useI18n } from "../i18n/LanguageContext";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { QualityScoreBadge } from "./quality-score-badge";
import { ProvenanceBadge } from "./provenance-badge";
import { DEMO_POI_ID } from "../data/mock-enrichment";

const VEHICLE_EMOJI: Record<Vehicle, string> = {
  walk: "🚶",
  bike: "🚲",
  motorbike: "🛵",
  car: "🚗",
};

interface ResultCardProps {
  result: PlaceResult;
  filters: SearchFilters;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onEnrich?: (id: string) => void;
  enriching?: boolean;
}

const WHY_ROWS: { key: keyof PlaceResult["meta"]["why"]; labelKey: string }[] = [
  { key: "semantic", labelKey: "why.semantic" },
  { key: "geoDecay", labelKey: "why.geoDecay" },
  { key: "quality", labelKey: "why.quality" },
  { key: "persona", labelKey: "why.persona" },
  { key: "ratingPop", labelKey: "why.ratingPop" },
  { key: "localness", labelKey: "why.localness" },
  { key: "luxuryPenalty", labelKey: "why.luxuryPenalty" },
];

function formatMinute(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function ResultCard({
  result,
  filters,
  active,
  expanded,
  onSelect,
  onToggleExpand,
  onEnrich,
  enriching,
}: ResultCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement | null>(null);

  const tags = [
    t(`price.${result.priceLevel}`),
    ...result.segments.map((s) => t(`segment.${s}`)),
    ...result.diet.map((d) => t(`diet.${d}`)),
  ];

  const reasoningParts: string[] = [];
  if (filters.vehicle && result.etaMinutes !== null) {
    reasoningParts.push(
      t("reason.eta", { min: result.etaMinutes, vehicle: t(`vehicle.${filters.vehicle}`) }),
    );
  } else if (result.distanceMeters !== null) {
    reasoningParts.push(t("reason.away", { km: (result.distanceMeters / 1000).toFixed(1) }));
  }
  if (filters.segment) reasoningParts.push(t("reason.goodFor", { seg: t(`segment.${filters.segment}`) }));
  if (filters.diet) reasoningParts.push(t(`diet.${filters.diet}`));
  reasoningParts.push(t("reason.price", { price: t(`price.${result.priceLevel}`) }));
  reasoningParts.push(
    result.meta.opening.overnight
      ? t("reason.overnight")
      : t("reason.openUntil", { time: formatMinute(result.meta.opening.closeMin) }),
  );
  const reasoning = reasoningParts.join(" - ");
  const p11Score = (result.meta.why.final * 10).toFixed(1);
  // Prefer client-side enriched qualityScore over meta.quality so the badge
  // can reflect the "before" downgrade and the "after" bump for the demo POI.
  const currentQuality = result.qualityScore ?? result.meta.quality;
  const scorePercent = Math.max(8, Math.min(100, result.meta.why.final * 100));

  // Mouse-follow radial glow — the tech "sensor" feel.
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${mx}%`);
    el.style.setProperty("--my", `${my}%`);
  };

  const isDemoPoi = result.id === DEMO_POI_ID;
  const showEnrichButton = isDemoPoi && !result.isEnriched;

  return (
    <Card
      ref={cardRef}
      onMouseMove={onMouseMove}
      className={cn(
        "result-card group relative rounded-[1.35rem] border-white/14 bg-card/95 p-3.5 shadow-[0_10px_26px_rgb(0_0_0/0.22)] hover:border-primary/50",
        active && "is-active border-primary/70 shadow-[0_0_0_1px_rgb(195_244_0/0.35),0_0_36px_rgb(195_244_0/0.18)]",
      )}
      onClick={onSelect}
    >
      <span className="card-shine" aria-hidden />

      <div className="flex items-start gap-3">
        <div
          className={cn(
            "pin-tile flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] text-primary transition-colors",
            active && "bg-primary text-primary-foreground",
          )}
        >
          <IconPin size={22} title={result.name} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="font-display min-w-0 truncate text-[15px] font-bold leading-5 text-card-foreground">{result.name}</h2>
              <p className="mt-0.5 truncate text-[0.68rem] font-bold uppercase tracking-[0.14em] text-primary font-mono">{result.cuisineType}</p>
            </div>
            <Badge variant="score" className="shrink-0 font-display">
              P11 {p11Score}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.address}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[0.055] p-2">
        <div>
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground font-mono">
            {t("quality.label")}
          </div>
          <div className="mt-0.5">
            <QualityScoreBadge score={currentQuality} size="sm" />
          </div>
        </div>
        <div>
          {result.etaMinutes !== null ? (
            <>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground font-mono">
                {t("result.eta")}
              </div>
              <div className="mt-0.5 font-display text-sm font-bold text-foreground">
                {filters.vehicle && (
                  <span className="mr-1" aria-hidden>
                    {VEHICLE_EMOJI[filters.vehicle]}
                  </span>
                )}
                {result.etaMinutes}min
              </div>
            </>
          ) : (
            <>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground font-mono">Distance</div>
              <div className="mt-0.5 font-display text-sm font-bold text-foreground">
                {result.distanceMeters === null ? "--" : `${(result.distanceMeters / 1000).toFixed(1)}km`}
              </div>
            </>
          )}
        </div>
        <div>
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground font-mono">Open</div>
          <div className="mt-0.5 font-display text-sm font-bold text-foreground">
            {result.meta.opening.overnight ? "24h" : formatMinute(result.meta.opening.closeMin)}
          </div>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-primary shadow-[0_0_18px_var(--color-primary)] transition-[width] duration-700 ease-out"
          style={{ width: `${scorePercent}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-[0.68rem]">
            {tag}
          </Badge>
        ))}
      </div>

      {showEnrichButton && (
        <button
          type="button"
          className="enrich-btn mt-3 w-full"
          onClick={(e) => {
            e.stopPropagation();
            onEnrich?.(result.id);
          }}
          disabled={!!enriching}
        >
          <span className="enrich-btn-sparkle" aria-hidden>
            ✨
          </span>
          <span>{t("enrich.button")}</span>
        </button>
      )}

      {result.isEnriched && result.provenance && (
        <div className="card-details" aria-live="polite">
          {result.enrichedMenuItems && result.provenance.menu && (
            <DetailRow
              label={t("field.menu")}
              value={
                result.enrichedMenuItems.slice(0, 3).join(" • ") +
                (result.enrichedMenuItems.length > 3
                  ? ` +${result.enrichedMenuItems.length - 3}`
                  : "")
              }
              field={result.provenance.menu}
              delayMs={400}
            />
          )}
          {result.enrichedHours && result.provenance.hours && (
            <DetailRow
              label={t("field.hours")}
              value={result.enrichedHours}
              field={result.provenance.hours}
              delayMs={480}
            />
          )}
          {result.enrichedPriceRange && result.provenance.priceRange && (
            <DetailRow
              label={t("field.priceRange")}
              value={result.enrichedPriceRange}
              field={result.provenance.priceRange}
              delayMs={560}
            />
          )}
          {result.enrichedDietTags && result.provenance.dietTags && (
            <DetailRow
              label={t("field.dietTags")}
              value={result.enrichedDietTags.join(", ")}
              field={result.provenance.dietTags}
              delayMs={640}
            />
          )}
        </div>
      )}

      <Button
        type="button"
        variant="glass"
        size="sm"
        className="mt-3 h-8 w-full rounded-xl text-xs font-bold uppercase tracking-[0.08em] text-primary font-mono"
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        <IconArrowDown size={16} className={cn("transition-transform duration-300", expanded && "rotate-180")} />
        {t("why.toggle")}
      </Button>

      {expanded && (
        <div className="enter-soft mt-3 rounded-2xl border border-white/12 bg-white/[0.08] p-3" onClick={(e) => e.stopPropagation()}>
          <p className="m-0 text-xs font-medium leading-5 text-foreground">{reasoning}</p>
          <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
            {WHY_ROWS.map(({ key, labelKey }) => {
              const value = result.meta.why[key];
              return (
                <div className="flex justify-between gap-3 text-xs text-muted-foreground" key={key}>
                  <span>{t(labelKey)}</span>
                  <span className="font-mono">{value === null ? "N/A" : value.toFixed(2)}</span>
                </div>
              );
            })}
            <div className="flex justify-between gap-3 border-t border-white/10 pt-1.5 text-xs font-bold text-foreground">
              <span>{t("why.final")}</span>
              <span className="font-mono">{result.meta.why.final.toFixed(2)}</span>
            </div>
          </div>
          {result.meta.matchedDishes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t("result.matchedDishes")}</span>
              {result.meta.matchedDishes.map((d) => (
                <Badge key={d.dish} variant="warning" className="text-[0.68rem]">
                  {d.dish} - {d.priceVnd.toLocaleString("vi-VN")}d
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  field: import("../types").ProvenanceField;
  delayMs: number;
}

function DetailRow({ label, value, field, delayMs }: DetailRowProps) {
  const style = { ["--row-delay" as string]: `${delayMs}ms` } as React.CSSProperties;
  return (
    <div className="card-detail-row" style={style}>
      <span className="card-detail-label">{label}</span>
      <span className="card-detail-value">{value}</span>
      <ProvenanceBadge field={field} delayMs={delayMs} compact />
    </div>
  );
}
