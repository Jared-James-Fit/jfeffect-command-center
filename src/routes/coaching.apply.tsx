import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import {
  ArrowLeft, ArrowRight, CheckCircle2, CalendarClock, Loader2, Clock, Video,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { submitCoachingApplication } from "@/lib/coaching-applications.functions";
import {
  computeAvailableSlots, bookSlotPublic, getBookingLinkPublic,
} from "@/lib/booking-links.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/coaching/apply")({
  component: QuickApply,
  head: () => ({
    meta: [
      { title: "Apply for JF Effect Coaching — 60–120 seconds" },
      { name: "description", content: "Answer a few quick questions, then book a call if coaching looks right for you." },
      { property: "og:title", content: "Apply for JF Effect Coaching" },
      { property: "og:description", content: "Answer a few quick questions, then book a call if coaching looks right for you." },
    ],
  }),
});

/* ────────────────── data ────────────────── */

const GOALS = [
  { v: "Lose body fat", l: "Lose body fat" },
  { v: "Build muscle", l: "Build muscle" },
  { v: "Get stronger", l: "Get stronger" },
  { v: "Powerlifting", l: "Powerlifting" },
  { v: "Improve consistency", l: "Improve consistency" },
  { v: "Feel healthier", l: "Feel healthier" },
  { v: "Prepare for an event", l: "Prepare for an event" },
  { v: "Not sure yet", l: "Not sure yet" },
];

const OBSTACLES = [
  { v: "dont_know_what", l: "I do not know what to do" },
  { v: "falling_off", l: "I keep falling off" },
  { v: "nutrition", l: "Nutrition" },
  { v: "accountability", l: "Accountability" },
  { v: "time", l: "Lack of time" },
  { v: "plateau", l: "Training plateaus" },
  { v: "motivation", l: "Motivation" },
  { v: "other", l: "Other" },
];

const TRAINING_LOCATIONS = [
  { v: "full_gym", l: "Full gym" },
  { v: "home_gym", l: "Home gym" },
  { v: "home_limited", l: "At home with limited equipment" },
  { v: "not_training", l: "Not training right now" },
];

const DAYS = [
  { v: 2, l: "2 days" }, { v: 3, l: "3 days" }, { v: 4, l: "4 days" },
  { v: 5, l: "5 days" }, { v: 6, l: "6+ days" },
];

const TIMELINES = [
  { v: "asap", l: "As soon as possible" },
  { v: "two_weeks", l: "Within 2 weeks" },
  { v: "thirty_days", l: "Within 30 days" },
  { v: "one_three_months", l: "Within 1–3 months" },
  { v: "exploring", l: "Just exploring" },
];

const COACHING_INTERESTS = [
  { v: "high_access_private", l: "High-access private coaching" },
  { v: "full_online", l: "Full online coaching" },
  { v: "training_nutrition", l: "Training and nutrition support" },
  { v: "membership", l: "Lower-cost app membership" },
  { v: "help_me_choose", l: "Help me choose" },
];

const READINESS = [
  { v: "fully_ready", l: "Fully ready" },
  { v: "ready_accountability", l: "Ready, but I need accountability" },
  { v: "unsure", l: "Unsure" },
  { v: "researching", l: "Mostly researching" },
];

const TRACKING = [
  { v: "yes", l: "Yes" },
  { v: "most", l: "Most of it" },
  { v: "not_sure", l: "Not sure" },
  { v: "no", l: "No" },
];

const INVESTMENT = [
  { v: "premium", l: "Ready for premium coaching" },
  { v: "full_online", l: "Ready for full online coaching" },
  { v: "lower_cost", l: "Need a lower-cost option" },
  { v: "explain_options", l: "Need to understand the options" },
  { v: "not_ready", l: "Not ready to invest yet" },
];

const WHY_NOW_TAGS = [
  "I am tired of restarting",
  "I have an event coming up",
  "My health is becoming a priority",
  "I want expert guidance",
  "I need accountability",
];

