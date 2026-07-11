// Pulsing purple chip that appears below assistant not-found replies,
// prompting the user to contribute the missing place.

interface Props {
  suggestedName: string;
  onClick: () => void;
  label: string;
}

export function UgcSuggestChip({ suggestedName, onClick, label }: Props) {
  return (
    <button
      type="button"
      className="ugc-chip"
      onClick={onClick}
      aria-label={`${label}: ${suggestedName}`}
    >
      <span className="ugc-chip-plus">➕</span>
      <span className="ugc-chip-text">{label}</span>
      {suggestedName && <span className="ugc-chip-name">"{suggestedName}"</span>}
    </button>
  );
}
