---
phase: 03
priority: P0
status: done
depends_on: [01, 02]
est: 90m
---

# Phase 03 — Agent Terminal Panel (Cyberpunk Typing Effect)

## Overview

Modal panel with terminal aesthetic that streams `EnrichmentStageEvent`s from the runner. Neon cyan + green glow, JetBrains Mono font, line-by-line reveal. Consumes runner from Phase 01, is triggered by the Enrich button from Phase 02.

## Key Insights

- Not a real terminal — a styled `<div>` with progressive `<span>` reveals.
- Typing effect: reveal char-by-char via CSS `steps()` animation on max-width for each line, OR simpler: fade-in each line with 300ms delay per stage event.
- **KISS choice: fade-in per line** (simpler, still reads well). Character-by-character is optional stretch.
- Auto-scrolls to bottom as lines append.
- Progress bar footer: fills as stages emit (5 stages before `done` → each = 20%).
- Auto-closes 900ms after `done` stage.
- User can close early with `Esc` or the `✕` button — this aborts runner (calls cancel fn).

## Requirements

- Reduced motion: instant reveal, no glow pulses.
- Backdrop click closes only if runner not active.
- Cleanup on unmount MUST call runner cancel fn.
- Non-blocking backdrop (semi-transparent, blur) — map remains visible behind.

## Related Files

**Create:**
- `ui/src/components/EnrichmentTerminal.tsx`

**Modify:**
- `ui/src/App.tsx` (mount)
- `ui/src/App.css` (terminal styles)

## Implementation Steps

### 1. `EnrichmentTerminal.tsx`

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { EnrichmentResult, EnrichmentStageEvent, EnrichmentStage } from "../types";
import { runMockEnrichment } from "../lib/enrichment-runner";

interface Props {
  open: boolean;
  poiName: string;
  result: EnrichmentResult;
  onComplete: (result: EnrichmentResult) => void;
  onClose: () => void;
}

interface TerminalLine {
  id: number;
  stage: EnrichmentStage;
  text: string;
}

const STAGE_LABEL: Record<EnrichmentStage, string> = {
  searching:        "SEARCHING",
  parsing:          "PARSING",
  consensus:        "CONSENSUS",
  "quality-update": "QUALITY  ",
  done:             "DONE     ",
};

const STAGE_ORDER: EnrichmentStage[] = [
  "searching", "parsing", "consensus", "quality-update", "done",
];