const CONTACT_METHODS = [
  { v: "text", l: "Text" },
  { v: "phone", l: "Phone call" },
  { v: "email", l: "Email" },
  { v: "instagram", l: "Instagram" },
] as const;

const BEST_TIMES = [
  { v: "morning", l: "Morning" },
  { v: "afternoon", l: "Afternoon" },
  { v: "evening", l: "Evening" },
  { v: "flexible", l: "Flexible" },
] as const;

type FormState = {
  main_goal: string;
  target_outcome: string;
  obstacle: string;
  obstacle_other: string;
  training_location: string;
  days_per_week: number | null;
  timeline: string;
  coaching_interest: string;
  readiness: string;
  tracking_willingness: string;
  investment_readiness: string;
  why_now: string;
  why_now_tags: string[];
  first_name: string;
  phone: string;
  email: string;
  instagram: string;
  preferred_contact: "text" | "phone" | "email" | "instagram" | "";
  best_time: "morning" | "afternoon" | "evening" | "flexible" | "";
  consent_contact: boolean;
  honeypot: string;
};

const EMPTY: FormState = {
  main_goal: "", target_outcome: "",
  obstacle: "", obstacle_other: "",
  training_location: "", days_per_week: null, timeline: "",
  coaching_interest: "", readiness: "", tracking_willingness: "", investment_readiness: "",
  why_now: "", why_now_tags: [],
  first_name: "", phone: "", email: "", instagram: "",
  preferred_contact: "", best_time: "",
  consent_contact: false, honeypot: "",
};

const STORAGE_KEY = "jf:quickapply:v1";
const STORAGE_STEP_KEY = "jf:quickapply-step:v1";

/* ────────────────── component ────────────────── */

