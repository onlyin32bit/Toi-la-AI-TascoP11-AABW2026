// Small chip attached to enriched fields showing which data source provided
// each field. Delay prop staggers the fade-in when the whole details section
// reveals after enrichment completes.
import type { CSSProperties } from "react";
import type { ProvenanceField } from "../types";
import { SOURCE_META } from "./source-icons";

interface Props {
  field: ProvenanceField;
  compact?: boolean;
  delayMs?: number;
}

export function ProvenanceBadge({ field, compact, delayMs = 0 }: Props) {
  const meta = SOURCE_META[field.source];
  const Icon = meta.Icon;
  const confidencePct = Math.round(field.confidence * 100);

  const style: CSSProperties = {
    ["--delay" as string]: `${delayMs}ms`,
    ["--src-color" as string]: meta.color,
  } as CSSProperties;

  return (
    <span
      className="prov-badge"
      data-source={field.source}
      style={style}
      title={`${meta.name} — độ tin cậy ${confidencePct}%`}
      aria-label={`Source: ${meta.name}, confidence ${confidencePct} percent`}
    >
      <Icon />
      {!compact && <span className="prov-badge-name">{meta.name}</span>}
    </span>
  );
}
