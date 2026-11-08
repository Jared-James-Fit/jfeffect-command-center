/**
 * Edit with AI: the coach types what to change about a program (or asks
 * about the athlete), the AI proposes exact changes, the coach unticks what
 * they don't want, refines by typing, and applies. Undo and the program's
 * history are one tap away, and so are the rules the AI follows for this
 * athlete. Admins and the client's own coaches only (the server checks).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowUp, Check, ChevronDown, Loader2, Plus, ShieldCheck, Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  applyProgramAiFn,
  askProgramAiFn,
  athleteGapsFn,
  deleteProgramRuleFn,
  discardProgramAiFn,
  latestProgramAiThreadFn,
  listProgramRulesFn,
  programAiThreadFn,
  programHistoryFn,
  saveProgramRuleFn,
  undoProgramAiFn,
  type ProgramAiTarget,
} from "@/lib/program-ai/program-ai.functions";
import { dayNames } from "@/lib/program-ai/engine";
import type { DayDiff, ResolvedChange } from "@/lib/program-ai/types";

type Tab = "chat" | "rules" | "history";

const BASIS: Record<ResolvedChange["basis"], string> = { requested: "You asked", data: "Data-backed", speculative: "Try & watch" };
const KIND: Record<string, string> = { fact: "Measured", estimate: "Estimate", hypothesis: "Hypothesis" };
const RULE_LABEL: Record<string, string> = {
  hard_constraint: "Hard constraint",
  temporary_restriction: "Temporary restriction",
  coach_preference: "Coach preference",
  client_preference: "Client preference",
};

const CLIENT_STARTERS = ["Review the program and fix anything you'd improve", "Make every workout fit in 60 minutes", "Which lift is progressing the slowest?", "Is their weekly volume recoverable?"];
const TEMPLATE_STARTERS = ["Make a 3-day version of this", "Adapt it for a home gym with dumbbells and a rack", "Turn it into a powerbuilding program", "Simplify the accessories"];

export function EditWithAiButton({ target, title, onApplied, beforeOpen, className, size = "default", variant = "outline", label = "Edit with AI" }: {
  target: ProgramAiTarget;
  title: string;
  onApplied?: () => void | Promise<void>;
  /** e.g. save the editor's unsaved changes first, so the AI reads what's on screen */
  beforeOpen?: () => Promise<void> | void;
  className?: string;
  size?: "default" | "sm";
  variant?: "outline" | "default" | "secondary" | "ghost";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={busy}
        data-testid="edit-with-ai"
        onClick={async () => {
          setBusy(true);
          try {
            await beforeOpen?.();
            setOpen(true);
          } catch (e: any) {
            toast.error(e?.message ?? "Couldn't save your changes first.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
        {label}
      </Button>
      {open && <EditWithAiSheet open={open} onOpenChange={setOpen} target={target} title={title} onApplied={onApplied} />}
    </>
  );
}

export function EditWithAiSheet({ open, onOpenChange, target, title, onApplied }: { open: boolean; onOpenChange: (v: boolean) => void; target: ProgramAiTarget; title: string; onApplied?: () => void | Promise<void> }) {
  const [tab, setTab] = useState<Tab>("chat");
  const clientId = target.kind === "client" ? target.clientId : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" data-edit-with-ai>
        <div className="border-b border-border px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex min-h-10 items-center pl-24">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" /> Edit with AI
              </SheetTitle>
              <SheetDescription className="truncate text-xs">{target.kind === "template" ? `Template · ${title}` : title}</SheetDescription>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-border p-1" role="tablist" aria-label="Edit with AI">
            {(["chat", "rules", "history"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("h-9 rounded-md text-sm font-medium transition", tab === t ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t === "chat" ? "Edit" : t === "rules" ? "Rules" : "History"}
              </button>
            ))}
          </div>
        </div>
        {tab === "chat" && <ChatPanel target={target} onApplied={onApplied} />}
        {tab === "rules" && <RulesPanel clientId={clientId} />}
        {tab === "history" && <HistoryPanel target={target} onChanged={onApplied} />}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// What's not on file about the athlete (never guessed), with where to fix it

const GAP_TAB: Record<string, string> = { info: "info", "goals-setup": "goals-setup", metrics: "metrics", program: "training" };

function AthleteGaps({ clientId }: { clientId: string }) {
  const gaps = useServerFn(athleteGapsFn);
  const q = useQuery({ queryKey: ["athlete-gaps", clientId], queryFn: () => gaps({ data: { clientId } }), staleTime: 60_000 });
  const missing = (q.data?.missing ?? []) as Array<{ field: string; why: string; where: string }>;
  if (!missing.length) return null;
  return (
    <div className="mb-4 rounded-lg border border-border p-3 text-sm" data-athlete-gaps>
      <p className="font-medium">Not on file, so the AI won't assume it:</p>
      <ul className="mt-1.5 space-y-1">
        {missing.map((m) => (
          <li key={m.field} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {m.field} <span className="text-xs text-muted-foreground">· {m.why}</span>
            </span>
            <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: GAP_TAB[m.where] ?? "info" } as any} className="shrink-0 text-xs font-medium underline">
              Add
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The conversation

function ChatPanel({ target, onApplied }: { target: ProgramAiTarget; onApplied?: () => void | Promise<void> }) {
  const qc = useQueryClient();
  const ask = useServerFn(askProgramAiFn);
  const getThread = useServerFn(programAiThreadFn);
  const latest = useServerFn(latestProgramAiThreadFn);
  const apply = useServerFn(applyProgramAiFn);
  const discard = useServerFn(discardProgramAiFn);
  const undo = useServerFn(undoProgramAiFn);
  const saveRule = useServerFn(saveProgramRuleFn);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asNew, setAsNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [savedRules, setSavedRules] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);
  const key = target.kind === "client" ? target.clientId : target.templateId;

  // pick up a recent unfinished conversation about this program
  useEffect(() => {
    let live = true;
    latest({ data: { target } })
      .then((r) => live && r.threadId && setThreadId(r.threadId))
      .catch(() => undefined)
      .finally(() => live && setResumed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const thread = useQuery({
    queryKey: ["program-ai-thread", threadId],
    queryFn: () => getThread({ data: { threadId: threadId! } }),
    enabled: !!threadId,
    refetchInterval: (q) => {
      const turns = (q.state.data as any)?.turns ?? [];
      const last = turns[turns.length - 1];
      return last && (last.status === "pending" || last.status === "running") ? 1500 : false;
    },
  });
  const turns: any[] = thread.data?.turns ?? [];
  const last = turns[turns.length - 1] ?? null;
  const working = !!last && (last.status === "pending" || last.status === "running");
  const proposal: ResolvedChange[] = last?.status === "ready" ? ((last.result?.changes ?? []) as ResolvedChange[]) : [];

  // a new proposal: everything that can be applied is ticked
  useEffect(() => {
    if (last?.status === "ready") setPicked(new Set(proposal.filter((c) => c.ok).map((c) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id, last?.status]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, last?.status, last?.stage]);
  useEffect(() => {
    if (target.kind === "template" && !newName) setNewName("");
  }, [target.kind, newName]);

  const send = useMutation({
    mutationFn: async (instruction: string) => {
      const rejected = last?.status === "ready" ? proposal.filter((c) => !picked.has(c.id)).map((c) => c.id) : [];
      return ask({ data: { target, instruction, threadId: last && last.status !== "applied" ? threadId : null, rejected } });
    },
    onSuccess: (r) => {
      setText("");
      setThreadId(r.threadId);
      void qc.invalidateQueries({ queryKey: ["program-ai-thread", r.threadId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send that."),
  });

  const applyNow = useMutation({
    mutationFn: async () =>
      apply({ data: { editId: last.id, changeIds: [...picked], newTemplateName: target.kind === "template" && asNew ? newName.trim() || null : null } }),
    onSuccess: async (r: any) => {
      toast.success(r.verified?.ok ? "Applied and checked" : "Applied", { description: r.verified?.ok ? undefined : r.verified?.problems?.[0] });
      if (r.schedule?.error) toast.error(r.schedule.error);
      await qc.invalidateQueries({ queryKey: ["program-ai-thread", threadId] });
      await qc.invalidateQueries({ queryKey: ["program-ai-history"] });
      setApplied((m) => ({ ...m, [last.id]: r }));
      await onApplied?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't apply it."),
  });
  const [applied, setApplied] = useState<Record<string, any>>({});

  const undoNow = useMutation({
    mutationFn: async (versionId: string) => undo({ data: { versionId } }),
    onSuccess: async (r: any) => {
      toast.success(r.note ?? "Undone", { description: r.scheduleNote ?? undefined });
      await qc.invalidateQueries({ queryKey: ["program-ai-history"] });
      await onApplied?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't undo it."),
  });

  const discardNow = useMutation({
    mutationFn: async () => discard({ data: { editId: last.id } }),
    onSuccess: () => {
      setThreadId(null);
      toast("Proposal discarded. Nothing changed.");
    },
  });

  const remember = async (r: { kind: any; rule: string }) => {
    try {
      await saveRule({ data: { clientId: target.kind === "client" ? target.clientId : null, kind: r.kind, rule: r.rule, source: "ai_suggested" } });
      setSavedRules((s) => new Set(s).add(r.rule));
      void qc.invalidateQueries({ queryKey: ["program-rules"] });
      toast.success("Saved to the rules");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that rule.");
    }
  };

  const okCount = proposal.filter((c) => c.ok && picked.has(c.id)).length;
  const starters = target.kind === "client" ? CLIENT_STARTERS : TEMPLATE_STARTERS;
  const submit = () => {
    const v = text.trim();
    if (!v || send.isPending || working) return;
    send.mutate(v);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-chat-scroll>
        {target.kind === "client" && <AthleteGaps clientId={target.clientId} />}
        {!turns.length && resumed && !send.isPending && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {target.kind === "client"
                ? "Tell it what to change, in plain words, or ask about their training. It reads their whole history, proposes the exact changes, and nothing changes until you apply it."
                : "Tell it how to change this template. It edits the template only: programs already assigned from it never change."}
            </p>
            <div className="flex flex-col gap-2">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => setText(s)} className="min-h-11 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-secondary">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {!resumed && <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        <div className="space-y-5">
          {turns.map((t, i) => (
            <TurnView
              key={t.id}
              turn={t}
              latest={i === turns.length - 1}
              picked={picked}
              onToggle={(id, on) => setPicked((s) => {
                const n = new Set(s);
                if (on) n.add(id);
                else n.delete(id);
                return n;
              })}
              appliedResult={applied[t.id]}
              onUndo={(v) => undoNow.mutate(v)}
              undoing={undoNow.isPending}
              onRetry={() => send.mutate(t.instruction)}
              onRemember={remember}
              savedRules={savedRules}
              target={target}
            />
          ))}
        </div>
        <div ref={endRef} />
      </div>

      <div className="border-t border-border bg-background px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
        {last?.status === "ready" && proposal.length > 0 && (
          <div className="mb-3 space-y-2">
            {target.kind === "template" && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Save as a new template (keeps this one as it is)</span>
                  <Switch checked={asNew} onCheckedChange={setAsNew} aria-label="Save as a new template" />
                </label>
                {asNew && <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New template name" className="h-10" />}
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Button className="min-h-11" disabled={!okCount || applyNow.isPending || working || (asNew && !newName.trim())} onClick={() => applyNow.mutate()} data-testid="edit-with-ai-apply">
                {applyNow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                {okCount ? `Apply ${okCount} change${okCount === 1 ? "" : "s"}` : "Tick a change to apply"}
              </Button>
              <Button variant="outline" className="min-h-11" disabled={applyNow.isPending || discardNow.isPending} onClick={() => discardNow.mutate()}>
                Discard
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <AutoGrowTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxHeight={140}
            placeholder={last?.status === "ready" && proposal.length ? "Refine it: “keep Friday heavy”, “fewer accessories”…" : target.kind === "client" ? "What should change? Or ask a question…" : "How should this template change?"}
            className="min-h-11 flex-1 resize-none rounded-lg text-base"
            aria-label="Message"
            data-testid="edit-with-ai-input"
          />
          <Button type="button" size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim() || send.isPending || working} onClick={submit} aria-label="Send">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        {last?.status === "ready" && proposal.some((c) => !picked.has(c.id)) && <p className="mt-2 text-xs text-muted-foreground">Unticked changes are left out when you apply, and dropped if you refine.</p>}
      </div>
    </>
  );
}

export function TurnView({ turn, latest, picked, onToggle, appliedResult, onUndo, undoing, onRetry, onRemember, savedRules, target }: {
  turn: any;
  latest: boolean;
  picked: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  appliedResult?: any;
  onUndo: (versionId: string) => void;
  undoing: boolean;
  onRetry: () => void;
  onRemember: (r: { kind: any; rule: string }) => void;
  savedRules: Set<string>;
  target: ProgramAiTarget;
}) {
  const r = turn.result ?? {};
  const changes: ResolvedChange[] = r.changes ?? [];
  const interactive = latest && turn.status === "ready";
  const clientId = target.kind === "client" ? target.clientId : null;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-[15px] text-foreground">{turn.instruction}</div>
      </div>
      {(turn.status === "pending" || turn.status === "running") && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{turn.stage ?? "Starting"}…</span>
        </div>
      )}
      {turn.status === "error" && (
        <div className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm">
          <p className="text-destructive">{turn.error ?? "Something went wrong."}</p>
          {latest && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {["ready", "applied", "superseded", "discarded"].includes(turn.status) && (
        <div className="space-y-3">
          {r.answer && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{r.answer}</p>}
          {r.analysis?.length > 0 && (
            <ul className="space-y-1.5">
              {r.analysis.map((a: any, i: number) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className={cn("mt-0.5 h-5 shrink-0 rounded px-1.5 text-[11px] font-medium leading-5", a.kind === "hypothesis" ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground")}>{KIND[a.kind] ?? a.kind}</span>
                  <span className="text-muted-foreground">{a.text}</span>
                </li>
              ))}
            </ul>
          )}
          {r.questions?.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {r.questions.map((q: string, i: number) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          {r.generate && clientId && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">That's a new program, not an edit.</p>
              <p className="text-muted-foreground">It'll be written from their whole history by Generate Next Program, audited, and saved as a hidden draft you review before they see it.</p>
              <Button asChild size="sm">
                <Link to="/admin/client-programs/$clientId/next-program" params={{ clientId }} search={{ notes: r.generate.notes || turn.instruction, weeks: r.generate.weeks, days: r.generate.days_per_week } as any}>
                  Open Generate Next Program
                </Link>
              </Button>
            </div>
          )}
          {changes.length > 0 && (
            <div className="space-y-2">
              {!interactive && turn.status !== "applied" && <p className="text-xs text-muted-foreground">{turn.status === "superseded" ? "Updated below." : "Discarded."}</p>}
              {(interactive || turn.status === "applied") &&
                changes.map((c) => (
                  <ChangeCard
                    key={c.id}
                    change={c}
                    checked={interactive ? picked.has(c.id) : (turn.applied_changes ?? []).includes(c.id)}
                    disabled={!interactive || !c.ok}
                    onChange={(v) => onToggle(c.id, v)}
                    faded={turn.status === "applied" && !(turn.applied_changes ?? []).includes(c.id)}
                  />
                ))}
            </div>
          )}
          {turn.status === "applied" && (
            <AppliedLine turn={turn} result={appliedResult} onUndo={onUndo} undoing={undoing} />
          )}
          {latest && r.remember?.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Remember this for next time?</p>
              {r.remember.map((x: any, i: number) => (
                <div key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p>{x.rule}</p>
                    <p className="text-xs text-muted-foreground">{RULE_LABEL[x.kind] ?? x.kind}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" disabled={savedRules.has(x.rule)} onClick={() => onRemember(x)}>
                    {savedRules.has(x.rule) ? "Saved" : "Save"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {latest && r.context?.brief_warnings?.length > 0 && <p className="text-xs text-muted-foreground">{r.context.brief_warnings.join(" ")}</p>}
        </div>
      )}
    </div>
  );
}

function AppliedLine({ turn, result, onUndo, undoing }: { turn: any; result?: any; onUndo: (v: string) => void; undoing: boolean }) {
  const s = result?.schedule;
  return (
    <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <ShieldCheck className="h-4 w-4 text-success" />
          {result ? (result.verified?.ok ? "Applied and checked" : "Applied") : "Applied"}
        </span>
        {turn.version_id && (
          <Button size="sm" variant="outline" disabled={undoing} onClick={() => onUndo(turn.version_id)}>
            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo
          </Button>
        )}
      </div>
      {result?.verified && !result.verified.ok && <p className="text-xs text-warning">{result.verified.problems.join(" ")}</p>}
      {s && !s.error && (s.trainingDays || s.moved > 0) && (
        <p className="text-xs text-muted-foreground">
          {s.trainingDays ? `Training days are now ${dayNames(s.trainingDays)}. ` : ""}
          {s.moved > 0 ? `${s.moved} workout${s.moved === 1 ? "" : "s"} re-dated.` : ""}
          {s.keptPinned > 0 ? ` ${s.keptPinned} placed by hand kept their dates.` : ""}
          {s.unplaced > 0 ? ` ${s.unplaced} couldn't be placed on a training day.` : ""}
        </p>
      )}
      {s?.error && <p className="text-xs text-warning">{s.error}</p>}
      {result?.newTemplate && result.templateId && (
        <Link to="/admin/program-library/$templateId" params={{ templateId: result.templateId }} className="text-xs underline">
          Open the new template
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One proposed change, with its exact before / after

/** "about 52 min" or "52–58 min" after the change. */
function minuteRange(days: DayDiff[]): string {
  const xs = days.map((d) => d.minutesAfter!).filter((n) => n != null);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? `~${lo} min` : `${lo}–${hi} min`;
}

function groupDays(days: DayDiff[]): Array<{ sample: DayDiff; labels: string[] }> {
  const groups = new Map<string, { sample: DayDiff; labels: string[] }>();
  for (const d of days) {
    const key = JSON.stringify([d.kind, d.rows, d.renamed ?? null]);
    const g = groups.get(key);
    if (g) g.labels.push(d.label);
    else groups.set(key, { sample: d, labels: [d.label] });
  }
  return [...groups.values()];
}

export function ChangeCard({ change, checked, disabled, onChange, faded, defaultOpen = false }: { change: ResolvedChange; checked: boolean; disabled: boolean; onChange: (v: boolean) => void; faded?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const errors = change.issues.filter((i) => i.level === "error");
  const warnings = change.issues.filter((i) => i.level === "warning");
  const groups = useMemo(() => groupDays(change.days), [change.days]);
  const minutes = change.days.filter((d) => d.minutesBefore != null && d.minutesAfter != null && d.minutesBefore !== d.minutesAfter);
  const summary = [
    change.touched.workouts ? `${change.touched.workouts} workout${change.touched.workouts === 1 ? "" : "s"}` : null,
    change.touched.weeks.length ? (change.touched.weeks.length > 2 ? `${change.touched.weeks[0]}–${change.touched.weeks[change.touched.weeks.length - 1].replace("Week ", "")}` : change.touched.weeks.join(", ")) : null,
    change.schedule ? "Schedule" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={cn("rounded-xl border border-border", faded && "opacity-50")} data-change={change.id}>
      <div className="flex gap-3 p-3">
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5 h-5 w-5 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background" aria-label={`Keep: ${change.title}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium leading-snug">{change.title}</span>
            <span className={cn("rounded px-1.5 text-[11px] font-medium leading-5", change.basis === "speculative" ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground")}>{BASIS[change.basis]}</span>
          </div>
          {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
          {change.why && <p className="text-sm text-muted-foreground">{change.why}</p>}
          {change.evidence.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {change.evidence.map((e, i) => (
                <li key={i}>· {e}</li>
              ))}
            </ul>
          )}
          {errors.map((e, i) => (
            <p key={i} className="flex gap-1.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Can't apply: {e.text}</span>
            </p>
          ))}
          {warnings.map((w, i) => (
            <p key={i} className="flex gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{w.text}</span>
            </p>
          ))}
          {(change.days.length > 0 || change.schedule) && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-9 items-center gap-1 text-sm font-medium" aria-expanded={open}>
              <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} /> {open ? "Hide" : "See"} exact changes
              {minutes.length > 0 && !open && <span className="font-normal text-muted-foreground"> · {minuteRange(minutes)}</span>}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {change.schedule && (
            <div className="text-sm">
              <p className="font-medium">Schedule</p>
              {change.schedule.after && (
                <p className="text-muted-foreground">
                  Training days: <span className="line-through">{dayNames(change.schedule.before) || "not set"}</span> → {dayNames(change.schedule.after)}
                </p>
              )}
              {change.schedule.redate && <p className="text-muted-foreground">Every upcoming workout goes back on their training days, in order (ones placed by hand keep their dates).</p>}
            </div>
          )}
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {g.labels.length === 1 ? g.labels[0] : `Same change in ${g.labels.length} workouts`}
                  {g.sample.kind === "added" && " · new workout"}
                  {g.sample.kind === "removed" && " · removed"}
                </p>
                {g.sample.minutesBefore != null && g.sample.minutesAfter != null && g.sample.minutesBefore !== g.sample.minutesAfter && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ~{g.sample.minutesBefore} → {g.sample.minutesAfter} min
                  </span>
                )}
              </div>
              {g.labels.length > 1 && <p className="text-xs text-muted-foreground">{g.labels.join("; ")}</p>}
              {g.sample.renamed && (
                <p className="text-sm">
                  <span className="text-muted-foreground line-through">{g.sample.renamed.before}</span> → {g.sample.renamed.after}
                </p>
              )}
              <ul className="space-y-1">
                {g.sample.rows.map((row, ri) => (
                  <li key={ri} className="text-sm">
                    {row.kind === "added" && <span>+ {row.after}</span>}
                    {row.kind === "removed" && <span className="text-muted-foreground line-through">− {row.before}</span>}
                    {(row.kind === "changed" || row.kind === "swapped" || row.kind === "moved") && (
                      <span className="block">
                        <span className="block text-muted-foreground line-through">{row.before}</span>
                        <span className="block">→ {row.after}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rules the AI follows

function RulesPanel({ clientId }: { clientId: string | null }) {
  const qc = useQueryClient();
  const list = useServerFn(listProgramRulesFn);
  const save = useServerFn(saveProgramRuleFn);
  const remove = useServerFn(deleteProgramRuleFn);
  const rules = useQuery({ queryKey: ["program-rules", clientId], queryFn: () => list({ data: { clientId } }) });
  const [kind, setKind] = useState("coach_preference");
  const [rule, setRule] = useState("");
  const [until, setUntil] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["program-rules"] });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await refresh();
      if (ok) toast.success(ok);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that.");
    }
  };
  const all: any[] = rules.data?.rules ?? [];
  const mine = all.filter((r) => (clientId ? r.client_id === clientId : true));
  const everyone = clientId ? all.filter((r) => !r.client_id) : [];
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <p className="text-sm text-muted-foreground">
        {clientId ? "What the AI always follows for this athlete. Your instruction in the moment wins over ordinary rules; hard constraints and restrictions only give way when you say so." : "Rules for every athlete and template (admins)."}
      </p>
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-11" aria-label="Kind of rule">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RULE_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AutoGrowTextarea value={rule} onChange={(e) => setRule(e.target.value)} rows={2} maxHeight={120} placeholder={clientId ? "e.g. Keeps heavy SBD on Fridays · 60-min sessions · no barbell lunges" : "e.g. Never program wall sits"} className="text-base" aria-label="Rule" />
        {kind === "temporary_restriction" && <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="h-11" aria-label="Until" />}
        <Button
          className="min-h-11 w-full"
          variant="outline"
          disabled={rule.trim().length < 3}
          onClick={() =>
            run(async () => {
              await save({ data: { clientId, kind: kind as any, rule: rule.trim(), expiresOn: kind === "temporary_restriction" && until ? until : null } });
              setRule("");
              setUntil("");
            }, "Rule saved")
          }
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add rule
        </Button>
      </div>
      {rules.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {Object.keys(RULE_LABEL).map((k) => {
        const group = mine.filter((r) => r.kind === k);
        if (!group.length) return null;
        return (
          <div key={k} className="space-y-2">
            <p className="text-sm font-semibold">{RULE_LABEL[k]}s</p>
            {group.map((r) => (
              <div key={r.id} className="space-y-2 rounded-lg border border-border p-3">
                {editing === r.id ? (
                  <>
                    <AutoGrowTextarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} maxHeight={120} className="text-base" aria-label="Edit rule" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => run(async () => { await save({ data: { id: r.id, clientId: r.client_id, kind: r.kind, rule: editText.trim(), expiresOn: r.expires_on, active: r.active } }); setEditing(null); }, "Saved")}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 text-left text-sm" onClick={() => { setEditing(r.id); setEditText(r.rule); }}>
                      <span className={cn(!r.active && "text-muted-foreground line-through")}>{r.rule}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.expires_on ? `Until ${r.expires_on} · ` : ""}
                        {r.source === "ai_suggested" ? "Suggested by the AI, saved by you" : "Yours"} · tap to edit
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch checked={r.active} onCheckedChange={(v) => run(() => save({ data: { id: r.id, clientId: r.client_id, kind: r.kind, rule: r.rule, expiresOn: r.expires_on, active: v } }))} aria-label={r.active ? "On" : "Off"} />
                      <Button size="icon" variant="ghost" className="h-10 w-10" aria-label="Remove rule" onClick={() => run(() => remove({ data: { id: r.id } }), "Removed")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
      {everyone.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Every athlete</p>
          {everyone.map((r) => (
            <p key={r.id} className={cn("rounded-lg border border-border p-3 text-sm", !r.active && "text-muted-foreground line-through")}>
              {r.rule} <span className="block text-xs text-muted-foreground">{RULE_LABEL[r.kind]}</span>
            </p>
          ))}
        </div>
      )}
      {(rules.data?.observations ?? []).length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">AI observations you confirmed</p>
          <p className="text-xs text-muted-foreground">From Program Intelligence. Unconfirmed ones are never treated as facts about the athlete.</p>
          {(rules.data?.observations ?? []).map((o: any) => (
            <p key={o.id} className="rounded-lg border border-border p-3 text-sm">
              {o.corrected_statement || o.statement}
            </p>
          ))}
        </div>
      )}
      {!rules.isLoading && !mine.length && !everyone.length && <p className="text-sm text-muted-foreground">No rules yet.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History: every change to this program (Edit with AI and Cleo), with Undo

function HistoryPanel({ target, onChanged }: { target: ProgramAiTarget; onChanged?: () => void | Promise<void> }) {
  const qc = useQueryClient();
  const history = useServerFn(programHistoryFn);
  const undo = useServerFn(undoProgramAiFn);
  const key = target.kind === "client" ? target.clientId : target.templateId;
  const q = useQuery({ queryKey: ["program-ai-history", key], queryFn: () => history({ data: { target } }) });
  const undoNow = useMutation({
    mutationFn: async (versionId: string) => undo({ data: { versionId } }),
    onSuccess: async (r: any) => {
      toast.success(r.note ?? "Undone", { description: r.scheduleNote ?? undefined });
      await qc.invalidateQueries({ queryKey: ["program-ai-history"] });
      await onChanged?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't undo it."),
  });
  const list: any[] = q.data?.versions ?? [];
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <p className="text-sm text-muted-foreground">Every change made by Edit with AI or Cleo, newest first. Undo puts it back; workouts trained since stay as trained.</p>
      {q.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {!q.isLoading && !list.length && <p className="text-sm text-muted-foreground">No changes yet.</p>}
      {list.map((v) => {
        const when = new Date(v.created_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const who = v.source === "restore" ? "Before an undo" : v.source === "ai_editor" ? "Edit with AI" : "Cleo";
        return (
          <div key={v.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 text-sm">
              <p className="line-clamp-3">{String(v.summary).split("\n")[0]}</p>
              <p className="text-xs text-muted-foreground">
                {who} · {when}
                {v.restored_at ? ` · undone${v.restore_note ? `: ${v.restore_note}` : ""}` : ""}
              </p>
            </div>
            {!v.restored_at && (
              <Button size="sm" variant="outline" className="shrink-0" disabled={undoNow.isPending} onClick={() => undoNow.mutate(v.id)}>
                <Undo2 className="mr-1.5 h-3.5 w-3.5" /> {v.source === "restore" ? "Redo" : "Undo"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
