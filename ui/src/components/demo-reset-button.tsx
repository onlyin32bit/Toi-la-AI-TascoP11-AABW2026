// Bottom-left floating icon button that clears all persisted demo state
// (enrichment + UGC pins). Shown only when there is state worth resetting,
// so first-time visitors aren't confused by it.
import { resetEnriched } from "../lib/enrichment-runner";
import { clearUgc } from "../lib/ugc-queue";

interface Props {
  onReset: () => void;
}

export function DemoResetButton({ onReset }: Props) {
  const handleClick = () => {
    if (!window.confirm("Reset demo state?")) return;
    resetEnriched();
    clearUgc();
    onReset();
  };

  return (
    <button
      type="button"
      className="demo-reset-btn"
      onClick={handleClick}
      title="Reset demo state"
      aria-label="Reset demo state"
    >
      ↺
    </button>
  );
}
