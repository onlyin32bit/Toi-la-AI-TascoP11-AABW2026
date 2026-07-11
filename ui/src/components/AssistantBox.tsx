import { IconWand } from "nucleo-isometric";
import { useI18n } from "../i18n/LanguageContext";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";

// Stub only: Q&A needs an LLM backend. This keeps the slot visible without
// pretending to answer.
export function AssistantBox() {
  const { t } = useI18n();

  return (
    <div className="assistant-card sheen-sweep relative overflow-hidden rounded-[1.35rem] border border-white/12 bg-card/95 p-3.5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-card-foreground">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[inset_0_1px_0_var(--panel-highlight),0_0_18px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]">
          <IconWand size={20} title={t("assistant.title")} />
        </div>
        <span className="font-display min-w-0 flex-1 truncate text-[15px]">{t("assistant.title")}</span>
        <Badge variant="outline" className="shrink-0 text-[0.62rem] font-mono uppercase tracking-[0.14em]">
          {t("assistant.soon")}
        </Badge>
      </div>
      <Input
        type="text"
        placeholder={t("assistant.placeholder")}
        disabled
        className="h-10 rounded-2xl border-white/15 bg-white/[0.06] text-xs font-medium"
      />
    </div>
  );
}
