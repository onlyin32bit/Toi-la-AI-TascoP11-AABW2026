// Attaches a menu photo to an EXISTING poi via POST /v1/contribute/menu (OCR).
// Distinct from ugc-contribute-form.tsx, which adds a brand-new restaurant.
// Returned dishes are `needs_confirm: true` — presented as a review list, not
// implied to be saved facts yet.
import { useState } from "react";
import { uploadMenu } from "../api";
import type { GoPoiDish } from "../lib/go-types";

const MAX_BYTES = 8 * 1024 * 1024;

interface Props {
  open: boolean;
  poiId: string;
  poiName: string;
  onClose: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function MenuUpload({ open, poiId, poiName, onClose, t }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dishes, setDishes] = useState<GoPoiDish[] | null>(null);

  if (!open) return null;

  const handleFile = (f: File | null) => {
    setError(null);
    setDishes(null);
    if (!f) return setFile(null);
    if (!f.type.startsWith("image/")) {
      setError(t("menu.upload.invalidType"));
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(t("menu.upload.tooLarge"));
      return;
    }
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await uploadMenu(poiId, file);
      setDishes(res.dishes);
    } catch (err) {
      console.warn("[menu-upload] failed:", err);
      setError(t("menu.upload.error"));
    } finally {
      setPending(false);
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
          <h2>{t("menu.upload.title")}</h2>
          <button type="button" className="ugc-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="ugc-field-label">{poiName}</p>
        <p className="text-xs text-muted-foreground">{t("menu.upload.hint")}</p>

        <div className="ugc-field">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {error && <p className="text-xs font-medium text-destructive">{error}</p>}

        {dishes && (
          <div className="ugc-field">
            <span className="ugc-field-label">{t("menu.upload.pending")}</span>
            <ul className="mt-1 space-y-1 text-xs">
              {dishes.map((d, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{d.name}</span>
                  <span className="font-mono">{d.price_vnd.toLocaleString("vi-VN")}đ</span>
                </li>
              ))}
              {dishes.length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </div>
        )}

        <footer className="ugc-modal-footer">
          <button type="button" className="ugc-btn ugc-btn-ghost" onClick={onClose}>
            {t("menu.upload.cancel")}
          </button>
          <button type="submit" className="ugc-btn ugc-btn-primary" disabled={!file || pending}>
            {pending ? "…" : t("menu.upload.submit")}
          </button>
        </footer>
      </form>
    </div>
  );
}
