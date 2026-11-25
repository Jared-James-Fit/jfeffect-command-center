/**
 * One meeting, start to finish, in one sheet (coach only): the agenda Cleo
 * prepared with each line's source, Present (the athlete-safe screen, in its
 * own window for screen sharing), notes and decisions as the call goes, who
 * does what, and the game plan, sent only on the coach's tap. Everything
 * autosaves.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
  sendSessionSummaryFn,
  updateSessionFn,
} from "@/lib/coaching-sessions/sessions.functions";
import type { Agenda, PrepItem } from "@/lib/coaching-sessions/prepare";
import { draftGamePlan, gamePlanMessage, type GamePlan } from "@/lib/coaching-sessions/presentation";
import { meetingsKey, sessionKey } from "./keys";

const SOURCE_WORDS: Record<PrepItem["source"], string> = {
  record: "On file",
  athlete: "Their words",
  coach: "Yours",
  read: "Cleo's read",
  history: "Earlier",
};


export function SessionSheet({ sessionId, clientId, onClose }: { sessionId: string; clientId: string; onClose: () => void }) {
  const read = useServerFn(getSessionFn);
  const q = useQuery({
    queryKey: sessionKey(sessionId),
    queryFn: () => read({ data: { sessionId, refresh: true } }),
    staleTime: 30_000,
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
          <SessionBody data={q.data} clientId={clientId} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SessionBody({ data, clientId }: { data: any; clientId: string }) {
  const s = data.session;
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
    const w = window.open(url, `jf-present-${s.id}`, "noopener");
    if (!w) window.location.assign(url);
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
                onClick={() => update({ data: { sessionId: s.id, status: "done" } }).then(refresh)}
              >
                <Check className="mr-1.5 h-4 w-4" /> Mark done
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetHeader>

      {/* The agenda, each line with where it came from */}
      {!retro && agenda ? (
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
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[16px] font-semibold">{retro ? "What was discussed" : "Your notes"}</h3>
          <span className="text-[12px] text-muted-foreground">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Private"}</span>
        </div>
        {retro ? (
          <Textarea
            rows={6}
            value={liveNotes}
            onChange={(e) => {
              setLiveNotes(e.target.value);
              save({ sessionId: s.id, live: { notes: e.target.value } });
            }}
            placeholder="Paste your notes or the meeting summary"
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
        {!retro ? (
          <>
            <p className="pt-2 text-[13px] font-medium text-muted-foreground">During the call</p>
            <Textarea
              rows={4}
              value={liveNotes}
              onChange={(e) => {
                setLiveNotes(e.target.value);
                save({ sessionId: s.id, live: { notes: e.target.value } });
              }}
              placeholder="Quick notes as you talk"
            />
          </>
        ) : null}
      </section>

      {/* Decisions */}
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

      <CommitmentsEditor sessionId={s.id} items={data.commitments} onChange={refresh} />

      <GamePlanSender data={data} decisions={decisions} onSent={refresh} />
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
      {s.shared_at ? (
        <p className="text-[13px] text-muted-foreground">Sent {new Date(s.shared_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
      ) : (
        <Button onClick={() => go.mutate()} loading={go.isPending} disabled={message.trim().length < 10}>
          <Send className="mr-1.5 h-4 w-4" /> Send in their chat
        </Button>
      )}
    </section>
  );
}
