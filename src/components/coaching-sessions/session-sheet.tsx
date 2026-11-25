/**
 * One meeting, start to finish, in one sheet (coach only), in three steps:
 * Before (Cleo's brief, the pre-call questions, the agenda with each line's
 * source, private notes), During (Present: the athlete-safe screen in its own
 * window for screen sharing; notes and decisions as the call goes) and After
 * (the transcript or notes read by Cleo, decisions on what it proposes, who
 * does what, and the game plan, sent only on the coach's tap). Autosaves.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, MonitorPlay, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/loading";
import { cn } from "@/lib/utils";
import {
  commitmentFn,
  getSessionFn,
  queueBriefFn,
  sendSessionQuestionsFn,
  sendSessionSummaryFn,
  updateSessionFn,
} from "@/lib/coaching-sessions/sessions.functions";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { ANSWER_WORDS } from "@/lib/coaching-sessions/questionnaire";
import { SessionAfter } from "./session-after";
import type { Agenda, PrepItem } from "@/lib/coaching-sessions/prepare";
import { draftGamePlan, gamePlanMessage, type GamePlan } from "@/lib/coaching-sessions/presentation";
import { meetingsKey, sessionKey } from "./keys";
import { isCoachConsentMessage } from "@/lib/ai-consent/consent";

const SOURCE_WORDS: Record<PrepItem["source"], string> = {
  record: "On file",
  athlete: "Their words",
  coach: "Yours",
  read: "Cleo's read",
  history: "Earlier",
};


export function SessionSheet({
  sessionId,
  clientId,
  onClose,
  onOpenTab,
}: {
  sessionId: string;
  clientId: string;
  onClose: () => void;
  onOpenTab?: (tab: string) => void;
}) {
  const read = useServerFn(getSessionFn);
  // the prep is read again once when the sheet opens; polls after that only pick up Cleo's work
  const first = useRef(true);
  const q = useQuery({
    queryKey: sessionKey(sessionId),
    queryFn: () => {
      const refresh = first.current;
      first.current = false;
      return read({ data: { sessionId, refresh } });
    },
    staleTime: 30_000,
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.session;
      if (!s) return false;
      if (["queued", "running"].includes(s.write_up_status) || ["queued", "running"].includes(s.analysis_status)) return 5000;
      if (s.questionnaire?.sent_at && !s.questionnaire?.submitted_at) return 20_000;
      return false;
    },
  });
  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-session-sheet>
        {q.isLoading ? (
          <div className="space-y-3 pt-8">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-48" />
          </div>
        ) : q.error || !q.data ? (
          <ErrorState error={q.error} what="this meeting" onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : (
          <SessionBody data={q.data} clientId={clientId} onOpenTab={onOpenTab} />
        )}
      </SheetContent>
    </Sheet>
  );
}

type Step = "before" | "during" | "after";
const STEP_WORDS: Record<Step, string> = { before: "Before", during: "During", after: "After" };

function SessionBody({ data, clientId, onOpenTab }: { data: any; clientId: string; onOpenTab?: (tab: string) => void }) {
  const s = data.session;
  const [step, setStep] = useState<Step>(() =>
    s.format === "retrospective" || s.status === "done" ? "after" : s.status === "live" ? "during" : "before",
  );
  const agenda: Agenda | null = s.agenda ?? null;
  const qc = useQueryClient();
  const update = useServerFn(updateSessionFn);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: sessionKey(s.id) });
    qc.invalidateQueries({ queryKey: meetingsKey(clientId) });
  };
  const retro = s.format === "retrospective";

  // autosaved: the coach's private notes and the call's notes
  const [notes, setNotes] = useState<string>(s.coach_notes ?? "");
  const [liveNotes, setLiveNotes] = useState<string>(s.live?.notes ?? "");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  type Patch = { sessionId: string; coachNotes?: string | null; live?: { notes?: string } };
  const save = (patch: Patch) => {
    if (timer.current) clearTimeout(timer.current);
    setSaving("saving");
    timer.current = setTimeout(async () => {
      try {
        await update({ data: patch });
        setSaving("saved");
      } catch (e: any) {
        setSaving("idle");
        toast.error(e?.message ?? "Couldn't save");
      }
    }, 700);
  };
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const decisions: string[] = s.live?.decisions ?? [];
  const [decision, setDecision] = useState("");
  const setDecisions = useMutation({
    mutationFn: (next: string[]) => update({ data: { sessionId: s.id, live: { decisions: next } } }),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const present = () => {
    const url = `/admin/meetings/${s.id}/present`;
    // a window of its own (to share that one screen); with "noopener" window.open
    // always returns null, so the opener link is cut by hand instead
    const w = window.open(url, `jf-present-${s.id}`);
    if (w) w.opener = null;
    else window.location.assign(url);
    if (s.status === "ready") void update({ data: { sessionId: s.id, status: "live" } }).then(refresh);
    setStep("during");
  };

  return (
    <div className="space-y-6 pb-10">
      <SheetHeader className="space-y-1 pt-2 text-left">
        <SheetTitle className="text-[20px]">{s.event?.title || "General meeting"}</SheetTitle>
        <p className="text-[13px] text-muted-foreground">
          {[data.clientName, retro ? "Added after" : s.format === "touch_base" ? "Touch-base" : "Call", s.minutes ? `${s.minutes} min` : null, s.event?.phase, s.event?.daysOut != null && s.event.daysOut >= 0 ? `${s.event.daysOut} days out` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {!retro ? (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={present} data-present>
              <MonitorPlay className="mr-1.5 h-4 w-4" /> Present
            </Button>
            {s.status !== "done" ? (
              <Button
                variant="outline"
                onClick={() =>
                  update({ data: { sessionId: s.id, status: "done" } }).then(() => {
                    refresh();
                    setStep("after");
                  })
                }
              >
                <Check className="mr-1.5 h-4 w-4" /> Call's done
              </Button>
            ) : null}
          </div>
        ) : null}
        {!retro ? (
          <div className="mt-3 grid grid-cols-3 rounded-lg bg-secondary p-1" role="tablist" aria-label="Meeting step">
            {(["before", "during", "after"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={step === k}
                onClick={() => setStep(k)}
                className={cn("h-9 rounded-md text-[14px]", step === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
                data-step={k}
              >
                {STEP_WORDS[k]}
              </button>
            ))}
          </div>
        ) : null}
      </SheetHeader>

      {step === "before" && !retro ? (
        <>
          {data.cleo ? <CleoBrief data={data} onChange={refresh} /> : null}
          <PreCallQuestions data={data} onChange={refresh} />
        </>
      ) : null}

      {/* The agenda, each line with where it came from */}
      {step === "before" && !retro && agenda ? (
        <section className="space-y-4" data-session-agenda>
          <div className="flex items-baseline justify-between">
            <h3 className="text-[16px] font-semibold">Agenda</h3>
            <p className="text-[13px] text-muted-foreground">
              {agenda.minutes} min · theirs {Math.round(agenda.athleteShare * 100)}%
            </p>
          </div>
          {agenda.sections.map((sec) => (
            <div key={sec.key} className="rounded-xl border border-border p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-[15px] font-semibold">{sec.title}</p>
                <p className="text-[13px] tabular-nums text-muted-foreground">{sec.minutes} min</p>
              </div>
              {sec.items.length ? (
                <ul className="mt-2 space-y-1.5">
                  {sec.items.map((i, n) => (
                    <li key={n} className="flex items-start gap-2 text-[14px] leading-snug">
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 rounded px-1.5 py-px text-[11px]",
                          i.source === "coach" || i.source === "read" || i.source === "history"
                            ? "bg-muted text-muted-foreground"
                            : "bg-secondary text-foreground",
                        )}
                      >
                        {SOURCE_WORDS[i.source]}
                      </span>
                      <span>{i.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {sec.key === "athletes_corner" ? "Open floor: ask what's on their mind." : "Nothing on file for this one."}
                </p>
              )}
            </div>
          ))}
          <p className="text-[12px] text-muted-foreground">
            On the shared screen they see only what's on file and their own words. Yours, Cleo's read and earlier follow-ups stay here.
          </p>
        </section>
      ) : null}

      {/* Private notes */}
      {step !== "after" || retro ? (
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold">{retro ? "What was discussed" : step === "during" ? "Notes" : "Your notes"}</h3>
          <span className="text-[12px] text-muted-foreground">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Private"}</span>
        </div>
        {retro || step === "during" ? (
          <Textarea
            rows={retro ? 6 : 8}
            value={liveNotes}
            onChange={(e) => {
              setLiveNotes(e.target.value);
              save({ sessionId: s.id, live: { notes: e.target.value } });
            }}
            placeholder={retro ? "Your notes or the meeting summary (or add the transcript below)" : "Quick notes as you talk"}
          />
        ) : (
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              save({ sessionId: s.id, coachNotes: e.target.value || null });
            }}
            placeholder="Anything Cleo should take into account"
          />
        )}
      </section>
      ) : null}

      {step === "after" ? <SessionAfter data={data} clientId={clientId} onOpenTab={onOpenTab} /> : null}

      {/* Decisions */}
      {step !== "before" ? (
      <section className="space-y-2" data-session-decisions>
        <h3 className="text-[16px] font-semibold">What we agreed</h3>
        {decisions.length ? (
          <ul className="space-y-1.5">
            {decisions.map((d, i) => (
              <li key={`${d}-${i}`} className="flex items-start gap-2 text-[14px]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span className="flex-1">{d}</span>
                <button
                  type="button"
                  aria-label="Remove"
                  className="text-muted-foreground"
                  onClick={() => setDecisions.mutate(decisions.filter((_, n) => n !== i))}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!decision.trim()) return;
            setDecisions.mutate([...decisions, decision.trim()]);
            setDecision("");
          }}
        >
          <input
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            placeholder="Add a decision"
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
          />
          <Button type="submit" variant="outline" size="sm" className="h-10">
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      </section>
      ) : null}

      {step !== "before" ? (
        <CommitmentsEditor sessionId={s.id} items={(data.commitments as any[]).filter((c) => c.confirmed !== false)} onChange={refresh} />
      ) : null}

      {step === "after" ? <GamePlanSender data={data} decisions={decisions} onSent={refresh} /> : null}
    </div>
  );
}

