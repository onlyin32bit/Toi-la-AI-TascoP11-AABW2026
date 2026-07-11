import { useEffect, useRef, useState } from "react";
import { IconFileSearch, IconLocationMap } from "nucleo-isometric";
import { useI18n } from "../i18n/LanguageContext";
import { tascoMaps } from "../lib/tasco-maps-client";
import type { TascoPlaceResult } from "../lib/tasco-maps-types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: () => void;
  onUseMyLocation: () => void;
  cities: string[];
  onCityPick: (city: string) => void;
  locating: boolean;
  // Show the secondary "no GPS? pick a city" row. Default true.
  showCityPicker?: boolean;
}

const DEBOUNCE_MS = 250;

export function SearchBar({
  query,
  onQueryChange,
  onSubmit,
  onUseMyLocation,
  cities,
  onCityPick,
  locating,
  showCityPicker = true,
}: SearchBarProps) {
  const { t } = useI18n();
  const [suggestions, setSuggestions] = useState<TascoPlaceResult[]>([]);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => {
      tascoMaps
        .autocomplete({ q: query, limit: 6 }, controller.signal)
        .then((res) => setSuggestions(res.suggestions))
        .catch(() => {
          // Fail silently — autocomplete is a nice-to-have, never blocks manual search.
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleSelect = (s: TascoPlaceResult) => {
    setSuggestionsVisible(false);
    onQueryChange(s.name ?? s.label ?? "");
    onSubmit();
  };

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <div className="glass-panel search-shell flex min-h-14 items-center gap-2 rounded-[1.35rem] px-2 py-2">
          <Button
            type="button"
            variant="glass"
            size="icon"
            className="size-10 shrink-0 rounded-2xl text-primary transition-transform hover:scale-105 active:scale-95"
            onClick={onSubmit}
            title={t("search.submit")}
          >
            <IconFileSearch size={22} title={t("search.submit")} />
          </Button>
          <Input
            type="text"
            className="h-10 border-0 bg-transparent px-1 text-[15px] font-semibold text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setSuggestionsVisible(true);
            }}
            onFocus={() => setSuggestionsVisible(true)}
            onBlur={() => setTimeout(() => setSuggestionsVisible(false), 150)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          />
          <Button
            type="button"
            variant="default"
            size="icon"
            className="size-10 shrink-0 rounded-2xl transition-transform hover:scale-105 active:scale-95"
            onClick={onUseMyLocation}
            disabled={locating}
            title={t("search.locate")}
          >
            <IconLocationMap size={22} title={t("search.locate")} className={locating ? "animate-spin" : undefined} />
          </Button>
        </div>
        {suggestionsVisible && suggestions.length > 0 && (
          <div className="glass-panel absolute inset-x-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-y-auto rounded-2xl p-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex w-full flex-col rounded-xl px-2.5 py-1.5 text-left text-xs hover:bg-white/[0.08]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
              >
                <span className="font-semibold text-foreground">{s.name ?? s.label}</span>
                {s.address && <span className="truncate text-muted-foreground">{s.address}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="collapse-panel" data-visible={showCityPicker}>
        <div className="glass-panel city-picker-row flex items-center gap-2 rounded-2xl px-3 py-2 text-xs text-muted-foreground">
          <span className="shrink-0 font-bold uppercase tracking-[0.14em] font-mono">{t("search.noGps")}</span>
          <Select onValueChange={onCityPick}>
            <SelectTrigger className="h-9 min-w-0 flex-1">
              <SelectValue placeholder={t("search.selectCity")} />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
