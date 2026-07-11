// Upload/camera → POST /v1/dishes/recognize → recognized dish + nearby
// restaurant matches. Passes userLoc when available for distanceMeters.
import { useState } from "react";
import { recognizeDish } from "../api";
import { HttpError } from "../lib/http";
import type { GoRecognizeResponse } from "../lib/go-types";
import type { UserLocation } from "../types";

const MAX_BYTES = 8 * 1024 * 1024;

interface Props {
  open: boolean;
  userLoc: UserLocation | null;
  onClose: () => void;
  onOpenPoi?: (restaurantId: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

type Status = { kind: "idle" } | { kind: "pending" } | { kind: "unavailable" } | { kind: "error" } | {
  kind: "done";
  result: GoRecognizeResponse;
};

export function DishPhoto({ open, userLoc, onClose, onOpenPoi, t }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  if (!open) return null;

  const handleFile = (f: File | null) => {
    setValidationError(null);
    setStatus({ kind: "idle" });
    if (!f) return setFile(null);
    if (!f.type.startsWith("image/")) {
      setValidationError(t("menu.upload.invalidType"));
      return;
    }
    if (f.size > MAX_BYTES) {
      setValidationError(t("menu.upload.tooLarge"));
      return;
    }
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || status.kind === "pending") return;
    setStatus({ kind: "pending" });
    try {
      const result = await recognizeDish(file, userLoc ?? undefined);
      setStatus({ kind: "done", result });
    } catch (err) {
      if (err instanceof HttpError && err.status === 503) {
        setStatus({ kind: "unavailable" });
      } else {
        console.warn("[dish-photo] recognize failed:", err);
        setStatus({ kind: "error" });
      }
    }
  };

  return (
    <div
      className="ugc-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="ugc-modal-panel" onSubmit={handleSubmit}>
        <header className="ugc-modal-header">
          <h2>{t("dish.photo.title")}</h2>
          <button type="button" className="ugc-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="text-xs text-muted-foreground">{t("dish.photo.hint")}</p>

        <div className="ugc-field">
          <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
        </div>

        {validationError && <p className="text-xs font-medium text-destructive">{validationError}</p>}
        {status.kind === "unavailable" && <p className="text-xs font-medium text-destructive">{t("dish.photo.unavailable")}</p>}
        {status.kind === "error" && <p className="text-xs font-medium text-destructive">{t("dish.photo.error")}</p>}
        {status.kind === "pending" && <p className="text-xs text-muted-foreground">{t("dish.photo.thinking")}</p>}

        {status.kind === "done" && (
          <div className="ugc-field space-y-2">
            <div>
              <span className="ugc-field-label">{status.result.recognized.dish_name}</span>
              <p className="text-xs text-muted-foreground">
                {status.result.recognized.cuisine} · {t("dish.photo.confidence")}{" "}
                {Math.round(status.result.recognized.confidence * 100)}%
              </p>
              {status.result.recognized.alternatives.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("dish.photo.alternatives")}: {status.result.recognized.alternatives.join(", ")}
                </p>
              )}
            </div>
            <div>
              <span className="ugc-field-label">{t("dish.photo.matches")}</span>
              {status.result.matches.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("dish.photo.noMatches")}</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {status.result.matches.map((m, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => onOpenPoi?.(m.restaurant_id)}
                      >
                        {m.dish}
                      </button>
                      <span className="font-mono">
                        {m.price_vnd.toLocaleString("vi-VN")}đ
                        {m.distanceMeters !== undefined ? ` · ${(m.distanceMeters / 1000).toFixed(1)}km` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        <footer className="ugc-modal-footer">
          <button type="button" className="ugc-btn ugc-btn-ghost" onClick={onClose}>
            {t("menu.upload.cancel")}
          </button>
          <button type="submit" className="ugc-btn ugc-btn-primary" disabled={!file || status.kind === "pending"}>
            {t("dish.photo.submit")}
          </button>
        </footer>
      </form>
    </div>
  );
}
