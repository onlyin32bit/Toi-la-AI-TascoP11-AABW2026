// Interactive assistant that runs on the honesty-trap principle: it only
// answers from the known dataset. Any query it can't resolve returns a
// "not found" message, which triggers the UGC suggestion chip so the user
// can contribute the missing place.
import { useState } from "react";
import { IconWand } from "nucleo-isometric";
import { useI18n } from "../i18n/LanguageContext";
import { askAssistant } from "../api";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { UgcSuggestChip } from "./ugc-suggest-chip";

interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: "answer" | "not-found" | "unavailable" | "error";
  suggestedName?: string;
  sources?: { field: string; source: string }[];
  poiId?: string;
}

interface AssistantBoxProps {
  onUgcOpen: (suggestedName: string) => void;
  onOpenPoi?: (poiId: string) => void;
}

// Best-effort extraction of the entity being asked about. Strips common
// Vietnamese question fragments so the UGC chip shows a clean place name.
function extractEntityName(query: string): string {
  const trimmed = query
    .replace(/\b(có ngon|có tốt|có bán|có mở|thế nào|ra sao|không|nhỉ|ạ|ơi)\b/gi, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  return trimmed.slice(0, 60);
}

export function AssistantBox({ onUgcOpen, onOpenPoi }: AssistantBoxProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [idSeq, setIdSeq] = useState(1);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || pending) return;
    setInput("");

    const userId = idSeq;
    const userMsg: AssistantMessage = { id: userId, role: "user", text: query };
    setIdSeq((n) => n + 2);
    setMessages((prev) => [...prev, userMsg]);
    setPending(true);

    const outcome = await askAssistant(query);
    const replyId = userId + 1;
    let reply: AssistantMessage;
    switch (outcome.kind) {
      case "answer":
        reply = {
          id: replyId,
          role: "assistant",
          kind: "answer",
          text: outcome.answer.answer,
          sources: outcome.answer.sources,
          poiId: outcome.answer.poi_id,
        };
        break;
      case "not_found":
        reply = {
          id: replyId,
          role: "assistant",
          kind: "not-found",
          text: outcome.message || t("assistant.notFound", { name: extractEntityName(query) }),
          suggestedName: extractEntityName(query),
        };
        break;
      case "unavailable":
        reply = { id: replyId, role: "assistant", kind: "unavailable", text: t("assistant.unavailable") };
        break;
      default:
        reply = { id: replyId, role: "assistant", kind: "error", text: t("assistant.error") };
    }

    setMessages((prev) => [...prev, reply]);
    setPending(false);
  };

  const lastAssistantIdx = [...messages]
    .reverse()
    .findIndex((m) => m.role === "assistant");
  const lastAssistant =
    lastAssistantIdx === -1
      ? null
      : messages[messages.length - 1 - lastAssistantIdx];

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

      {(messages.length > 0 || pending) && (
        <div className="assistant-log mb-3 space-y-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className="assistant-msg"
              data-role={m.role}
              data-kind={m.kind}
            >
              <span className="assistant-msg-bubble">
                {m.text}
                {m.poiId && onOpenPoi && (
                  <button
                    type="button"
                    className="assistant-poi-link ml-1 underline"
                    onClick={() => onOpenPoi(m.poiId!)}
                  >
                    →
                  </button>
                )}
              </span>
              {m.sources && m.sources.length > 0 && (
                <div className="assistant-sources mt-1 flex flex-wrap gap-1">
                  {m.sources.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[0.6rem] font-mono opacity-70">
                      {s.field}:{s.source}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
          {pending && (
            <div className="assistant-msg" data-role="assistant" data-kind="pending">
              <span className="assistant-msg-bubble opacity-70">{t("assistant.thinking")}</span>
            </div>
          )}
          {lastAssistant?.kind === "not-found" && lastAssistant.suggestedName && (
            <div className="assistant-ugc-slot">
              <UgcSuggestChip
                suggestedName={lastAssistant.suggestedName}
                onClick={() => onUgcOpen(lastAssistant.suggestedName!)}
                label={t("ugc.chip")}
              />
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("assistant.placeholder")}
          className="h-10 flex-1 rounded-2xl border-white/15 bg-white/[0.06] text-xs font-medium"
        />
        <Button
          type="submit"
          size="sm"
          variant="default"
          className="h-10 rounded-2xl px-3 text-xs font-bold"
          disabled={!input.trim() || pending}
        >
          {t("assistant.send")}
        </Button>
      </form>
    </div>
  );
}
