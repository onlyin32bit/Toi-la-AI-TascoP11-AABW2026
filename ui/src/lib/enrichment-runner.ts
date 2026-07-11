// Mocks a staged enrichment agent. Emits typed stage events on a schedule
// so the EnrichmentTerminal can render them as terminal lines.
// Also holds localStorage persistence for enriched fixtures across reloads.
//
// Style choice: no formal SEARCH/PARSE/CONSENSUS boundaries — just a rolling
// stream of silly, Claude-Code-style verb-ing phrases (Investigating,
// Interrogating, Divining…) that read differently every run, ending with the
// quality-update payoff line and DONE.
import type {
  EnrichmentResult,
  EnrichmentStage,
  EnrichmentStageEvent,
} from "../types";

export type StageListener = (event: EnrichmentStageEvent) => void;

interface RunOptions {
  speed?: "normal" | "fast";
}

// ── Silly verb-ing phrase pool (Claude Code cadence) ──────────────────
// Mixes serious data ops with absurd food-themed shenanigans — the demo
// storytelling angle is "aggressive enrichment feels alive, not scripted".

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

// ── Stage schedule builder ────────────────────────────────────────────
// Every call picks fresh random verbs so the terminal reads differently on
// each Enrich click. Total ~9.5s + close hold = fits comfortably inside the
// 20-45s "Agent Acts" beat of the 60s pitch.

interface ScheduledStage {
  atMs: number;
  event: EnrichmentStageEvent;
}

// Number of intermediate "thinking" verb-ing lines shown before payoff
const THINKING_LINE_COUNT = 7;
const THINKING_LINE_INTERVAL_MS = 1300;
const PAYOFF_HOLD_MS = 1000;
const DONE_HOLD_MS = 700;

// Total scheduled event count (used by terminal for progress bar).
// = intermediate + quality + done
export const ENRICHMENT_TOTAL_LINES = THINKING_LINE_COUNT + 2;

function buildSchedule(result: EnrichmentResult): ScheduledStage[] {
  const verbs = shuffle(FUN_VERBS).slice(0, THINKING_LINE_COUNT);
  const stages: ScheduledStage[] = [];

  // Intermediate "thinking" lines — all use the `searching` stage so the
  // terminal renders them uniformly (no [SEARCHING]/[PARSING] labels).
  verbs.forEach((v, i) => {
    stages.push({
      atMs: i * THINKING_LINE_INTERVAL_MS,
      event: { stage: "searching", message: v },
    });
  });

  const lastThinkingMs = (THINKING_LINE_COUNT - 1) * THINKING_LINE_INTERVAL_MS;

  // Payoff line — the pitch's "aha" moment: quality bumps
  stages.push({
    atMs: lastThinkingMs + PAYOFF_HOLD_MS,
    event: {
      stage: "quality-update",
      message: `⚡ Quality: ${(result.qualityBefore * 100).toFixed(0)}% → ${(result.qualityAfter * 100).toFixed(0)}% ✓`,
      qualityBefore: result.qualityBefore,
      qualityAfter: result.qualityAfter,
    },
  });

  // Done — closes the terminal + fires onComplete
  stages.push({
    atMs: lastThinkingMs + PAYOFF_HOLD_MS + DONE_HOLD_MS,
    event: { stage: "done", message: "Enrichment complete" },
  });

  return stages;
}

// Fires the timed stage stream. Returns a cancel fn that clears all pending
// timers — MUST be called on unmount to avoid orphan callbacks after the
// component has unmounted.
export function runMockEnrichment(
  result: EnrichmentResult,
  onStage: StageListener,
  opts: RunOptions = {},
): () => void {
  const speedFactor = opts.speed === "fast" ? 0.4 : 1;
  const schedule = buildSchedule(result);
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (const s of schedule) {
    const t = setTimeout(() => onStage(s.event), s.atMs * speedFactor);
    timers.push(t);
  }

  return () => timers.forEach(clearTimeout);
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
    // storage full or disabled — silent
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
    // ignore
  }
}
