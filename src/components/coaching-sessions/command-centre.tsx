/**
 * The meeting command centre (coach only; Nov 25 2026): one page per meeting
 * in three stages, Prepare · Connect · Execute.
 *
 *  Prepare: the readiness strip (appointment, the client's prep, the coach's,
 *    what to clarify, how to join), what changed since the coach last looked,
 *    the objective and the outcome, the plan the coach owns (talking points
 *    to edit, skip, reorder or add; each says what it rests on), the
 *    pre-meeting questions, Cleo's brief and the coach's private notes. One
 *    main action: Start meeting.
 *  Connect: Join, Present and the script window, the timer, the recorder
 *    (with consent), the plan in meeting mode (mark addressed, what sounds
 *    covered), quick notes, decisions and commitments. One main action: End
 *    meeting.
 *  Execute: SessionAfter (what Cleo did, what still needs the coach, the
 *    outcome, recommendations with honest statuses, commitments, memories,
 *    the optional recap and the recording behind it).
 *
 * Everything autosaves; nothing reaches the client unless the coach sends it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock,
  Check,
  ChevronDown,
  CircleDot,
  MapPin,
  MonitorPlay,
  Plus,
  RefreshCw,
  ScrollText,
  Send,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PackageShareButton } from "@/components/sales/package-share-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/loading";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { GoalSummary } from "@/components/goals/goal-summary";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  commitmentFn,
  getSessionFn,
  queueBriefFn,
  sendSessionQuestionsFn,
  updateSessionFn,
} from "@/lib/coaching-sessions/sessions.functions";
import {
  applyAgendaOp,
  normalizeAgenda,
  type Agenda,
  type AgendaOp,
  type SectionKey,
} from "@/lib/coaching-sessions/prepare";
import { ANSWER_WORDS } from "@/lib/coaching-sessions/questionnaire";
import {
  buildPresenterScript,
  openScriptWindow,
  scriptInputFrom,
} from "@/lib/coaching-sessions/script";
import {
  canJoin,
  soonWords,
  STATE_WORDS,
  type AppointmentState,
  type ReadinessItem,
} from "@/lib/coaching-sessions/lifecycle";
import { coverageRead } from "@/lib/coaching-sessions/coverage";
import { assembleTranscript } from "@/lib/coaching-sessions/recording";
import { isCoachConsentMessage } from "@/lib/ai-consent/consent";
import {
  SessionActionsSheet,
  type ActionSession,
} from "@/components/schedule/session-actions-sheet";
import { PlanEditor } from "./plan-editor";
import { PresenterScript } from "./presenter-script";
import { MeetingRecorder } from "./recorder";
import { SessionAfter } from "./session-after";
import { meetingsKey, sessionKey } from "./keys";

type Stage = "prepare" | "connect" | "execute";
const STAGE_WORDS: Record<Stage, string> = {
  prepare: "Prepare",
  connect: "Connect",
  execute: "Execute",
};

const TONE: Record<ReadinessItem["tone"], string> = {
  done: "text-success",
  waiting: "text-muted-foreground",
  attention: "text-warning",
  none: "text-muted-foreground",
};

const today = () => new Date().toLocaleDateString("en-CA");
const clockOf = (d: Date) => d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
const dayOf = (d: Date) => {
  const t = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, t)) return "Today";
  const tm = new Date(t);
  tm.setDate(t.getDate() + 1);
  if (same(d, tm)) return "Tomorrow";
  return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
};

export function MeetingCommandCentre({ sessionId }: { sessionId: string }) {
  const read = useServerFn(getSessionFn);
  // the plan is refreshed (and counted as reviewed) once on open; polls after that only pick up Cleo's work
  const first = useRef(true);
  const q = useQuery({
    queryKey: sessionKey(sessionId),
    queryFn: () => {
      const once = first.current;
      first.current = false;
      return read({ data: { sessionId, refresh: once, review: once } });
    },
    staleTime: 20_000,
    refetchInterval: (query) => {
      const d = query.state.data as any;
      const s = d?.session;
      if (!s) return false;
      const audio = ((d?.audio ?? []) as any[]).some(
        (p) => p.status === "uploaded" || p.status === "transcribing",
      );
      if (
        ["queued", "running"].includes(s.write_up_status) ||
        ["queued", "running"].includes(s.analysis_status) ||
        audio
      )
        return 5000;
      if (s.status === "live") return 15_000;
      if (s.questionnaire?.sent_at && !s.questionnaire?.submitted_at) return 30_000;
      return false;
    },
  });
  if (q.isLoading)
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <ErrorState
          error={q.error}
          what="this meeting"
          onRetry={() => q.refetch()}
          retrying={q.isFetching}
        />
      </div>
    );
  return <CommandCentre data={q.data} />;
}

function CommandCentre({ data }: { data: any }) {
  const s = data.session;
  const clientId: string = s.client_id;
  const retro = s.format === "retrospective";
  const qc = useQueryClient();
  const update = useServerFn(updateSessionFn);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: sessionKey(s.id) });
    qc.invalidateQueries({ queryKey: meetingsKey(clientId) });
    qc.invalidateQueries({ queryKey: ["meetings-board"] });
    qc.invalidateQueries({ queryKey: ["next-meeting", clientId] });
  };
  const [stage, setStage] = useState<Stage>(() =>
    retro || s.status === "done" ? "execute" : s.status === "live" ? "connect" : "prepare",
  );
  const navigate = useNavigate();

  // the plan, edited optimistically and saved as ops (the server applies them to the plan on file)
  const [agenda, setAgenda] = useState<Agenda | null>(() => normalizeAgenda(s.agenda));
  const serverAgenda = useRef(s.agenda);
  // edits go to the server one at a time, in the order they were made; the
  // plan on screen isn't replaced by a refetch until every edit has landed
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [inFlight, setInFlight] = useState(0);
  useEffect(() => {
    if (inFlight > 0) return;
    if (s.agenda !== serverAgenda.current) {
      serverAgenda.current = s.agenda;
      setAgenda(normalizeAgenda(s.agenda));
    }
  }, [s.agenda, inFlight]);
  const pending = useRef(0);
  const saveOps = {
    isPending: inFlight > 0,
    mutate: (ops: AgendaOp[]) => {
      pending.current += 1;
      setInFlight(pending.current);
      queue.current = queue.current
        .then(() => update({ data: { sessionId: s.id, agendaOps: ops } }))
        .catch((e: any) => {
          toast.error(e?.message ?? "Couldn't save that");
          // what's on file wins: the next read puts it back on screen
          serverAgenda.current = null;
        })
        .finally(() => {
          pending.current -= 1;
          setInFlight(pending.current);
          if (pending.current === 0) qc.invalidateQueries({ queryKey: sessionKey(s.id) });
        });
    },
  };
  const onOps = (ops: AgendaOp[]) => {
    const now = new Date().toISOString();
    setAgenda((a) =>
      ops.reduce<Agenda | null>((acc, op) => (acc ? applyAgendaOp(acc, op, now) : acc), a),
    );
    saveOps.mutate(ops);
  };

  const setStatus = useMutation({
    mutationFn: (status: "ready" | "live" | "done") =>
      update({ data: { sessionId: s.id, status } }),
    onSuccess: (_r, status) => {
      refresh();
      setStage(status === "live" ? "connect" : status === "done" ? "execute" : "prepare");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });

  const appt = data.appointment as null | {
    ptSessionId: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    location: string | null;
    meetLink: string | null;
    state: AppointmentState;
    status: string;
    pendingChange: {
      kind: "move" | "cancel";
      proposedDate: string | null;
      proposedStart: string | null;
      note: string | null;
    } | null;
  };
  const when = appt?.startsAt
    ? soonWords(appt.startsAt, new Date(), { clock: clockOf, day: dayOf }, appt.endsAt)
    : null;
  const title =
    s.event?.title ||
    appt?.title ||
    (data.firstName ? `Meeting with ${data.firstName}` : "Meeting");

  const present = () => {
    const url = `/admin/meetings/${s.id}/present`;
    const w = window.open(url, `jf-present-${s.id}`);
    if (w) w.opener = null;
    else window.location.assign(url);
    if (s.status === "ready" || s.status === "preparing") setStatus.mutate("live");
  };
  const script = () => {
    if (!openScriptWindow(s.id))
      toast.error(
        "Your browser blocked the script window. Allow pop-ups for jfeffect.com and try again.",
      );
  };

  return (
    <div
      className="mx-auto max-w-3xl space-y-4 px-4 pb-16 pt-3 md:px-6"
      data-meeting-command-centre
      data-stage={stage}
    >
      <header className="space-y-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold leading-tight">{title}</h1>
            <p className="text-[13px] text-muted-foreground">
              {[
                <Link
                  key="c"
                  to="/admin/clients/$id"
                  params={{ id: clientId }}
                  search={{ tab: "meetings" } as any}
                  className="hover:underline"
                >
                  {data.clientName ?? data.firstName ?? "Client"}
                </Link>,
                when,
                retro ? "Added after" : s.format === "touch_base" ? "Touch-base" : null,
                agenda?.minutes ? `${agenda.minutes} min` : s.minutes ? `${s.minutes} min` : null,
              ]
                .filter(Boolean)
                .reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, " · ", x] : [x]), [])}
            </p>
          </div>
          <PackageShareButton />
          {appt ? <StateChip state={appt.state} /> : null}
        </div>
        {appt?.pendingChange ? (
          <p
            className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning"
            data-pending-change
          >
            {data.firstName ?? "They"} asked to{" "}
            {appt.pendingChange.kind === "cancel" ? "cancel" : "move it"}
            {appt.pendingChange.note ? `: “${appt.pendingChange.note}”` : "."} Answer it from Manage
            or their chat.
          </p>
        ) : null}
      </header>

      {!retro ? (
        <div
          className="grid grid-cols-3 rounded-lg bg-secondary p-1"
          role="tablist"
          aria-label="Meeting stage"
        >
          {(["prepare", "connect", "execute"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={stage === k}
              onClick={() => setStage(k)}
              className={cn(
                "h-9 rounded-md text-[14px]",
                stage === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
              )}
              data-stage-tab={k}
            >
              {STAGE_WORDS[k]}
            </button>
          ))}
        </div>
      ) : null}

      {stage === "prepare" && !retro ? (
        <PrepareStage
          data={data}
          agenda={agenda}
          onOps={onOps}
          busy={saveOps.isPending}
          refresh={refresh}
          appt={appt}
          onStart={() => setStatus.mutate("live")}
          starting={setStatus.isPending}
          onPresent={present}
          onScript={script}
        />
      ) : null}
      {stage === "connect" && !retro ? (
        <ConnectStage
          data={data}
          agenda={agenda}
          onOps={onOps}
          busy={saveOps.isPending}
          refresh={refresh}
          appt={appt}
          onEnd={() => setStatus.mutate("done")}
          ending={setStatus.isPending}
          onPresent={present}
          onScript={script}
        />
      ) : null}
      {stage === "execute" || retro ? (
        <>
          {retro ? (
            <LiveNotes
              s={s}
              label="What was discussed"
              placeholder="Your notes or the meeting summary (or add the transcript below)"
            />
          ) : null}
          <SessionAfter
            data={data}
            clientId={clientId}
            today={today()}
            refresh={refresh}
            onOpenTab={(tab) =>
              navigate({
                to: "/admin/clients/$id",
                params: { id: clientId },
                search: { tab } as any,
              })
            }
          />
        </>
      ) : null}
    </div>
  );
}

function StateChip({ state }: { state: AppointmentState }) {
  const tone =
    state === "confirmed" || state === "completed"
      ? "bg-success/10 text-success"
      : state === "reschedule_requested" || state === "cancelled" || state === "no_show"
        ? "bg-warning/15 text-warning"
        : "bg-secondary text-foreground";
  return (
    <span
      className={cn("shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium", tone)}
      data-appointment-state={state}
    >
      {STATE_WORDS[state]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Prepare                                                             */

