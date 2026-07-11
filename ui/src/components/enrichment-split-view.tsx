// Before/After split-slider modal for the enrichment demo. Two full-card
// layers are stacked in the same container; the "after" layer is clipped
// left-to-right based on a draggable divider so BGK can visually A/B the
// data richness in ~2 seconds.
import { useEffect, useRef, useState } from "react";
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

// Default divider position — 50/50 read, user can drag to either extreme.
const DEFAULT_SPLIT_PCT = 50;

export function EnrichmentSplitView({ open, poi, qualityBefore, onClose, t }: Props) {
  const [splitPct, setSplitPct] = useState(DEFAULT_SPLIT_PCT);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragActive = useRef(false);

  useEffect(() => {
    if (open) setSplitPct(DEFAULT_SPLIT_PCT);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setSplitPct((p) => Math.max(0, p - 5));
      if (e.key === "ArrowRight") setSplitPct((p) => Math.min(100, p + 5));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const updateFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSplitPct(Math.max(0, Math.min(100, pct)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragActive.current = true;
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActive.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = () => {
    dragActive.current = false;
  };

  const containerStyle = { ["--split-x" as string]: `${splitPct}%` } as React.CSSProperties;

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

        <div
          ref={containerRef}
          className="split-container"
          style={containerStyle}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(splitPct)}
          aria-label={t("compare.slider.aria")}
        >
          {/* BEFORE layer (bottom, always fully visible) */}
          <div className="split-layer split-layer-before" aria-hidden={splitPct === 100}>
            <SplitCard variant="before" poi={poi} qualityBefore={qualityBefore} t={t} />
            <span className="split-label split-label-before">{t("compare.before")}</span>
          </div>

          {/* AFTER layer (top, clipped by --split-x) */}
          <div className="split-layer split-layer-after" aria-hidden={splitPct === 0}>
            <SplitCard variant="after" poi={poi} qualityBefore={qualityBefore} t={t} />
            <span className="split-label split-label-after">{t("compare.after")}</span>
          </div>

          {/* Draggable divider handle */}
          <div
            className="split-divider"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-hidden
          >
            <span className="split-divider-line" />
            <span className="split-divider-handle">
              <span className="split-divider-arrow">◂</span>
              <span className="split-divider-arrow">▸</span>
            </span>
          </div>
        </div>

        <footer className="split-modal-footer">
          <span className="split-modal-hint">{t("compare.hint")}</span>
        </footer>
      </div>
    </div>
  );
}

// ── Card faces for each side of the split ────────────────────────────

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
        {/* Menu */}
        <div className="split-detail-row">
          <span className="split-detail-label">{t("field.menu")}</span>
          {isBefore ? (
            <span className="split-detail-missing">⚠️ {t("compare.missing")}</span>
          ) : (
            <span className="split-detail-value">
              {poi.enrichedMenuItems?.slice(0, 3).join(" • ") ?? "—"}
              {poi.enrichedMenuItems && poi.enrichedMenuItems.length > 3
                ? ` +${poi.enrichedMenuItems.length - 3}`
                : ""}
            </span>
          )}
          {!isBefore && poi.provenance?.menu && (
            <ProvenanceBadge field={poi.provenance.menu} compact delayMs={0} />
          )}
        </div>

        {/* Hours */}
        <div className="split-detail-row">
          <span className="split-detail-label">{t("field.hours")}</span>
          {isBefore ? (
            <span className="split-detail-missing">⚠️ {t("compare.missing")}</span>
          ) : (
            <span className="split-detail-value">{poi.enrichedHours ?? "—"}</span>
          )}
          {!isBefore && poi.provenance?.hours && (
            <ProvenanceBadge field={poi.provenance.hours} compact delayMs={0} />
          )}
        </div>

        {/* Price range */}
        <div className="split-detail-row">
          <span className="split-detail-label">{t("field.priceRange")}</span>
          {isBefore ? (
            <span className="split-detail-missing">⚠️ {t("compare.missing")}</span>
          ) : (
            <span className="split-detail-value">{poi.enrichedPriceRange ?? "—"}</span>
          )}
          {!isBefore && poi.provenance?.priceRange && (
            <ProvenanceBadge field={poi.provenance.priceRange} compact delayMs={0} />
          )}
        </div>

        {/* Diet tags */}
        <div className="split-detail-row">
          <span className="split-detail-label">{t("field.dietTags")}</span>
          {isBefore ? (
            <span className="split-detail-missing">⚠️ {t("compare.missing")}</span>
          ) : (
            <span className="split-detail-value">
              {poi.enrichedDietTags?.join(", ") ?? "—"}
            </span>
          )}
          {!isBefore && poi.provenance?.dietTags && (
            <ProvenanceBadge field={poi.provenance.dietTags} compact delayMs={0} />
          )}
        </div>
      </div>
    </div>
  );
}
