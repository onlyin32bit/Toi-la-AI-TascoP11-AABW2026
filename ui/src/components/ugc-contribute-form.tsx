// Minimal contribute-a-place modal opened by UgcSuggestChip. On submit,
// forwards the entry (with current-location coords) up to App via onSubmit.
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

export function UgcContributeForm({
  open,
  initialName,
  userLat,
  userLng,
  onCancel,
  onSubmit,
  t,
}: Props) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState("");
  const [dish, setDish] = useState("");
  const [dietVeg, setDietVeg] = useState(false);
  const [dietHalal, setDietHalal] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setAddress("");
      setDish("");
      setDietVeg(false);
      setDietHalal(false);
    }
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
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
    <div
      className="ugc-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form className="ugc-modal-panel" onSubmit={handleSubmit}>
        <header className="ugc-modal-header">
          <h2>{t("ugc.modal.title")}</h2>
          <button
            type="button"
            className="ugc-modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="ugc-field">
          <label htmlFor="ugc-name">
            {t("ugc.field.name")} <span className="req">*</span>
          </label>
          <input
            id="ugc-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="ugc-field">
          <label htmlFor="ugc-addr">{t("ugc.field.address")}</label>
          <input
            id="ugc-addr"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("ugc.field.address.placeholder")}
          />
        </div>

        <div className="ugc-field">
          <label htmlFor="ugc-dish">{t("ugc.field.dish")}</label>
          <input
            id="ugc-dish"
            type="text"
            value={dish}
            onChange={(e) => setDish(e.target.value)}
          />
        </div>

        <div className="ugc-field">
          <span className="ugc-field-label">{t("ugc.field.dietTags")}</span>
          <div className="ugc-diet-row">
            <label>
              <input
                type="checkbox"
                checked={dietVeg}
                onChange={(e) => setDietVeg(e.target.checked)}
              />{" "}
              {t("diet.vegetarian")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={dietHalal}
                onChange={(e) => setDietHalal(e.target.checked)}
              />{" "}
              {t("diet.halal")}
            </label>
          </div>
        </div>

        <footer className="ugc-modal-footer">
          <button type="button" className="ugc-btn ugc-btn-ghost" onClick={onCancel}>
            {t("ugc.cancel")}
          </button>
          <button
            type="submit"
            className="ugc-btn ugc-btn-primary"
            disabled={!canSubmit}
          >
            {t("ugc.submit")}
          </button>
        </footer>
      </form>
    </div>
  );
}