function CommitmentsEditor({ sessionId, items, onChange }: { sessionId: string; items: any[]; onChange: () => void }) {
  const save = useServerFn(commitmentFn);
  const [owner, setOwner] = useState<"athlete" | "coach">("athlete");
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => save({ data: { sessionId, owner, text: text.trim() } }),
    onSuccess: () => {
      setText("");
      onChange();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add it"),
  });
  const close = useMutation({
    mutationFn: (c: any) => save({ data: { sessionId, id: c.id, status: c.status === "open" ? "done" : "open" } }),
    onSuccess: onChange,
  });
  return (
    <section className="space-y-2" data-session-commitments>
      <h3 className="text-[16px] font-semibold">Who does what</h3>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-[14px]">
              <button
                type="button"
                onClick={() => close.mutate(c)}
                aria-label={c.status === "open" ? "Mark done" : "Reopen"}
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  c.status === "done" ? "border-success bg-success text-white" : "border-border",
                )}
              >
                {c.status === "done" ? <Check className="h-3 w-3" /> : null}
              </button>
              <span className={cn("flex-1", c.status === "done" && "text-muted-foreground line-through")}>
                <span className="text-muted-foreground">{c.owner === "athlete" ? "Them: " : "You: "}</span>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) add.mutate();
        }}
      >
        <button
          type="button"
          onClick={() => setOwner(owner === "athlete" ? "coach" : "athlete")}
          className="h-10 shrink-0 rounded-lg border border-border px-3 text-[14px]"
        >
          {owner === "athlete" ? "Them" : "You"}
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a commitment"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
        />
        <Button type="submit" variant="outline" size="sm" className="h-10" loading={add.isPending}>
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}