function QuickApply() {
  const submit = useServerFn(submitCoachingApplication);
  const [form, setForm] = useState<FormState>(() => {
    if (typeof window === "undefined") return EMPTY;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    } catch { /* noop */ }
    return EMPTY;
  });
  const [step, setStep] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const raw = localStorage.getItem(STORAGE_STEP_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch { return 0; }
  });
  const suppressAutoAdvanceRef = useRef(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof submit>> | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (result) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(form)); } catch { /* noop */ }
  }, [form, result]);

  useEffect(() => {
    if (result) return;
    try { localStorage.setItem(STORAGE_STEP_KEY, String(step)); } catch { /* noop */ }
  }, [step, result]);

  const mut = useMutation({
    mutationFn: () => submit({ data: {
      ...form,
      days_per_week: form.days_per_week ?? undefined,
      preferred_contact: form.preferred_contact || undefined,
      best_time: form.best_time || undefined,
    } as any }),
    onSuccess: (r) => {
      setResult(r);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_STEP_KEY);
      } catch { /* noop */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't submit application."),
  });

  if (result) return <PostSubmit result={result} />;

  /* Step definitions — each step returns its own JSX, has a `valid()` predicate,
     and may opt into auto-advance for single-choice answers. */
  const steps = useMemo(() => buildSteps(form, set), [form]);
  const total = steps.length;
  const safeStep = Math.min(step, total - 1);
  const cur = steps[safeStep];
  useEffect(() => {
    if (step > total - 1) setStep(total - 1);
  }, [step, total]);
  const pct = Math.round(((step + 1) / total) * 100);

  function next() {
    if (!cur.valid()) return;
    if (step < total - 1) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      mut.mutate();
    }
  }
  function back() {
    if (step > 0) {
      suppressAutoAdvanceRef.current = true;
      setStep(step - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // Auto-advance for steps that say so
  useEffect(() => {
    if (suppressAutoAdvanceRef.current) {
      suppressAutoAdvanceRef.current = false;
      return;
    }
    if (!cur.autoAdvance) return;
    if (!cur.valid()) return;
    const t = setTimeout(() => {
      if (step < total - 1) setStep(step + 1);
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.autoKey, step, total]);

  return (
    <SalesPageShell>
      <Section className="!py-6 md:!py-10">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link to="/coaching" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back
            </Link>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Step {step + 1} of {total}
            </div>
          </div>

          {/* Progress */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>

          <Card className="mt-4 p-5 md:p-6">
            <h1 className="text-xl md:text-2xl font-black tracking-tight">{cur.title}</h1>
            {cur.sub && <p className="mt-1 text-sm text-muted-foreground">{cur.sub}</p>}
            <div className="mt-5">{cur.body}</div>

            {/* Honeypot */}
            <input
              type="text" name="company" tabIndex={-1} autoComplete="off"
              value={form.honeypot} onChange={(e) => set("honeypot", e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden
            />
          </Card>

          {/* Sticky continue */}
          <div className="sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3">
            <Button
              variant="ghost" size="lg" onClick={back} disabled={step === 0}
              className="h-12 px-4"
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button
              size="lg" onClick={next}
              disabled={!cur.valid() || mut.isPending}
              className="h-12 flex-1 text-base font-bold"
            >
              {mut.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
              ) : step === total - 1 ? (
                "Submit Application"
              ) : (
                <>Continue <ArrowRight className="ml-1 h-4 w-4" /></>
              )}
            </Button>
          </div>
        </div>
      </Section>
    </SalesPageShell>
  );
}

/* ────────────────── steps ────────────────── */

type StepDef = {
  title: string;
  sub?: string;
  body: React.ReactNode;
  valid: () => boolean;
  autoAdvance?: boolean;
  /** Changing this key re-triggers the auto-advance effect (latest selection). */
  autoKey?: string;
};

function buildSteps(f: FormState, set: <K extends keyof FormState>(k: K, v: FormState[K]) => void): StepDef[] {
  const steps: StepDef[] = [];

  // 1. Main goal
  steps.push({
    title: "What do you want help with most?",
    sub: "Pick the one that fits best.",
    body: <CardGrid options={GOALS} value={f.main_goal} onChange={(v) => set("main_goal", v)} />,
    valid: () => !!f.main_goal,
    autoAdvance: true, autoKey: f.main_goal,
  });

  // 2. Desired result (text)
  steps.push({
    title: "What result do you want most?",
    sub: "Keep it short — we only need the main result.",
    body: (
      <TextField
        value={f.target_outcome} max={250}
        placeholder="Lose 20 lb, feel confident, and stop falling off."
        onChange={(v) => set("target_outcome", v)}
      />
    ),
    valid: () => f.target_outcome.trim().length >= 3,
  });

  // 3. Obstacle
  steps.push({
    title: "What is holding you back most?",
    body: (
      <div className="space-y-3">
        <CardGrid options={OBSTACLES} value={f.obstacle} onChange={(v) => set("obstacle", v)} />
        {f.obstacle === "other" && (
          <Input
            placeholder="Briefly — what's the obstacle?" maxLength={80}
            value={f.obstacle_other} onChange={(e) => set("obstacle_other", e.target.value)}
          />
        )}
      </div>
    ),
    valid: () => !!f.obstacle && (f.obstacle !== "other" || f.obstacle_other.trim().length >= 2),
    autoAdvance: f.obstacle !== "" && f.obstacle !== "other",
    autoKey: f.obstacle,
  });

  // 4. Training (3 questions on one screen)
  steps.push({
    title: "Your training situation",
    body: (
      <div className="space-y-5">
        <SubSection label="Where do you train?">
          <CardGrid compact options={TRAINING_LOCATIONS}
            value={f.training_location} onChange={(v) => set("training_location", v)} />
        </SubSection>
        <SubSection label="How many days can you realistically train?">
          <CardGrid compact options={DAYS.map((d) => ({ v: String(d.v), l: d.l }))}
            value={f.days_per_week ? String(f.days_per_week) : ""}
            onChange={(v) => set("days_per_week", Number(v))} />
        </SubSection>
        <SubSection label="When do you want to start?">
          <CardGrid compact options={TIMELINES}
            value={f.timeline} onChange={(v) => set("timeline", v)} />
        </SubSection>
      </div>
    ),
    valid: () => !!f.training_location && !!f.days_per_week && !!f.timeline,
  });

  // 5. Coaching fit (4 questions — split for breathability)
  steps.push({
    title: "What kind of support are you looking for?",
    body: <CardGrid options={COACHING_INTERESTS} value={f.coaching_interest}
      onChange={(v) => set("coaching_interest", v)} />,
    valid: () => !!f.coaching_interest,
    autoAdvance: true, autoKey: f.coaching_interest,
  });
  steps.push({
    title: "How ready are you to follow a structured plan?",
    body: <CardGrid options={READINESS} value={f.readiness} onChange={(v) => set("readiness", v)} />,
    valid: () => !!f.readiness,
    autoAdvance: true, autoKey: f.readiness,
  });
  steps.push({
    title: "Are you willing to track workouts, progress, and check-ins?",
    body: <CardGrid options={TRACKING} value={f.tracking_willingness}
      onChange={(v) => set("tracking_willingness", v)} />,
    valid: () => !!f.tracking_willingness,
    autoAdvance: true, autoKey: f.tracking_willingness,
  });
  steps.push({
    title: "Which best describes your investment readiness?",
    sub: "We don't ask for income — and budget alone won't disqualify you.",
    body: <CardGrid options={INVESTMENT} value={f.investment_readiness}
      onChange={(v) => set("investment_readiness", v)} />,
    valid: () => !!f.investment_readiness,
    autoAdvance: true, autoKey: f.investment_readiness,
  });

  // 6. Why now
  steps.push({
    title: "Why do you want to change this now?",
    sub: "Tap a prompt to start, then edit if you want.",
    body: (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {WHY_NOW_TAGS.map((t) => (
            <button
              key={t} type="button"
              onClick={() => {
                const has = f.why_now_tags.includes(t);
                const next = has ? f.why_now_tags.filter((x) => x !== t) : [...f.why_now_tags, t];
                set("why_now_tags", next);
                if (!has && !f.why_now.trim()) set("why_now", t);
              }}
              className={
                "rounded-full border px-3 py-1.5 text-xs transition " +
                (f.why_now_tags.includes(t)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted")
              }
            >{t}</button>
          ))}
        </div>
        <TextField
          value={f.why_now} max={250}
          placeholder="I'm tired of restarting and want real accountability."
          onChange={(v) => set("why_now", v)}
        />
      </div>
    ),
    valid: () => f.why_now.trim().length >= 3 || f.why_now_tags.length > 0,
  });

  // 7. Contact + consent
  steps.push({
    title: "How can we reach you?",
    sub: "We'll only use this to follow up on your application.",
    body: (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="first_name">First name</Label>
          <Input
            id="first_name" autoComplete="given-name" inputMode="text"
            value={f.first_name} onChange={(e) => set("first_name", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Mobile phone</Label>
          <Input
            id="phone" type="tel" inputMode="tel" autoComplete="tel"
            placeholder="(555) 555-5555"
            value={f.phone} onChange={(e) => set("phone", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email" type="email" inputMode="email" autoComplete="email"
            value={f.email} onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="instagram">Instagram (optional)</Label>
          <Input
            id="instagram" placeholder="@yourhandle"
            value={f.instagram} onChange={(e) => set("instagram", e.target.value)}
          />
        </div>

        <SubSection label="Best way to contact you?">
          <CardGrid compact options={CONTACT_METHODS.map((c) => ({ v: c.v, l: c.l }))}
            value={f.preferred_contact} onChange={(v) => set("preferred_contact", v as any)} />
        </SubSection>
        <SubSection label="When are you easiest to reach?">
          <CardGrid compact options={BEST_TIMES.map((b) => ({ v: b.v, l: b.l }))}
            value={f.best_time} onChange={(v) => set("best_time", v as any)} />
        </SubSection>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Checkbox
            checked={f.consent_contact}
            onCheckedChange={(c) => set("consent_contact", !!c)}
            className="mt-0.5"
          />
          <span className="text-muted-foreground">
            I agree that JF Effect may contact me about my coaching application by phone, text, and email. Message and data rates may apply.
            {" "}
            <Link to="/privacy" className="underline">Privacy</Link> · <Link to="/terms" className="underline">Terms</Link>.
          </span>
        </label>
      </div>
    ),
    valid: () =>
      f.first_name.trim().length >= 1 &&
      /^[\d\s+\-()]{7,}$/.test(f.phone.trim()) &&
      /.+@.+\..+/.test(f.email.trim()) &&
      !!f.preferred_contact && !!f.best_time && f.consent_contact === true,
  });

  // 8. Final compact review
  steps.push({
    title: "Ready to submit?",
    sub: "We'll save your application and offer you a coaching call right after.",
    body: (
      <div className="space-y-3 text-sm">
        <Review label="Name" value={f.first_name} />
        <Review label="Main goal" value={f.main_goal} />
        <Review label="Start" value={(TIMELINES.find((t) => t.v === f.timeline)?.l) ?? f.timeline} />
        <Review label="Preferred contact" value={(CONTACT_METHODS.find((c) => c.v === f.preferred_contact)?.l) ?? f.preferred_contact} />
        <p className="pt-2 text-[11px] text-muted-foreground">
          You'll get a chance to book a coaching call on the next screen.
        </p>
      </div>
    ),
    valid: () => true,
  });

  return steps;
}

/* ────────────────── small UI building blocks ────────────────── */

function CardGrid<T extends string | number>({
  options, value, onChange, compact = false,
}: {
  options: Array<{ v: T; l: string }>;
  value: T | "" | null;
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  return (
    <div className={"grid gap-2 " + (compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {options.map((opt) => {
        const active = value === opt.v;
        return (
          <button
            key={String(opt.v)} type="button" onClick={() => onChange(opt.v)}
            className={
              "min-h-[56px] rounded-xl border px-4 py-3 text-left text-sm font-semibold transition " +
              "active:scale-[0.99] " +
              (active
                ? "border-primary bg-primary text-primary-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]"
                : "border-border bg-background hover:border-primary/40 hover:bg-muted")
            }
          >
            <span className="block">{opt.l}</span>
          </button>
        );
      })}
    </div>
  );
}

function TextField({
  value, onChange, max, placeholder,
}: { value: string; onChange: (v: string) => void; max: number; placeholder: string }) {
  return (
    <div>
      <Textarea
        rows={3} placeholder={placeholder} maxLength={max}
        value={value} onChange={(e) => onChange(e.target.value)}
        className="resize-none text-base"
      />
      <div className="mt-1 text-right text-[11px] text-muted-foreground">
        {value.length}/{max}
      </div>
    </div>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="truncate font-semibold">{value || "—"}</span>
    </div>
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
        <Section className="!py-12">
          <div className="mx-auto max-w-xl">
            <Card className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
              <h1 className="mt-3 text-2xl md:text-3xl font-black tracking-tight">Application received.</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                We've received your application and will reach out shortly.
              </p>
            </Card>
          </div>
        </Section>
      </SalesPageShell>
    );
  }

  if (view === "confirmed" && booked) {
    return <BookedScreen booked={booked} firstName={result.first_name} />;
  }

  return (
    <SalesPageShell>
      <Section className="!py-12">
        <div className="mx-auto max-w-xl">
          {view === "intro" && (
            <Card className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
              <h1 className="mt-3 text-2xl md:text-3xl font-black tracking-tight">
                Application received.
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Your application has been sent to the JF Effect team. The next step is to choose a time for a quick coaching call.
              </p>
              <div className="mt-7 space-y-3">
                <Button
                  size="lg"
                  className="h-14 w-full text-base font-black"
                  onClick={() => setView("picker")}
                >
                  <CalendarClock className="mr-2 h-5 w-5" /> Book Your Call
                </Button>
                <button
                  type="button"
                  onClick={() => nav({ to: "/coaching" })}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Finish Without Booking
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
      </Section>
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
      <Section className="!py-12">
        <div className="mx-auto max-w-xl">
          <Card className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h1 className="mt-3 text-2xl md:text-3xl font-black tracking-tight">Your call is booked.</h1>
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
      </Section>
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
