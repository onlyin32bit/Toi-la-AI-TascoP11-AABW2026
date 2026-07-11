// Runners that drive the EnrichmentTerminal's line stream.
//
// Two implementations:
//   1. `runMockEnrichment` — schedule-driven, purely client-side. Fixed
//      random verb-ing lines + a synthesized quality-update from the mock
//      fixture. Used when the backend is unavailable or the demo runs
//      offline.
//   2. `runLiveEnrichment` — kicks off POST /v1/enrich in the background,
//      streams random verb-ing "thinking" lines at 1.3s intervals while
//      waiting, then swaps in the real quality-update + done events when
//      the backend responds. Falls back to the mock quality bump on error.
//
// Both share the same StageListener contract so the terminal is agnostic
// to the source. Both return a cancel fn that MUST be called on unmount.
import type {
  EnrichmentResult,
  EnrichmentStage,
  EnrichmentStageEvent,
} from "../types";
import { fetchEnrich, type EnrichApiRequest } from "./enrich-api-client";

export type StageListener = (event: EnrichmentStageEvent) => void;
export type ResultListener = (result: EnrichmentResult) => void;

export interface RunnerCallbacks {
  onStage: StageListener;
  /** Called once with the final result before the "done" event fires.
   *  Mock: emits the fixture. Live: emits whatever the backend returned. */
  onResult?: ResultListener;
}

// ── Silly verb-ing phrase pool (Claude Code cadence) ──────────────────
const FUN_VERBS = [
  "🔍 Investigating menu geometry…",
  "🍜 Interrogating noodle strands…",
  "📡 Consulting ancient food scrolls…",
  "🕵️  Cross-examining chef's grandmother…",
  "🌶️  Calibrating spice tolerance…",
  "🥢 Balancing chopstick angles…",
  "🎣 Bribing food bloggers…",
  "🔮 Divining pho depth…",
  "🎭 Impersonating a food critic…",
  "🚀 Launching reconnaissance drones…",
  "🪄 Casting menu spells…",
  "👻 Summoning Yelp ghosts…",
  "🦑 Wrestling squid protocols…",
  "🌈 Refracting flavor spectrum…",
  "🐉 Awakening the dragon of taste…",
  "☕ Waiting for barista to blink…",
  "🎪 Herding menu items…",
  "🧪 Fermenting review data…",
  "🎨 Painting broth textures…",
  "🎯 Aligning umami vectors…",
  "🕰️  Time-traveling through opening hours…",
  "🎸 Jamming with sauce recipes…",
  "🐟 Fishing for hidden gems…",
  "🥁 Drumming up consensus…",
  "🎬 Directing the plating scene…",
  "🌙 Consulting moon phase for menu…",
  "🦄 Chasing rare unicorn dishes…",
  "🧭 Navigating dumpling coordinates…",
  "📻 Tuning to gourmet frequencies…",
  "🎢 Riding flavor rollercoasters…",
  "🐌 Racing snails to the kitchen…",
  "🎈 Inflating opinion balloons…",
  "🧙 Consulting the pho oracle…",
  "🚁 Deploying spice helicopters…",
  "🎾 Bouncing ideas off waiters…",
  "🦉 Interviewing nocturnal chefs…",
  "🧨 Detonating flavor bombs…",
  "🎁 Unwrapping menu secrets…",
  "🌊 Surfing the umami wave…",
  "🧬 Sequencing broth DNA…",
  "🎡 Spinning the review wheel…",
  "🐝 Pollinating recipe trees…",
  "🦩 Consulting flamingo taste-testers…",
  "🎳 Bowling for bún chả stars…",
  "🚂 Choo-chooing through databases…",
];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── Mock runner (offline-safe, fixed schedule) ────────────────────────

const MOCK_THINKING_LINES = 7;
const MOCK_THINKING_INTERVAL_MS = 1300;
const MOCK_PAYOFF_HOLD_MS = 1000;
const MOCK_DONE_HOLD_MS = 700;

export const ENRICHMENT_TOTAL_LINES = MOCK_THINKING_LINES + 2;

interface ScheduledStage {
  atMs: number;
  event: EnrichmentStageEvent;
}

function buildMockSchedule(result: EnrichmentResult): ScheduledStage[] {
  const verbs = shuffle(FUN_VERBS).slice(0, MOCK_THINKING_LINES);
  const stages: ScheduledStage[] = verbs.map((v, i) => ({
    atMs: i * MOCK_THINKING_INTERVAL_MS,
    event: { stage: "searching", message: v },
  }));
  const lastMs = (MOCK_THINKING_LINES - 1) * MOCK_THINKING_INTERVAL_MS;
  stages.push({
    atMs: lastMs + MOCK_PAYOFF_HOLD_MS,
    event: qualityEvent(result),
  });
  stages.push({
    atMs: lastMs + MOCK_PAYOFF_HOLD_MS + MOCK_DONE_HOLD_MS,
    event: { stage: "done", message: "Enrichment complete" },
  });
  return stages;
}

