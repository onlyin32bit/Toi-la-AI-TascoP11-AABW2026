import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowDown,
  IconCrown,
  IconGear,
  IconGlobe,
  IconLocationHeart,
  IconLocationMap,
  IconPhoto,
  IconSwitchOff,
  IconSwitchOn,
} from "nucleo-isometric";
import { recommend } from "./api";
import { CITIES } from "./data/mockPlaces";
import { MapView } from "./components/MapView";
import { SearchBar } from "./components/SearchBar";
import { FilterChips } from "./components/FilterChips";
import { ResultCard } from "./components/ResultCard";
import { AssistantBox } from "./components/AssistantBox";
import { EnrichmentTerminal } from "./components/enrichment-terminal";
import { EnrichmentSplitView } from "./components/enrichment-split-view";
import { UgcContributeForm } from "./components/ugc-contribute-form";
import { DemoResetButton } from "./components/demo-reset-button";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { useI18n } from "./i18n/LanguageContext";
import { cn } from "./lib/utils";
import type {
  EnrichmentResult,
  NotFoundReason,
  PlaceResult,
  SearchFilters,
  SearchResponse,
  UserLocation,
  Vehicle,
} from "./types";
import { DEMO_POI_ID, MOCK_ENRICHMENT_RESULT } from "./data/mock-enrichment";
import { loadEnriched, saveEnriched } from "./lib/enrichment-runner";
import type { EnrichApiRequest } from "./lib/enrich-api-client";
import { enqueueUgc, listUgc, type UgcEntry } from "./lib/ugc-queue";
import "./App.css";

type ThemeMode = "dark" | "light";
type AccentTheme = "green" | "blue" | "orange" | "pink" | "lgbt";
// Three-position bottom sheet:
//   hidden   → docked off-screen; a swipe-hint bar peeks at the viewport edge
//   half     → ~52 dvh visible (default) — enough for a few cards, map still readable
//   expanded → full viewport height — deep browse
type SheetState = "hidden" | "half" | "expanded";

const VEHICLE_OPTIONS: { id: Vehicle; emoji: string }[] = [
  { id: "walk", emoji: "🚶" },
  { id: "bike", emoji: "🚲" },
  { id: "motorbike", emoji: "🛵" },
  { id: "car", emoji: "🚗" },
];

const ACCENT_THEMES: { id: AccentTheme; label: string; swatch: string }[] = [
  { id: "green", label: "Green", swatch: "#ccff00" },
  { id: "blue", label: "Blue", swatch: "#5bd3ff" },
  { id: "orange", label: "Orange", swatch: "#ff9f1c" },
  { id: "pink", label: "Pink", swatch: "#ff5db1" },
  {
    id: "lgbt",
    label: "LGBT",
    swatch:
      "linear-gradient(135deg, #e40303 0 16%, #ff8c00 16% 32%, #ffed00 32% 48%, #008026 48% 64%, #24408e 64% 80%, #732982 80% 100%)",
  },
];

// Drag thresholds on the grip.
const HIDE_THRESHOLD_PX = 90; // drag DOWN this far → hide
const SHOW_THRESHOLD_PX = 30; // drag UP this far   → show (easy)

function readThemeMode(): ThemeMode {
  const value = window.localStorage.getItem("tasco-theme-mode");
  return value === "light" || value === "dark" ? value : "dark";
}

function readAccentTheme(): AccentTheme {
  const value = window.localStorage.getItem("tasco-accent-theme");
  return ACCENT_THEMES.some((theme) => theme.id === value) ? (value as AccentTheme) : "green";
}

function readExtrasExpanded(): boolean {
  // Default expanded — reveal all controls on first paint. User can collapse.
  const val = window.localStorage.getItem("tasco-extras-expanded");
  return val === null ? true : val === "1";
}

const VEHICLE_IDS: Vehicle[] = ["walk", "bike", "motorbike", "car"];

function readVehicle(): Vehicle {
  const value = window.localStorage.getItem("tasco-vehicle");
  return VEHICLE_IDS.includes(value as Vehicle) ? (value as Vehicle) : "motorbike";
}