export function EnrichmentTerminal({ open, poiName, result, onComplete, onClose }: Props) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [running, setRunning] = useState(false);
  const [maxStageIndex, setMaxStageIndex] = useState(-1);
  const cancelRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setLines([]);
      setMaxStageIndex(-1);
      setRunning(false);
      return;
    }
    setRunning(true);
    setLines([]);
    setMaxStageIndex(-1);
    idRef.current = 0;

    const onStage = (ev: EnrichmentStageEvent) => {
      idRef.current += 1;
      setLines((prev) => [...prev, { id: idRef.current, stage: ev.stage, text: ev.message }]);
      const idx = STAGE_ORDER.indexOf(ev.stage);
      setMaxStageIndex((prev) => Math.max(prev, idx));
      if (ev.stage === "done") {
        setRunning(false);
        setTimeout(() => {
          onComplete(result);
          onClose();
        }, 900);
      }
    };

    cancelRef.current = runMockEnrichment(result, onStage);
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [open, result, onComplete, onClose]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const progressPct = useMemo(() => {
    if (maxStageIndex < 0) return 0;
    return Math.round(((maxStageIndex + 1) / STAGE_ORDER.length) * 100);
  }, [maxStageIndex]);

  if (!open) return null;

  return (
    <div
      className="enrich-terminal-backdrop"
      onClick={(e) => { if (!running && e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Enrichment agent terminal"
    >
      <div className="enrich-terminal-panel">
        <header className="enrich-terminal-header">
          <div className="enrich-terminal-title">
            <span className="enrich-terminal-prompt">$</span>
            <span>enrich --target "{poiName}"</span>
          </div>
          <button
            type="button"
            className="enrich-terminal-close"
            onClick={onClose}
            aria-label="Close terminal"
          >
            ✕
          </button>
        </header>

        <div ref={scrollRef} className="enrich-terminal-body">
          {lines.map((line) => (
            <div key={line.id} className="term-line" data-stage={line.stage}>
              <span className="term-line-tag">[{STAGE_LABEL[line.stage]}]</span>
              <span className="term-line-msg">{line.text}</span>
            </div>
          ))}
          {running && <span className="term-caret">▊</span>}
        </div>

        <footer className="enrich-terminal-footer">
          <div className="enrich-progress">
            <div className="enrich-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="enrich-progress-label">{progressPct}%</span>
        </footer>
      </div>
    </div>
  );
}
```

### 2. CSS (append to `App.css`)

```css
/* ═══════════════════════════════════════════════════════════════════
   Enrichment Terminal — Cyberpunk neon panel
   ═══════════════════════════════════════════════════════════════════ */

.enrich-terminal-backdrop {
  position: fixed; inset: 0;
  z-index: 900;
  display: grid; place-items: center;
  background: color-mix(in srgb, black 55%, transparent);
  backdrop-filter: blur(14px) saturate(1.4);
  animation: term-backdrop-in 220ms ease-out;
}
@keyframes term-backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.enrich-terminal-panel {
  width: min(560px, 92vw);
  max-height: 78vh;
  display: flex; flex-direction: column;
  background: color-mix(in srgb, #050a15 92%, transparent);
  border: 1px solid color-mix(in srgb, #22d3ee 45%, transparent);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", monospace;
  color: #cff9ff;
  box-shadow:
    0 0 40px color-mix(in srgb, #22d3ee 30%, transparent),
    inset 0 0 30px color-mix(in srgb, #22d3ee 8%, transparent);
  animation: term-panel-in 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes term-panel-in {
  from { opacity: 0; transform: translateY(20px) scale(0.96); }
  to   { opacity: 1; transform: none; }
}

.enrich-terminal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid color-mix(in srgb, #22d3ee 20%, transparent);
  font-size: 12px;
}
.enrich-terminal-title {
  display: flex; align-items: center; gap: 8px;
  color: #67e8f9; font-weight: 700; letter-spacing: 0.03em;
}
.enrich-terminal-prompt {
  color: #a7f3d0; text-shadow: 0 0 8px color-mix(in srgb, #10b981 60%, transparent);
}
.enrich-terminal-close {
  background: transparent; border: none;
  color: color-mix(in srgb, #cff9ff 70%, transparent);
  font-size: 14px; cursor: pointer;
  padding: 4px 8px;
}
.enrich-terminal-close:hover { color: #fff; }

.enrich-terminal-body {
  flex: 1; overflow-y: auto;
  padding: 1rem 0;
  font-size: 12.5px;
  line-height: 1.7;
}
.enrich-terminal-body::-webkit-scrollbar { width: 6px; }
.enrich-terminal-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, #22d3ee 40%, transparent);
  border-radius: 4px;
}

.term-line {
  opacity: 0;
  animation: term-line-in 260ms ease-out forwards;
  display: flex; gap: 12px;
  padding: 2px 0;
}
@keyframes term-line-in {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: none; }
}
.term-line-tag {
  color: #67e8f9;
  font-weight: 700;
  white-space: pre;
  flex-shrink: 0;
}
.term-line-msg { color: #cff9ff; }

.term-line[data-stage="searching"] .term-line-tag { color: #67e8f9; }
.term-line[data-stage="parsing"]   .term-line-tag { color: #a78bfa; }
.term-line[data-stage="consensus"] .term-line-tag { color: #eab308; }
.term-line[data-stage="quality-update"] {
  color: #a7f3d0;
  text-shadow: 0 0 8px color-mix(in srgb, #10b981 55%, transparent);
}
.term-line[data-stage="quality-update"] .term-line-tag { color: #10b981; }
.term-line[data-stage="done"] .term-line-tag { color: #10b981; }

.term-caret {
  color: #67e8f9;
  animation: term-blink 1s steps(2) infinite;
  padding-left: 12px;
}
@keyframes term-blink { 50% { opacity: 0; } }

.enrich-terminal-footer {
  display: flex; align-items: center; gap: 12px;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, #22d3ee 20%, transparent);
  font-size: 11px;
  color: #67e8f9;
}
.enrich-progress {
  flex: 1; height: 4px;
  background: color-mix(in srgb, #22d3ee 12%, transparent);
  border-radius: 999px;
  overflow: hidden;
}
.enrich-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #22d3ee, #10b981);
  box-shadow: 0 0 8px #22d3ee;
  transition: width 400ms cubic-bezier(0.22, 1, 0.36, 1);
}
.enrich-progress-label {
  font-weight: 700; min-width: 3ch; text-align: right;
}

@media (prefers-reduced-motion: reduce) {
  .term-line, .enrich-terminal-panel, .enrich-terminal-backdrop {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .term-caret { animation: none; }
  .enrich-progress-fill { transition: none; }
}
```

### 3. Wire in `App.tsx`

```tsx
import { EnrichmentTerminal } from "./components/EnrichmentTerminal";
import { MOCK_ENRICHMENT_RESULT } from "./data/mock-enrichment";

// inside render:
{terminalOpen && enrichingId && (
  <EnrichmentTerminal
    open={terminalOpen}
    poiName={results.find(r => r.id === enrichingId)?.name ?? ""}
    result={{ ...MOCK_ENRICHMENT_RESULT, poiId: enrichingId }}
    onComplete={(res) => handleEnrichComplete(enrichingId, res)}
    onClose={() => { setTerminalOpen(false); setEnrichingId(null); }}
  />
)}
```

## Todo

- [ ] Create `EnrichmentTerminal.tsx`
- [ ] Append terminal CSS to `App.css`
- [ ] Wire mount in `App.tsx`
- [ ] Test: click Enrich → panel opens, 5 stages stream over ~5s, progress hits 100%
- [ ] Test: Esc closes, timers cleared
- [ ] Test: backdrop click during run → ignored; after done → closes
- [ ] Test: reduced-motion — instant reveals, no glow

## Success Criteria

- Panel opens with backdrop blur + neon border
- Lines reveal with fade-in stagger; correct colors per stage
- Caret blinks while running, disappears at done
- Progress bar fills as stages emit
- Auto-closes 900ms after done + fires `onComplete`
- Esc / close button aborts cleanly, no timer leak
- Reduced motion respected

## Risks

- `useEffect` deps causing runner restart on every render → memo `result` object at App level via `useMemo` if needed
- Multiple Enrich clicks → guard via `enrichingId` state (Phase 02)

## Next Steps

Phase 04 renders provenance badges on the freshly-enriched card fields.
