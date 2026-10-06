import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { Block, PrimaryCta } from "@/components/sales/apple";
import {
  ArrowLeft, CheckCircle2, CalendarClock, Loader2, Clock, Video,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitCoachingApplication } from "@/lib/coaching-applications.functions";
import {
  computeAvailableSlots, bookSlotPublic, getBookingLinkPublic,
} from "@/lib/booking-links.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/coaching/apply")({
  component: SimpleQuickApply,
  head: () => ({
    meta: [
      { title: "Apply for JF Effect Coaching — 30–60 seconds" },
      { name: "description", content: "Tell us who you are, what you want, and when you want to start." },
      { property: "og:title", content: "Apply for JF Effect Coaching" },
      { property: "og:description", content: "Tell us who you are, what you want, and when you want to start." },
    ],
  }),
});

/* ────────────────── data ────────────────── */

const SIMPLE_GOALS = [
  { v: "powerlifting", l: "Powerlifting" },
  { v: "fat_loss", l: "Fat Loss" },
  { v: "build_muscle", l: "Build Muscle" },
  { v: "general_fitness", l: "General Fitness" },
  { v: "other", l: "Other" },
] as const;
const SIMPLE_TIMELINES = [
  { v: "asap", l: "ASAP" },
  { v: "this_month", l: "This Month" },
  { v: "one_three_months", l: "Next 1–3 Months" },
  { v: "exploring", l: "Just Exploring" },
] as const;

type SimpleFormState = {
  full_name: string; email: string; phone: string; instagram: string;
  main_goal: string; target_outcome: string; timeline: string;
  honeypot: string; source_page: string;
};
const EMPTY_SIMPLE_FORM: SimpleFormState = {
  full_name: "", email: "", phone: "", instagram: "", main_goal: "", target_outcome: "", timeline: "", honeypot: "", source_page: "",
};

