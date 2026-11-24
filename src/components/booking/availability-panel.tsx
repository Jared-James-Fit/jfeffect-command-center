import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Lightbulb, Loader2, Pause, Play, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { addDaysISO, deviceTodayISO } from "@/lib/schedule-time";
import { weekDays } from "@/components/calendar/week-strip";
import { getAvailabilityPreview, listBlockingCalendars } from "@/lib/availability.functions";
import {
  AVAILABILITY_QUERY,
  MODE_COPY,
  TIME_CHOICES,
  WEEKDAY_CHOICES,
  addAvailabilityOverride,
  barPlace,
  barScale,
  rangeLabel,
  removeAvailabilityOverride,
  saveAvailabilitySettings,
  shortDayLabel,
  timeLabel,
  toDayMinutes,
  weekSummary,
  windowsText,
} from "@/lib/availability-ui";
import {
  PROTECTED_LABEL,
  type AvailabilityMode,
  type AvailabilitySettings,
  type ProtectedKind,
} from "@/lib/smart-availability";
import { dowOf } from "@/lib/booking-slots";

type Preview = Awaited<ReturnType<typeof getAvailabilityPreview>>;
type PreviewDay = Preview["days"][number];

function usePreview(weekStart: string, typeId: string | null, habits = false, enabled = true) {
  const fn = useServerFn(getAvailabilityPreview);
  return useQuery({
    queryKey: [AVAILABILITY_QUERY, weekStart, typeId, habits],
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: () => fn({ data: { weekStart, typeId, habits } }),
  });
}

function thisMonday(): string {
  return weekDays(deviceTodayISO())[0];
}

/**
 * Calendar → Booking: where calls can go. One card: the mode, what this week
 * offers and why, then the week itself and his boundaries one tap away.
 */
