// Side-by-side comparison of 2+ DIFFERENT restaurants via GET /v1/compare.
// Distinct from enrichment-split-view.tsx (before/after enrichment of ONE poi).
import { useEffect, useState } from "react";
import { compareRestaurants, type CompareOutcome } from "../api";
import type { UserLocation } from "../types";

interface Props {
  open: boolean;
  ids: string[];
  userLoc: UserLocation | null;
  onClose: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

type Status = { kind: "pending" } | { kind: "error" } | { kind: "done"; data: CompareOutcome };

export function CompareView({ open, ids, userLoc, onClose, t }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "pending" });

  useEffect(() => {
    if (!open || ids.length === 0) return;
    let cancelled = false;
    setStatus({ kind: "pending" });
    compareRestaurants(ids, userLoc ?? undefined)
      .then((data) => {
        if (!cancelled) setStatus({ kind: "done", data });
      })
      .catch((err) => {
        console.warn("[compare-view] failed:", err);
        if (!cancelled) setStatus({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, ids, userLoc]);

  if (!open) return null;

  return (
    <div
      className="ugc-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ugc-modal-panel" style={{ maxWidth: "min(92vw, 640px)", overflowX: "auto" }}>
        <header className="ugc-modal-header">
          <h2>{t("cmp.title")}</h2>
          <button type="button" className="ugc-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {status.kind === "pending" && <p className="text-xs text-muted-foreground">…</p>}
        {status.kind === "error" && <p className="text-xs font-medium text-destructive">{t("cmp.error")}</p>}

        {status.kind === "done" && (
          <>
            {status.data.notFound.length > 0 && (
              <p className="text-xs font-medium text-destructive">
                {t("cmp.notFound", { ids: status.data.notFound.join(", ") })}
              </p>
            )}
            <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${status.data.items.length}, minmax(140px, 1fr))`, gap: "0.75rem" }}>
              {status.data.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/12 bg-white/[0.04] p-2 text-xs">
                  <p className="font-display mb-1 truncate text-[13px] font-bold">{item.name}</p>
                  <Row label={t("cmp.col.price")} value={`${item.priceLevel} · ${item.avgPriceVnd.toLocaleString("vi-VN")}đ`} />
                  <Row label={t("cmp.col.rating")} value={item.rating.toFixed(1)} />
                  <Row label={t("cmp.col.quality")} value={item.quality.toFixed(2)} />
                  {item.distanceMeters !== null && (
                    <Row label={t("cmp.col.distance")} value={`${(item.distanceMeters / 1000).toFixed(1)}km`} />
                  )}
                  <div className="mt-1">
                    <span className="text-muted-foreground">{t("cmp.col.dishes")}:</span>
                    <ul>
                      {item.topDishes.slice(0, 3).map((d) => (
                        <li key={d.dish}>{d.dish}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <footer className="ugc-modal-footer">
          <button type="button" className="ugc-btn ugc-btn-primary" onClick={onClose}>
            {t("cmp.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
