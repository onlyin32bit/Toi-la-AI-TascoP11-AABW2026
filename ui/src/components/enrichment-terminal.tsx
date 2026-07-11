// Cyberpunk-style neon terminal panel that streams the enrichment stages.
// Consumes runMockEnrichment from lib/enrichment-runner and renders each
// StageEvent as a colored terminal line with a blinking caret.
import { useEffect, useMemo, useRef, useState } from "react";
import type { EnrichmentResult, EnrichmentStage, EnrichmentStageEvent } from "../types";
import { ENRICHMENT_TOTAL_LINES, runMockEnrichment } from "../lib/enrichment-runner";

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

// Intermediate "thinking" lines all use the `searching` stage — they render
// with a compact "▸" prompt instead of a category tag. Only the payoff line
// (quality-update) and the finale (done) get an explicit labelled tag.
const STAGE_LABEL: Record<EnrichmentStage, string> = {
  searching: "▸        ",
  parsing:   "▸        ",
  consensus: "▸        ",
  "quality-update": "[QUALITY]",
  done:            "[DONE   ]",
};

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

    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const onStage = (ev: EnrichmentStageEvent) => {
      idRef.current += 1;
      setLines((prev) => [...prev, { id: idRef.current, stage: ev.stage, text: ev.message }]);
      setMaxStageIndex((prev) => prev + 1);
      if (ev.stage === "done") {
        setRunning(false);
        closeTimer = setTimeout(() => {
          onComplete(result);
          onClose();
        }, 900);
      }
    };

    cancelRef.current = runMockEnrichment(result, onStage);
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
      if (closeTimer) clearTimeout(closeTimer);
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

  // Line-based progress — smoother than stage-based since most emitted lines
  // share the same "searching" stage now.
  const progressPct = useMemo(() => {
    if (maxStageIndex < 0) return 0;
    return Math.min(100, Math.round(((maxStageIndex + 1) / ENRICHMENT_TOTAL_LINES) * 100));
  }, [maxStageIndex]);

  if (!open) return null;

  return (
    <div
      className="enrich-terminal-backdrop"
      onClick={(e) => {
        if (!running && e.target === e.currentTarget) onClose();
      }}
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
