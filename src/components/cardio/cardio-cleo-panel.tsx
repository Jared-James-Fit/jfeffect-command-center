/**
 * Cleo — Cardio, inside the Cardio tab's dock (Nov 23 2026): the coach asks in
 * words, Cleo answers from the shared client intelligence and, when asked for a
 * change, proposes a whole plan. The proposal shows exactly what changes
 * session by session, its quality before and after, anything to check, and a
 * nutrition note when the change affects food; Apply to draft puts it on the
 * coach's draft (undoable there), Not this records why for next time. Nothing
 * reaches the client until the coach publishes.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { askCardioCleoFn, decideCardioProposalFn } from "@/lib/cardio/cardio.functions";
import type { CardioProposal, CardioProposalRow } from "@/lib/cardio/types";
import type { CardioPlan } from "@/lib/cardio/plan";

export const CARDIO_QUICK_ASKS = [
  "Review everything before I publish",
  "Build a time-efficient cardio plan around their training days",
  "Reduce their cardio without compromising their current fat-loss progress",
  "Review whether their cardio is interfering with lower-body recovery",
  "Keep nutrition unchanged but improve the cardio distribution",
];

type Turn = { id: string; ask: string; status: "thinking" | "done" | "failed"; proposal?: CardioProposal; error?: string; decided?: "applied" | "dismissed" };

export function CardioCleoPanel({
  clientId,
  firstName,
  draft,
  onApply,
  onNutritionNote,
  seed,
  history,
}: {
  clientId: string;
  firstName: string;
  draft: CardioPlan;
  /** Put a proposed plan on the draft (the builder keeps it undoable). */
  onApply: (plan: CardioPlan, proposalId: string | null) => void;
  onNutritionNote?: (note: string) => void;
  seed?: { text: string; nonce: number } | null;
  history: CardioProposalRow[];
}) {
  const ask = useServerFn(askCardioCleoFn);
  const decide = useServerFn(decideCardioProposalFn);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [why, setWhy] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!seed?.text) return;
    setText(seed.text);
    window.setTimeout(() => boxRef.current?.focus(), 50);
  }, [seed?.nonce, seed?.text]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  const send = async (words?: string) => {
    const q = (words ?? text).trim();
    if (q.length < 3) return;
    const id = `${Date.now()}`;
    setTurns((t) => [...t, { id, ask: q, status: "thinking" }]);
    setText("");
    try {
      const proposal = await ask({ data: { clientId, instructions: q, draft: draft.sessions as any, scope: "the cardio draft on screen" } });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "done", proposal } : x)));
    } catch (e: any) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "failed", error: e?.message ?? "Cleo couldn't answer just now." } : x)));
    }
  };

  const apply = async (turn: Turn) => {
    const p = turn.proposal;
    if (!p?.plan) return;
    onApply(p.plan, p.id);
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, decided: "applied" } : x)));
    if (p.id) await decide({ data: { clientId, id: p.id, status: "applied", note: null } }).catch(() => {});
    toast.success("On your draft. Review it, then publish when you're ready.");
  };

  const dismiss = async (turn: Turn) => {
    const p = turn.proposal;
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, decided: "dismissed" } : x)));
    if (p?.id) await decide({ data: { clientId, id: p.id, status: "dismissed", note: why[turn.id]?.trim() || null } }).catch(() => {});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-cardio-cleo>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] leading-snug text-muted-foreground">
              Ask about {firstName}'s cardio or tell me what to change. I read their training, nutrition, check-ins and what's been tried, and put any change on your draft only when you apply it.
            </p>
            {history.length > 0 && (
              <details className="rounded-lg border border-border px-3 py-2 text-[13px]">
                <summary className="cursor-pointer font-medium">Earlier asks ({history.length})</summary>
                <ul className="mt-2 space-y-2">
                  {history.slice(0, 6).map((h) => (
                    <li key={h.id} className="text-[12px] leading-snug">
                      <span className="font-medium">{h.instructions}</span>
                      <span className="text-muted-foreground"> · {h.status === "applied" ? "applied" : h.status === "dismissed" ? `turned down${h.decision_note ? `: ${h.decision_note}` : ""}` : h.status}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-foreground px-3 py-2 text-[13px] text-background">{t.ask}</div>
            {t.status === "thinking" && (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading their records…
              </p>
            )}
            {t.status === "failed" && <p className="text-[13px] text-destructive">{t.error}</p>}
            {t.proposal && (
              <div className="space-y-2 rounded-2xl border border-border bg-card p-3 text-[13px]" data-cardio-proposal>
                <p className="leading-relaxed">{t.proposal.answer}</p>
                {t.proposal.plan && (
                  <>
                    <div>
                      <p className="text-[12px] font-semibold">What changes on the draft</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
                        {t.proposal.changeLines.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>
                    {t.proposal.reasons.length > 0 && (
                      <details className="text-[12px]">
                        <summary className="cursor-pointer font-medium text-muted-foreground">Why</summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {t.proposal.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {t.proposal.quality.before != null && t.proposal.quality.after != null && (
                      <p className="text-[12px] text-muted-foreground" data-proposal-quality>
                        Plan quality {t.proposal.quality.before} → {t.proposal.quality.after}
                      </p>
                    )}
                    {t.proposal.problems.length > 0 && (
                      <ul className="space-y-0.5 text-[12px]">
                        {t.proposal.problems.map((p, i) => (
                          <li key={i} className={p.level === "error" ? "text-destructive" : "text-warning"}>
                            {p.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {t.proposal.nutritionNote && (
                  <div className="rounded-lg bg-muted/60 px-2.5 py-2 text-[12px]">
                    <span className="font-medium">Nutrition: </span>
                    {t.proposal.nutritionNote}
                    {onNutritionNote && (
                      <button type="button" className="ml-1 cursor-pointer font-medium underline-offset-2 hover:underline" onClick={() => onNutritionNote(t.proposal!.nutritionNote!)}>
                        Take to nutrition
                      </button>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">Confidence {t.proposal.confidence}</p>
                {t.proposal.plan && !t.decided && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap gap-2">
                      <Button className="h-9" onClick={() => void apply(t)} disabled={t.proposal.problems.some((p) => p.level === "error")} data-proposal-apply>
                        Apply to draft
                      </Button>
                      <Button variant="outline" className="h-9" onClick={() => void dismiss(t)} data-proposal-dismiss>
                        Not this
                      </Button>
                    </div>
                    <input
                      value={why[t.id] ?? ""}
                      onChange={(e) => setWhy((w) => ({ ...w, [t.id]: e.target.value }))}
                      placeholder="Why not (optional, Cleo remembers it)"
                      className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                )}
                {t.decided && <p className="text-[12px] font-medium text-muted-foreground">{t.decided === "applied" ? "Applied to your draft" : "Turned down"}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" data-cardio-quick>
          {CARDIO_QUICK_ASKS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setText(q)}
              className="shrink-0 cursor-pointer rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={`Ask about or change ${firstName}'s cardio…`}
            className="min-h-[44px] flex-1 resize-none text-[14px]"
            data-cardio-cleo-input
          />
          <Button size="icon" className={cn("h-11 w-11 shrink-0")} onClick={() => void send()} disabled={text.trim().length < 3 || turns.some((t) => t.status === "thinking")} aria-label="Send to Cleo">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
