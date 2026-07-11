// Interactive assistant that runs on the honesty-trap principle: it only
// answers from the known dataset. Any query it can't resolve returns a
// "not found" message, which triggers the UGC suggestion chip so the user
// can contribute the missing place.
import { useState } from "react";
import { IconWand } from "nucleo-isometric";
import { useI18n } from "../i18n/LanguageContext";
import type { PlaceResult } from "../types";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { UgcSuggestChip } from "./ugc-suggest-chip";

interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: "answer" | "not-found";
  suggestedName?: string;
}

interface AssistantBoxProps {
  results: PlaceResult[];
  onUgcOpen: (suggestedName: string) => void;
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

function findMatch(query: string, results: PlaceResult[]): PlaceResult | null {
  const q = query.toLowerCase();
  return (
    results.find((r) => q.includes(r.name.toLowerCase())) ??
    results.find((r) => r.name.toLowerCase().includes(q)) ??
    null
  );
}

export function AssistantBox({ results, onUgcOpen }: AssistantBoxProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [idSeq, setIdSeq] = useState(1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query) return;
    setInput("");

    const userId = idSeq;
    const userMsg: AssistantMessage = { id: userId, role: "user", text: query };
    setIdSeq((n) => n + 2);

    const match = findMatch(query, results);
    const replyId = userId + 1;
    const reply: AssistantMessage = match
      ? {
          id: replyId,
          role: "assistant",
          kind: "answer",
          text: `${match.name} — ${match.address}`,
        }
      : {
          id: replyId,
          role: "assistant",
          kind: "not-found",
          text: t("assistant.notFound", { name: extractEntityName(query) }),
          suggestedName: extractEntityName(query),
        };

    setMessages((prev) => [...prev, userMsg, reply]);
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

      {messages.length > 0 && (
        <div className="assistant-log mb-3 space-y-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className="assistant-msg"
              data-role={m.role}
              data-kind={m.kind}
            >
              <span className="assistant-msg-bubble">{m.text}</span>
            </div>
          ))}
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
          disabled={!input.trim()}
        >
          {t("assistant.send")}
        </Button>
      </form>
    </div>
  );
}
