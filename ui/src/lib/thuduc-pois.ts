// Loader + types for the pre-scraped Thu Duc dataset served as static JSON
// under /thuduc-pois.json (see ui/public/). 809 POIs geocoded via Foody +
// Google Places; kept out of the main benchmark KB so it doesn't inflate
// /v1/recommend or dilute the 15 eval questions.
import { useEffect, useState } from "react";

export interface ThuDucPoi {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  category: string | null;
  cuisine: string | null;
  priceLevel: string | null;
  avgPriceVnd: number | null;
  rating: number | null;
  reviewCount: number | null;
  district: string;
  openHours: string | null;
  source: string;
}

interface ThuDucDataset {
  generated: string;
  district: string;
  count: number;
  pois: ThuDucPoi[];
}

const PUBLIC_PATH = "/thuduc-pois.json";

let cache: ThuDucPoi[] | null = null;
let inflight: Promise<ThuDucPoi[]> | null = null;

/** Fetches the Thu Duc dataset once and caches it in-memory for the tab. */
export async function loadThuDucPois(): Promise<ThuDucPoi[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch(PUBLIC_PATH)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<ThuDucDataset>;
    })
    .then((d) => {
      cache = d.pois;
      inflight = null;
      return cache;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/** React hook — returns pois when enabled, [] otherwise. */
export function useThuDucPois(enabled: boolean): ThuDucPoi[] {
  const [pois, setPois] = useState<ThuDucPoi[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadThuDucPois()
      .then((list) => {
        if (!cancelled) setPois(list);
      })
      .catch((err) => {
        console.warn("[thuduc] load failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return pois;
}