function SimpleQuickApply() {
  const submit = useServerFn(submitCoachingApplication);
  const [form, setForm] = useState<SimpleFormState>(EMPTY_SIMPLE_FORM);
  const [result, setResult] = useState<Awaited<ReturnType<typeof submit>> | null>(null);
  const set = <K extends keyof SimpleFormState>(key: K, value: SimpleFormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    set("source_page", params.get("from") || "coaching_apply");
  }, []);

  const checks: Array<[string, boolean]> = [
    ["name", form.full_name.trim().length >= 2],
    ["email", /.+@.+\..+/.test(form.email.trim())],
    ["phone", /^[\d\s+\-()]{7,}$/.test(form.phone.trim())],
    ["Instagram", /^@?[A-Za-z0-9._]{1,30}$/.test(form.instagram.trim())],
    ["goal", !!form.main_goal],
    ["result", form.target_outcome.trim().length > 0],
    ["start date", !!form.timeline],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  const done = checks.length - missing.length;
  const valid = checks.every(([, ok]) => ok);

  const mutation = useMutation({
    mutationFn: () => submit({ data: {
      ...form,
      page_url: typeof window !== "undefined" ? window.location.href : "",
      referrer: typeof document !== "undefined" ? document.referrer : "",
      form_name: "Public Coaching Application",
    } }),
    onSuccess: (next) => { setResult(next); window.scrollTo({ top: 0, behavior: "smooth" }); },
    onError: (error: any) => toast.error(error?.message ?? "Could not submit your application. Please try again."),
  });

  if (result) return <PostSubmit result={result} />;

  const fieldCls = "h-12 rounded-xl bg-background text-[17px] md:text-[17px]";

  return (
    <SalesPageShell>
      <Block narrow className="!py-8 md:!py-12">
        <div className="jf-auth-rise">
          <div className="mb-6 text-center">
            <p className="text-[13px] font-semibold text-primary">JF Effect Coaching</p>
            <h1 className="mt-1.5 text-[32px] font-semibold leading-tight tracking-[-0.02em] md:text-[40px]">Apply for Coaching</h1>
            <p className="mx-auto mt-2 max-w-sm text-[16px] leading-relaxed text-muted-foreground">
              A few quick details so we know what you need and how to reach you. No payment to apply.
            </p>
          </div>

          <form
            className="space-y-6 rounded-2xl bg-card p-5 ring-1 ring-border/70 md:p-7"
            onSubmit={(event) => { event.preventDefault(); if (valid) mutation.mutate(); }}
          >
            <div className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="full_name" className="text-[14px]">Full name</Label><Input id="full_name" required autoComplete="name" className={fieldCls} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="email" className="text-[14px]">Email</Label><Input id="email" type="email" inputMode="email" required autoComplete="email" autoCapitalize="none" className={fieldCls} value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="phone" className="text-[14px]">Phone number</Label><Input id="phone" type="tel" inputMode="tel" required autoComplete="tel" className={fieldCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="instagram" className="text-[14px]">Instagram</Label><Input id="instagram" required autoComplete="off" autoCapitalize="none" autoCorrect="off" placeholder="@username" className={fieldCls} value={form.instagram} onChange={(e) => set("instagram", e.target.value)} /><p className="text-[13px] text-muted-foreground">Your @username. We may reach out there too.</p></div>
            </div>
            <ChoiceGrid label="What do you want help with?" options={SIMPLE_GOALS} value={form.main_goal} onChange={(value) => set("main_goal", value)} />
            <div className="space-y-1.5"><Label htmlFor="target_outcome" className="text-[15px] font-medium">What result are you after?</Label><Textarea id="target_outcome" required rows={3} maxLength={250} placeholder="Tell me the main result you want." value={form.target_outcome} onChange={(e) => set("target_outcome", e.target.value)} className="resize-none rounded-xl bg-background text-[17px] md:text-[17px]" /><p className="text-right text-[12px] tabular-nums text-muted-foreground">{form.target_outcome.length}/250</p></div>
            <ChoiceGrid label="When do you want to start?" options={SIMPLE_TIMELINES} value={form.timeline} onChange={(value) => set("timeline", value)} />
            <input aria-hidden="true" tabIndex={-1} className="hidden" value={form.honeypot} onChange={(e) => set("honeypot", e.target.value)} />

            <div className="space-y-3">
              <button
                type="submit"
                disabled={!valid || mutation.isPending}
                className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary text-[17px] font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--primary)_70%,transparent)] transition active:scale-[0.985] disabled:opacity-50 disabled:shadow-none"
              >
                {mutation.isPending ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Sending…</> : "Apply for Coaching"}
              </button>
              <p className="text-center text-[13px] text-muted-foreground" aria-live="polite">
                {valid
                  ? "Next you'll pick a time for a quick call."
                  : `${done} of ${checks.length} done · still needed: ${missing.join(", ")}`}
              </p>
            </div>
          </form>
        </div>
      </Block>
    </SalesPageShell>
  );
}