function PrepareStage({
  data,
  agenda,
  onOps,
  busy,
  refresh,
  appt,
  onStart,
  starting,
  onPresent,
  onScript,
}: {
  data: any;
  agenda: Agenda | null;
  onOps: (ops: AgendaOp[]) => void;
  busy: boolean;
  refresh: () => void;
  appt: any;
  onStart: () => void;
  starting: boolean;
  onPresent: () => void;
  onScript: () => void;
}) {
  const s = data.session;
  const readiness = data.readiness as {
    ready: boolean;
    items: ReadinessItem[];
    headline: string;
  } | null;
  const [manage, setManage] = useState(false);
  return (
    <div className="space-y-4">
      {readiness ? (
        <section className="rounded-2xl border border-border px-3 py-2.5" data-readiness>
          <div className="flex items-center gap-2">
            <CircleDot
              className={cn("h-4 w-4", readiness.ready ? "text-success" : "text-muted-foreground")}
            />
            <p className="text-[14px] font-medium">{readiness.headline}</p>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
            {readiness.items.map((i) => (
              <div key={i.key} className="min-w-0" data-readiness-item={i.key}>
                <dt className="text-[11.5px] text-muted-foreground">{i.label}</dt>
                <dd className={cn("truncate text-[13px] font-medium", TONE[i.tone])}>{i.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onStart} loading={starting} data-start-meeting>
          Start meeting
        </Button>
        <Button variant="outline" onClick={onPresent} data-present>
          <MonitorPlay className="mr-1.5 h-4 w-4" /> Present
        </Button>
        {agenda ? (
          <Button variant="outline" onClick={onScript} data-open-script>
            <ScrollText className="mr-1.5 h-4 w-4" /> Script
          </Button>
        ) : null}
        {appt ? (
          <Button variant="ghost" onClick={() => setManage(true)} data-manage-appointment>
            <CalendarClock className="mr-1.5 h-4 w-4" /> Manage
          </Button>
        ) : null}
      </div>

      <ChangesSinceReview changes={data.changesSinceReview ?? []} />

      {/* what they're working toward (the goal ledger): the targets this meeting can confirm or move */}
      <GoalSummary clientId={s.client_id} competitionId={s.competition_id ?? null} compact hideWhenEmpty />

      {agenda ? <Objective agenda={agenda} onOps={onOps} /> : null}
      {agenda ? <Clarify agenda={agenda} onOps={onOps} /> : null}

      {agenda ? (
        <PlanEditor
          agenda={agenda}
          mode="prepare"
          reviewedBefore={data.reviewedBefore ?? null}
          onOps={onOps}
          busy={busy}
        />
      ) : (
        <p className="rounded-xl bg-muted px-3 py-3 text-[14px] text-muted-foreground">
          Preparing the plan…
        </p>
      )}

      <PreMeetingQuestions data={data} onChange={refresh} />
      {data.cleo ? <CleoBrief data={data} onChange={refresh} /> : null}
      <PrivateNotes s={s} />

      {appt ? (
        <ManageAppointment
          ptSessionId={appt.ptSessionId}
          clientName={data.clientName}
          open={manage}
          onOpenChange={(o) => {
            setManage(o);
            if (!o) refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function ChangesSinceReview({ changes }: { changes: Array<{ at: string; text: string }> }) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  return (
    <section className="rounded-xl border border-border" data-changes-since-review>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="h-2 w-2 rounded-full bg-warning" />
        <span className="text-[14px] font-medium">{changes.length} new since you last looked</span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? (
        <ul className="space-y-1 border-t border-border px-3 py-2">
          {changes.map((c, i) => (
            <li key={i} className="text-[13.5px]">
              {c.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Objective({ agenda, onOps }: { agenda: Agenda; onOps: (ops: AgendaOp[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(agenda.objective);
  useEffect(() => setText(agenda.objective), [agenda.objective]);
  return (
    <section className="space-y-1" data-objective>
      <div className="flex items-baseline gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">
          Objective{agenda.objectivePrivate ? " · private" : ""}
        </p>
        {!editing ? (
          <button
            type="button"
            className="text-[12px] text-muted-foreground hover:underline"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 3) onOps([{ op: "objective", text: text.trim() }]);
            setEditing(false);
          }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[15px]"
          />
          <Button type="submit" size="sm" className="h-10">
            Save
          </Button>
        </form>
      ) : (
        <p className="text-[16px] font-medium leading-snug">{agenda.objective}</p>
      )}
      {agenda.outcome ? (
        <p className="text-[13.5px] text-muted-foreground">Outcome: {agenda.outcome}</p>
      ) : null}
    </section>
  );
}

function Clarify({ agenda, onOps }: { agenda: Agenda; onOps: (ops: AgendaOp[]) => void }) {
  const open = (agenda.clarify ?? []).filter((c) => (c.status ?? "open") === "open");
  if (!open.length) return null;
  return (
    <section className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5" data-clarify>
      <p className="text-[13px] font-medium text-warning">To clarify before you build on it</p>
      <ul className="mt-1.5 space-y-1.5">
        {open.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-snug">{c.text}</p>
              {c.say ? <p className="text-[12.5px] text-muted-foreground">Ask: {c.say}</p> : null}
            </div>
            <button
              type="button"
              className="h-7 shrink-0 rounded-md border border-border px-2 text-[12px]"
              onClick={() => onOps([{ op: "status", id: c.id, status: "addressed" }])}
            >
              Settled
            </button>
            <button
              type="button"
              aria-label="Not needed"
              className="h-7 shrink-0 px-1 text-muted-foreground"
              onClick={() => onOps([{ op: "status", id: c.id, status: "skipped" }])}
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useAutosave(save: (v: string) => Promise<unknown>) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const flush = async () => {
    if (pending.current == null) return;
    const v = pending.current;
    pending.current = null;
    try {
      await save(v);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return {
    state,
    change: (v: string) => {
      pending.current = v;
      setState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
  };
}

function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  return (
    <span
      className={cn(
        "text-[12px]",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "error"
            ? "Not saved, keep typing to retry"
            : "Private"}
    </span>
  );
}

function PrivateNotes({ s }: { s: any }) {
  const update = useServerFn(updateSessionFn);
  const [notes, setNotes] = useState<string>(s.coach_notes ?? "");
  const auto = useAutosave((v) => update({ data: { sessionId: s.id, coachNotes: v || null } }));
  return (
    <section className="space-y-1.5" data-private-notes>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">Your notes</h3>
        <SaveState state={auto.state} />
      </div>
      <Textarea
        rows={3}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          auto.change(e.target.value);
        }}
        placeholder="Only you see these. Cleo takes them into account."
      />
    </section>
  );
}

function LiveNotes({ s, label, placeholder }: { s: any; label: string; placeholder: string }) {
  const update = useServerFn(updateSessionFn);
  const [notes, setNotes] = useState<string>(s.live?.notes ?? "");
  const auto = useAutosave((v) => update({ data: { sessionId: s.id, live: { notes: v } } }));
  return (
    <section className="space-y-1.5" data-live-notes>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold">{label}</h3>
        <SaveState state={auto.state} />
      </div>
      <Textarea
        rows={5}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          auto.change(e.target.value);
        }}
        placeholder={placeholder}
      />
    </section>
  );
}

function PreMeetingQuestions({ data, onChange }: { data: any; onChange: () => void }) {
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
  const preview = data.questions as null | {
    keys: string[];
    minutes: number;
    reasons: string[];
    labels?: Record<string, string>;
    useful?: boolean;
  };
  const [open, setOpen] = useState(false);
  const label = (k: string) =>
    preview?.labels?.[k] ?? ANSWER_WORDS[k as keyof typeof ANSWER_WORDS] ?? k;
  const status = q?.submitted_at
    ? `Answered ${new Date(q.submitted_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
    : q?.sent_at
      ? `Sent ${new Date(q.sent_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}${q.auto ? " with the confirmation" : ""} · no answers yet`
      : preview && preview.useful && preview.keys.length
        ? `${preview.keys.length} could help · not sent`
        : "Not needed: the plan works from what's on file";
  return (
    <section className="rounded-xl border border-border" data-precall>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="text-[14px] font-medium">Client prep</span>
        <span className="truncate text-[13px] text-muted-foreground">{status}</span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {q?.submitted_at ? (
            <ul className="space-y-1.5">
              {Object.entries(
                (q.answers ?? {}) as Record<string, { label: string; text: string }>,
              ).map(([k, v]) => (
                <li key={k} className="text-[14px] leading-snug">
                  <span className="text-muted-foreground">
                    {ANSWER_WORDS[k as keyof typeof ANSWER_WORDS] ?? v.label}:{" "}
                  </span>
                  {v.text}
                </li>
              ))}
            </ul>
          ) : q?.sent_at ? (
            <p className="text-[13.5px] text-muted-foreground">
              Their answers land in the plan when they send them. The meeting doesn't depend on
              them.
            </p>
          ) : preview && preview.keys.length ? (
            <>
              <ul className="space-y-1 text-[14px]">
                {preview.keys.map((k) => (
                  <li key={k}>{label(k)}</li>
                ))}
              </ul>
              {preview.reasons.length ? (
                <p className="text-[12.5px] text-muted-foreground">{preview.reasons.join(". ")}.</p>
              ) : null}
              <p className="text-[12.5px] text-muted-foreground">
                About {preview.minutes} min for them. They go by themselves with the confirmation a
                day before when they'd help; send them now if you'd rather.
              </p>
              {data.hasApp ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() => go.mutate()}
                  loading={go.isPending}
                  data-send-questions
                >
                  <Send className="mr-1.5 h-4 w-4" /> Send now
                </Button>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  They don't have the app yet, so ask on the call if you need to.
                </p>
              )}
            </>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">
              Everything a question would ask is already on file.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CleoBrief({ data, onChange }: { data: any; onChange: () => void }) {
  const s = data.session;
  const again = useServerFn(queueBriefFn);
  const go = useMutation({
    mutationFn: () => again({ data: { sessionId: s.id } }),
    onSuccess: onChange,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't start it"),
  });
  const b = s.write_up;
  const working = s.write_up_status === "queued" || s.write_up_status === "running";
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border" data-cleo-brief>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <CleoAvatar className="h-6 w-6 shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <span className="text-[14px] font-medium">Cleo's brief</span>{" "}
          <span className="text-[13px] text-muted-foreground">
            {working
              ? "· refining the plan…"
              : s.write_up_status === "failed"
                ? "· couldn't write it"
                : b?.summary
                  ? ""
                  : "· not written yet"}
          </span>
        </button>
        {!working ? (
          <button
            type="button"
            onClick={() => go.mutate()}
            className="flex items-center gap-1 text-[12px] text-muted-foreground"
            aria-label="Write the brief again"
          >
            <RefreshCw className="h-3 w-3" /> {b ? "Again" : "Write"}
          </button>
        ) : null}
      </div>
      {b?.summary && !open ? (
        <p className="line-clamp-2 px-3 pb-2.5 text-[13.5px] text-muted-foreground">{b.summary}</p>
      ) : null}
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {s.write_up_status === "failed" ? (
            <p
              className={cn(
                "text-[13.5px]",
                isCoachConsentMessage(b?.error) ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {b?.error ?? "Cleo couldn't write it this time."}
            </p>
          ) : null}
          {b?.summary ? <p className="text-[14.5px] leading-relaxed">{b.summary}</p> : null}
          {b?.focus?.length ? (
            <ol className="list-decimal space-y-1 pl-5 text-[14px]">
              {b.focus.map((f: any) => (
                <li key={f.text}>{f.text}</li>
              ))}
            </ol>
          ) : null}
          {b?.questions?.length ? (
            <div>
              <p className="text-[12.5px] font-medium text-muted-foreground">
                Only if it's still unclear
              </p>
              <ul className="mt-1 space-y-1">
                {b.questions.map((q: any) => (
                  <li key={q.text} className="text-[14px]">
                    {q.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {b?.listenFor?.length ? (
            <p className="text-[13px] text-muted-foreground">
              Listen for: {b.listenFor.join(" · ")}
            </p>
          ) : null}
          {b?.avoid?.length ? (
            <p className="text-[13px] text-muted-foreground">Skip: {b.avoid.join(" · ")}</p>
          ) : null}
          <p className="text-[11.5px] text-muted-foreground">
            Organized from what's on file; it adds nothing new. Its phrasing is in the plan's
            script.
          </p>
        </div>
      ) : null}
    </section>
  );
}

type PtRow = ActionSession;
function ManageAppointment({
  ptSessionId,
  clientName,
  open,
  onOpenChange,
}: {
  ptSessionId: string;
  clientName: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["meeting-pt-session", ptSessionId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select(
          "id, client_id, title, session_type, session_date, start_time, end_time, timezone, location, status, uses_credit, google_event_id",
        )
        .eq("id", ptSessionId)
        .maybeSingle();
      if (error) throw error;
      return (data as PtRow | null) ?? null;
    },
  });
  return (
    <SessionActionsSheet
      session={open ? (q.data ?? null) : null}
      clientName={clientName}
      open={open && !!q.data}
      onOpenChange={onOpenChange}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Connect                                                             */

function ConnectStage({
  data,
  agenda,
  onOps,
  busy,
  refresh,
  appt,
  onEnd,
  ending,
  onPresent,
  onScript,
}: {
  data: any;
  agenda: Agenda | null;
  onOps: (ops: AgendaOp[]) => void;
  busy: boolean;
  refresh: () => void;
  appt: any;
  onEnd: () => void;
  ending: boolean;
  onPresent: () => void;
  onScript: () => void;
}) {
  const s = data.session;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const startedAt = useMemo(
    () => Date.parse(s.live?.started_at ?? s.updated_at ?? "") || null,
    [s.live?.started_at, s.updated_at],
  );
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const joinable = appt && canJoin(appt.startsAt, appt.endsAt, new Date(now), appt.meetLink);

  // the stage on the shared screen (the script reports its slide)
  const slides = useMemo(
    () => buildPresenterScript(scriptInputFrom({ ...data, session: { ...s, agenda } })),
    [data, s, agenda],
  );
  const [slide, setSlide] = useState(0);
  const current = (
    slides[slide]?.key && slides[slide]!.key !== "title" ? slides[slide]!.key : null
  ) as SectionKey | null;

  // what sounds covered so far, from the transcribed parts of a consented recording
  const parts = useMemo(() => (data.audio ?? []) as any[], [data.audio]);
  const transcript = useMemo(
    () =>
      assembleTranscript(
        parts.filter((p) => p.status === "done"),
        s.recording?.speakers ?? {},
        s.recording?.participants ?? [],
      ),
    [parts, s.recording],
  );
  const cover = useMemo(
    () => coverageRead(agenda, transcript, elapsed / 60),
    [agenda, transcript, elapsed],
  );
  const covered = useMemo(() => new Set(cover.covered), [cover.covered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {appt?.meetLink ? (
          <Button asChild variant={joinable ? "default" : "outline"} data-join>
            <a href={appt.meetLink} target="_blank" rel="noreferrer">
              <Video className="mr-1.5 h-4 w-4" /> Join
            </a>
          </Button>
        ) : appt?.location ? (
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
            <MapPin className="h-4 w-4" />
            {appt.location.split(",")[0]}
          </span>
        ) : null}
        <Button variant="outline" onClick={onPresent}>
          <MonitorPlay className="mr-1.5 h-4 w-4" /> Present
        </Button>
        {agenda ? (
          <Button variant="outline" onClick={onScript}>
            <ScrollText className="mr-1.5 h-4 w-4" /> Script
          </Button>
        ) : null}
        <span className="ml-auto tabular-nums text-[14px] text-muted-foreground" data-meeting-timer>
          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          {agenda?.minutes ? ` / ${agenda.minutes} min` : ""}
        </span>
      </div>

      <MeetingRecorder data={data} onChange={refresh} />

      {cover.overlooked.length ? (
        <section className="rounded-xl border border-border px-3 py-2" data-overlooked>
          <p className="text-[12.5px] text-muted-foreground">Not heard yet</p>
          <ul className="mt-1 space-y-1">
            {cover.overlooked.map((o) => (
              <li key={o.id} className="flex items-start gap-2 text-[13.5px]">
                <span className="min-w-0 flex-1">{o.text}</span>
                <button
                  type="button"
                  className="text-[12px] text-muted-foreground hover:underline"
                  onClick={() => onOps([{ op: "status", id: o.id, status: "addressed" }])}
                >
                  Covered
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {agenda && slides.length ? (
        <PresenterScript sessionId={s.id} slides={slides} onSlide={setSlide} />
      ) : null}

      {agenda ? (
        <PlanEditor
          agenda={agenda}
          mode="meeting"
          reviewedBefore={data.reviewedBefore ?? null}
          onOps={onOps}
          busy={busy}
          current={current}
          covered={covered}
        />
      ) : null}

      <LiveNotes s={s} label="Notes" placeholder="Quick notes as you talk" />
      <Decisions s={s} onChange={refresh} />
      <QuickCommitments
        sessionId={s.id}
        items={(data.commitments as any[]).filter(
          (c) => c.session_id === s.id && c.confirmed !== false,
        )}
        onChange={refresh}
      />

      <Button
        variant="outline"
        className="w-full"
        onClick={onEnd}
        loading={ending}
        data-end-meeting
      >
        <Check className="mr-1.5 h-4 w-4" /> End meeting
      </Button>
    </div>
  );
}

function Decisions({ s, onChange }: { s: any; onChange: () => void }) {
  const update = useServerFn(updateSessionFn);
  const [list, setList] = useState<string[]>(s.live?.decisions ?? []);
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: (next: string[]) =>
      update({ data: { sessionId: s.id, live: { decisions: next } } }),
    onSuccess: onChange,
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });
  const set = (next: string[]) => {
    setList(next);
    save.mutate(next);
  };
  return (
    <section className="space-y-1.5" data-session-decisions>
      <h3 className="text-[15px] font-semibold">Decided</h3>
      {list.length ? (
        <ul className="space-y-1">
          {list.map((d, i) => (
            <li key={`${d}-${i}`} className="flex items-start gap-2 text-[14px]">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span className="flex-1">{d}</span>
              <button
                type="button"
                aria-label="Remove"
                className="text-muted-foreground"
                onClick={() => set(list.filter((_, n) => n !== i))}
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
          if (!text.trim()) return;
          set([...list, text.trim()]);
          setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a decision"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
        />
        <Button type="submit" variant="outline" size="sm" className="h-10" aria-label="Add">
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}

function QuickCommitments({
  sessionId,
  items,
  onChange,
}: {
  sessionId: string;
  items: any[];
  onChange: () => void;
}) {
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
  return (
    <section className="space-y-1.5" data-session-commitments>
      <h3 className="text-[15px] font-semibold">Who does what</h3>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((c) => (
            <li key={c.id} className="text-[14px]">
              <span className="text-muted-foreground">
                {c.owner === "athlete" ? "Them: " : "You: "}
              </span>
              {c.text}
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
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-10"
          loading={add.isPending}
          aria-label="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}
