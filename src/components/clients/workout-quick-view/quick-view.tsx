/**
 * The workout quick view (Nov 23 2026): the Clients list's dumbbell opens a
 * drawer on the athlete's workout (right on a computer, the whole screen on a
 * phone) without leaving the list, so the list's search, filters, page and
 * scroll are where they were when it closes.
 *
 *   Workout   today's workout (else the most relevant one, said why), the
 *             plan beside what was logged, set by set, the notes from both
 *             sides and the review; ‹ › and the week strip step through
 *             workouts, the date opens recent and coming ones
 *   Profile   the essentials: account, coach, training days, goals, health,
 *             the last weekly check-in and the coach's notes
 *
 * The starred athletes sit across the top, one tap (or [ ]) between them; a
 * switch keeps the tab, and the day when the next athlete trains that day too.
 * It only reads: logging is Client view on that day, editing is the program
 * editor, each one deliberate tap away, both as the coach's own permissions
 * allow. Esc closes, ← → step workouts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ExternalLink, Eye, Loader2, MessageSquare, PencilLine, Star, UserRound,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { WorkoutStatusMark } from "@/components/workouts/workout-status-mark";
import { ClientFileNotes } from "@/components/clients/client-file-notes";
import { useEnterClientPov, clientWorkoutHref } from "@/components/clients/use-enter-client-pov";
import { getClientSchedule } from "@/lib/schedule-bulk.functions";
import { getHealthProfileFn } from "@/lib/health/health.functions";
import { healthProfileKey, type HealthProfile } from "@/lib/health/health-profile";
import { coachMark, STATUS_TONE, STATUS_WORD, type CoachStatus } from "@/lib/coach-schedule";
import { clientAccountLabel } from "@/lib/client-account-label";
import { focusBlockEditorWeek } from "@/lib/block-editor-focus";
import { useClientStars, type StarredClient } from "@/lib/client-stars";
import { useAuth } from "@/lib/auth";
import { todayLocalISO } from "@/lib/today";
import { cn } from "@/lib/utils";
import {
  addDaysIso, buildPeekDay, clockLine, DEFAULT_REASON_WORDS, feedbackLine, jumpList, painLine, peekEntries, pickForClient,
  placeLine, relativeDay, shortDay, stepEntry, trainingDaysLine, weekDays, weekLabel, weekStartIso,
  type DefaultReason, type PeekDay, type PeekEntry,
} from "@/lib/workout-peek";
import { peekClientQuery, peekDayQuery, peekProfileQuery, peekScheduleQuery, type PeekClientRecord, type PeekProfile } from "./data";
import { usePeekLoadGuides } from "./load-guides";
import type { CardGuide } from "@/lib/workouts/card-suggestion";
import { useAthleteEquipment } from "@/lib/equipment/equipment-queries";
import { cardSetupView, setupPhotos, type EquipmentData } from "@/lib/equipment/equipment";
import { useEquipmentPhotoUrl } from "@/lib/equipment/equipment-queries";
import { useMediaViewer } from "@/components/media-viewer";
import { restWords } from "@/lib/rest-timer-store";

export type QuickViewClient = { id: string; full_name: string | null; profile_picture_url: string | null };
export type QuickViewTab = "workout" | "profile";

type Props = {
  /** The athlete shown; null closes it. */
  client: QuickViewClient | null;
  onClose: () => void;
  /** Another athlete, from the switcher (the page keeps who's open). */
  onSwitch: (c: QuickViewClient) => void;
  /** Their full profile in place of the drawer (the Clients page's overlay), on a tab. */
  onOpenProfile: (clientId: string, tab?: "training") => void;
};

