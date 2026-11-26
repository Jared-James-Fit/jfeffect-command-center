/**
 * A client's Meetings tab (Nov 25 2026, docs/COACHING_SESSIONS.md): what Cleo
 * recommends now (often nothing, or a message), the events coming up read from
 * their records, the commitments still open on either side, and every meeting:
 * prepared, presented, followed up. Coach only; nothing here reaches the client
 * except a summary the coach sends from a meeting.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, ChevronRight, History, Info, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/loading";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { cn } from "@/lib/utils";
import { dualRange, inputKg } from "@/lib/dual-weight";
import {
  commitmentFn,
  getSessionsHomeFn,
  prepareSessionFn,
} from "@/lib/coaching-sessions/sessions.functions";
import { LEVEL_WORDS, type InterventionLevel } from "@/lib/coaching-sessions/prepare";
import type { SessionEvent } from "@/lib/coaching-sessions/events";
import { MemoryPanel } from "./memory-panel";
import { STATE_WORDS, type AppointmentState } from "@/lib/coaching-sessions/lifecycle";
import { meetingsKey } from "./keys";
import { extractMeetingGoalsFn } from "@/lib/goal-intel/goal-intel.functions";

function MeetingHelp({ label, text }: { label: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" title={text} aria-label={label} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 text-xs" align="start">{text}</PopoverContent>
    </Popover>
  );
}

const FORMAT_WORDS: Record<string, string> = {
  call: "Call",
  touch_base: "Touch-base",
  retrospective: "Added after",
};
const STATUS_WORDS: Record<string, string> = {
  preparing: "Preparing",
  ready: "Ready",
  live: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(iso.length > 10 ? iso : `${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        ...(iso.length > 10 ? {} : { timeZone: "UTC" }),
      })
    : "";

export function MeetingsWorkspace({
  clientId,
  onOpenTab,
}: {
  clientId: string;
  onOpenTab?: (tab: string) => void;
}) {
  const read = useServerFn(getSessionsHomeFn);
  const qc = useQueryClient();
  const extractGoals = useServerFn(extractMeetingGoalsFn);
  const scan = useMutation({
    mutationFn: (sessionId: string) => extractGoals({ data: { sessionId } }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: meetingsKey(clientId) });
      void qc.invalidateQueries({ queryKey: ["client-goals", clientId] });
      void qc.invalidateQueries({ queryKey: ["competition-workspace", clientId] });
      const count = result.created + result.updated;
      toast.success(count ? `${count} goal proposal${count === 1 ? "" : "s"} ready for review` : "Meeting checked — no new proposals");
    },
    onError: (error: Error) => toast.error(error.message || "Could not read meeting goals"),
  });
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: meetingsKey(clientId),
    queryFn: () => read({ data: { clientId } }),
  });
  const [prepare, setPrepare] = useState<null | {
    format: "call" | "touch_base" | "retrospective";
  }>(null);
  const [why, setWhy] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const open = (id: string) =>
    navigate({ to: "/admin/meetings/$sessionId", params: { sessionId: id } });

  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <ErrorState
        error={q.error}
        what="this client's meetings"
        onRetry={() => q.refetch()}
        retrying={q.isFetching}
      />
    );
  const d = q.data;
  const level = d.intervention.level as InterventionLevel;
  const upcoming = d.sessions.filter(
    (s: any) => s.status === "ready" || s.status === "live" || s.status === "preparing",
  );
  const past = d.sessions.filter((s: any) => s.status === "done");
  const shownPast = showPast ? past : past.slice(0, 4);

  return (
    <div className="space-y-4" data-meetings>
      {/* Cleo's read: the lowest effective intervention, in one line */}
      <section className="rounded-2xl border border-border bg-card px-4 py-3" data-meetings-read>
        <div className="flex items-center gap-3">
          <CleoAvatar className="h-7 w-7 shrink-0" />
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => setWhy((v) => !v)}
            aria-expanded={why}
          >
            <p className="truncate text-[15px] font-semibold">{LEVEL_WORDS[level]}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {d.intervention.minutes ? `About ${d.intervention.minutes} min · ` : ""}
              {d.intervention.reasons[0] ?? "Nothing pressing"}
            </p>
          </button>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              !why && "-rotate-90",
            )}
          />
        </div>
        {why ? (
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            {d.intervention.reasons.map((r: string) => (
              <p key={r} className="text-[13.5px]">
                {r}
              </p>
            ))}
            {d.intervention.coverage ? (
              <p className="text-[12px] text-muted-foreground">{d.intervention.coverage}</p>
            ) : null}
            {d.missing.length ? (
              <p className="text-[12.5px] text-muted-foreground">
                Not on file:{" "}
                {d.missing
                  .map((m: any) => m.text.toLowerCase())
                  .slice(0, 4)
                  .join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-9"
            onClick={() => setPrepare({ format: level === "touch_base" ? "touch_base" : "call" })}
          >
            <Plus className="mr-1 h-4 w-4" /> New meeting
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => setPrepare({ format: "retrospective" })}
          >
            <History className="mr-1 h-4 w-4" /> Log meeting
          </Button>
          <MeetingHelp label="About meeting actions" text="New meeting creates an agenda for an upcoming conversation. Log meeting records a completed conversation using notes or a transcript." />
        </div>
      </section>

      {/* Meetings: coming up first (each opens its command centre), then the last few */}
      <section className="rounded-2xl border border-border bg-card" data-meetings-list>
        <h3 className="px-4 pt-3 text-[16px] font-semibold">Meetings</h3>
        {!d.sessions.length ? (
          <p className="px-4 pb-3 pt-1 text-[14px] text-muted-foreground">
            No meetings yet. A booked call is prepared by itself; prepare one here, or add one
            you've already had so Cleo can remember it.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {[...upcoming, ...shownPast].map((s: any) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => open(s.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                  data-meeting-row={s.id}
                >
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">
                      {s.event?.title || s.appointment?.title || "General meeting"}
                    </p>
                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {[
                        FORMAT_WORDS[s.format],
                        day(s.appointment?.startsAt ?? s.scheduled_at ?? s.created_at),
                        s.appointment?.state && s.status !== "done"
                          ? STATE_WORDS[s.appointment.state as AppointmentState]
                          : null,
                        s.changedSinceReview && s.status !== "done"
                          ? `${s.changedSinceReview} new in the plan`
                          : null,
                        s.openRecommendations ? `${s.openRecommendations} follow-ups` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[12px]",
                      s.status === "done"
                        ? "bg-muted text-muted-foreground"
                        : "bg-secondary text-foreground",
                    )}
                  >
                    {STATUS_WORDS[s.status] ?? s.status}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                {s.status === "done" && (
                  <div className="space-y-1.5 px-4 pb-3 pl-11 text-xs">
                    {s.summary ? <p className="whitespace-pre-wrap text-muted-foreground">{s.summary}</p> : null}
                    {s.discussedGoals?.length ? (
                      <div className="rounded-lg border border-border px-3 py-2 space-y-1" data-meeting-discussed-goals>
                        <p className="font-medium">Discussed targets</p>
                        {s.discussedGoals.map((g: any) => {
                          const w = g.client_value != null && (g.client_unit === "kg" || g.client_unit === "lb")
                            ? dualRange(inputKg(Number(g.client_value), g.client_unit), g.client_value_max != null ? inputKg(Number(g.client_value_max), g.client_unit) : null, "kg", g.client_unit) : null;
                          return <div key={g.id} className="flex flex-wrap justify-between gap-x-3">
                            <span>{g.title}</span>
                            <span className="tabular-nums">{w ? <>{w.primary} <span className="text-muted-foreground">({w.secondary})</span></> : g.client_value != null ? `${g.client_value} (unit unconfirmed)` : g.client_text ?? "—"}{g.client_unit_source === "inferred" ? <span className="text-muted-foreground"> · unit inferred</span> : null}</span>
                          </div>;
                        })}
                        <p className="text-muted-foreground">Source: this meeting · discussed, not necessarily approved.</p>
                      </div>
                    ) : null}
                    {s.discussion?.length ? (
                      <details className="text-muted-foreground">
                        <summary className="cursor-pointer">Discussion notes ({s.discussion.length})</summary>
                        <div className="mt-1 space-y-1">
                          {s.discussion.map((i: any, index: number) => <p key={index}><span className="font-medium">{i.basis === "interpretation" ? "Cleo interpretation" : i.basis === "tentative" || i.kind === "tentative" ? "Tentative" : i.kind === "agreement" ? "Recorded agreement" : i.speaker === "athlete" ? "Athlete" : i.speaker === "coach" ? "Coach" : "Discussed"}:</span> {i.text}</p>)}
                        </div>
                      </details>
                    ) : null}
                    {s.analysis_status === "ready" && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={scan.isPending} onClick={() => scan.mutate(s.id)}>{scan.isPending && scan.variables === s.id ? "Checking…" : "Check for goal proposals"}</Button>
                        {onOpenTab && s.discussedGoals?.length > 0 && <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => onOpenTab("summary")}>Review goals <ChevronRight className="ml-1 h-3 w-3" /></Button>}
                      </div>
                    )}
                    {(d.intelligence as any[]).filter((i) => i.source_session_id === s.id && i.status !== "archived" && ["goal", "decision", "commitment"].includes(i.kind)).slice(0, 6).map((i) => (
                      <p key={i.id} className="leading-snug"><span className="font-medium">{i.status === "confirmed" ? "Saved note" : "For review"}:</span> {i.text}</p>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {past.length > 4 ? (
          <button
            type="button"
            className="w-full border-t border-border py-2 text-[13px] text-muted-foreground"
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? "Show fewer" : `Show all ${past.length} past meetings`}
          </button>
        ) : null}
      </section>

      {/* Open commitments, both sides */}
      {d.commitments.length ? <Commitments clientId={clientId} items={d.commitments} /> : null}

      {/* What Cleo remembers from conversations */}
      <MemoryPanel
        clientId={clientId}
        title="Client memory"
        rows={(d.intelligence as any[]).filter((i) => i.status !== "archived")}
        today={d.today}
        onChange={() => qc.invalidateQueries({ queryKey: meetingsKey(clientId) })}
      />

      {/* Coming up, from their records */}
      {d.events.length ? (
        <section className="rounded-2xl border border-border bg-card p-4" data-meetings-events>
          <h3 className="text-[15px] font-semibold">Coming up</h3>
          <ul className="mt-1 divide-y divide-border">
            {d.events.map((e: SessionEvent) => (
              <li key={e.key} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[14.5px] font-medium">{e.title}</p>
                  <p className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                    {e.daysOut != null ? (e.daysOut === 0 ? "Today" : `${e.daysOut} days`) : ""}
                  </p>
                </div>
                <p className="text-[12.5px] text-muted-foreground">
                  {[
                    day(e.date),
                    e.phase,
                    e.weightClass ? `${String(e.weightClass).replace(/ ?kg$/, "")} kg` : null,
                    e.source,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {e.conflicts.map((c) => (
                  <p key={c} className="mt-1 text-[12.5px] text-warning">
                    {c}: confirm which is right
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prepare ? (
        <PrepareSheet
          clientId={clientId}
          events={d.events}
          initialFormat={prepare.format}
          suggestedMinutes={d.intervention.minutes}
          onClose={() => setPrepare(null)}
          onPrepared={(id) => {
            setPrepare(null);
            open(id);
          }}
        />
      ) : null}
    </div>
  );
}

function Commitments({ clientId, items }: { clientId: string; items: any[] }) {
  const save = useServerFn(commitmentFn);
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: (c: any) => save({ data: { sessionId: c.sessionId, id: c.id, status: "done" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingsKey(clientId) }),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const theirs = items.filter((c) => c.owner === "athlete");
  const yours = items.filter((c) => c.owner === "coach");
  const list = (title: string, rows: any[]) =>
    rows.length ? (
      <div>
        <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
        <ul className="mt-1 space-y-1.5">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-2.5">
              <Checkbox
                className="mt-0.5"
                disabled={!c.sessionId || done.isPending}
                onCheckedChange={() => done.mutate(c)}
                aria-label={`Mark done: ${c.text}`}
              />
              <span className="text-[14px] leading-snug">
                {c.text}
                <span className="text-muted-foreground">
                  {" "}
                  · from {day(c.sessionDate)}
                  {c.dueOn ? ` · due ${day(c.dueOn)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      data-meetings-commitments
    >
      <h3 className="text-[16px] font-semibold">Still open</h3>
      {list("Theirs", theirs)}
      {list("Yours", yours)}
    </section>
  );
}

function PrepareSheet({
  clientId,
  events,
  initialFormat,
  suggestedMinutes,
  onClose,
  onPrepared,
}: {
  clientId: string;
  events: SessionEvent[];
  initialFormat: "call" | "touch_base" | "retrospective";
  suggestedMinutes: number | null;
  onClose: () => void;
  onPrepared: (id: string) => void;
}) {
  const prep = useServerFn(prepareSessionFn);
  const qc = useQueryClient();
  const firstAhead = events.find((e) => e.daysOut == null || e.daysOut >= 0);
  const [eventKey, setEventKey] = useState<string>(firstAhead?.key ?? "general");
  const [custom, setCustom] = useState("");
  const [format, setFormat] = useState(initialFormat);
  const [minutes, setMinutes] = useState<number>(
    initialFormat === "touch_base" ? 10 : (suggestedMinutes ?? 20),
  );
  const [notes, setNotes] = useState("");
  const [priorities, setPriorities] = useState("");
  const key = useMemo(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now()),
    [],
  );
  const go = useMutation({
    mutationFn: () =>
      prep({
        data: {
          clientId,
          eventKey: eventKey === "general" || eventKey === "custom" ? null : eventKey,
          customTitle:
            eventKey === "custom" ? custom : eventKey === "general" ? "General meeting" : null,
          format,
          minutes: format === "retrospective" ? null : minutes,
          coachNotes: notes.trim() || null,
          priorities: priorities
            .split("\n")
            .map((p) => p.trim())
            .filter(Boolean),
          key,
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: meetingsKey(clientId) });
      onPrepared(r.id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't prepare it"),
  });
  const choice = (k: string, title: string, sub?: string) => (
    <button
      type="button"
      key={k}
      onClick={() => setEventKey(k)}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left",
        eventKey === k ? "border-foreground bg-secondary" : "border-border",
      )}
    >
      <p className="text-[15px] font-medium">{title}</p>
      {sub ? <p className="text-[13px] text-muted-foreground">{sub}</p> : null}
    </button>
  );
  return (
    <Sheet open onOpenChange={(o) => (!o ? onClose() : null)}>
      <SheetContent
        side="bottom"
        swipeToClose
        className="max-h-[92svh] overflow-y-auto rounded-t-2xl sm:mx-auto sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>
            {format === "retrospective" ? "Log meeting" : "New meeting"}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-5 pb-4" data-prepare-sheet>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">What it's about</p>
            {events
              .filter((e) => e.daysOut == null || e.daysOut >= 0)
              .map((e) =>
                choice(
                  e.key,
                  e.title,
                  [day(e.date), e.phase, e.daysOut != null ? `${e.daysOut} days` : null]
                    .filter(Boolean)
                    .join(" · "),
                ),
              )}
            {choice("general", "General meeting", "A progress review or check-in, no event")}
            {choice("custom", "Something else")}
            {eventKey === "custom" ? (
              <input
                autoFocus
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="What it's about"
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-[16px]"
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">Kind</p>
            <div className="grid grid-cols-3 gap-2">
              {(["call", "touch_base", "retrospective"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setFormat(f);
                    if (f === "touch_base") setMinutes(10);
                  }}
                  className={cn(
                    "h-11 rounded-lg border text-[14px]",
                    format === f ? "border-foreground bg-secondary font-medium" : "border-border",
                  )}
                >
                  {FORMAT_WORDS[f]}
                </button>
              ))}
            </div>
          </div>
          {format !== "retrospective" ? (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-muted-foreground">Length</p>
              <div className="flex gap-2">
                {(format === "touch_base" ? [5, 10] : [15, 20, 30]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMinutes(m)}
                    className={cn(
                      "h-10 flex-1 rounded-lg border text-[14px] tabular-nums",
                      minutes === m
                        ? "border-foreground bg-secondary font-medium"
                        : "border-border",
                    )}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">Your notes (private)</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Concerns, context, anything Cleo should know"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">
              What you want to decide (one per line, optional)
            </p>
            <Textarea
              value={priorities}
              onChange={(e) => setPriorities(e.target.value)}
              placeholder={"Settle the openers\nAgree the taper"}
              rows={2}
            />
          </div>
          <Button
            className="h-12 w-full"
            disabled={go.isPending || (eventKey === "custom" && !custom.trim())}
            loading={go.isPending}
            onClick={() => go.mutate()}
          >
            {format === "retrospective" ? "Log meeting" : "Create agenda"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
