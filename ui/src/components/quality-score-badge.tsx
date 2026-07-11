// Colored quality-score pill (low/mid/high tier). Whenever the `score` prop
// changes to a new value, the number count-ups smoothly from the previously-
// shown score to the new one via requestAnimationFrame. Self-animating (no
// separate `targetScore` prop) so parents can just re-render with a new score
// after enrichment completes and the badge takes care of the interpolation.
import { useEffect, useRef, useState } from "react";
import { qualityPercent, qualityTier } from "../lib/quality-score";

interface Props {
  score: number;
  size?: "sm" | "md";
  label?: string;
}

export function QualityScoreBadge({ score, size = "md", label }: Props) {
  const [displayScore, setDisplayScore] = useState(score);
  const prevScoreRef = useRef(score);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const start = prevScoreRef.current;
    const end = score;
    if (start === end) {
      setDisplayScore(score);
      return;
    }
    prevScoreRef.current = end;
    setAnimating(true);
    const duration = 900;
    const startAt = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(start + (end - start) * eased);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setAnimating(false);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [score]);

  const tier = qualityTier(displayScore);
  const pct = qualityPercent(displayScore);

  return (
    <span
      className="quality-badge"
      data-tier={tier}
      data-size={size}
      data-animating={animating || undefined}
      aria-label={`${label ?? "Quality"} ${pct}%`}
    >
      <span className="quality-badge-dot" />
      <span className="quality-badge-value">{pct}%</span>
      {label && <span className="quality-badge-label">{label}</span>}
    </span>
  );
}
