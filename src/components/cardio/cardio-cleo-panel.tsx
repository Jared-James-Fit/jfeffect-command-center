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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { askCardioCleoFn, decideCardioProposalFn } from "@/lib/cardio/cardio.functions";
import { useCoachVoice, VoiceButton, VoiceStatus } from "@/components/program-ai/coach-voice";
import type { CardioProposal, CardioProposalRow } from "@/lib/cardio/types";
import { pickChanges, type CardioPlan } from "@/lib/cardio/plan";

export const CARDIO_QUICK_ASKS = [
  "Review everything before I publish",
  "Build a time-efficient cardio plan around their training days",
  "Reduce their cardio without compromising their current fat-loss progress",
  "Review whether their cardio is interfering with lower-body recovery",
  "Keep nutrition unchanged but improve the cardio distribution",
];

type Turn = { id: string; ask: string; status: "thinking" | "done" | "failed"; proposal?: CardioProposal; error?: string; decided?: "applied" | "dismissed"; picked?: Set<string>; base?: CardioPlan };

export function CardioCleoPanel({
  clientId,
  firstName,
  draft,
  onApply,
  onNutritionNote,
  seed,
  history,
  scorePlan,
  onPublishDraft,
}: {
  clientId: string;
  firstName: string;
  draft: CardioPlan;
  /** Put a proposed plan on the draft (the builder keeps it undoable). */
  onApply: (plan: CardioPlan, proposalId: string | null) => void;
  onNutritionNote?: (note: string) => void;
  seed?: { text: string; nonce: number; send?: boolean } | null;
  history: CardioProposalRow[];
  /** The design score of a plan (scoreCardioPlan with their context), for picked changes. */
  scorePlan?: (plan: CardioPlan) => number | null;
  /** After a proposal lands on the draft: open the publish dialog (now, or scheduled for a date). */
  onPublishDraft?: () => void;
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
    if (seed.send) {
      if (!turns.some((t) => t.status === "thinking")) void send(seed.text);
      return;
    }
    setText(seed.text);
    window.setTimeout(() => boxRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce, seed?.text]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  const busy = turns.some((t) => t.status === "thinking");
  const voice = useCoachVoice((said) => setText((cur) => (cur.trim() ? `${cur.trim()} ${said}` : said)));
  const send = async (words?: string) => {
    const q = (words ?? text).trim();
    // one ask at a time: a second Enter or tap while Cleo reads is ignored
    if (q.length < 3 || busy) return;
    const id = `${Date.now()}`;
    setTurns((t) => [...t, { id, ask: q, status: "thinking" }]);
    setText("");
    try {
      const base = draft;
      const proposal = await ask({ data: { clientId, instructions: q, draft: draft.sessions as any, scope: "the cardio draft on screen" } });
      const picked = new Set((proposal.changes ?? []).map((c) => c.key));
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "done", proposal, picked, base } : x)));
    } catch (e: any) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, status: "failed", error: e?.message ?? "Cleo couldn't answer just now." } : x)));
    }
  };

  /** The plan with only the ticked changes (all of them when the proposal can't be split). */
  const chosen = (turn: Turn): CardioPlan | null => {
    const p = turn.proposal;
    if (!p?.plan) return null;
    if (!p.changes?.length || !turn.picked || !turn.base) return p.plan;
    return pickChanges(turn.base, p.plan, turn.picked);
  };

  const apply = async (turn: Turn) => {
    const p = turn.proposal;
    const plan = chosen(turn);
    if (!p?.plan || !plan) return;
    const some = !!p.changes?.length && !!turn.picked && turn.picked.size < p.changes.length;
    onApply(plan, p.id);
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, decided: "applied" } : x)));
    if (p.id) await decide({ data: { clientId, id: p.id, status: "applied", note: some ? `Applied ${turn.picked!.size} of ${p.changes!.length} changes` : null } }).catch(() => {});
    toast.success(some ? `${turn.picked!.size} of ${p.changes!.length} changes on your draft. Review, then publish.` : "On your draft. Review it, then publish when you're ready.");
  };

  const togglePick = (turnId: string, key: string, on: boolean) =>
    setTurns((t) =>
      t.map((x) => {
        if (x.id !== turnId) return x;
        const n = new Set(x.picked ?? []);
        if (on) n.add(key);
        else n.delete(key);
        return { ...x, picked: n };
      }),
    );

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
                      <p className="text-[12px] font-semibold">What changes on the draft{t.proposal.changes && t.proposal.changes.length > 1 ? " (untick any you'd keep as it is)" : ""}</p>
                      {t.proposal.changes?.length ? (
                        <ul className="mt-1 space-y-1" data-cardio-proposal-changes>
                          {t.proposal.changes.map((c) => (
                            <li key={c.key}>
                              <label className={cn("flex cursor-pointer gap-2 rounded-lg px-1.5 py-1.5 hover:bg-muted/50", t.decided && "cursor-default hover:bg-transparent")}>
                                <Checkbox
                                  checked={t.picked?.has(c.key) ?? true}
                                  disabled={!!t.decided}
                                  onCheckedChange={(v) => togglePick(t.id, c.key, !!v)}
                                  className="mt-0.5"
                                  aria-label={c.lines[0]}
                                />
                                <span className="min-w-0 text-[12px] leading-snug">
                                  {c.lines.map((l, i) => (
                                    <span key={i} className={cn("block", i > 0 && "text-muted-foreground")}>
                                      {l}
                                    </span>
                                  ))}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
                          {t.proposal.changeLines.map((l, i) => (
                            <li key={i}>{l}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {t.proposal.reasons.length > 0 && (
                      <div className="text-[12px]">
                        <p className="font-semibold">Why</p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                          {t.proposal.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {t.proposal.quality.before != null && (() => {
                      const plan = chosen(t);
                      const after = plan && scorePlan ? scorePlan(plan) : t.proposal!.quality.after;
                      return after != null ? (
                        <p className="text-[12px] text-muted-foreground" data-proposal-quality>
                          Plan quality {t.proposal!.quality.before} → <span className={cn("font-medium", after > t.proposal!.quality.before! ? "text-success" : "text-foreground")}>{after}</span>
                          {t.proposal!.changes && t.picked && t.picked.size < t.proposal!.changes.length ? " with the changes you've ticked" : ""}
                        </p>
                      ) : null;
                    })()}
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
                      <Button
                        className="h-9"
                        onClick={() => void apply(t)}
                        disabled={t.proposal.problems.some((p) => p.level === "error") || (!!t.proposal.changes?.length && !!t.picked && t.picked.size === 0)}
                        data-proposal-apply
                      >
                        {t.proposal.changes && t.proposal.changes.length > 1 && t.picked
                          ? t.picked.size === t.proposal.changes.length
                            ? `Apply all ${t.picked.size} to draft`
                            : `Apply ${t.picked.size} of ${t.proposal.changes.length} to draft`
                          : "Apply to draft"}
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
                {t.decided === "dismissed" && <p className="text-[12px] font-medium text-muted-foreground">Turned down</p>}
                {t.decided === "applied" && (
                  <div className="space-y-2 rounded-lg bg-muted/60 px-2.5 py-2 text-[12px]" data-proposal-next>
                    <p>
                      <span className="font-medium">On your draft.</span> Publish it now, schedule it for a date, or keep it as a draft to look at again (Cardio quality reminds you while it waits). Nothing reaches {firstName} until you publish.
                    </p>
                    {onPublishDraft && (
                      <Button className="h-9" onClick={onPublishDraft} data-proposal-publish>
                        Publish or schedule…
                      </Button>
                    )}
                  </div>
                )}
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
              // Enter sends, Shift+Enter is a new line (every Cleo box, Nov 24 2026)
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (e.nativeEvent as any).keyCode !== 229) {
                e.preventDefault();
                void send();
              }
            }}
            enterKeyHint="send"
            rows={2}
            placeholder={`Ask about or change ${firstName}'s cardio…`}
            className="min-h-[44px] flex-1 resize-none text-[14px]"
            data-cardio-cleo-input
          />
          <VoiceButton voice={voice} disabled={busy} />
          <Button size="icon" className={cn("h-11 w-11 shrink-0")} onClick={() => void send()} disabled={text.trim().length < 3 || busy || voice.recording} aria-label="Send to Cleo">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <VoiceStatus voice={voice} className="mt-2" />
      </div>
    </div>
  );
}
