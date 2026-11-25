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
import { CalendarClock, ChevronRight, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/loading";
import { CleoAvatar } from "@/components/summer/cleo-avatar";
import { cn } from "@/lib/utils";
import { commitmentFn, getSessionsHomeFn, prepareSessionFn } from "@/lib/coaching-sessions/sessions.functions";
import { LEVEL_WORDS, type InterventionLevel } from "@/lib/coaching-sessions/prepare";
import type { SessionEvent } from "@/lib/coaching-sessions/events";
import { SessionSheet } from "./session-sheet";
import { IntelRow } from "./session-after";
import { intelligenceFn } from "@/lib/coaching-sessions/sessions.functions";
import { meetingsKey } from "./keys";


const FORMAT_WORDS: Record<string, string> = { call: "Call", touch_base: "Touch-base", retrospective: "Added after" };
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

export function MeetingsWorkspace({ clientId, onOpenTab }: { clientId: string; onOpenTab?: (tab: string) => void }) {
  const read = useServerFn(getSessionsHomeFn);
  const q = useQuery({ queryKey: meetingsKey(clientId), queryFn: () => read({ data: { clientId } }) });
  const [prepare, setPrepare] = useState<null | { format: "call" | "touch_base" | "retrospective" }>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  if (q.error || !q.data)
    return <ErrorState error={q.error} what="this client's meetings" onRetry={() => q.refetch()} retrying={q.isFetching} />;
  const d = q.data;
  const level = d.intervention.level as InterventionLevel;
  const upcoming = d.sessions.filter((s: any) => s.status === "ready" || s.status === "live" || s.status === "preparing");
  const past = d.sessions.filter((s: any) => s.status === "done");

  return (
    <div className="space-y-4" data-meetings>
      {/* Cleo's read: the lowest effective intervention */}
      <section className="rounded-2xl border border-border bg-card p-4" data-meetings-read>
        <div className="flex items-start gap-3">
          <CleoAvatar className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-muted-foreground">Cleo recommends</p>
            <p className="text-[17px] font-semibold leading-snug">{LEVEL_WORDS[level]}</p>
            {d.intervention.minutes ? (
              <p className="text-[13px] text-muted-foreground">
                About {d.intervention.minutes} minutes{d.intervention.timing ? ` · ${d.intervention.timing}` : ""}
              </p>
            ) : null}
            <ul className="mt-2 space-y-1 text-[14px]">
              {d.intervention.reasons.map((r: string) => (
                <li key={r} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            {d.intervention.coverage ? <p className="mt-2 text-[12px] text-muted-foreground">{d.intervention.coverage}</p> : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setPrepare({ format: level === "touch_base" ? "touch_base" : "call" })}>
            <Plus className="mr-1 h-4 w-4" /> Prepare a meeting
          </Button>
          <Button variant="outline" onClick={() => setPrepare({ format: "retrospective" })}>
            <History className="mr-1 h-4 w-4" /> Add a past meeting
          </Button>
        </div>
        {d.missing.length ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Missing: {d.missing.map((m: any) => m.text.toLowerCase()).slice(0, 4).join(", ")}
          </p>
        ) : null}
      </section>

      {/* Coming up, from their records */}
      {d.events.length ? (
        <section className="rounded-2xl border border-border bg-card p-4" data-meetings-events>
          <h3 className="text-[16px] font-semibold">Coming up</h3>
          <ul className="mt-2 divide-y divide-border">
            {d.events.map((e: SessionEvent) => (
              <li key={e.key} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-medium">{e.title}</p>
                  <p className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                    {e.daysOut != null ? (e.daysOut === 0 ? "Today" : `${e.daysOut} days`) : ""}
                  </p>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {[day(e.date), e.phase, e.weightClass ? `${String(e.weightClass).replace(/ ?kg$/, "")} kg` : null, e.source].filter(Boolean).join(" · ")}
                </p>
                {e.conflicts.map((c) => (
                  <p key={c} className="mt-1 text-[13px] text-warning">
                    {c}: confirm which is right
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Open commitments, both sides */}
      {d.commitments.length ? <Commitments clientId={clientId} items={d.commitments} /> : null}

      {/* What Cleo remembers from conversations */}
      <Remembered clientId={clientId} items={(d.intelligence as any[]).filter((i) => i.status !== "archived")} />

      {/* Meetings */}
      <section className="rounded-2xl border border-border bg-card p-4" data-meetings-list>
        <h3 className="text-[16px] font-semibold">Meetings</h3>
        {!d.sessions.length ? (
          <p className="mt-2 text-[14px] text-muted-foreground">
            No meetings yet. Prepare one, or add one you've already had so Cleo can remember it.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {[...upcoming, ...past].map((s: any) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(s.id)}
                  className="flex w-full items-center gap-3 py-3 text-left"
                  data-meeting-row={s.id}
                >
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{s.event?.title || "General meeting"}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {[FORMAT_WORDS[s.format], s.minutes ? `${s.minutes} min` : null, day(s.scheduled_at ?? s.created_at)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[12px]",
                      s.status === "done" ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground",
                    )}
                  >
                    {STATUS_WORDS[s.status] ?? s.status}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {prepare ? (
        <PrepareSheet
          clientId={clientId}
          events={d.events}
          initialFormat={prepare.format}
          suggestedMinutes={d.intervention.minutes}
          onClose={() => setPrepare(null)}
          onPrepared={(id) => {
            setPrepare(null);
            setOpen(id);
          }}
        />
      ) : null}
      {open ? <SessionSheet sessionId={open} clientId={clientId} onOpenTab={(t) => { setOpen(null); onOpenTab?.(t); }} onClose={() => setOpen(null)} /> : null}
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
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" data-meetings-commitments>
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
  const [minutes, setMinutes] = useState<number>(initialFormat === "touch_base" ? 10 : suggestedMinutes ?? 20);
  const [notes, setNotes] = useState("");
  const [priorities, setPriorities] = useState("");
  const key = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())), []);
  const go = useMutation({
    mutationFn: () =>
      prep({
        data: {
          clientId,
          eventKey: eventKey === "general" || eventKey === "custom" ? null : eventKey,
          customTitle: eventKey === "custom" ? custom : eventKey === "general" ? "General meeting" : null,
          format,
          minutes: format === "retrospective" ? null : minutes,
          coachNotes: notes.trim() || null,
          priorities: priorities.split("\n").map((p) => p.trim()).filter(Boolean),
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
      <SheetContent side="bottom" swipeToClose className="max-h-[92svh] overflow-y-auto rounded-t-2xl sm:mx-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{format === "retrospective" ? "Add a past meeting" : "Prepare a meeting"}</SheetTitle>
        </SheetHeader>
        <div className="mt-3 space-y-5 pb-4" data-prepare-sheet>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">What it's about</p>
            {events
              .filter((e) => e.daysOut == null || e.daysOut >= 0)
              .map((e) => choice(e.key, e.title, [day(e.date), e.phase, e.daysOut != null ? `${e.daysOut} days` : null].filter(Boolean).join(" · ")))}
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
                  className={cn("h-11 rounded-lg border text-[14px]", format === f ? "border-foreground bg-secondary font-medium" : "border-border")}
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
                    className={cn("h-10 flex-1 rounded-lg border text-[14px] tabular-nums", minutes === m ? "border-foreground bg-secondary font-medium" : "border-border")}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">Your notes (private)</p>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Concerns, context, anything Cleo should know" rows={3} />
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">What you want to decide (one a line, optional)</p>
            <Textarea value={priorities} onChange={(e) => setPriorities(e.target.value)} placeholder={"Settle the openers\nAgree the taper"} rows={2} />
          </div>
          <Button className="h-12 w-full" disabled={go.isPending || (eventKey === "custom" && !custom.trim())} loading={go.isPending} onClick={() => go.mutate()}>
            {format === "retrospective" ? "Add it" : "Prepare"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Lasting coaching intelligence: what the coach kept from conversations (and can add, change or remove). */
function Remembered({ clientId, items }: { clientId: string; items: any[] }) {
  const qc = useQueryClient();
  const act = useServerFn(intelligenceFn);
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: meetingsKey(clientId) });
  const add = useMutation({
    mutationFn: () => act({ data: { clientId, action: "add", text: text.trim() } }),
    onSuccess: () => {
      setText("");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save that"),
  });
  const kept = items.filter((i) => i.status === "confirmed");
  const proposed = items.filter((i) => i.status === "proposed");
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-4" data-meetings-remembered>
      <h3 className="text-[16px] font-semibold">What Cleo remembers</h3>
      <p className="text-[13px] text-muted-foreground">
        Kept from your conversations. Cleo uses these in their training, nutrition and cardio work; change or remove any of them.
      </p>
      {proposed.length ? <p className="text-[13px] text-muted-foreground">{proposed.length} from a meeting waiting for you to keep or let go.</p> : null}
      {[...proposed, ...kept].map((i) => (
        <IntelRow key={i.id} item={i} clientId={clientId} refresh={refresh} />
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) add.mutate();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add something worth remembering"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-[16px] sm:text-[14px]"
        />
        <Button type="submit" variant="outline" size="sm" className="h-10" loading={add.isPending}>
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}