function GamePlanSender({ data, decisions, onSent }: { data: any; decisions: string[]; onSent: () => void }) {
  const s = data.session;
  const send = useServerFn(sendSessionSummaryFn);
  const draft = useMemo<GamePlan>(
    () => (s.game_plan as GamePlan) ?? draftGamePlan(s.agenda, decisions, data.commitments),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.id, decisions.join("|"), data.commitments.length],
  );
  const [text, setText] = useState<string | null>(null);
  const message = text ?? gamePlanMessage(data.firstName, draft);
  const go = useMutation({
    mutationFn: () => send({ data: { sessionId: s.id, text: message } }),
    onSuccess: (r) => {
      toast.success(r.already ? "Already sent" : "Sent in their chat");
      onSent();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send it"),
  });
  return (
    <section className="space-y-2 rounded-2xl border border-border p-4" data-session-game-plan>
      <h3 className="text-[16px] font-semibold">The game plan</h3>
      <p className="text-[13px] text-muted-foreground">
        Optional. Kept here either way; it reaches them only if you send it.
      </p>
      <Textarea rows={10} value={message} onChange={(e) => setText(e.target.value)} />
      {!data.hasApp ? (
        <p className="text-[13px] text-muted-foreground">They don't have the app yet: copy it and send it another way.</p>
      ) : s.shared_at ? (
        <p className="text-[13px] text-muted-foreground">Sent {new Date(s.shared_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
      ) : (
        <Button onClick={() => go.mutate()} loading={go.isPending} disabled={message.trim().length < 10}>
          <Send className="mr-1.5 h-4 w-4" /> Send in their chat
        </Button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Before the call                                                     */

function CleoBrief({ data, onChange }: { data: any; onChange: () => void }) {
  const s = data.session;
  const again = useServerFn(queueBriefFn);
  const go = useMutation({ mutationFn: () => again({ data: { sessionId: s.id } }), onSuccess: onChange, onError: (e: any) => toast.error(e?.message ?? "Couldn't start it") });
  const b = s.write_up;
  const working = s.write_up_status === "queued" || s.write_up_status === "running";
  return (
    <section className="space-y-3 rounded-2xl border border-border p-4" data-cleo-brief>
      <div className="flex items-start gap-3">
        <CleoAvatar className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] text-muted-foreground">Cleo's brief</p>
            {!working && s.write_up_status !== "none" ? (
              <button type="button" onClick={() => go.mutate()} className="flex items-center gap-1 text-[12px] text-muted-foreground" aria-label="Write the brief again">
                <RefreshCw className="h-3 w-3" /> Again
              </button>
            ) : null}
          </div>
          {working ? (
            <div className="mt-1 space-y-2">
              <p className="text-[14px] text-muted-foreground">Reading what's on file…</p>
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : s.write_up_status === "failed" && isCoachConsentMessage(b?.error) ? (
            <p className="text-[14px] text-muted-foreground" data-ai-consent-refused>
              {b.error}
            </p>
          ) : s.write_up_status === "failed" ? (
            <p className="text-[14px] text-muted-foreground">
              Cleo couldn't write it this time.{" "}
              <button type="button" className="underline" onClick={() => go.mutate()}>
                Try again
              </button>
            </p>
          ) : !b ? (
            <Button size="sm" variant="outline" className="mt-1 h-9" onClick={() => go.mutate()} loading={go.isPending}>
              Write a brief
            </Button>
          ) : (
            <div className="space-y-3">
              {b.summary ? <p className="text-[15px] leading-relaxed">{b.summary}</p> : null}
              {b.focus?.length ? (
                <div>
                  <p className="text-[13px] font-medium text-muted-foreground">What matters most</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-[14px]">
                    {b.focus.map((f: any) => (
                      <li key={f.text}>{f.text}</li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {b.questions?.length ? (
                <div>
                  <p className="text-[13px] font-medium text-muted-foreground">Questions to ask</p>
                  <ul className="mt-1 space-y-1.5">
                    {b.questions.map((q: any) => (
                      <li key={q.text} className="text-[14px] leading-snug">
                        {q.text}
                        {q.why ? <span className="block text-[12px] text-muted-foreground">{q.why}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {b.listenFor?.length ? (
                <p className="text-[13px] text-muted-foreground">Listen for: {b.listenFor.join(" · ")}</p>
              ) : null}
              {b.avoid?.length ? <p className="text-[13px] text-muted-foreground">Skip: {b.avoid.join(" · ")}</p> : null}
              <p className="text-[11px] text-muted-foreground">Organized from what's on file; it adds nothing new.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PreCallQuestions({ data, onChange }: { data: any; onChange: () => void }) {
  const s = data.session;
  const send = useServerFn(sendSessionQuestionsFn);
  const go = useMutation({
    mutationFn: () => send({ data: { sessionId: s.id } }),
    onSuccess: (r) => {
      toast.success(r.already ? "Already sent" : "Sent in their chat");
      onChange();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't send them"),
  });
  const q = s.questionnaire;
  const preview = data.questions as null | { keys: string[]; minutes: number; reasons: string[] };
  if (s.format === "touch_base" && !q) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-border p-4" data-precall>
      <h3 className="text-[16px] font-semibold">Before the call</h3>
      {q?.submitted_at ? (
        <>
          <p className="text-[13px] text-muted-foreground">They answered {new Date(q.submitted_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}. It's in the agenda.</p>
          <ul className="space-y-1.5">
            {Object.entries((q.answers ?? {}) as Record<string, { label: string; text: string }>).map(([k, v]) => (
              <li key={k} className="text-[14px] leading-snug">
                <span className="text-muted-foreground">{ANSWER_WORDS[k as keyof typeof ANSWER_WORDS] ?? v.label}: </span>
                {v.text}
              </li>
            ))}
          </ul>
        </>
      ) : q?.sent_at ? (
        <p className="text-[14px] text-muted-foreground">
          Sent {new Date(q.sent_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}: {q.keys?.length ?? 0} quick questions, about {q.minutes ?? 2} min. Their answers land here.
        </p>
      ) : preview && preview.keys.length ? (
        <>
          <p className="text-[14px]">
            {preview.keys.length} quick questions, about {preview.minutes} min: only what isn't already on file.
          </p>
          <p className="text-[13px] text-muted-foreground">{preview.keys.map((k) => ANSWER_WORDS[k as keyof typeof ANSWER_WORDS] ?? k).join(" · ")}</p>
          {preview.reasons.length ? <p className="text-[12px] text-muted-foreground">{preview.reasons.join(". ")}.</p> : null}
          {data.hasApp ? (
            <Button size="sm" className="h-9" onClick={() => go.mutate()} loading={go.isPending} data-send-questions>
              <Send className="mr-1.5 h-4 w-4" /> Send in their chat
            </Button>
          ) : (
            <p className="text-[13px] text-muted-foreground">They don't have the app yet, so ask these on the call.</p>
          )}
        </>
      ) : (
        <p className="text-[14px] text-muted-foreground">Everything Cleo would ask is already on file. Nothing to send.</p>
      )}
    </section>
  );
}