function qualityEvent(result: EnrichmentResult): EnrichmentStageEvent {
  return {
    stage: "quality-update",
    message: `⚡ Quality: ${(result.qualityBefore * 100).toFixed(0)}% → ${(result.qualityAfter * 100).toFixed(0)}% ✓`,
    qualityBefore: result.qualityBefore,
    qualityAfter: result.qualityAfter,
  };
}

export function runMockEnrichment(
  result: EnrichmentResult,
  callbacks: RunnerCallbacks,
): () => void {
  const schedule = buildMockSchedule(result);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;

  for (const s of schedule) {
    const timer = setTimeout(() => {
      if (stopped) return;
      if (s.event.stage === "done") callbacks.onResult?.(result);
      callbacks.onStage(s.event);
    }, s.atMs);
    timers.push(timer);
  }

  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
  };
}

// ── Live runner (drives verb stream while POST /v1/enrich flies) ──────
//
// While the backend Apify call is in-flight (typically 15-60s), we keep
// emitting random verbs every ~1.3s so the terminal reads as "alive"
// instead of hung. As soon as the backend returns (success OR error), we
// stop the verb loop and emit the payoff line + done event.

const LIVE_VERB_INTERVAL_MS = 1300;
const LIVE_PAYOFF_HOLD_MS = 900;
const LIVE_DONE_HOLD_MS = 700;

export function runLiveEnrichment(
  request: EnrichApiRequest,
  fallback: EnrichmentResult,
  callbacks: RunnerCallbacks,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const controller = new AbortController();
  let stopped = false;
  let usedVerbs = new Set<string>();

  const pickFreshVerb = (): string => {
    // Cycle through the pool without repeats until it exhausts, then reset.
    if (usedVerbs.size >= FUN_VERBS.length) usedVerbs = new Set();
    const remaining = FUN_VERBS.filter((v) => !usedVerbs.has(v));
    const v = remaining[Math.floor(Math.random() * remaining.length)];
    usedVerbs.add(v);
    return v;
  };

  const scheduleTimer = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      if (stopped) return;
      fn();
    }, ms);
    timers.push(t);
  };

  const emitVerb = () => {
    if (stopped) return;
    callbacks.onStage({ stage: "searching" as EnrichmentStage, message: pickFreshVerb() });
    scheduleTimer(emitVerb, LIVE_VERB_INTERVAL_MS);
  };
  // Fire first verb immediately, then keep cycling
  emitVerb();

  const finalize = (result: EnrichmentResult, extraLine?: EnrichmentStageEvent) => {
    if (stopped) return;
    stopped = true;
    timers.forEach(clearTimeout);
    if (extraLine) callbacks.onStage(extraLine);
    scheduleStopTimersAfter(() => {
      callbacks.onStage(qualityEvent(result));
    }, extraLine ? 500 : LIVE_PAYOFF_HOLD_MS);
    scheduleStopTimersAfter(() => {
      callbacks.onResult?.(result);
      callbacks.onStage({ stage: "done", message: "Enrichment complete" });
    }, (extraLine ? 500 : LIVE_PAYOFF_HOLD_MS) + LIVE_DONE_HOLD_MS);
  };

  // Once we've decided to finalize, `stopped=true` was already set to block
  // any queued verb ticks. But we still need timers for the payoff sequence.
  function scheduleStopTimersAfter(fn: () => void, ms: number) {
    // Re-arm timers even though `stopped` is true — the outer cancel fn
    // still clears them if the user closes the panel early.
    const t = setTimeout(fn, ms);
    timers.push(t);
  }

  fetchEnrich(request, { signal: controller.signal })
    .then((live) => finalize(live))
    .catch((err) => {
      // Aborted mid-stream (user closed panel) — silently no-op; caller
      // already tore the terminal down.
      if (controller.signal.aborted) return;
      const errorLine: EnrichmentStageEvent = {
        stage: "quality-update",
        message: `⚠️  Enrich upstream lỗi: ${(err as Error).message} — dùng mock fallback`,
      };
      finalize(fallback, errorLine);
    });

  return () => {
    stopped = true;
    controller.abort();
    timers.forEach(clearTimeout);
  };
}

export const ENRICHMENT_STAGE_ORDER: EnrichmentStage[] = [
  "searching",
  "parsing",
  "consensus",
  "quality-update",
  "done",
];

// ── localStorage persistence ──────────────────────────────────────────

const KEY_PREFIX = "tasco-enriched-";

export function saveEnriched(poiId: string, result: EnrichmentResult): void {
  try {
    localStorage.setItem(KEY_PREFIX + poiId, JSON.stringify(result));
  } catch {
    /* silent */
  }
}

export function loadEnriched(poiId: string): EnrichmentResult | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + poiId);
    if (!raw) return null;
    return JSON.parse(raw) as EnrichmentResult;
  } catch {
    return null;
  }
}

export function resetEnriched(poiId?: string): void {
  try {
    if (poiId) {
      localStorage.removeItem(KEY_PREFIX + poiId);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