function reasonText(r: NotFoundReason, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (r.kind) {
    case "dish":
      return t("empty.reason.dish", { dish: r.dish ?? "" });
    case "dietCity":
      return t("empty.reason.dietCity", { diet: t(`diet.${r.diet}`), city: r.city ?? "" });
    case "segment":
      return t("empty.reason.segment", { segment: t(`segment.${r.segment}`) });
    case "vehicleRange":
      return t("empty.reason.vehicleRange", { vehicle: r.vehicle ? t(`vehicle.${r.vehicle}`) : "" });
    default:
      return t("empty.reason.generic");
  }
}

function App() {
  const { t, lang, setLang } = useI18n();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(() => ({ vehicle: readVehicle() }));
  const [userLoc, setUserLoc] = useState<UserLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [mapFocus, setMapFocus] = useState<"results" | "user">("results");
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [accentTheme, setAccentTheme] = useState<AccentTheme>(readAccentTheme);
  // Collapse state for secondary controls on narrow viewports.
  // On lg+ this is ignored — all extras are always visible.
  const [isNarrow, setIsNarrow] = useState<boolean>(() => window.innerWidth < 1024);
  const [extrasExpanded, setExtrasExpanded] = useState<boolean>(readExtrasExpanded);
  // Default to half so results are visible without covering the whole map.
  // Tap grip to step down; drag up to reach full.
  const [sheetState, setSheetState] = useState<SheetState>("half");

  // ── Enrichment + UGC demo state ────────────────────────────────────
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  // Client-side patches applied to results after enrichment (menu, hours, etc.)
  // Keyed by POI id so we can layer them onto whatever the ranker returns.
  const [enrichmentPatches, setEnrichmentPatches] = useState<Record<string, EnrichmentResult>>(
    () => {
      const saved = loadEnriched(DEMO_POI_ID);
      const map: Record<string, EnrichmentResult> = {};
      if (saved) map[DEMO_POI_ID] = saved;
      return map;
    },
  );
  const [ugcOpen, setUgcOpen] = useState(false);
  const [ugcSuggested, setUgcSuggested] = useState("");
  const [ugcPins, setUgcPins] = useState<UgcEntry[]>(() => listUgc());
  const [compareOpenId, setCompareOpenId] = useState<string | null>(null);

  const dockRef = useRef<HTMLElement | null>(null);
  const dragStart = useRef<{ y: number; pointerId: number; moved: boolean } | null>(null);
  const swipeStart = useRef<{ y: number; pointerId: number } | null>(null);

  const runSearch = async (nextQuery: string, nextFilters: SearchFilters, loc: UserLocation | null) => {
    const res = await recommend(nextQuery, nextFilters, loc ?? undefined);
    setResponse(res);
  };

  useEffect(() => {
    runSearch("", {}, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.dataset.accent = accentTheme;
    window.localStorage.setItem("tasco-theme-mode", themeMode);
    window.localStorage.setItem("tasco-accent-theme", accentTheme);
  }, [themeMode, accentTheme]);

  useEffect(() => {
    window.localStorage.setItem("tasco-extras-expanded", extrasExpanded ? "1" : "0");
  }, [extrasExpanded]);

  useEffect(() => {
    if (filters.vehicle) window.localStorage.setItem("tasco-vehicle", filters.vehicle);
  }, [filters.vehicle]);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Auto-reveal on new search: bump hidden → half but don't clobber user's
  // existing choice if they've already expanded.
  const revealForResults = () => setSheetState((prev) => (prev === "hidden" ? "half" : prev));

  const handleSubmit = () => {
    setMapFocus("results");
    revealForResults();
    runSearch(query, filters, userLoc);
  };

  const handleFiltersChange = (next: SearchFilters) => {
    setFilters(next);
    setMapFocus("results");
    revealForResults();
    runSearch(query, next, userLoc);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserLoc(loc);
        setLocating(false);
        setMapFocus("user");
        runSearch(query, filters, loc);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  };

  const handleCityPick = (city: string) => {
    setQuery(city);
    setMapFocus("results");
    revealForResults();
    runSearch(city, filters, userLoc);
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setExpandedId(id);
    // Selecting a POI focuses the map — force the sheet to half so the pin is
    // visible. From half or hidden we also normalize to half.
    setSheetState("half");
  };

  // ── Enrichment handlers ────────────────────────────────────────────
  const handleEnrichClick = useCallback((id: string) => {
    setEnrichingId(id);
    setTerminalOpen(true);
  }, []);

  // Stable identity so the EnrichmentTerminal's effect doesn't restart on
  // unrelated App re-renders (resize, i18n toggle, etc.). Depends on
  // enrichingId only — that's the piece the callback needs to close over.
  const handleTerminalComplete = useCallback(
    (res: EnrichmentResult) => {
      if (!enrichingId) return;
      saveEnriched(enrichingId, res);
      setEnrichmentPatches((prev) => ({ ...prev, [enrichingId]: res }));
    },
    [enrichingId],
  );

  const handleTerminalClose = useCallback(() => {
    setTerminalOpen(false);
    setEnrichingId(null);
  }, []);

  // ── UGC handlers ────────────────────────────────────────────────────
  const handleUgcOpen = useCallback((suggestedName: string) => {
    setUgcSuggested(suggestedName);
    setUgcOpen(true);
  }, []);

  const handleUgcSubmit = (data: Omit<UgcEntry, "id" | "createdAt" | "status">) => {
    const entry = enqueueUgc(data);
    setUgcPins((prev) => [...prev, entry]);
    setUgcOpen(false);
  };

  const handleDemoReset = () => {
    window.location.reload();
  };

  // ── Compare handlers ───────────────────────────────────────────────
  const handleCompareOpen = useCallback((id: string) => {
    setCompareOpenId(id);
  }, []);
  const handleCompareClose = useCallback(() => {
    setCompareOpenId(null);
  }, []);

  // Grip handles both a tap-to-cycle and a drag gesture.
  //   tap          → cycle down (expanded → half → hidden → half)
  //   drag up      → step up   (hidden → half → expanded)
  //   drag down    → step down (expanded → half → hidden)
  const stepUp = (s: SheetState): SheetState =>
    s === "hidden" ? "half" : s === "half" ? "expanded" : "expanded";
  const stepDown = (s: SheetState): SheetState =>
    s === "expanded" ? "half" : s === "half" ? "hidden" : "hidden";
  const tapCycle = (s: SheetState): SheetState =>
    // Tap on grip = go one step down. From hidden the grip is off-screen so
    // this branch is unreachable; guard by cycling back to half instead.
    s === "expanded" ? "half" : s === "half" ? "hidden" : "half";

  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = { y: e.clientY, pointerId: e.pointerId, moved: false };
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
    const raw = e.clientY - dragStart.current.y;
    // Bumped from 4 → 12 so mouse jitter on desktop doesn't turn a tap into a
    // failed drag.
    if (Math.abs(raw) > 12) dragStart.current.moved = true;
  };

  const releaseDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragStart.current || dragStart.current.pointerId !== e.pointerId) return;
    const delta = e.clientY - dragStart.current.y;
    const moved = dragStart.current.moved;
    dragStart.current = null;
    const smallMove = Math.abs(delta) < SHOW_THRESHOLD_PX;
    if (!moved || smallMove) {
      setSheetState(tapCycle(sheetState));
      return;
    }
    if (delta < -SHOW_THRESHOLD_PX) setSheetState(stepUp(sheetState));
    else if (delta > HIDE_THRESHOLD_PX) setSheetState(stepDown(sheetState));
  };

  // Bottom-edge swipe-up: reveals the dock when hidden. Fires as soon as the
  // upward delta crosses SHOW_THRESHOLD_PX so it feels instant.
  const onSwipePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    swipeStart.current = { y: e.clientY, pointerId: e.pointerId };
  };

  const onSwipePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeStart.current || swipeStart.current.pointerId !== e.pointerId) return;
    const delta = e.clientY - swipeStart.current.y;
    if (delta < -SHOW_THRESHOLD_PX) {
      swipeStart.current = null;
      // Reveal to half — user can drag further up to full via grip.
      setSheetState("half");
    }
  };

  const onSwipeRelease = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeStart.current || swipeStart.current.pointerId !== e.pointerId) return;
    const delta = e.clientY - swipeStart.current.y;
    swipeStart.current = null;
    // Tap on hint = reveal to half.
    if (Math.abs(delta) < 8) setSheetState("half");
  };

  const rawResults = response?.results ?? [];
  // Apply enrichment patches + demo-POI "before" downgrade to the results
  // array before anything else consumes it. Order matters: patch first
  // (adds enriched fields), THEN force the demo POI to 0.61 only if unenriched
  // so the "before" state persists on cold load.
  const results = useMemo<PlaceResult[]>(() => {
    return rawResults.map((r) => {
      const patch = enrichmentPatches[r.id];
      if (patch) {
        return {
          ...r,
          qualityScore: patch.qualityAfter,
          provenance: patch.provenance,
          isEnriched: true,
          enrichedMenuItems: patch.menuItems,
          enrichedHours: patch.hoursOpen,
          enrichedPriceRange: patch.priceRange,
          enrichedDietTags: patch.dietTags,
        };
      }
      return r;
    });
  }, [rawResults, enrichmentPatches]);

  const topScore = results[0] ? (results[0].meta.why.final * 10).toFixed(1) : "--";
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const selectedResult = results.find((result) => result.id === selectedId) ?? results[0];
  // Secondary controls: always shown on lg+, gated by user toggle on narrow.
  const showExtras = !isNarrow || extrasExpanded;

  const enrichingResult = enrichingId ? results.find((r) => r.id === enrichingId) : null;
  const hasDemoState = Object.keys(enrichmentPatches).length > 0 || ugcPins.length > 0;

  // Memoize the enrichment payload so EnrichmentTerminal's effect doesn't
  // restart the runner whenever App re-renders (results reference changes).
  // qualityBefore is pulled from the target POI's own quality so the terminal
  // log matches whatever number the card badge is currently showing.
  const activeEnrichmentPayload = useMemo(() => {
    if (!enrichingId) return MOCK_ENRICHMENT_RESULT;
    const target = rawResults.find((r) => r.id === enrichingId);
    const currentQuality = target?.qualityScore ?? target?.meta.quality ?? MOCK_ENRICHMENT_RESULT.qualityBefore;
    return {
      ...MOCK_ENRICHMENT_RESULT,
      poiId: enrichingId,
      qualityBefore: currentQuality,
      qualityAfter: Math.min(0.98, currentQuality + 0.1),
    };
  }, [enrichingId, rawResults]);

  // Live enrich request — sent to POST /v1/enrich when the engine base URL
  // env var is set. Absent env => undefined => terminal falls back to the
  // fixed mock schedule (offline demo).
  const activeLiveRequest = useMemo<EnrichApiRequest | undefined>(() => {
    if (!enrichingId) return undefined;
    if (!import.meta.env.VITE_ENGINE_BASE_URL) return undefined;
    const target = rawResults.find((r) => r.id === enrichingId);
    if (!target) return undefined;
    return {
      poiId: target.id,
      name: target.name,
      address: target.address,
      city: target.city,
      qualityBefore: activeEnrichmentPayload.qualityBefore,
    };
  }, [enrichingId, rawResults, activeEnrichmentPayload.qualityBefore]);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-background text-foreground app-ambient">
      <MapView
        results={results}
        userLoc={userLoc}
        selectedId={selectedId}
        satellite={satellite}
        focusMode={mapFocus}
        onSelect={handleSelect}
        ugcPins={ugcPins}
      />

      <div className="tech-grid-bg" aria-hidden />
      <div className="map-overlay pointer-events-none absolute inset-0 z-[400]" />

      <section className="pointer-events-none absolute inset-x-0 top-0 z-[700] px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4">
        <div className="pointer-events-auto mx-auto flex w-full max-w-[520px] flex-col gap-2.5 lg:ml-6 lg:mr-auto stagger">
          <div className="glass-panel command-deck sheen-sweep overflow-hidden rounded-[1.35rem] p-2.5">
            <div className="flex items-center justify-between gap-2.5">
              <div className="min-w-0 px-1">
                <div className="flex items-center gap-2 text-[0.65rem] font-extrabold uppercase tracking-[0.16em] text-primary">
                  <IconCrown size={15} />
                  <span className="font-mono">P11.INTEL</span>
                  <span className="ml-1 inline-flex h-[6px] w-[6px] rounded-full bg-primary shadow-[0_0_10px_var(--color-primary)]" />
                </div>
                <div className="mt-1 flex min-w-0 items-end gap-2">
                  <h1 className="font-display truncate text-[1.4rem] font-bold leading-none text-foreground">Tasco Food</h1>
                  <span className="hidden rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-muted-foreground sm:inline-flex font-mono">
                    v2.6 / MAP-FIRST
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-xs font-medium text-muted-foreground">{t("app.subtitle")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center gap-1 rounded-2xl border border-white/12 bg-black/25 p-1 backdrop-blur-md">
                  <Button
                    type="button"
                    size="sm"
                    variant={lang === "vi" ? "default" : "ghost"}
                    className="h-8 rounded-xl px-2.5 text-xs font-mono"
                    onClick={() => setLang("vi")}
                  >
                    VI
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={lang === "en" ? "default" : "ghost"}
                    className="h-8 rounded-xl px-2.5 text-xs font-mono"
                    onClick={() => setLang("en")}
                  >
                    EN
                  </Button>
                </div>
                {isNarrow && (
                  <Button
                    type="button"
                    size="icon"
                    variant="glass"
                    className="size-9 rounded-2xl lg:hidden"
                    aria-label={extrasExpanded ? "Collapse controls" : "Expand controls"}
                    aria-expanded={extrasExpanded}
                    onClick={() => setExtrasExpanded((v) => !v)}
                  >
                    <IconArrowDown
                      size={16}
                      className={cn("transition-transform duration-300", extrasExpanded && "rotate-180")}
                    />
                  </Button>
                )}
              </div>
            </div>

            <div className="collapse-panel" data-visible={showExtras}>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={themeMode === "dark" ? "default" : "glass"}
                className="h-9 min-w-[6.5rem] flex-1 justify-start rounded-xl px-2.5 text-xs"
                onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
                title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {themeMode === "dark" ? <IconSwitchOn size={18} /> : <IconSwitchOff size={18} />}
                {themeMode === "dark" ? "Dark" : "Light"}
              </Button>
              <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.06] px-1.5 py-1.5">
                <IconGear size={16} className="shrink-0 text-muted-foreground" />
                {ACCENT_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    aria-label={`${theme.label} theme`}
                    title={`${theme.label} theme`}
                    className={cn(
                      "theme-dot shrink-0 rounded-full border border-white/20",
                      accentTheme === theme.id && "is-active",
                    )}
                    style={{ background: theme.swatch }}
                    onClick={() => setAccentTheme(theme.id)}
                  />
                ))}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.06] px-2 py-1.5">
              <span className="shrink-0 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted-foreground font-mono">
                {t("vehicle.label")}
              </span>
              <Select
                value={filters.vehicle ?? "motorbike"}
                onValueChange={(v) => handleFiltersChange({ ...filters, vehicle: v as Vehicle })}
              >
                <SelectTrigger className="h-9 min-w-0 flex-1 rounded-lg" aria-label={t("vehicle.label")}>
                  <SelectValue>
                    <span className="mr-2" aria-hidden>
                      {VEHICLE_OPTIONS.find((v) => v.id === (filters.vehicle ?? "motorbike"))?.emoji}
                    </span>
                    {t(`vehicle.${filters.vehicle ?? "motorbike"}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_OPTIONS.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      <span className="mr-2" aria-hidden>
                        {v.emoji}
                      </span>
                      {t(`vehicle.${v.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            </div>
          </div>
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onSubmit={handleSubmit}
            onUseMyLocation={handleUseMyLocation}
            cities={CITIES}
            onCityPick={handleCityPick}
            locating={locating}
            showCityPicker={showExtras}
          />
          <div className="collapse-panel" data-visible={showExtras}>
            <FilterChips filters={filters} onChange={handleFiltersChange} />
          </div>
        </div>
      </section>

      <aside ref={dockRef} data-sheet={sheetState} className="result-dock">
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheetState === "expanded" ? "Collapse recommendations" : "Toggle recommendations"}
          aria-expanded={sheetState !== "hidden"}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={releaseDrag}
          onPointerCancel={releaseDrag}
        >
          <span className="sheet-handle-grip" />
        </button>

        <div className="sheet-body flex min-h-0 flex-1 flex-col px-4">
          <div className="mb-3 grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[0.66rem] font-extrabold uppercase tracking-[0.14em] text-primary">
                <span className="pulse-dot" />
                <span className="font-mono">Live recommendations</span>
              </div>
              <h2 className="font-display mt-1 truncate text-xl font-bold leading-tight text-foreground">
                {t("results.count", { count: results.length })}
              </h2>
              <p className="mt-0.5 line-clamp-1 text-xs font-medium text-muted-foreground">
                {selectedResult ? selectedResult.name : "Ranked by proximity, taste, and context"}
              </p>
            </div>
            <div className="score-tile flex shrink-0 items-center gap-2 rounded-2xl border border-secondary/60 bg-secondary px-3 py-2 text-secondary-foreground">
              <IconLocationHeart size={20} />
              <div>
                <div className="font-display text-sm font-bold leading-none">P11 {topScore}</div>
                <div className="mt-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] opacity-80 font-mono">
                  {activeFilterCount ? `${activeFilterCount} filters` : "Top match"}
                </div>
              </div>
            </div>
          </div>

          <div className="bottom-sheet-scroll stagger min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {response?.meta.notFound ? (
              <Card className="border-dashed border-white/15 bg-card/95 p-5 text-center text-sm text-muted-foreground">
                <IconGlobe size={34} className="mx-auto mb-3 text-primary" />
                <p className="m-0">
                  {t("empty.prefix")}
                  {response.meta.notFoundReason ? ` (${reasonText(response.meta.notFoundReason, t)})` : ""}. {t("empty.suffix")}
                </p>
              </Card>
            ) : (
              results.map((r) => (
                <ResultCard
                  key={r.id}
                  result={r}
                  filters={filters}
                  active={r.id === selectedId}
                  expanded={r.id === expandedId}
                  onSelect={() => handleSelect(r.id)}
                  onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  onEnrich={handleEnrichClick}
                  enriching={enrichingId === r.id}
                  onCompare={handleCompareOpen}
                />
              ))
            )}
            <AssistantBox results={results} onUgcOpen={handleUgcOpen} />
          </div>
        </div>
      </aside>

      {sheetState === "hidden" && (
        <div
          className="swipe-zone"
          role="button"
          tabIndex={0}
          aria-label={t("results.count", { count: results.length })}
          onPointerDown={onSwipePointerDown}
          onPointerMove={onSwipePointerMove}
          onPointerUp={onSwipeRelease}
          onPointerCancel={onSwipeRelease}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setSheetState("half");
            }
          }}
        >
          <span className="swipe-hint" />
        </div>
      )}

      <div className="map-mode-fab" role="group" aria-label="Map style">
        <Button
          type="button"
          size="icon"
          variant={satellite ? "ghost" : "default"}
          className="size-10 rounded-xl"
          onClick={() => setSatellite(false)}
          title="Map mode"
        >
          <IconLocationMap size={19} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={satellite ? "default" : "ghost"}
          className="size-10 rounded-xl"
          onClick={() => setSatellite(true)}
          title="Satellite mode"
        >
          <IconPhoto size={19} />
        </Button>
      </div>

      {terminalOpen && enrichingId && enrichingResult && (
        <EnrichmentTerminal
          open={terminalOpen}
          poiName={enrichingResult.name}
          result={activeEnrichmentPayload}
          liveRequest={activeLiveRequest}
          onComplete={handleTerminalComplete}
          onClose={handleTerminalClose}
        />
      )}

      <UgcContributeForm
        open={ugcOpen}
        initialName={ugcSuggested}
        userLat={userLoc?.lat ?? 21.028511}
        userLng={userLoc?.lon ?? 105.804817}
        onCancel={() => setUgcOpen(false)}
        onSubmit={handleUgcSubmit}
        t={t}
      />

      {hasDemoState && <DemoResetButton onReset={handleDemoReset} />}

      {compareOpenId && (() => {
        const poi = results.find((r) => r.id === compareOpenId);
        if (!poi) return null;
        const patch = enrichmentPatches[compareOpenId];
        const qualityBefore = patch?.qualityBefore ?? poi.meta.quality;
        return (
          <EnrichmentSplitView
            open
            poi={poi}
            qualityBefore={qualityBefore}
            onClose={handleCompareClose}
            t={t}
          />
        );
      })()}
    </div>
  );
}

export default App;
