import { useEffect, useMemo, useRef, useState } from "react";
import { SlowLoadHint } from "@/components/slow-load-hint";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { bookOnline, getBookingPage, getBookingSlots } from "@/lib/booking.functions";
import { inviteStateMessage, type InviteState } from "@/lib/booking-invite";
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
  /** The length the coach picked when he sent the link (minutes); it's set, not a choice. */
  duration?: number | null;
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
/** "CST", "GMT+1": the zone a time is in, short, for beside a time. */
function zoneShort(tz: string, at: Date = new Date()): string {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
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
 * The booking page: pick a day, pick a time, confirm. Who's booking is the
 * server's call (getBookingPage): signed in as a client, or the coach's
 * personal link (/b/<token>), they book as themselves with no form and no
 * sign-in; anyone else fills in a name and email. Times show in the visitor's
 * own time zone, labelled.
 */
export function BookingPage({
  slug: givenSlug,
  prefill,
  preview = false,
}: {
  /** null on a personal link (/b/<token>): the link names its type. */
  slug: string | null;
  prefill: Prefill;
  /** The coach's View as client: everything shows, nothing books. */
  preview?: boolean;
}) {
  const qc = useQueryClient();
  const pageFn = useServerFn(getBookingPage);
  const slotsFn = useServerFn(getBookingSlots);
  const bookFn = useServerFn(bookOnline);

  // Time zone and "today" only exist in the browser.
  const [tz, setTz] = useState<string | null>(null);
  useEffect(() => setTz(deviceTz()), []);
  const today = tz ? localDateISO(new Date(), tz) : null;

  // Who's signed in on this device (the server decides what that means for this page).
  const { data: viewerId, isFetched: viewerChecked } = useQuery({
    queryKey: ["booking-viewer"],
    retry: false,
    staleTime: 30_000,
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  });
  // Signed in as the link's own client with its booking standing: "Book another time" books as them without it.
  const [skipInvite, setSkipInvite] = useState(false);
  const invite = skipInvite ? null : prefill.invite || null;

  const { data: page, isLoading: pageLoading } = useQuery({
    queryKey: ["booking-page", givenSlug, invite, viewerId ?? null, prefill.applicationId || null],
    enabled: viewerChecked,
    queryFn: () => pageFn({ data: { slug: givenSlug, invite, applicationId: prefill.applicationId || null } }),
    staleTime: 30_000,
  });
  const slug = page?.slug ?? givenSlug ?? "";
  const who = page?.who ?? null;

  // How long: the coach's pick for his link (fixed), else theirs from the type's lengths.
  const options = page?.durationOptions ?? [];
  const wanted = page?.fixedDuration ?? prefill.duration ?? null;
  const coachLength = wanted && options.includes(wanted) ? wanted : null;
  const [picked, setPicked] = useState<number | null>(null);
  const duration = coachLength ?? (picked && options.includes(picked) ? picked : page?.durationMin ?? null);
  const choosesLength = !coachLength && options.length > 1;

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
    queryKey: ["booking-slots", slug, month, duration],
    // A clients-only type shows its times only to someone who can book it; a link that can't book shows none.
    enabled:
      !!page && !!slug && !!month && page.hasHours && !!duration && !page.linkState && (!page.clientsOnly || !!who?.canBook),
    staleTime: 30_000,
    queryFn: () =>
      slotsFn({
        data: {
          slug,
          from: addDaysISO(monthStart(month!), -1),
          to: addDaysISO(monthEnd(month!), 1),
          duration,
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

  const book = useMutation({
    mutationFn: async () => {
      if (!slot) throw new Error("Pick a time first.");
      if (preview) throw new Error("Preview only: they confirm it here.");
      // The server works out who it's for again; the page's view of it is never trusted.
      return (await bookFn({
        data: {
          slug,
          start: slot.start,
          name: who ? null : form.name,
          email: who ? null : form.email,
          phone: who ? null : form.phone || null,
          notes: form.notes || null,
          applicationId: prefill.applicationId || null,
          invite,
          duration,
        },
      })) as Result;
    },
    onSuccess: (r) => {
      setResult(r);
      setStep("done");
      // The link now has its booking and that time is gone: never show the old state again.
      void qc.invalidateQueries({ queryKey: ["booking-page"] });
      void qc.invalidateQueries({ queryKey: ["booking-slots"] });
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

  if (pageLoading || !tz || !viewerChecked) {
    return (
      <Shell>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
          <span className="flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</span>
          <SlowLoadHint />
        </div>
      </Shell>
    );
  }
  if (!page) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-8 text-center" data-booking-unavailable>
          <h1 className="text-lg font-semibold">
            {invite ? "This booking link isn't working" : "This booking page isn't taking bookings right now"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {invite ? "Check you have the whole link, or ask your coach for a new one." : "Message your coach for a new link."}
          </p>
        </div>
      </Shell>
    );
  }

  const coachTz = page.timezone;
  const sameZone = coachTz === tz;
  // "Ask Jared for a new one" (never "Ask JF", when no coach is named).
  const coachFirst = page.hostName && page.hostName !== "JF Effect" ? page.hostName.trim().split(/\s+/)[0] : "";
  const signInLink = (
    <Button asChild className="h-11 font-semibold">
      <Link to="/auth" search={{ next: typeof window !== "undefined" ? window.location.pathname : `/book/${slug}` }}>
        Sign in
      </Link>
    </Button>
  );
  const header = (
    <div className="space-y-3 border-b border-border p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {page.hostName}
        </span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{page.name}</h1>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4" /> {duration ?? page.durationMin} min
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

  // ── A personal link that can't book ──────────────────────────────────────────
  // Run out, cancelled or not a link: say so, with Sign in (signed in as a client, the
  // server would already have booked them as themselves and there'd be no state here).
  const linkSaid = page.linkState && page.linkState !== "booked" ? inviteStateMessage(page.linkState as InviteState, coachFirst) : null;
  if (linkSaid) {
    return (
      <Shell>
        <div className="overflow-hidden rounded-2xl border border-border bg-card" data-booking-link-state={page.linkState}>
          {header}
          <div className="space-y-3 p-5 sm:p-6">
            <p className="text-[15px] font-semibold">{linkSaid.title}</p>
            <p className="text-sm text-muted-foreground">{linkSaid.body}</p>
            <div className="flex flex-col gap-2 sm:flex-row">{signInLink}</div>
          </div>
        </div>
      </Shell>
    );
  }

  // ── The link already has its booking ───────────────────────────────────────
  if (page.linkState === "booked") {
    const b = page.booked;
    const at = b ? new Date(b.start) : null;
    return (
      <Shell>
        <div className="overflow-hidden rounded-2xl border border-border bg-card" data-booking-link-state="booked">
          {header}
          <div className="space-y-4 p-5 sm:p-6">
            <div>
              <p className="text-[15px] font-semibold">{b?.done ? "You had this one" : "You're booked"}</p>
              {at && b && (
                <p className="mt-1 text-sm" data-booking-booked-when>
                  {longDay(localDateISO(at, tz))} · {clockIn(b.start, tz)} – {clockIn(b.end, tz)} {zoneShort(tz, at)}
                </p>
              )}
              <p className="mt-2 text-sm text-muted-foreground">
                {b?.done
                  ? `Need another? Ask ${coachFirst || "your coach"} for a new link.`
                  : "Change or cancel it in your JF Effect app."}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="h-11 font-semibold">
                <Link to="/portal/calendar">Open the app</Link>
              </Button>
              {who?.signedIn && (
                <Button variant="outline" className="h-11" onClick={() => setSkipInvite(true)}>
                  Book another time
                </Button>
              )}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Clients only (General Call) ─────────────────────────────────────────────
  // Signed in as a coaching client, or the coach's personal link for one. Anyone
  // else is told who it's for instead of picking a time it would refuse.
  if (page.clientsOnly && !who?.canBook) {
    return (
      <Shell>
        <div className="overflow-hidden rounded-2xl border border-border bg-card" data-booking-clients-only>
          {header}
          <div className="space-y-3 p-5 sm:p-6">
            <p className="text-[15px] font-semibold">For JF Effect coaching clients</p>
            <p className="text-sm text-muted-foreground">
              {who && page.includedCall
                ? "This call is included with a coaching package your account isn't on. Message your coach if you'd like it added."
                : who
                  ? "Your account doesn't include calls with a coach. Coaching does: a coach, a program written for you, and calls like this one."
                  : "Sign in with your client account to pick a time."}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {!who && signInLink}
              {!(who && page.includedCall) && (
                <Button asChild variant="outline" className="h-11">
                  <Link to="/coaching/apply">Apply for coaching</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

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
              <h1 className="text-2xl font-bold tracking-tight">You're booked</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.kind === "session"
                  ? page.isCall
                    ? "It's in your JF Effect app, and your coach has it in your chat."
                    : "It's in your JF Effect app, with a reminder text the evening before."
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
                {clockIn(result.end, tz)} {zoneShort(tz, start)}
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
              <Button asChild className="h-12 w-full max-w-sm bg-primary font-semibold">
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
                <Link to="/portal/calendar">See it in your calendar</Link>
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
            <div className="rounded-xl bg-muted p-4" data-booking-confirm-time>
              <div className="text-lg font-semibold">
                {longDay(localDateISO(new Date(slot.start), tz))}
              </div>
              <div className="text-sm text-foreground/90">
                {clockIn(slot.start, tz)} – {clockIn(slot.end, tz)} {zoneShort(tz, new Date(slot.start))}
              </div>
              {who && (
                <div className="mt-2 text-sm text-muted-foreground" data-booking-as>
                  Booking as <span className="font-semibold text-foreground">{who.firstName}</span>
                </div>
              )}
            </div>

            {who ? null : (
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
                <Label htmlFor="b-notes">
                  {page.isCall ? "What do you want to talk about? (optional)" : "Anything to share? (optional)"}
                </Label>
                <Textarea
                  id="b-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            )}
            {preview && (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground" data-booking-preview>
                Preview: this is what they see. Only they can confirm it.
              </p>
            )}
            <Button
              className="h-12 w-full bg-primary text-base font-semibold"
              disabled={!valid || book.isPending || preview}
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
    <Shell back={who?.signedIn ? "/portal/calendar" : null}>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {header}
        {!who && !invite && page.usesCredit && (
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
        {choosesLength && page.hasHours && (
          <div className="space-y-2 border-b border-border px-5 py-4 sm:px-6" data-booking-length>
            <h2 className="text-sm font-semibold">How long do you need?</h2>
            <div
              className={cn("grid gap-2", options.length === 4 ? "grid-cols-4" : "grid-cols-3")}
              role="radiogroup"
              aria-label="Call length"
            >
              {options.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={duration === n}
                  onClick={() => {
                    if (duration === n) return;
                    setPicked(n);
                    setSlot(null);
                  }}
                  className={cn(
                    "h-11 rounded-full border px-2 text-sm font-semibold tabular-nums transition",
                    duration === n
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-foreground hover:bg-secondary",
                  )}
                >
                  {n} min
                </button>
              ))}
            </div>
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
                          ? "bg-primary font-bold text-primary-foreground"
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