function ChoiceGrid<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { v: T; l: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[15px] font-medium leading-none">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const active = value === option.v;
          return (
            <button
              key={option.v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.v)}
              className={cn(
                "min-h-[52px] rounded-xl px-4 py-3 text-left text-[16px] font-medium transition active:scale-[0.985]",
                active ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/60 ring-1 ring-border/70 hover:bg-muted",
              )}
            >
              {option.l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}


/* ────────────────── post-submit success + booking ────────────────── */

function PostSubmit({ result }: {
  result: {
    booking_slug?: string | null;
    first_name?: string;
    email?: string;
    phone?: string;
    id?: string;
  };
}) {
  const nav = useNavigate();
  const [view, setView] = useState<"intro" | "picker" | "confirmed">("intro");
  const [booked, setBooked] = useState<{
    starts_at: string; tz: string; duration: number; meet_link?: string | null;
  } | null>(null);

  if (!result.booking_slug) {
    return (
      <SalesPageShell>
        <Block narrow className="!py-12">
          <div className="mx-auto max-w-xl">
            <Card className="rounded-2xl p-7 text-center shadow-none ring-1 ring-border/70 md:p-9">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
              <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">Application received.</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                We've received your application and will reach out shortly.
              </p>
            </Card>
          </div>
        </Block>
      </SalesPageShell>
    );
  }

  if (view === "confirmed" && booked) {
    return <BookedScreen booked={booked} firstName={result.first_name} />;
  }

  return (
    <SalesPageShell>
      <Block narrow className="!py-12">
        <div className="mx-auto max-w-xl">
          {view === "intro" && (
            <Card className="rounded-2xl p-7 text-center shadow-none ring-1 ring-border/70 md:p-9">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
              <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">
                Application received.
              </h1>
              <p className="mt-2 text-[16px] leading-relaxed text-muted-foreground">
                Your application is with the JF Effect team. One quick step left: pick a time for a short coaching call.
              </p>
              <ol className="mx-auto mt-6 max-w-xs space-y-2.5 text-left text-[15px]">
                {[
                  ["Applied", true],
                  ["Pick a time for your call", false],
                  ["We map your plan together", false],
                ].map(([label, ok], i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className={"grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold " + (ok ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground")}>
                      {ok ? "✓" : i + 1}
                    </span>
                    <span className={ok ? "text-muted-foreground line-through" : "font-medium"}>{label as string}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-7 space-y-3">
                <PrimaryCta full onClick={() => setView("picker")}>
                  <CalendarClock className="h-5 w-5" aria-hidden /> Book your call
                </PrimaryCta>
                <button
                  type="button"
                  onClick={() => nav({ to: "/coaching" })}
                  className="text-[14px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  I'll book later
                </button>
              </div>
            </Card>
          )}

          {view === "picker" && (
            <SlotPicker
              slug={result.booking_slug!}
              applicationId={result.id ?? ""}
              name={result.first_name ?? ""}
              email={result.email ?? ""}
              phone={result.phone ?? ""}
              onCancel={() => setView("intro")}
              onBooked={(b) => { setBooked(b); setView("confirmed"); }}
            />
          )}
        </div>
      </Block>
    </SalesPageShell>
  );
}

/* ────────────────── in-flow slot picker ────────────────── */

function SlotPicker({
  slug, applicationId, name, email, phone, onCancel, onBooked,
}: {
  slug: string; applicationId: string; name: string; email: string; phone: string;
  onCancel: () => void;
  onBooked: (b: { starts_at: string; tz: string; duration: number; meet_link?: string | null }) => void;
}) {
  const getLink = useServerFn(getBookingLinkPublic);
  const getSlots = useServerFn(computeAvailableSlots);
  const book = useServerFn(bookSlotPublic);

  const localTz = useMemo(
    () => (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York"),
    [],
  );

  const linkQ = useQuery({
    queryKey: ["public-booking-link", slug],
    queryFn: () => getLink({ data: { slug } }),
  });

  // Build the next ~14 days of dates in the applicant's local timezone
  const days = useMemo(() => {
    const arr: { iso: string; label: string; weekday: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() + i * 86_400_000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      arr.push({
        iso,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
      });
    }
    return arr;
  }, []);
  const [date, setDate] = useState<string>(days[0].iso);

  const slotsQ = useQuery({
    queryKey: ["public-booking-slots", slug, date],
    queryFn: () => getSlots({ data: { slug, date } }),
    enabled: !!slug && !!date,
  });

  const [chosen, setChosen] = useState<string | null>(null);

  const bookMut = useMutation({
    mutationFn: async (starts_at: string) => book({ data: {
      slug, starts_at, name, email, phone, application_id: applicationId || undefined,
    } }),
    onSuccess: (r) => onBooked({
      starts_at: r.starts_at,
      tz: localTz,
      duration: linkQ.data?.link?.duration_minutes ?? 20,
      meet_link: r.meet_link,
    }),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't book that slot. Please try another time."),
  });

  const duration = linkQ.data?.link?.duration_minutes ?? 20;
  const coachName = linkQ.data?.coach?.full_name ?? "Your coach";

  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onCancel} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Pick a time</div>
      </div>

      <h2 className="mt-3 text-xl md:text-2xl font-black tracking-tight">Book your coaching call</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <Clock className="mr-1 inline h-3.5 w-3.5" />{duration} min · with {coachName} · times shown in your local time zone ({localTz})
      </p>

      {/* Day strip */}
      <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const active = d.iso === date;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => { setDate(d.iso); setChosen(null); }}
              className={
                "min-w-[64px] shrink-0 rounded-xl border px-3 py-2 text-center transition " +
                (active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted")
              }
            >
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">{d.weekday}</div>
              <div className="text-base font-black">{d.label}</div>
            </button>
          );
        })}
      </div>

      {/* Slots */}
      <div className="mt-4 min-h-[120px]">
        {slotsQ.isFetching ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading times…
          </div>
        ) : (slotsQ.data?.slots?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No times available on this day. Try another date.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slotsQ.data!.slots.map((s) => {
              const active = chosen === s.startISO;
              const localLabel = new Date(s.startISO).toLocaleTimeString(undefined, {
                hour: "numeric", minute: "2-digit",
              });
              return (
                <button
                  key={s.startISO}
                  type="button"
                  onClick={() => setChosen(s.startISO)}
                  className={
                    "min-h-[48px] rounded-xl border px-3 py-2 text-sm font-bold transition " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/40 hover:bg-muted")
                  }
                >
                  {localLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm */}
      <div className="sticky bottom-3 mt-5">
        <Button
          size="lg"
          disabled={!chosen || bookMut.isPending}
          onClick={() => chosen && bookMut.mutate(chosen)}
          className="h-14 w-full text-base font-black"
        >
          {bookMut.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Booking…</>
          ) : chosen ? (
            <>Confirm &amp; Book Call</>
          ) : (
            <>Select a time</>
          )}
        </Button>
      </div>
    </Card>
  );
}

function BookedScreen({
  booked, firstName,
}: {
  booked: { starts_at: string; tz: string; duration: number; meet_link?: string | null };
  firstName?: string;
}) {
  const start = new Date(booked.starts_at);
  const dateLabel = start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const timeLabel = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const ics = makeIcsHref({
    title: "JF Effect Coaching Call",
    startISO: booked.starts_at,
    endISO: new Date(start.getTime() + booked.duration * 60_000).toISOString(),
    description: "Your JF Effect coaching discovery call." + (booked.meet_link ? ` Join: ${booked.meet_link}` : ""),
    location: booked.meet_link ?? "",
  });
  return (
    <SalesPageShell>
      <Block narrow className="!py-12">
        <div className="mx-auto max-w-xl">
          <Card className="rounded-2xl p-7 text-center shadow-none ring-1 ring-border/70 md:p-9">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
            <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">Your call is booked.</h1>
            {firstName && <p className="mt-1 text-sm text-muted-foreground">Thanks, {firstName} — see you then.</p>}

            <div className="mt-6 space-y-2 text-left text-sm">
              <Row label="Date" value={dateLabel} />
              <Row label="Time" value={`${timeLabel} (${booked.tz})`} />
              <Row label="Call length" value={`${booked.duration} min`} />
              <Row label="How" value={booked.meet_link ? "Google Meet" : "We'll confirm the call link by email"} icon={<Video className="h-3.5 w-3.5" />} />
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <a
                href={ics} download="jf-effect-coaching-call.ics"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold hover:bg-muted"
              >Add to Calendar</a>
              {booked.meet_link && (
                <a
                  href={booked.meet_link} target="_blank" rel="noopener"
                  className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold hover:bg-muted"
                >Open meeting link</a>
              )}
            </div>
          </Card>
        </div>
      </Block>
    </SalesPageShell>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1 truncate font-semibold">{icon}{value}</span>
    </div>
  );
}

function makeIcsHref(opts: { title: string; startISO: string; endISO: string; description: string; location: string }) {
  const fmt = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JF Effect//Coaching//EN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@jfeffect.com`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(opts.startISO)}`,
    `DTEND:${fmt(opts.endISO)}`,
    `SUMMARY:${opts.title.replace(/\n/g, " ")}`,
    `DESCRIPTION:${opts.description.replace(/\n/g, " ")}`,
    opts.location ? `LOCATION:${opts.location}` : "",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines);
}