export function AvailabilityCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [weekOpen, setWeekOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const monday = thisMonday();
  const { data, isLoading } = usePreview(monday, null);
  const settings = data?.settings;
  const confirmed = !!settings?.confirmedAt;
  const today = deviceTodayISO();
  const paused = !!settings?.pausedUntil && settings.pausedUntil >= today;

  const refresh = () => qc.invalidateQueries({ queryKey: [AVAILABILITY_QUERY] });
  const save = async (next: AvailabilitySettings, ok: string) => {
    try {
      await saveAvailabilitySettings(next, user?.id ?? null);
      toast.success(ok);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    }
  };
  const chooseMode = (mode: AvailabilityMode) => {
    if (!settings || mode === settings.mode) return;
    if (mode !== "manual" && !confirmed) return setSetupOpen(true);
    void save({ ...settings, mode }, `${MODE_COPY[mode].label} is on`);
  };
  const firstReason = data?.days.find((d) => d.reason && !d.closed && d.date >= today)?.reason ?? null;

  return (
    <Card className="p-4" data-availability-card>
      <div className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold">Availability</h2>
        {paused && <span className="ml-auto text-xs text-muted-foreground">Paused until {shortDayLabel(settings!.pausedUntil!)}</span>}
      </div>
      <div className="mt-3 inline-flex h-9 rounded-full border border-border bg-background/60 p-0.5 text-sm font-medium" role="radiogroup" aria-label="Availability mode">
        {(["manual", "assisted", "auto"] as AvailabilityMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={settings?.mode === m}
            disabled={!settings}
            onClick={() => chooseMode(m)}
            className={cn("rounded-full px-3", settings?.mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {MODE_COPY[m].label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{settings ? MODE_COPY[settings.mode].line : " "}</p>

      {isLoading || !data ? (
        <div className="mt-3 h-10 jf-skeleton rounded-lg bg-muted" />
      ) : !confirmed ? (
        <div className="mt-3 rounded-xl bg-muted p-3 text-sm">
          <p className="font-medium">Set your boundaries first</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Your days and hours, how many calls a day, and the time that's never offered (training, family, focus). Bookings work exactly as now until you save them.
          </p>
          <Button className="mt-3 h-10" onClick={() => setSetupOpen(true)}>
            Set boundaries
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          <p className="text-sm font-medium" data-availability-summary>
            {data.calendarError ? "Google Calendar couldn't be read" : weekSummary(data.days, settings!.mode)}
          </p>
          {data.calendarError ? (
            <p className="text-[13px] text-muted-foreground">{data.calendarError}</p>
          ) : (
            firstReason && <p className="text-[13px] text-muted-foreground">{firstReason}</p>
          )}
          {data.learned.length > 0 && (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden /> {data.learned.length} suggestion{data.learned.length === 1 ? "" : "s"} from your changes
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" className="h-10" onClick={() => setWeekOpen(true)} disabled={!data}>
          See the week
        </Button>
        <Button variant="ghost" className="h-10" onClick={() => setSetupOpen(true)} disabled={!settings}>
          Boundaries
        </Button>
        {confirmed && settings!.mode !== "manual" && (
          <Button
            variant="ghost"
            className="ml-auto h-10"
            onClick={() =>
              paused
                ? save({ ...settings!, pausedUntil: null }, "Smart picks are back on")
                : save({ ...settings!, pausedUntil: addDaysISO(today, 6) }, "Paused for a week: your own hours until then")
            }
          >
            {paused ? <Play className="mr-1.5 h-4 w-4" /> : <Pause className="mr-1.5 h-4 w-4" />}
            {paused ? "Resume" : "Pause a week"}
          </Button>
        )}
      </div>

      {settings && (
        <AvailabilitySetupSheet
          open={setupOpen}
          onOpenChange={setSetupOpen}
          settings={settings}
          onSave={async (next) => {
            const first = !next.confirmedAt;
            await save({ ...next, confirmedAt: next.confirmedAt ?? new Date().toISOString() }, first ? "Boundaries saved" : "Saved");
            setSetupOpen(false);
          }}
        />
      )}
      {weekOpen && <AvailabilityWeekSheet open={weekOpen} onOpenChange={setWeekOpen} />}
    </Card>
  );
}

// ── The week ─────────────────────────────────────────────────────────────────

function AvailabilityWeekSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(thisMonday());
  const [typeId, setTypeId] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const { data, isFetching } = usePreview(weekStart, typeId, false, open);
  const refresh = () => qc.invalidateQueries({ queryKey: [AVAILABILITY_QUERY] });
  const settings = data?.settings;
  const tz = settings?.timezone ?? "America/Winnipeg";
  const today = deviceTodayISO();
  const dates = weekDays(weekStart);

  const scale = useMemo(() => {
    if (!data || !settings) return { from: 8 * 60, to: 18 * 60 };
    const edges = [
      ...data.days.flatMap((d) => [...d.windows, ...(d.suggested ?? [])]),
      ...data.busy,
    ].map((r) => toDayMinutes(r, tz));
    return barScale(settings, edges);
  }, [data, settings, tz]);

  const accept = async (key: string, apply: () => AvailabilitySettings) => {
    try {
      await saveAvailabilitySettings(apply(), user?.id ?? null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    }
    void key;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[94dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Your week of calls</SheetTitle>
            <SheetDescription>What people can book, and why. Tap a day to change it.</SheetDescription>
          </SheetHeader>

          <div className="mt-3 flex items-center gap-1">
            <span className="mr-auto text-sm font-semibold">
              {shortDayLabel(dates[0])} – {shortDayLabel(dates[6])}
            </span>
            {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Updating" />}
            {weekStart !== thisMonday() && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => setWeekStart(thisMonday())}>
                This week
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous week" disabled={weekStart <= thisMonday()} onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next week" onClick={() => setWeekStart(addDaysISO(weekStart, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {data && data.smartTypes.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.smartTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeId(t.id)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-[13px]",
                    (typeId ?? data.type?.id) === t.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <Legend assisted={settings?.mode === "assisted"} />

          {data?.calendarError && <p className="mt-3 rounded-lg bg-muted p-3 text-[13px]">{data.calendarError}</p>}

          {data && settings && data.learned.length > 0 && (
            <div className="mt-3 space-y-2">
              {data.learned.map((l) => (
                <div key={l.key} className="rounded-xl border border-border p-3 text-[13px]" data-availability-learned>
                  <p className="flex gap-1.5">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    {l.text}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9"
                      onClick={() =>
                        accept(l.key, () => {
                          if (l.kind === "day_off") return { ...settings, days: settings.days.filter((d) => !l.days.includes(d)) };
                          const item = { id: crypto.randomUUID(), days: l.days, start: l.start!, end: l.end! };
                          return l.kind === "protect"
                            ? { ...settings, protected: [...settings.protected, { ...item, kind: "personal" as ProtectedKind, label: "Personal" }] }
                            : { ...settings, pinned: [...settings.pinned, item] };
                        })
                      }
                    >
                      {l.kind === "protect" ? "Protect it" : l.kind === "pin" ? "Always offer it" : "No calls that day"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9" onClick={() => accept(l.key, () => ({ ...settings, dismissed: [...settings.dismissed, l.key] }))}>
                      Not a habit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <ol className="mt-3 divide-y divide-border/60" aria-label="This week's days">
            {dates.map((date) => {
              const day = data?.days.find((d) => d.date === date);
              const busy = (data?.busy ?? []).filter((b) => toLocalDate(b.start, tz) === date);
              const past = date < today;
              return (
                <li key={date}>
                  <button
                    type="button"
                    disabled={past || !day}
                    onClick={() => setDayOpen(date)}
                    className="block w-full py-2.5 text-left disabled:opacity-50"
                    data-availability-day={date}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className={cn("text-sm font-semibold", date === today && "underline underline-offset-4")}>{shortDayLabel(date)}</span>
                      <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">
                        {past ? "Past" : !day ? "" : day.closed ? "Closed" : day.slotCount ? `${day.slotCount} open` : "None open"}
                      </span>
                      {!past && day && <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/60" aria-hidden />}
                    </div>
                    <DayBar day={day} busy={busy} scale={scale} tz={tz} />
                    {day?.reason && <p className="mt-1 text-[13px] text-muted-foreground" data-availability-reason>{day.reason}</p>}
                  </button>
                </li>
              );
            })}
          </ol>
          <ScaleLabels scale={scale} />
        </div>
        {dayOpen && data && settings && (
          <AvailabilityDaySheet
            date={dayOpen}
            day={data.days.find((d) => d.date === dayOpen) ?? null}
            busy={(data.busy ?? []).filter((b) => toLocalDate(b.start, tz) === dayOpen)}
            overrides={data.overrides.filter((o) => o.date === dayOpen)}
            settings={settings}
            onClose={() => setDayOpen(null)}
            onChanged={refresh}
            userId={user?.id ?? null}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function toLocalDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

const OPEN = "bg-success/70";
const SUGGESTED = "border border-dashed border-success bg-success/10";
const SESSION = "bg-foreground/70";
const BUSY = "bg-muted-foreground/45";
const PROTECTED = "bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_2px,transparent_2px_6px)] opacity-40";

function Legend({ assisted }: { assisted: boolean }) {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-4 rounded-sm", cls)} aria-hidden /> {label}
    </span>
  );
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-hidden>
      {item(OPEN, "Bookable")}
      {assisted && item(SUGGESTED, "Smart pick")}
      {item(SESSION, "Clients")}
      {item(BUSY, "Busy")}
      {item(PROTECTED, "Protected")}
    </div>
  );
}

function DayBar({
  day,
  busy,
  scale,
  tz,
}: {
  day: PreviewDay | undefined;
  busy: Preview["busy"];
  scale: { from: number; to: number };
  tz: string;
}) {
  const seg = (r: { start: number; end: number }, cls: string, key: string) => {
    const place = barPlace(toDayMinutes(r, tz), scale);
    if (!place) return null;
    return <span key={key} className={cn("absolute inset-y-0 rounded-sm", cls)} style={{ left: `${place.left}%`, width: `${place.width}%` }} />;
  };
  return (
    <div className="relative mt-1.5 h-4 overflow-hidden rounded-md bg-muted" aria-hidden>
      {(day?.protectedTimes ?? []).map((p, i) => seg(p, PROTECTED, `p${i}`))}
      {(day?.suggested ?? []).map((w, i) => seg(w, SUGGESTED, `s${i}`))}
      {(day?.windows ?? []).map((w, i) => seg(w, OPEN, `w${i}`))}
      {busy.map((b, i) => seg(b, b.kind === "session" || b.kind === "appointment" ? SESSION : BUSY, `b${i}`))}
    </div>
  );
}

function ScaleLabels({ scale }: { scale: { from: number; to: number } }) {
  const ticks: number[] = [];
  for (let m = scale.from; m <= scale.to; m += 180) ticks.push(m);
  return (
    <div className="relative mt-1 h-4 text-[11px] tabular-nums text-muted-foreground" aria-hidden>
      {ticks.map((m) => (
        <span key={m} className="absolute -translate-x-1/2" style={{ left: `${((m - scale.from) / (scale.to - scale.from)) * 100}%` }}>
          {timeLabel(`${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00`).replace(":00", "")}
        </span>
      ))}
    </div>
  );
}

// ── One day ──────────────────────────────────────────────────────────────────

function AvailabilityDaySheet({
  date,
  day,
  busy,
  overrides,
  settings,
  onClose,
  onChanged,
  userId,
}: {
  date: string;
  day: PreviewDay | null;
  busy: Preview["busy"];
  overrides: Preview["overrides"];
  settings: AvailabilitySettings;
  onClose: () => void;
  onChanged: () => void;
  userId: string | null;
}) {
  const tz = settings.timezone;
  const dow = dowOf(date);
  const dayName = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
  const [form, setForm] = useState<{ kind: "block" | "open"; start: string; end: string; every: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const off = overrides.find((o) => o.kind === "off");
  const smartDay = overrides.find((o) => o.kind === "smart");

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusyId(key);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save");
    } finally {
      setBusyId(null);
    }
  };

  const saveForm = () => {
    if (!form) return;
    if (form.end <= form.start) return toast.error("The end has to be after the start");
    const every = form.every;
    void run(
      "form",
      async () => {
        if (every) {
          const item = { id: crypto.randomUUID(), days: [dow], start: form.start, end: form.end };
          await saveAvailabilitySettings(
            form.kind === "block"
              ? { ...settings, protected: [...settings.protected, { ...item, kind: "personal", label: "Personal" }] }
              : { ...settings, pinned: [...settings.pinned, item] },
            userId,
          );
        } else {
          await addAvailabilityOverride({ date, kind: form.kind, start: form.start, end: form.end, userId });
        }
        setForm(null);
      },
      every ? `Every ${dayName} from now on` : "Changed for this day",
    );
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <SheetHeader className="text-left">
            <SheetTitle>{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</SheetTitle>
            <SheetDescription>{day?.reason ?? (day?.windows.length ? "Open as your settings say." : "Nothing open.")}</SheetDescription>
          </SheetHeader>

          <Section title="Bookable">
            <p className="text-sm">{day?.windows.length ? windowsText(day.windows, tz) : "Nothing"}</p>
            {day?.suggested && day.suggested.length > 0 && (
              <p className="mt-1 text-[13px] text-muted-foreground">Smart pick: {windowsText(day.suggested, tz)}</p>
            )}
          </Section>

          {busy.length > 0 && (
            <Section title="Already on">
              <ul className="space-y-1 text-sm">
                {busy
                  .slice()
                  .sort((a, b) => a.start - b.start)
                  .map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="min-w-[9.5rem] shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{windowsText([b], tz)}</span>
                      <span className="truncate">{b.label}</span>
                    </li>
                  ))}
              </ul>
            </Section>
          )}

          {(overrides.length > 0 || (day?.protectedTimes.length ?? 0) > 0) && (
            <Section title="Your changes">
              <ul className="space-y-1.5 text-sm">
                {(day?.protectedTimes ?? []).map((p, i) => (
                  <li key={`p${i}`} className="text-muted-foreground">
                    {p.label}, every {dayName}: {windowsText([p], tz)}
                  </li>
                ))}
                {overrides.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {o.kind === "off" ? "Day off" : o.kind === "smart" ? "Using the smart picks" : `${o.kind === "block" ? "Blocked" : "Opened"} ${rangeLabel(o.start!, o.end!)}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label="Undo this change"
                      disabled={busyId === o.id}
                      onClick={() => run(o.id!, () => removeAvailabilityOverride(o.id!), "Undone")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {form ? (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <p className="text-sm font-medium">{form.kind === "block" ? "Block time" : "Open extra time"}</p>
              <div className="flex items-center gap-2">
                <TimeSelect value={form.start} onChange={(v) => setForm({ ...form, start: v })} label="From" />
                <span className="text-muted-foreground">to</span>
                <TimeSelect value={form.end} onChange={(v) => setForm({ ...form, end: v })} label="To" />
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Every {dayName}</span>
                <Switch checked={form.every} onCheckedChange={(v) => setForm({ ...form, every: v })} />
              </label>
              <p className="text-[12px] text-muted-foreground">
                {form.every
                  ? form.kind === "block"
                    ? "Saved as protected time: never offered on any " + dayName + "."
                    : "Always offered on " + dayName + "s in Automatic, when it's free."
                  : "Just this " + dayName + "."}
              </p>
              <div className="flex gap-2">
                <Button className="h-10" disabled={busyId === "form"} onClick={saveForm}>
                  Save
                </Button>
                <Button variant="ghost" className="h-10" onClick={() => setForm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <Button variant="outline" className="h-11 justify-start" onClick={() => setForm({ kind: "block", start: settings.dayStart, end: TIME_CHOICES.find((t) => t > settings.dayStart && t >= "12:00") ?? settings.dayEnd, every: false })}>
                Block time
              </Button>
              <Button variant="outline" className="h-11 justify-start" onClick={() => setForm({ kind: "open", start: "17:00" > settings.dayEnd ? settings.dayEnd : "17:00", end: "18:00", every: false })}>
                Open extra time
              </Button>
              {off ? (
                <Button variant="outline" className="h-11 justify-start" disabled={busyId === "off"} onClick={() => run("off", () => removeAvailabilityOverride(off.id!), "Back on")}>
                  Undo day off
                </Button>
              ) : (
                <Button variant="outline" className="h-11 justify-start" disabled={busyId === "off"} onClick={() => run("off", () => addAvailabilityOverride({ date, kind: "off", userId }), "No calls this day")}>
                  Take the day off
                </Button>
              )}
              {settings.mode === "assisted" &&
                (smartDay ? (
                  <Button variant="outline" className="h-11 justify-start" onClick={() => run("smart", () => removeAvailabilityOverride(smartDay.id!), "Back to your hours")}>
                    Back to your hours
                  </Button>
                ) : (
                  day?.suggested && (
                    <Button variant="outline" className="h-11 justify-start" onClick={() => run("smart", () => addAvailabilityOverride({ date, kind: "smart", userId }), "Using the smart pick this day")}>
                      Use the smart pick this day
                    </Button>
                  )
                ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {Array.from(new Set([...TIME_CHOICES, value])).sort().map((t) => (
          <SelectItem key={t} value={t}>
            {timeLabel(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Boundaries ───────────────────────────────────────────────────────────────

function ChipRow<T extends string | number>({
  options,
  isOn,
  onPick,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  isOn: (v: T) => boolean;
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={isOn(o.value)}
          onClick={() => onPick(o.value)}
          className={cn(
            "h-9 min-w-10 rounded-full border px-3 text-[13px] font-medium",
            isOn(o.value) ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AvailabilitySetupSheet({
  open,
  onOpenChange,
  settings,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settings: AvailabilitySettings;
  onSave: (next: AvailabilitySettings) => Promise<void>;
}) {
  const [s, setS] = useState<AvailabilitySettings>(settings);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adding, setAdding] = useState<{ label: string; kind: ProtectedKind; days: number[]; start: string; end: string } | null>(null);
  const [away, setAway] = useState<{ from: string; to: string; label: string } | null>(null);
  const set = <K extends keyof AvailabilitySettings>(k: K, v: AvailabilitySettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const habitsQ = usePreview(thisMonday(), null, true, open);
  const habits = (habitsQ.data?.habits ?? []).filter((h) => !s.dismissed.includes(h.key) && !s.protected.some((p) => p.days.includes(h.days[0]) && p.start <= h.start && p.end >= h.end));
  const calendarsFn = useServerFn(listBlockingCalendars);
  const calendars = useQuery({ queryKey: ["availability-calendars"], enabled: open && moreOpen, queryFn: () => calendarsFn({}) });

  // A fresh copy each time it opens.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const stamp = open ? JSON.stringify(settings) : null;
  if (open && stamp !== openedFor) {
    setOpenedFor(stamp);
    setS(settings);
  }

  const toggleDay = (d: number) => set("days", s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[94dvh] overflow-y-auto rounded-t-2xl pb-0">
        <div className="mx-auto w-full max-w-lg space-y-5 pb-24">
          <SheetHeader className="text-left">
            <SheetTitle>Your boundaries</SheetTitle>
            <SheetDescription>Calls only ever land inside these. Nothing already booked moves.</SheetDescription>
          </SheetHeader>

          <Field label="How times are picked">
            <div className="grid gap-2">
              {(["manual", "assisted", "auto"] as AvailabilityMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={s.mode === m}
                  onClick={() => set("mode", m)}
                  className={cn("rounded-xl border p-3 text-left", s.mode === m ? "border-foreground" : "border-border")}
                >
                  <span className="block text-sm font-semibold">{MODE_COPY[m].label}</span>
                  <span className="block text-[13px] text-muted-foreground">{MODE_COPY[m].line}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Days calls can be on">
            <ChipRow options={WEEKDAY_CHOICES.map((d) => ({ value: d.dow, label: d.label }))} isOn={(d) => s.days.includes(d)} onPick={toggleDay} label="Days" />
          </Field>

          <Field label="Earliest and latest">
            <div className="flex items-center gap-2">
              <TimeSelect value={s.dayStart} onChange={(v) => set("dayStart", v)} label="Earliest" />
              <span className="text-muted-foreground">to</span>
              <TimeSelect value={s.dayEnd} onChange={(v) => set("dayEnd", v)} label="Latest" />
            </div>
          </Field>

          <Field label="Calls a day at most">
            <ChipRow
              options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })).concat([{ value: 0, label: "No limit" }])}
              isOn={(n) => (s.maxPerDay ?? 0) === n}
              onPick={(n) => set("maxPerDay", n || null)}
              label="Calls a day"
            />
          </Field>

          <Field label="Clear time around each call">
            <ChipRow
              options={[0, 10, 15, 30].map((n) => ({ value: n, label: n ? `${n} min` : "None" }))}
              isOn={(n) => s.gapMin === n}
              onPick={(n) => set("gapMin", n)}
              label="Gap"
            />
          </Field>

          <Field label="Protected time" hint="Never offered: training, family, focus.">
            <ul className="space-y-1.5">
              {s.protected.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p.label}</span>{" "}
                    <span className="text-muted-foreground">
                      {WEEKDAY_CHOICES.filter((d) => p.days.includes(d.dow)).map((d) => d.label).join(", ")} · {rangeLabel(p.start, p.end)}
                    </span>
                  </span>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Remove ${p.label}`} onClick={() => set("protected", s.protected.filter((x) => x.id !== p.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            {habits.length > 0 && (
              <div className="mt-2 space-y-1.5" data-availability-habits>
                <p className="text-[12px] text-muted-foreground">From your calendar (times only):</p>
                {habits.map((h) => (
                  <div key={h.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1">{h.text}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => set("protected", [...s.protected, { id: crypto.randomUUID(), label: "Personal", kind: "personal", days: h.days, start: h.start, end: h.end }])}
                    >
                      Protect
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => set("dismissed", [...s.dismissed, h.key])}>
                      Not a habit
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {adding ? (
              <div className="mt-2 space-y-2 rounded-xl border border-border p-3">
                <ChipRow
                  options={(["training", "personal", "focus"] as ProtectedKind[]).map((k) => ({ value: k, label: PROTECTED_LABEL[k] }))}
                  isOn={(k) => adding.kind === k}
                  onPick={(k) => setAdding({ ...adding, kind: k, label: PROTECTED_LABEL[k] })}
                  label="What it's for"
                />
                <ChipRow
                  options={WEEKDAY_CHOICES.map((d) => ({ value: d.dow, label: d.label }))}
                  isOn={(d) => adding.days.includes(d)}
                  onPick={(d) => setAdding({ ...adding, days: adding.days.includes(d) ? adding.days.filter((x) => x !== d) : [...adding.days, d] })}
                  label="Days"
                />
                <div className="flex items-center gap-2">
                  <TimeSelect value={adding.start} onChange={(v) => setAdding({ ...adding, start: v })} label="From" />
                  <span className="text-muted-foreground">to</span>
                  <TimeSelect value={adding.end} onChange={(v) => setAdding({ ...adding, end: v })} label="To" />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="h-10"
                    disabled={!adding.days.length || adding.end <= adding.start}
                    onClick={() => {
                      set("protected", [...s.protected, { id: crypto.randomUUID(), ...adding }]);
                      setAdding(null);
                    }}
                  >
                    Add
                  </Button>
                  <Button variant="ghost" className="h-10" onClick={() => setAdding(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="mt-1 h-10 px-2" onClick={() => setAdding({ label: "Training", kind: "training", days: [...s.days], start: "13:00", end: "15:00" })}>
                <Plus className="mr-1.5 h-4 w-4" /> Add protected time
              </Button>
            )}
          </Field>

          <Field label="Away" hint="Whole days with no calls (vacation, meets).">
            <ul className="space-y-1.5">
              {s.away.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {a.label ? <span className="font-medium">{a.label} </span> : null}
                    <span className="text-muted-foreground">{a.from === a.to ? shortDayLabel(a.from) : `${shortDayLabel(a.from)} – ${shortDayLabel(a.to)}`}</span>
                  </span>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove" onClick={() => set("away", s.away.filter((x) => x.id !== a.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            {away ? (
              <div className="mt-2 space-y-2 rounded-xl border border-border p-3">
                <Input value={away.label} placeholder="What for (optional)" onChange={(e) => setAway({ ...away, label: e.target.value })} className="h-10 text-base" />
                <div className="flex items-center gap-2">
                  <Input type="date" value={away.from} onChange={(e) => setAway({ ...away, from: e.target.value, to: away.to < e.target.value ? e.target.value : away.to })} className="h-10" aria-label="From" />
                  <span className="text-muted-foreground">to</span>
                  <Input type="date" value={away.to} min={away.from} onChange={(e) => setAway({ ...away, to: e.target.value })} className="h-10" aria-label="To" />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="h-10"
                    disabled={!away.from || !away.to}
                    onClick={() => {
                      set("away", [...s.away, { id: crypto.randomUUID(), from: away.from, to: away.to, label: away.label.trim() || null }]);
                      setAway(null);
                    }}
                  >
                    Add
                  </Button>
                  <Button variant="ghost" className="h-10" onClick={() => setAway(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="mt-1 h-10 px-2" onClick={() => setAway({ from: deviceTodayISO(), to: deviceTodayISO(), label: "" })}>
                <Plus className="mr-1.5 h-4 w-4" /> Add days away
              </Button>
            )}
          </Field>

          <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
            <CollapsibleTrigger className="flex h-10 w-full items-center justify-between text-sm font-medium">
              More settings
              <ChevronDown className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-5 pt-2">
              <Field label="Calls a week at most">
                <ChipRow
                  options={[5, 8, 10, 15, 20].map((n) => ({ value: n, label: String(n) })).concat([{ value: 0, label: "No limit" }])}
                  isOn={(n) => (s.maxPerWeek ?? 0) === n}
                  onPick={(n) => set("maxPerWeek", n || null)}
                  label="Calls a week"
                />
              </Field>
              <Field label="Notice they need to give">
                <ChipRow
                  options={[2, 4, 12, 24, 48].map((n) => ({ value: n, label: n < 24 ? `${n} h` : `${n / 24} day${n === 24 ? "" : "s"}` }))}
                  isOn={(n) => s.minNoticeHours === n}
                  onPick={(n) => set("minNoticeHours", n)}
                  label="Notice"
                />
                <label className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span>Allow bookings for today and tomorrow</span>
                  <Switch checked={s.lastMinute} onCheckedChange={(v) => set("lastMinute", v)} />
                </label>
              </Field>
              <Field label="How far ahead">
                <ChipRow
                  options={[14, 30, 60, 90].map((n) => ({ value: n, label: n === 14 ? "2 weeks" : n === 30 ? "1 month" : `${n / 30} months` }))}
                  isOn={(n) => s.maxAdvanceDays === n}
                  onPick={(n) => set("maxAdvanceDays", n)}
                  label="How far ahead"
                />
              </Field>
              <Field label="Calls go here first when there's a choice" hint="Optional. Leave it off and calls go next to what's already on.">
                <label className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span>Preferred time</span>
                  <Switch
                    checked={!!s.preferredStart}
                    onCheckedChange={(v) => setS((x) => ({ ...x, preferredStart: v ? "13:00" : null, preferredEnd: v ? "16:00" : null }))}
                  />
                </label>
                {s.preferredStart && (
                  <div className="flex items-center gap-2">
                    <TimeSelect value={s.preferredStart} onChange={(v) => set("preferredStart", v)} label="Preferred from" />
                    <span className="text-muted-foreground">to</span>
                    <TimeSelect value={s.preferredEnd ?? "16:00"} onChange={(v) => set("preferredEnd", v)} label="Preferred to" />
                  </div>
                )}
              </Field>
              <Field label="Keep clear for focused work" hint="A stretch at least this long isn't filled with calls; one block of calls goes at its edge.">
                <ChipRow
                  options={[60, 90, 120, 180].map((n) => ({ value: n, label: n % 60 ? `${n / 60} h` : `${n / 60} h` }))}
                  isOn={(n) => s.focusMin === n}
                  onPick={(n) => set("focusMin", n)}
                  label="Focus time"
                />
              </Field>
              <Field label="One block of calls is">
                <ChipRow
                  options={[60, 90, 120, 180].map((n) => ({ value: n, label: `${n / 60} h` }))}
                  isOn={(n) => s.callBlockMin === n}
                  onPick={(n) => set("callBlockMin", n)}
                  label="Call block"
                />
              </Field>
              <Field label="Keep at least this many call times open a week" hint="For new people booking intro calls. Opens the next best time, never your protected time.">
                <ChipRow
                  options={[0, 4, 6, 10].map((n) => ({ value: n, label: n ? String(n) : "Off" }))}
                  isOn={(n) => s.weeklyFloor === n}
                  onPick={(n) => set("weeklyFloor", n)}
                  label="Weekly floor"
                />
                <label className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span>Open more when a week fills up</span>
                  <Switch checked={s.stretch} onCheckedChange={(v) => set("stretch", v)} />
                </label>
              </Field>
              <Field label="Other Google calendars that block calls" hint="Your app calendar and main calendar always do.">
                {calendars.isLoading ? (
                  <p className="text-[13px] text-muted-foreground">Loading…</p>
                ) : (calendars.data ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No other calendars found.</p>
                ) : (
                  <ul className="space-y-1">
                    {(calendars.data ?? [])
                      .filter((c) => !c.primary)
                      .map((c) => (
                        <li key={c.id}>
                          <label className="flex items-center justify-between gap-3 py-1 text-sm">
                            <span className="truncate">{c.name}</span>
                            <Switch
                              checked={s.extraCalendars.includes(c.id)}
                              onCheckedChange={(v) => set("extraCalendars", v ? [...s.extraCalendars, c.id] : s.extraCalendars.filter((x) => x !== c.id))}
                            />
                          </label>
                        </li>
                      ))}
                  </ul>
                )}
              </Field>
              <Button variant="ghost" className="h-10 px-2" onClick={() => setS((x) => ({ ...x, learningSince: new Date().toISOString(), dismissed: [] }))}>
                Forget what it learned from my changes
              </Button>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="sticky bottom-0 -mx-6 border-t border-border bg-background px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-lg gap-2">
            <Button
              className="h-11 flex-1"
              disabled={saving || !s.days.length}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(s);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {settings.confirmedAt ? "Save" : "Save boundaries"}
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