/** A real link (⌘-click opens a new tab) that otherwise swaps the drawer for the profile. */
function ProfileLink({ clientId, tab, onOpen, className, children, ...rest }: {
  clientId: string;
  tab?: "training";
  onOpen: (clientId: string, tab?: "training") => void;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <a
      href={`/admin/clients/${clientId}${tab ? `?tab=${tab}` : ""}`}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        onOpen(clientId, tab);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "Client";

/** A key press that's for the drawer, not for a box being typed in or a modifier shortcut. */
function isOwnKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  return !t?.closest?.('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]');
}

export default function WorkoutQuickView({ client, onClose, onSwitch, onOpenProfile }: Props) {
  const open = !!client;
  const clientId = client?.id ?? null;
  const qc = useQueryClient();
  const scheduleFn = useServerFn(getClientSchedule);
  const stars = useClientStars();
  const today = todayLocalISO();

  const [tab, setTab] = useState<QuickViewTab>("workout");
  // the workout the coach picked, per athlete (switching back returns to it)
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // the day carried over to the next athlete from the switcher
  const [carry, setCarry] = useState<{ to: string; date: string } | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);

  // a fresh open starts on the workout (the dumbbell's promise), from each athlete's own default
  useEffect(() => {
    if (!open) {
      setTab("workout");
      setChosen({});
      setCarry(null);
      setJumpOpen(false);
    }
  }, [open]);

  const schedule = useQuery({ ...peekScheduleQuery(scheduleFn, clientId ?? ""), enabled: !!clientId });
  const record = useQuery({ ...peekClientQuery(clientId ?? ""), enabled: !!clientId });
  const entries = useMemo(() => peekEntries(schedule.data, today), [schedule.data, today]);

  const pick = useMemo(() => {
    if (!clientId || !entries.length) return null;
    return pickForClient(entries, {
      remembered: chosen[clientId] ?? null,
      carryDate: carry?.to === clientId ? carry.date : null,
      todayIso: today,
    });
  }, [clientId, entries, chosen, carry, today]);
  const entry = pick ? entries.find((e) => e.key === pick.key) ?? null : null;
  const reason: DefaultReason | null = pick && !chosen[clientId ?? ""] ? pick.reason : null;

  const goTo = useCallback(
    (key: string) => {
      if (!clientId) return;
      setChosen((c) => ({ ...c, [clientId]: key }));
      setJumpOpen(false);
    },
    [clientId],
  );
  const prev = entry ? stepEntry(entries, entry.key, -1) : null;
  const next = entry ? stepEntry(entries, entry.key, 1) : null;

  // The athletes to switch between: the starred, with the one open first when they aren't.
  const switcher = useMemo(() => {
    const list: QuickViewClient[] = stars.list.map((s: StarredClient) => ({ id: s.id, full_name: s.full_name, profile_picture_url: s.profile_picture_url }));
    if (client && !list.some((s) => s.id === client.id)) list.unshift(client);
    return list;
  }, [stars.list, client]);

  const switchTo = useCallback(
    (c: QuickViewClient) => {
      if (!clientId || c.id === clientId) return;
      // keep the day the coach chose (an in-person session, a group's review); a default isn't carried
      if (entry && chosen[clientId]) setCarry({ to: c.id, date: entry.date });
      else setCarry(null);
      onSwitch(c);
    },
    [clientId, entry, chosen, onSwitch],
  );
  const stepAthlete = useCallback(
    (dir: -1 | 1) => {
      if (switcher.length < 2 || !clientId) return;
      const i = switcher.findIndex((s) => s.id === clientId);
      const target = switcher[(i + dir + switcher.length) % switcher.length];
      if (target) switchTo(target);
    },
    [switcher, clientId, switchTo],
  );

  // Read ahead: the workouts either side, and the athletes either side in the switcher.
  useEffect(() => {
    if (!clientId) return;
    for (const e of [prev, next]) if (e) void qc.prefetchQuery(peekDayQuery(clientId, e.dayId));
  }, [qc, clientId, prev?.dayId, next?.dayId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !clientId || switcher.length < 2) return;
    const i = switcher.findIndex((s) => s.id === clientId);
    const around = [switcher[(i + 1) % switcher.length], switcher[(i - 1 + switcher.length) % switcher.length]];
    const t = window.setTimeout(() => {
      for (const s of around) if (s && s.id !== clientId) void qc.prefetchQuery(peekScheduleQuery(scheduleFn, s.id));
    }, 400);
    return () => window.clearTimeout(t);
  }, [open, clientId, switcher, qc, scheduleFn]);

  // Keys: ← → workouts, [ ] athletes (Esc is the sheet's own).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isOwnKey(e)) return;
      if (e.key === "ArrowLeft" && tab === "workout" && prev) {
        e.preventDefault();
        goTo(prev.key);
      } else if (e.key === "ArrowRight" && tab === "workout" && next) {
        e.preventDefault();
        goTo(next.key);
      } else if (e.key === "[") {
        e.preventDefault();
        stepAthlete(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        stepAthlete(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tab, prev, next, goTo, stepAthlete]);

  const name = record.data?.full_name ?? client?.full_name ?? "Client";
  const photo = record.data?.profile_picture_url ?? client?.profile_picture_url ?? null;
  const starred = clientId ? stars.isStarred(clientId) : false;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        data-workout-quick-view
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-[36rem] lg:max-w-[40rem]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Header: who, the starred athletes, the two tabs */}
        <div className="shrink-0 border-b border-border" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
          <div className="flex min-h-10 items-center gap-2 pl-[6.25rem] pr-3">
            <UserAvatar src={photo} name={name} size={36} className="shrink-0" expandable={false} />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base leading-tight">{name}</SheetTitle>
              <SheetDescription className="sr-only">Their workout and profile, without leaving the Clients list</SheetDescription>
            </div>
            {stars.canStar && clientId && client && (
              <button
                type="button"
                onClick={() => stars.toggle(client)}
                aria-pressed={starred}
                aria-label={starred ? `Unstar ${name}` : `Star ${name}`}
                title={starred ? "Starred" : "Star to switch to them here"}
                className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Star className={cn("h-5 w-5", starred && "fill-foreground text-foreground")} aria-hidden />
              </button>
            )}
            {clientId && (
              <ProfileLink
                clientId={clientId}
                onOpen={onOpenProfile}
                aria-label={`Open ${name}'s profile`}
                title="Open client"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <UserRound className="h-5 w-5" aria-hidden />
              </ProfileLink>
            )}
          </div>

          <AthleteSwitcher
            list={switcher}
            currentId={clientId}
            starredIds={stars.ids}
            canStar={stars.canStar}
            onPick={switchTo}
            onHover={(c) => void qc.prefetchQuery(peekScheduleQuery(scheduleFn, c.id))}
          />

          <div className="px-3 pb-2.5 pt-2" role="group" aria-label="Show">
            <div className="grid grid-cols-2 rounded-lg bg-muted p-0.5">
              {(["workout", "profile"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "h-9 cursor-pointer rounded-md text-sm font-semibold transition-colors",
                    tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "workout" ? "Workout" : "Profile"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-quick-view-scroll>
          {clientId && tab === "workout" && (
            <WorkoutTab
              clientId={clientId}
              name={name}
              record={record.data ?? null}
              entries={entries}
              entry={entry}
              reason={reason}
              prev={prev}
              next={next}
              loading={schedule.isLoading}
              error={schedule.isError}
              onRetry={() => void schedule.refetch()}
              onGo={goTo}
              jumpOpen={jumpOpen}
              setJumpOpen={setJumpOpen}
              today={today}
              onOpenProfile={onOpenProfile}
            />
          )}
          {clientId && tab === "profile" && <ProfileTab clientId={clientId} record={record.data ?? null} loading={record.isLoading} today={today} />}
        </div>

        <p className="hidden shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground [@media(pointer:fine)]:block">
          <kbd className="font-sans">←</kbd> <kbd className="font-sans">→</kbd> workouts · <kbd className="font-sans">[</kbd> <kbd className="font-sans">]</kbd> athletes · <kbd className="font-sans">Esc</kbd> back to the list
        </p>
      </SheetContent>
    </Sheet>
  );
}

/* ───────────────────────────── The switcher ───────────────────────────── */

function AthleteSwitcher({
  list, currentId, starredIds, canStar, onPick, onHover,
}: {
  list: QuickViewClient[];
  currentId: string | null;
  starredIds: ReadonlySet<string>;
  canStar: boolean;
  onPick: (c: QuickViewClient) => void;
  onHover: (c: QuickViewClient) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // keep the athlete on screen in view when it changes
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentId]);
  if (list.length < 2) {
    return canStar ? (
      <p className="flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground" data-switcher-hint>
        <Star className="h-3.5 w-3.5" aria-hidden />
        Star athletes to switch between them here.
      </p>
    ) : null;
  }
  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Starred athletes"
      data-athlete-switcher
      className="flex gap-1.5 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {list.map((c) => {
        const on = c.id === currentId;
        return (
          <button
            key={c.id}
            type="button"
            aria-current={on ? "true" : undefined}
            onClick={() => onPick(c)}
            onPointerEnter={() => onHover(c)}
            onFocus={() => onHover(c)}
            title={c.full_name ?? undefined}
            className={cn(
              "inline-flex h-10 shrink-0 cursor-pointer touch-manipulation items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-[13px] font-medium transition-colors",
              on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-foreground/30",
            )}
          >
            <UserAvatar src={c.profile_picture_url} name={c.full_name ?? "Client"} size={28} expandable={false} />
            {firstName(c.full_name)}
            {!starredIds.has(c.id) && <span className="sr-only">(not starred)</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Workout ───────────────────────────── */

function WorkoutTab({
  clientId, name, record, entries, entry, reason, prev, next, loading, error, onRetry, onGo, jumpOpen, setJumpOpen, today, onOpenProfile,
}: {
  clientId: string;
  name: string;
  record: PeekClientRecord | null;
  entries: PeekEntry[];
  entry: PeekEntry | null;
  reason: DefaultReason | null;
  prev: PeekEntry | null;
  next: PeekEntry | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onGo: (key: string) => void;
  jumpOpen: boolean;
  setJumpOpen: (v: boolean) => void;
  today: string;
  onOpenProfile: (clientId: string, tab?: "training") => void;
}) {
  const { viewOnly } = useAuth();
  const pov = useEnterClientPov();
  const live = !!entry && (entry.status === "today" || entry.status === "in_progress");
  // While they train (today's, or one started), it refreshes on its own: a coach beside them sees each set land.
  const dayQ = useQuery({
    ...peekDayQuery(clientId, entry?.dayId ?? ""),
    enabled: !!entry,
    refetchInterval: live ? 30_000 : false,
  });
  const day = useMemo(
    () => (dayQ.data && entry ? buildPeekDay(dayQ.data, { instanceId: entry.instanceId, weekIndex: entry.weekIndex }) : null),
    [dayQ.data, entry],
  );
  // What to lift on each exercise, exactly as their logger's Suggested reads it (load-guides.ts).
  const { guides } = usePeekLoadGuides({ clientId, entry, day, record, today, live });
  // Their saved setups (rack height, J-hooks, seat…): the line their card shows above its sets.
  const equipment = useAthleteEquipment(entry ? clientId : null);

  if (loading) return <WorkoutSkeleton />;
  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm font-semibold">Couldn't load {firstName(name)}'s workouts</p>
        <Button variant="outline" size="sm" className="mt-3 h-10" onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <CalendarDays className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">No workouts on {firstName(name)}'s calendar</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Nothing dated in a program they can see. Assign or place one from their Training tab.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2 h-10">
          <ProfileLink clientId={clientId} tab="training" onOpen={onOpenProfile}>Open Training</ProfileLink>
        </Button>
      </div>
    );
  }

  const days = trainingDaysLine(record?.committed_training_days);
  return (
    <div className="pb-4">
      {/* ‹ the workout's day › — stays put while the exercises scroll */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background px-2 py-1.5 dark:bg-card">
        <div className="flex items-center gap-1">
          <NavButton label="Previous workout" disabled={!prev} onClick={() => prev && onGo(prev.key)}>
            <ChevronLeft className="h-5 w-5" />
          </NavButton>
          <button
            type="button"
            onClick={() => setJumpOpen(!jumpOpen)}
            aria-expanded={jumpOpen}
            className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-lg px-2 hover:bg-muted/60"
            data-quick-view-date
          >
            <span className="flex items-center gap-1 text-sm font-semibold">
              {relativeDay(entry.date, today)}
              {relativeDay(entry.date, today) !== shortDay(entry.date, today) && (
                <span className="font-normal text-muted-foreground">· {shortDay(entry.date, today)}</span>
              )}
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", jumpOpen && "rotate-180")} aria-hidden />
            </span>
            {reason && reason !== "today" && <span className="text-[11px] text-muted-foreground">{DEFAULT_REASON_WORDS[reason]}</span>}
          </button>
          <NavButton label="Next workout" disabled={!next} onClick={() => next && onGo(next.key)}>
            <ChevronRight className="h-5 w-5" />
          </NavButton>
        </div>
        {jumpOpen && <JumpList entries={entries} current={entry.key} today={today} onGo={onGo} />}
      </div>

      <WeekStrip entries={entries} entry={entry} today={today} onGo={onGo} />
      {days && (
        <p className="px-4 pb-1 text-xs text-muted-foreground" data-training-days>
          Trains {days}
        </p>
      )}

      <div key={entry.key} className="animate-in fade-in-0 duration-150">
        <WorkoutSummary entry={entry} day={day} name={name} loading={dayQ.isLoading} error={dayQ.isError} onRetry={() => void dayQ.refetch()} today={today} />
        {day && <ExerciseList day={day} name={name} entry={entry} today={today} guides={guides} equipment={equipment.data} />}
        {dayQ.isLoading && <ExercisesSkeleton />}
      </div>

      {/* The deliberate ways to change anything: their app on that day, or the program. */}
      <div className="mt-4 flex flex-wrap gap-2 px-4" data-quick-view-actions>
        {pov.canPov && (
          <Button
            variant="outline"
            className="h-11 min-w-0 flex-1"
            disabled={pov.busy}
            onClick={() => void pov.enter(clientId, { to: clientWorkoutHref(entry.date), fallbackName: name })}
            title="Open this day in their app, to log or change it as they would"
          >
            {pov.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            Log in client view
          </Button>
        )}
        {!viewOnly && entry.blockId && (
          <Button asChild variant="outline" className="h-11 min-w-0 flex-1">
            <Link
              to="/admin/blocks/$blockId"
              params={{ blockId: entry.blockId }}
              onClick={() => focusBlockEditorWeek(entry.weekIndex)}
            >
              <PencilLine className="h-4 w-4" aria-hidden />
              Edit program
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function NavButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const WEEKDAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday to Sunday with a mark under each day that has a workout; « » step weeks, a day opens its workout. */
function WeekStrip({ entries, entry, today, onGo }: { entries: PeekEntry[]; entry: PeekEntry; today: string; onGo: (key: string) => void }) {
  const [start, setStart] = useState(() => weekStartIso(entry.date));
  // follow the workout on screen into its week
  useEffect(() => setStart(weekStartIso(entry.date)), [entry.date]);
  const week = weekDays(entries, start);
  return (
    <div className="px-2 pb-2 pt-2" data-quick-view-week>
      <div className="mb-1 flex items-center justify-between px-1">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setStart(addDaysIso(start, -7))}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-muted-foreground">{weekLabel(start)}</span>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => setStart(addDaysIso(start, 7))}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {week.map((d, i) => {
          const first = d.entries.find((e) => e.status !== "done") ?? d.entries[0];
          const selected = d.entries.some((e) => e.key === entry.key);
          const isToday = d.date === today;
          return (
            <button
              key={d.date}
              type="button"
              disabled={!first}
              onClick={() => first && onGo(selected && d.entries.length > 1 ? d.entries[(d.entries.findIndex((e) => e.key === entry.key) + 1) % d.entries.length].key : first.key)}
              aria-pressed={selected}
              aria-label={`${relativeDay(d.date, today)}${first ? `: ${first.name}` : ", no workout"}`}
              className="flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg py-1 disabled:cursor-default"
            >
              <span className="text-[10px] font-medium text-muted-foreground">{WEEKDAY_LETTER[i]}</span>
              <span
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full text-[13px] tabular-nums",
                  selected ? "bg-foreground font-semibold text-background" : isToday ? "font-semibold ring-1 ring-foreground/50" : first ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {Number(d.date.slice(8))}
              </span>
              <WorkoutStatusMark mark={first ? coachMark(first.status) : null} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Recent and coming workouts, one tap to any of them. */
function JumpList({ entries, current, today, onGo }: { entries: PeekEntry[]; current: string; today: string; onGo: (key: string) => void }) {
  const { recent, ahead } = jumpList(entries, today);
  const section = (title: string, list: PeekEntry[]) =>
    list.length ? (
      <div>
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">{title}</p>
        <ul>
          {list.map((e) => (
            <li key={e.key}>
              <button
                type="button"
                onClick={() => onGo(e.key)}
                aria-current={e.key === current ? "true" : undefined}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-sm hover:bg-muted/60",
                  e.key === current && "bg-muted",
                )}
              >
                <WorkoutStatusMark mark={coachMark(e.status)} />
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{relativeDay(e.date, today)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                {STATUS_WORD[e.status] && e.status !== "today" && (
                  <span className={cn("shrink-0 text-xs", STATUS_TONE[e.status])}>{STATUS_WORD[e.status]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="mt-1 max-h-72 overflow-y-auto border-t border-border/60 pb-1" data-quick-view-jump>
      {section("Coming up", ahead)}
      {section("Recent", recent)}
    </div>
  );
}

function statusSentence(entry: PeekEntry, day: PeekDay | null, today: string): { word: string; tone: string; detail: string | null } {
  const word = STATUS_WORD[entry.status] || (entry.status === "upcoming" ? "Planned" : "");
  const c = day?.completion ?? null;
  let detail: string | null = null;
  if (entry.status === "done") {
    const at = clockLine(c?.completed_at, today);
    detail = [at ? `finished ${at}` : null, day?.minutes ? `${day.minutes} min` : null].filter(Boolean).join(" · ") || null;
  } else if (entry.status === "in_progress") {
    const at = clockLine(c?.started_at ?? c?.in_progress_at, today);
    detail = at ? `started ${at}` : null;
  }
  return { word: word || "Planned", tone: STATUS_TONE[entry.status as CoachStatus] ?? "text-muted-foreground", detail };
}

function WorkoutSummary({
  entry, day, name, loading, error, onRetry, today,
}: { entry: PeekEntry; day: PeekDay | null; name: string; loading: boolean; error: boolean; onRetry: () => void; today: string }) {
  const s = statusSentence(entry, day, today);
  const review = feedbackLine(day?.feedback);
  const pain = painLine(day?.feedback);
  // against the plan only once it's over: mid-session every set still to come would read as "fewer"
  const over = entry.status === "done" || entry.status === "missed" || entry.status === "optional" || entry.date < today;
  const vs = over ? day?.vsPlan : null;
  // the count says something once anything's logged or the session's under way, never "0 of 12" for one ahead
  const showSets = !!day && day.setsPlanned > 0 && (day.setsLogged > 0 || entry.status === "in_progress" || entry.status === "done");
  const pct = day && day.setsPlanned ? Math.min(100, Math.round((day.setsLogged / day.setsPlanned) * 100)) : 0;
  return (
    <section className="mx-4 mt-1 space-y-2.5 rounded-2xl border border-border bg-card p-4" data-quick-view-summary>
      <div>
        {placeLine(entry) && (
          <p className="mb-0.5 text-xs text-muted-foreground" data-quick-view-place>
            {placeLine(entry)}
          </p>
        )}
        <h3 className="text-[17px] font-semibold leading-snug">{day?.name ?? entry.name}</h3>
        {(day?.focus ?? entry.focus) && <p className="text-sm text-muted-foreground">{day?.focus ?? entry.focus}</p>}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={cn("inline-flex items-center gap-1.5 font-semibold", s.tone)}>
          <WorkoutStatusMark mark={coachMark(entry.status)} />
          {s.word}
        </span>
        {s.detail && <span className="text-muted-foreground">{s.detail}</span>}
        {entry.optional && <span className="text-muted-foreground">· Optional</span>}
      </p>
      {loading ? (
        <Skeleton className="h-4 w-40" />
      ) : error ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load this workout.{" "}
          <button type="button" onClick={onRetry} className="cursor-pointer font-semibold text-foreground underline-offset-2 hover:underline">Try again</button>
        </p>
      ) : day && showSets ? (
        <div className="space-y-1" data-quick-view-sets>
          <p className="text-xs text-muted-foreground tabular-nums">
            {day.setsLogged} of {day.setsPlanned} sets logged
          </p>
          <span className="block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-success" : "bg-foreground/50")} style={{ width: `${pct}%` }} />
          </span>
        </div>
      ) : null}

      {vs && (vs.asPlanned ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success" data-quick-view-vs>
          <Check className="h-4 w-4" aria-hidden /> Done as planned
        </p>
      ) : vs.lines.length ? (
        <ul className="space-y-1 text-sm" data-quick-view-vs>
          {vs.lines.slice(0, 3).map((l, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", l.kind === "easier" || l.kind === "extra" ? "bg-muted-foreground" : "bg-amber-500")} />
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      ) : null)}

      {(review || day?.feedback?.client_note || pain) && (
        <div className="space-y-1 border-t border-border/60 pt-2.5 text-sm" data-quick-view-review>
          {review && (
            <p>
              <span className="text-muted-foreground">Review </span>
              <span className="font-medium">{review}</span>
            </p>
          )}
          {day?.feedback?.client_note?.trim() && <p className="text-muted-foreground">“{day.feedback.client_note.trim()}”</p>}
          {pain && (
            <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Pain: {pain}
            </p>
          )}
        </div>
      )}

      {(day?.dayNote || day?.athleteNote) && (
        <div className="space-y-2 border-t border-border/60 pt-2.5 text-sm">
          {day?.dayNote && (
            <NoteLine label={day.dayNote.visible ? "Your note · they see it" : "Your note · only you"} text={day.dayNote.text} />
          )}
          {day?.athleteNote && <NoteLine label={`${firstName(name)}'s note`} text={day.athleteNote} icon />}
        </div>
      )}
    </section>
  );
}

function NoteLine({ label, text, icon }: { label: string; text: string; icon?: boolean }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        {icon && <MessageSquare className="h-3 w-3" aria-hidden />}
        {label}
      </p>
      <p className="whitespace-pre-line leading-snug">{text}</p>
    </div>
  );
}

function ExerciseList({ day, name, entry, today, guides, equipment }: { day: PeekDay; name: string; entry: PeekEntry; today: string; guides: Map<string, CardGuide>; equipment: EquipmentData }) {
  if (!day.exercises.length) {
    return <p className="mx-4 mt-3 text-sm text-muted-foreground">No exercises written for this workout.</p>;
  }
  // An exercise short of its sets is news only in a workout that's over and was trained: today's or
  // one ahead is still to come, and a missed one already says so once at the top.
  const over = entry.status === "done" || entry.status === "missed" || entry.date < today;
  const flagShort = over && day.setsLogged > 0;
  return (
    <ol className="mt-3 space-y-2 px-4" data-quick-view-exercises>
      {day.exercises.map((ex, i) => (
        <ExerciseItem
          key={ex.id}
          ex={ex}
          n={i + 1}
          name={name}
          flagShort={flagShort}
          guide={guides.get(ex.id) ?? null}
          // what their card is on, and how it's set up (cardSetupView: the logged sets', else today's pick)
          setup={ex.exerciseId ? cardSetupView(equipment, ex.exerciseId, ex.sets) : null}
        />
      ))}
    </ol>
  );
}

function ExerciseItem({ ex, n, name, flagShort, guide, setup }: {
  ex: PeekDay["exercises"][number];
  n: number;
  name: string;
  flagShort: boolean;
  guide: CardGuide | null;
  setup: ReturnType<typeof cardSetupView> | null;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = !!(ex.details.muscle || ex.details.equipment || ex.details.cues || ex.details.demo);
  const complete = ex.setsPlanned ? ex.setsLogged >= ex.setsPlanned : ex.setsLogged > 0;
  const partial = ex.setsLogged > 0 && !complete;
  return (
    <li className="rounded-xl border border-border bg-card p-3" data-quick-view-exercise>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-[15px] font-semibold leading-snug">
              {ex.name}
              {ex.role && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{ex.role}</span>}
              {ex.cardio && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Cardio</span>}
            </p>
            {hasDetails && (
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={`${open ? "Hide" : "Show"} details for ${ex.name}`}
                className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              </button>
            )}
          </div>

          <dl className="mt-1.5 grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
            {setup?.summary && (
              <>
                <dt className="text-xs leading-5 text-muted-foreground">Setup</dt>
                <dd className="leading-5" data-setup>
                  {/* the parts never break mid-phrase: "J-hooks 9" stays together */}
                  {setup.summary.split(" · ").map((part, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-muted-foreground"> · </span>}
                      <span className="whitespace-nowrap font-medium">{part}</span>
                    </span>
                  ))}
                  {setup.equipment?.archived_at && <span className="text-xs text-muted-foreground"> · retired</span>}
                  {setupPhotos(setup.setup).length > 0 && <SetupPhotoLink path={setupPhotos(setup.setup)[0]} count={setupPhotos(setup.setup).length} />}
                </dd>
              </>
            )}
            <dt className="text-xs leading-5 text-muted-foreground">Plan</dt>
            <dd className="leading-5 text-muted-foreground" data-plan>{ex.plan || "–"}</dd>
            {guide && <GuideRow guide={guide} name={name} />}
            {ex.rest && (
              <>
                <dt className="text-xs leading-5 text-muted-foreground">Rest</dt>
                <dd className="leading-5" data-rest={ex.rest.usual ? "usual" : "program"}>
                  <span className="font-medium tabular-nums">{(restWords(ex.rest.seconds) ?? "").replace(/^Rest /, "")}</span>
                  {ex.rest.usual && <span className="text-xs text-muted-foreground"> · the usual for this lift</span>}
                </dd>
              </>
            )}
            <dt className="text-xs leading-5 text-muted-foreground">Logged</dt>
            <dd className="leading-5" data-logged>
              {ex.logged.length ? (
                <span className="flex items-start gap-1.5">
                  <span className="min-w-0 space-y-0.5">
                    {ex.logged.map((l, i) => (
                      <span key={i} className="block font-medium tabular-nums">{l}</span>
                    ))}
                  </span>
                  {complete ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="All sets logged" />
                  ) : partial && ex.setsPlanned ? (
                    <span className={cn("shrink-0 text-xs tabular-nums", flagShort ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                      {ex.setsLogged}/{ex.setsPlanned}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className={cn("text-sm", flagShort && !ex.cardio ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                  {flagShort ? "Not logged" : "–"}
                </span>
              )}
            </dd>
          </dl>

          {(ex.coachNote || ex.athleteNotes.length > 0) && (
            <div className="mt-2 space-y-1.5 text-[13px] leading-snug">
              {ex.coachNote && (
                <p className="text-muted-foreground">
                  <span className="font-semibold text-foreground/80">Note: </span>
                  {ex.coachNote}
                </p>
              )}
              {ex.athleteNotes.map((t, i) => (
                <p key={i}>
                  <span className="font-semibold">{firstName(name)}: </span>
                  {t}
                </p>
              ))}
            </div>
          )}

          {open && hasDetails && (
            <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-[13px] text-muted-foreground" data-quick-view-details>
              {(ex.details.muscle || ex.details.equipment) && (
                <p>{[ex.details.muscle, ex.details.equipment].filter(Boolean).join(" · ")}</p>
              )}
              {ex.details.cues && <p className="whitespace-pre-line">{ex.details.cues}</p>}
              {ex.details.demo && (
                <a
                  href={ex.details.demo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  Demo video <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * The weight line under the plan: the number the athlete's Suggested shows (a
 * range to pick within on the first heavy set of a main lift), the weight a
 * coach's % comes to today, or, once every set is in, where next time starts.
 */
function GuideRow({ guide, name }: { guide: CardGuide; name: string }) {
  const label = guide.kind === "planned" ? "Load" : guide.kind === "next" ? "Next time" : "Suggested";
  return (
    <>
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="leading-5" data-load-guide={guide.kind}>
        {guide.kind === "suggested" ? (
          <span>
            <span className="font-semibold tabular-nums">{guide.shown} {guide.unit}</span>
            {guide.plan && (
              // "× 11 @ 8" reads on from the weight; a progression's change ("+5 lb", "same weight · build to 12") is its own phrase
              <span className="tabular-nums text-muted-foreground">{guide.plan.startsWith("×") ? " " : " · "}{guide.plan}</span>
            )}
            {guide.note && (
              <span className={cn("text-xs", guide.live ? "text-success" : "text-muted-foreground")}> · {guide.note}</span>
            )}
          </span>
        ) : guide.kind === "pending" ? (
          <span className="text-muted-foreground" title={`No recent logs of this lift with an RPE: ${firstName(name)}'s first set sets it`}>
            {guide.note}
          </span>
        ) : guide.kind === "planned" ? (
          <span>
            {guide.value ? (
              <span className="font-semibold tabular-nums">{guide.value}</span>
            ) : (
              <span className="text-muted-foreground">{guide.waiting ?? "–"}</span>
            )}
            <span className="text-xs text-muted-foreground"> · {guide.label}{guide.capped ? " · capped" : ""}</span>
          </span>
        ) : (
          <span>
            <span className="font-semibold tabular-nums">{guide.shown} {guide.unit}</span>
            {guide.note && <span className="text-xs text-muted-foreground"> · {guide.note}</span>}
          </span>
        )}
      </dd>
    </>
  );
}

function WorkoutSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading workouts">
      <Skeleton className="mx-auto h-9 w-48" />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <ExercisesSkeleton />
    </div>
  );
}

function ExercisesSkeleton() {
  return (
    <div className="mt-3 space-y-2 px-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
    </div>
  );
}

/* ───────────────────────────── Profile ───────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthDay(ts: string | null | undefined, today: string): string | null {
  if (!ts) return null;
  const d = ts.length === 10 ? new Date(`${ts}T12:00:00`) : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear() !== Number(today.slice(0, 4)) ? `, ${d.getFullYear()}` : "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

function agoWords(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const ms = Date.now() - Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const b = new Date(`${dob.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a -= 1;
  return a > 0 && a < 120 ? a : null;
}

function ratingWords(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? `${n}/5` : String(v);
}

function goalWords(g: PeekProfile["goals"]): string | null {
  if (!g) return null;
  const main = (g.main_goal === "other" ? g.main_goal_other : g.main_goal) ?? g.main_goal_other;
  return (main ?? "").replace(/_/g, " ").trim() || null;
}

function bodyweightGoal(r: PeekClientRecord | null, today: string): string | null {
  if (!r?.bodyweight_goal_value || !r.bodyweight_goal_type) return null;
  const verb = /lose|cut/i.test(r.bodyweight_goal_type) ? "Lose to" : /gain|bulk/i.test(r.bodyweight_goal_type) ? "Gain to" : "Hold";
  const by = monthDay(r.bodyweight_goal_date, today);
  return `${verb} ${r.bodyweight_goal_value} ${r.bodyweight_goal_unit ?? ""}`.trim() + (by ? ` by ${by}` : "");
}

function ProfileTab({ clientId, record, loading, today }: { clientId: string; record: PeekClientRecord | null; loading: boolean; today: string }) {
  const profile = useQuery({ ...peekProfileQuery(clientId, record?.assigned_coach_id ?? null), enabled: !!record });
  const healthFn = useServerFn(getHealthProfileFn);
  // the Health card's own read and key, so either fills the other
  const health = useQuery({
    queryKey: healthProfileKey(clientId),
    queryFn: async () => (await healthFn({ data: { clientId } })).health as HealthProfile,
    staleTime: 30_000,
  });

  if (loading || !record) {
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  const label = clientAccountLabel(record);
  const p = profile.data;
  const g = p?.goals ?? null;
  const days = trainingDaysLine(record.committed_training_days);
  const age = ageOf(record.date_of_birth);
  const facts: Array<[string, string | null]> = [
    ["Account", label.label],
    ["Coaching", record.coaching_type],
    ["Coach", p?.coachName ?? null],
    ["Client since", monthDay(record.created_at, today)],
    ["Last active", agoWords(record.last_active_at ?? record.last_signed_in_at)],
    ["Trains", days],
    ["Units", record.preferred_weight_unit === "kg" ? "Kilograms" : record.preferred_weight_unit === "lb" ? "Pounds" : null],
    ["Age", age ? String(age) : null],
  ];
  const goal = goalWords(g);
  const setup = g
    ? [g.training_days_per_week ? `${g.training_days_per_week} days a week` : null, g.workout_length_minutes ? `${g.workout_length_minutes} min` : null, (g.training_location ?? "").replace(/_/g, " ") || null]
        .filter(Boolean)
        .join(" · ")
    : "";
  const bw = bodyweightGoal(record, today);
  const h = health.data;
  const healthLines = h ? [...h.injuries, ...h.conditions, ...h.medications] : [];
  const ci = p?.checkin ?? null;
  const ans = (ci?.answers ?? {}) as Record<string, unknown>;
  const summary = ci?.ai_status === "ready" && !ci.ai_analysis?.fallback ? (ci.ai_analysis?.summary ?? "").trim() : "";

  return (
    <div className="space-y-3 p-4" data-quick-view-profile>
      <Card title="Essentials">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{k}</dt>
              <dd className="truncate text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {(record.email || record.phone) && (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 text-sm">
            {record.phone && <a className="font-medium underline-offset-2 hover:underline" href={`tel:${record.phone}`}>{record.phone}</a>}
            {record.email && <a className="min-w-0 truncate font-medium underline-offset-2 hover:underline" href={`mailto:${record.email}`}>{record.email}</a>}
          </p>
        )}
      </Card>

      <Card title="Goals">
        {profile.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : goal || g?.goal_target || bw || setup ? (
          <div className="space-y-1 text-sm">
            {goal && <p className="font-medium first-letter:uppercase">{goal}</p>}
            {g?.goal_target && <p>{g.goal_target}</p>}
            {bw && <p>{bw}</p>}
            {(g?.training_experience || setup) && (
              <p className="text-muted-foreground first-letter:uppercase">
                {[(g?.training_experience ?? "").replace(/_/g, " ") || null, setup || null].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Goals & Setup isn't filled in yet.</p>
        )}
      </Card>

      <Card title="Health">
        {health.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : health.isError ? (
          <p className="text-sm text-muted-foreground">Couldn't read their health profile.</p>
        ) : healthLines.length || h?.pain.length ? (
          <ul className="space-y-1.5 text-sm">
            {healthLines.slice(0, 6).map((e) => (
              <li key={e.id}>
                <span className="font-medium">{e.label}</span>
                {e.details && <span className="text-muted-foreground"> · {e.details}</span>}
              </li>
            ))}
            {h?.pain.slice(0, 3).map((pa) => (
              <li key={`pain:${pa.area}`} className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {pa.area} pain {pa.summary ? `· ${pa.summary}` : `· ${pa.count}× recently${pa.worst ? `, worst ${pa.worst}/10` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing on file.</p>
        )}
      </Card>

      <Card
        title="Last check-in"
        action={
          <Link to="/admin/messages" search={{ client: clientId } as any} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Open chat <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        {profile.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : ci ? (
          <div className="space-y-1.5 text-sm" data-quick-view-checkin>
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{monthDay(ci.submitted_at, today)}</span>
              {ci.reviewed_at ? (
                <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" aria-hidden /> Reviewed</span>
              ) : (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">To review</span>
              )}
            </p>
            {[["Week", ans.week_rating], ["Training", ans.training_rating], ["Nutrition", ans.nutrition_rating]].some(([, v]) => ratingWords(v)) && (
              <p className="text-muted-foreground">
                {[["Week", ans.week_rating], ["Training", ans.training_rating], ["Nutrition", ans.nutrition_rating]]
                  .map(([k, v]) => (ratingWords(v) ? `${k} ${ratingWords(v)}` : null))
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            {typeof ans.win === "string" && ans.win.trim() && <p><span className="text-muted-foreground">Win: </span>{ans.win.trim()}</p>}
            {typeof ans.help === "string" && ans.help.trim() && <p><span className="text-muted-foreground">Asked for: </span>{ans.help.trim()}</p>}
            {summary && <p className="line-clamp-3 text-muted-foreground">{summary}</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No weekly check-in yet.</p>
        )}
      </Card>

      <ClientFileNotes clientId={clientId} limit={3} />
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The athlete's setup photo, a tap from big: how the rack or machine looks set up. */
function SetupPhotoLink({ path, count }: { path: string; count: number }) {
  const url = useEquipmentPhotoUrl(path);
  const viewer = useMediaViewer();
  return (
    <button
      type="button"
      onClick={(e) => url && viewer.open(url, { alt: "Setup photo", from: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
      className="ml-1.5 inline-flex h-6 items-center gap-1 rounded-md align-middle text-xs text-muted-foreground hover:text-foreground"
      aria-label={count > 1 ? `See the setup photos (${count})` : "See the setup photo"}
      data-setup-photo-link
    >
      <span className="inline-block h-5 w-5 overflow-hidden rounded bg-muted">{url && <img src={url} alt="" className="h-full w-full object-cover" />}</span>
      {count > 1 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}
