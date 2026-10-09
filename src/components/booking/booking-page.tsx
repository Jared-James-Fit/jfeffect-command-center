import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Ticket,
  Video,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  bookOnline,
  bookOnlineAsMe,
  getBookingPage,
  getBookingSlots,
  getMyBookingIdentity,
} from "@/lib/booking.functions";
import { googleCalendarLink, icsDataLink, outlookCalendarLink } from "@/lib/add-to-calendar";
import { addDaysISO, localDateISO } from "@/lib/schedule-time";
import type { Slot } from "@/lib/booking-slots";
import { cn } from "@/lib/utils";

type Prefill = {
  name: string;
  email: string;
  phone: string;
  applicationId: string;
  invite: string;
};
type Result = {
  kind: "session" | "appointment";
  start: string;
  end: string;
  title: string;
  where: string;
  meetLink: string | null;
  durationMin: number;
  usedCredit?: boolean;
  noCreditLeft?: boolean;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Winnipeg";
  } catch {
    return "America/Winnipeg";
  }
}
function zoneName(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: "long" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? tz
    );
  } catch {
    return tz;
  }
}
function monthKey(dateISO: string) {
  return dateISO.slice(0, 7);
}
function monthStart(key: string) {
  return `${key}-01`;
}
function monthEnd(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function shiftMonth(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}
function longDay(dateISO: string) {
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
function clockIn(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

function WhereIcon({ mode, className }: { mode: string; className?: string }) {
  if (mode === "video") return <Video className={className} />;
  if (mode === "phone") return <Phone className={className} />;
  return <MapPin className={className} />;
}

/**
 * The booking page: pick a day, pick a time, confirm. Signed-in clients skip
 * the form entirely. Times show in the visitor's own time zone.
 */
export function BookingPage({ slug, prefill }: { slug: string; prefill: Prefill }) {
  const pageFn = useServerFn(getBookingPage);
  const slotsFn = useServerFn(getBookingSlots);
  const bookFn = useServerFn(bookOnline);
  const bookMeFn = useServerFn(bookOnlineAsMe);
  const meFn = useServerFn(getMyBookingIdentity);

  // Time zone and "today" only exist in the browser.
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => setTz(deviceTz()), []);
  const today = tz ? localDateISO(new Date(), tz) : null;

  const { data: page, isLoading: pageLoading } = useQuery({
    queryKey: ["booking-page", slug, prefill.invite],
    queryFn: () => pageFn({ data: { slug, invite: prefill.invite || null } }),
    staleTime: 60_000,
  });

  // Signed in as a client? Then they book as themselves, no form.
  const { data: me } = useQuery({
    queryKey: ["booking-me"],
    enabled: !!tz,
    retry: false,
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      try {
        return await meFn();
      } catch {
        return null;
      }
    },
  });

  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    if (today && !month) setMonth(monthKey(today));
  }, [today, month]);

  const lastDay = today && page ? addDaysISO(today, page.maxAdvanceDays) : null;
  const {
    data: slotData,
    isFetching: slotsLoading,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ["booking-slots", slug, month],
    enabled: !!page && !!month && page.hasHours,
    staleTime: 30_000,
    queryFn: () =>
      slotsFn({
        data: {
          slug,
          from: addDaysISO(monthStart(month!), -1),
          to: addDaysISO(monthEnd(month!), 1),
        },
      }),
  });

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    if (!tz) return m;
    for (const s of (slotData?.slots ?? []) as Slot[]) {
      const d = localDateISO(new Date(s.start), tz);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(s);
    }
    return m;
  }, [slotData, tz]);

  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<"pick" | "details" | "done">("pick");
  const [form, setForm] = useState({
    name: prefill.name,
    email: prefill.email,
    phone: prefill.phone,
    notes: "",
  });
  const [result, setResult] = useState<Result | null>(null);
  const advanced = useRef(false);

  // Land on the first open day; if this month is full, look at next month once.
  useEffect(() => {
    if (!month || slotsLoading || !slotData) return;
    const days = Array.from(byDay.keys())
      .filter((d) => monthKey(d) === month)
      .sort();
    if (days.length) {
      if (!day || monthKey(day) !== month || !byDay.has(day)) setDay(days[0]);
    } else if (!advanced.current && lastDay && monthStart(shiftMonth(month, 1)) <= lastDay) {
      advanced.current = true;
      setMonth(shiftMonth(month, 1));
    }
  }, [byDay, month, slotData, slotsLoading, day, lastDay]);

  // Who's booking, when we know: signed in as a client, or a personal link from the coach.
  const who = me
    ? { name: me.name || me.email }
    : page?.invitee
      ? { name: page.invitee.firstName }
      : null;

  const book = useMutation({
    mutationFn: async () => {
      if (!slot) throw new Error("Pick a time first.");
      if (me)
        return (await bookMeFn({
          data: { slug, start: slot.start, notes: form.notes || null },
        })) as Result;
      return (await bookFn({
        data: {
          slug,
          start: slot.start,
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          notes: form.notes || null,
          applicationId: prefill.applicationId || null,
          invite: prefill.invite || null,
        },
      })) as Result;
    },
    onSuccess: (r) => {
      setResult(r);
      setStep("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: any) => {
      const msg = e?.message ?? "Couldn't book that. Try another time.";
      toast.error(msg);
      if (/taken|pick another/i.test(msg)) {
        setSlot(null);
        setStep("pick");
        refetchSlots();
      }
    },
  });

  if (pageLoading || !tz) {
    return (
      <Shell>
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }
  if (!page) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-bold">This booking page isn't taking bookings right now</h1>
          <p className="mt-2 text-sm text-muted-foreground">Message your coach for a new link.</p>
        </div>
      </Shell>
    );
  }

  const coachTz = page.timezone;
  const sameZone = coachTz === tz;
  const header = (
    <div className="space-y-3 border-b border-border p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {page.hostName}
        </span>
      </div>
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{page.name}</h1>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4" /> {page.durationMin} min
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <WhereIcon mode={page.locationMode} className="h-4 w-4 shrink-0" />{" "}
          <span className="truncate">{page.where}</span>
        </span>
        {who && page.usesCredit && (
          <span className="inline-flex items-center gap-1.5 text-primary">
            <Ticket className="h-4 w-4" /> Uses 1 session from your package
          </span>
        )}
      </div>
      {page.description && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">
          {page.description}
        </p>
      )}
    </div>
  );

  // ── Done ──────────────────────────────────────────────────────────────────
  if (step === "done" && result) {
    const start = new Date(result.start);
    const end = new Date(result.end);
    const event = {
      uid: `booking-${result.start}@jfeffect.com`,
      title: page.name,
      start,
      end,
      location: result.meetLink || result.where,
      details: result.meetLink ? `Join: ${result.meetLink}` : null,
    };
    return (
      <Shell>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="space-y-4 p-6 text-center sm:p-8">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">You're booked</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.kind === "session"
                  ? "It's in your JF Effect app, with a reminder text the evening before."
                  : "Check your email for the calendar invite."}
              </p>
            </div>
            <div className="mx-auto max-w-sm space-y-2 rounded-xl border border-border bg-secondary/30 p-4 text-left text-sm">
              <div className="font-bold">{page.name}</div>
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-muted-foreground" />{" "}
                {longDay(localDateISO(start, tz))}
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" /> {clockIn(result.start, tz)} –{" "}
                {clockIn(result.end, tz)}
              </div>
              <div className="flex items-center gap-2">
                <WhereIcon
                  mode={page.locationMode}
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />{" "}
                <span className="min-w-0 break-words">{result.where}</span>
              </div>
            </div>
            {result.noCreditLeft && (
              <p className="mx-auto max-w-sm rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs text-amber-500">
                You're out of prepaid sessions, so this one isn't covered yet. Your coach has been
                told and will sort it with you.
              </p>
            )}
            {result.meetLink && (
              <Button asChild className="h-12 w-full max-w-sm bg-gradient-primary font-bold">
                <a href={result.meetLink} target="_blank" rel="noreferrer">
                  <Video className="mr-2 h-4 w-4" /> Video call link
                </a>
              </Button>
            )}
            {result.kind === "session" && (
              <Button
                asChild
                className="h-12 w-full max-w-sm font-bold"
                variant={result.meetLink ? "outline" : "default"}
              >
                <Link to="/portal/calendar">See it in your schedule</Link>
              </Button>
            )}
            <div className="mx-auto max-w-sm space-y-2 pt-2">
              <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Add to your calendar
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button asChild variant="outline" className="h-11 text-xs font-bold">
                  <a href={googleCalendarLink(event)} target="_blank" rel="noreferrer">
                    Google
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-11 text-xs font-bold">
                  <a href={icsDataLink(event)} download="booking.ics">
                    Apple
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-11 text-xs font-bold">
                  <a href={outlookCalendarLink(event)} target="_blank" rel="noreferrer">
                    Outlook
                  </a>
                </Button>
              </div>
              {result.kind === "session" && (
                <Link
                  to="/portal/calendar"
                  className="block text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  Or sync every session to your phone calendar automatically
                </Link>
              )}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Details ───────────────────────────────────────────────────────────────
  if (step === "details" && slot) {
    const needPhone = page.locationMode === "phone";
    const valid = who
      ? true
      : form.name.trim().length > 0 &&
        /\S+@\S+\.\S+/.test(form.email) &&
        (!needPhone || form.phone.trim().length >= 7);
    return (
      <Shell>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {header}
          <div className="space-y-4 p-5 sm:p-6">
            <button
              type="button"
              onClick={() => setStep("pick")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Change time
            </button>
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-4">
              <div className="text-lg font-black">
                {longDay(localDateISO(new Date(slot.start), tz))}
              </div>
              <div className="text-sm font-semibold text-foreground/90">
                {clockIn(slot.start, tz)} – {clockIn(slot.end, tz)}
              </div>
            </div>

            {who ? (
              <div className="rounded-xl border border-border bg-secondary/30 p-3 text-sm">
                <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Booking as
                </div>
                <div className="font-bold">{who.name}</div>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="b-name">Your name</Label>
                  <Input
                    id="b-name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="b-email">Email</Label>
                  <Input
                    id="b-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="h-11"
                  />
                </div>
                {(page.collectPhone || needPhone) && (
                  <div className="space-y-1.5">
                    <Label htmlFor="b-phone">
                      {needPhone ? "Phone (we'll call you)" : "Phone (for a reminder text)"}
                    </Label>
                    <Input
                      id="b-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="h-11"
                    />
                  </div>
                )}
              </div>
            )}
            {page.collectNotes && (
              <div className="space-y-1.5">
                <Label htmlFor="b-notes">Anything to share? (optional)</Label>
                <Textarea
                  id="b-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            )}
            <Button
              className="h-12 w-full bg-gradient-primary text-base font-black"
              disabled={!valid || book.isPending}
              onClick={() => book.mutate()}
            >
              {book.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Booking…
                </>
              ) : (
                "Confirm booking"
              )}
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Pick a day and time ───────────────────────────────────────────────────
  const m = month ?? monthKey(today!);
  const first = monthStart(m);
  const lead = new Date(`${first}T12:00:00Z`).getUTCDay();
  const daysInMonth = Number(monthEnd(m).slice(8, 10));
  const cells: Array<string | null> = [
    ...Array(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDaysISO(first, i)),
  ];
  const canPrev = m > monthKey(today!);
  const canNext = !!lastDay && monthStart(shiftMonth(m, 1)) <= lastDay;
  const times = day ? (byDay.get(day) ?? []) : [];
  const monthLabel = new Date(`${first}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthHasSlots = Array.from(byDay.keys()).some((d) => monthKey(d) === m);
  const error = slotData?.error;

  return (
    <Shell back={me ? "/portal/calendar" : null}>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {header}
        {!who && page.usesCredit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/5 px-5 py-3 text-xs sm:px-6">
            <span className="text-foreground/85">
              Already training with us? Sign in so it comes off your sessions.
            </span>
            <Link
              to="/auth"
              search={{ next: `/book/${slug}` }}
              className="font-bold text-primary underline-offset-2 hover:underline"
            >
              Sign in
            </Link>
          </div>
        )}
        {!page.hasHours ? (
          <p className="p-6 text-sm text-muted-foreground">
            No times are open right now. Check back soon.
          </p>
        ) : (
          <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
            {/* Month */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold">{monthLabel}</h2>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10"
                    disabled={!canPrev}
                    onClick={() => setMonth(shiftMonth(m, -1))}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10"
                    disabled={!canNext}
                    onClick={() => setMonth(shiftMonth(m, 1))}
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    {w}
                  </div>
                ))}
                {cells.map((d, i) => {
                  if (!d) return <div key={`b${i}`} />;
                  const open = byDay.has(d);
                  const selected = d === day;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={!open}
                      onClick={() => {
                        setDay(d);
                        setSlot(null);
                      }}
                      aria-label={`${longDay(d)}${open ? ", times available" : ""}`}
                      aria-pressed={selected}
                      className={cn(
                        "mx-auto grid aspect-square w-full max-w-11 place-items-center rounded-full text-sm tabular-nums transition",
                        selected
                          ? "bg-primary font-black text-primary-foreground"
                          : open
                            ? "bg-primary/15 font-bold text-primary hover:bg-primary/25"
                            : "text-muted-foreground/45",
                        d === today && !selected && "ring-1 ring-primary/50",
                      )}
                    >
                      {Number(d.slice(8, 10))}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Times in {zoneName(tz)}
                  {sameZone ? "" : ` (your time zone). Your coach is on ${zoneName(coachTz)}.`}
                </span>
              </div>
            </div>

            {/* Times */}
            <div className="min-w-0">
              {slotsLoading && !slotData ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Finding open times…
                </div>
              ) : error === "calendar_unavailable" ? (
                <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                  <p>
                    We couldn't check the calendar just now, so no times are shown (to keep anything
                    from double booking).
                  </p>
                  <Button size="sm" variant="outline" onClick={() => refetchSlots()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
                  </Button>
                </div>
              ) : !monthHasSlots ? (
                <div className="space-y-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <p>No open times in {monthLabel.split(" ")[0]}.</p>
                  {canNext && (
                    <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(m, 1))}>
                      Next month <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ) : day ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-bold">{longDay(day)}</h3>
                  <div className="grid max-h-[24rem] grid-cols-2 gap-2 overflow-y-auto pr-0.5 md:grid-cols-1">
                    {times.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => {
                          setSlot(s);
                          setStep("details");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="h-12 rounded-xl border border-primary/40 text-sm font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
                      >
                        {clockIn(s.start, tz)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children, back }: { children: React.ReactNode; back?: string | null }) {
  return (
    <div className="min-h-[100dvh] bg-background px-3 py-5 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        {back && (
          <Link
            to={back as any}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the app
          </Link>
        )}
        {children}
        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          <CalendarPlus className="mr-1 inline h-3 w-3" /> Booked times sync to your coach's
          calendar instantly.
        </p>
      </div>
    </div>
  );
}
