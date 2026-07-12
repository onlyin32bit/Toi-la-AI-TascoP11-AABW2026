// Before/After compare modal for the enrichment demo. Renders two full
// cards side-by-side (grays-out "before", accent-tinted "after") so BGK
// can A/B the data richness in ~2 seconds without any drag interaction.
// Stacks vertically on narrow viewports where side-by-side is unreadable.
import { useEffect } from "react";
import type { PlaceResult } from "../types";
import { ProvenanceBadge } from "./provenance-badge";
import { QualityScoreBadge } from "./quality-score-badge";

interface Props {
  open: boolean;
  poi: PlaceResult;
  qualityBefore: number;
  onClose: () => void;
  t: (key: string) => string;
}

export function EnrichmentSplitView({ open, poi, qualityBefore, onClose, t }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="split-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("compare.modal.title")}
    >
      <div className="split-modal-panel">
        <header className="split-modal-header">
          <div className="split-modal-title">
            <span className="split-modal-lens">🔍</span>
            <span>{t("compare.modal.title")}</span>
          </div>
          <button
            type="button"
            className="split-modal-close"
            onClick={onClose}
            aria-label={t("compare.close")}
          >
            ✕
          </button>
        </header>

        <div className="split-grid">
          <section className="split-side split-side-before" aria-label={t("compare.before")}>
            <div className="split-label split-label-before">{t("compare.before")}</div>
            <SplitCard variant="before" poi={poi} qualityBefore={qualityBefore} t={t} />
          </section>
          <div className="split-divider-arrow-badge" aria-hidden>
            →
          </div>
          <section className="split-side split-side-after" aria-label={t("compare.after")}>
            <div className="split-label split-label-after">{t("compare.after")}</div>
            <SplitCard variant="after" poi={poi} qualityBefore={qualityBefore} t={t} />
          </section>
        </div>

        <footer className="split-modal-footer">
          <span className="split-modal-hint">{t("compare.hint.sideBySide")}</span>
        </footer>
      </div>
    </div>
  );
}

// ── Card faces for each side of the compare ──────────────────────────

interface SplitCardProps {
  variant: "before" | "after";
  poi: PlaceResult;
  qualityBefore: number;
  t: (key: string) => string;
}

function SplitCard({ variant, poi, qualityBefore, t }: SplitCardProps) {
  const isBefore = variant === "before";
  const scoreShown = isBefore ? qualityBefore : (poi.qualityScore ?? poi.meta.quality);

  return (
    <div className="split-card" data-variant={variant}>
      <header className="split-card-header">
        <h3>{poi.name}</h3>
        <p>{poi.address}</p>
      </header>

      <div className="split-card-badge-row">
        <QualityScoreBadge score={scoreShown} size="sm" label={t("quality.label")} />
      </div>

      <div className="split-card-details">
        <DetailRow
          label={t("field.menu")}
          isBefore={isBefore}
          value={
            poi.enrichedMenuItems
              ? poi.enrichedMenuItems.slice(0, 3).join(" • ") +
                (poi.enrichedMenuItems.length > 3 ? ` +${poi.enrichedMenuItems.length - 3}` : "")
              : "—"
          }
          field={poi.provenance?.menu}
          t={t}
        />
        <DetailRow
          label={t("field.hours")}
          isBefore={isBefore}
          value={poi.enrichedHours ?? "—"}
          field={poi.provenance?.hours}
          t={t}
        />
        <DetailRow
          label={t("field.priceRange")}
          isBefore={isBefore}
          value={poi.enrichedPriceRange ?? "—"}
          field={poi.provenance?.priceRange}
          t={t}
        />
        <DetailRow
          label={t("field.dietTags")}
          isBefore={isBefore}
          value={poi.enrichedDietTags?.join(", ") ?? "—"}
          field={poi.provenance?.dietTags}
          t={t}
        />
      </div>
    </div>
  );
}

interface DetailRowProps {
  label: string;
  isBefore: boolean;
  value: string;
  field: import("../types").ProvenanceField | undefined;
  t: (key: string) => string;
}

function DetailRow({ label, isBefore, value, field, t }: DetailRowProps) {
  return (
    <div className="split-detail-row">
      <span className="split-detail-label">{label}</span>
      {isBefore ? (
        <span className="split-detail-missing">⚠️ {t("compare.missing")}</span>
      ) : (
        <span className="split-detail-value">{value}</span>
      )}
      {!isBefore && field && <ProvenanceBadge field={field} compact delayMs={0} />}
    </div>
  );
}
