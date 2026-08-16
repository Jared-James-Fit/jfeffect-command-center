import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import { ArrowLeft, ArrowRight, X, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { submitCoachingApplication } from "@/lib/coaching-applications.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/personal-trainer-selkirk/apply")({
  component: SelkirkApply,
  head: () => ({
    meta: [
      { title: "Apply — Personal Training in Selkirk, MB | JF Effect" },
      { name: "description", content: "Apply for in-person personal training in Selkirk, MB at Iron Image Barbell Club with JF Effect." },
      { property: "og:title", content: "Apply — Personal Training in Selkirk, MB" },
      { property: "og:description", content: "Apply for in-person personal training in Selkirk, MB at Iron Image Barbell Club with JF Effect." },
      { name: "robots", content: "noindex,follow" },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/personal-trainer-selkirk/apply" }],
  }),
});

/* ────────────────── options ────────────────── */

const GOALS = [
  { v: "Lose body fat", l: "Lose body fat" },
  { v: "Build muscle", l: "Build muscle" },
  { v: "Get stronger", l: "Get stronger" },
  { v: "Powerlifting", l: "Powerlifting" },
  { v: "General fitness & health", l: "General fitness & health" },
  { v: "Not sure yet", l: "Not sure yet" },
];

const EXPERIENCE = [
  { v: "beginner", l: "Brand new to the gym" },
  { v: "some", l: "Some experience" },
  { v: "consistent", l: "Train consistently" },
  { v: "advanced", l: "Advanced lifter" },
];

const DAYS = [
  { v: 2, l: "2 days" }, { v: 3, l: "3 days" }, { v: 4, l: "4 days" },
  { v: 5, l: "5 days" }, { v: 6, l: "6+ days" },
];

const BEST_TIMES = [
  { v: "morning", l: "Morning" },
  { v: "afternoon", l: "Afternoon" },
  { v: "evening", l: "Evening" },
  { v: "flexible", l: "Flexible" },
] as const;

const TIMELINES = [
  { v: "asap", l: "As soon as possible" },
  { v: "two_weeks", l: "Within 2 weeks" },
  { v: "thirty_days", l: "Within 30 days" },
  { v: "one_three_months", l: "Within 1–3 months" },
  { v: "exploring", l: "Just exploring" },
];

const CONTACT_METHODS = [
  { v: "text", l: "Text" },
  { v: "phone", l: "Phone call" },
  { v: "email", l: "Email" },
  { v: "instagram", l: "Instagram" },
] as const;

const WHY_NOW_TAGS = [
  "I want hands-on coaching",
  "I need accountability",
  "I'm tired of restarting",
  "I want a structured plan",
  "I want results before an event",
];

type FormState = {
  main_goal: string;
  experience: string;
  days_per_week: number | null;
  best_time: "morning" | "afternoon" | "evening" | "flexible" | "";
  timeline: string;
  why_now: string;
  why_now_tags: string[];
  first_name: string;
  phone: string;
  email: string;
  instagram: string;
  preferred_contact: "text" | "phone" | "email" | "instagram" | "";
  consent_contact: boolean;
  honeypot: string;
};

const EMPTY: FormState = {
  main_goal: "", experience: "",
  days_per_week: null, best_time: "", timeline: "",
  why_now: "", why_now_tags: [],
  first_name: "", phone: "", email: "", instagram: "",
  preferred_contact: "", consent_contact: false, honeypot: "",
};

const STORAGE_KEY = "jf:selkirk-apply:v1";
const STORAGE_STEP_KEY = "jf:selkirk-apply-step:v1";

/* ────────────────── component ────────────────── */

function SelkirkApply() {
  const nav = useNavigate();
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
  const [done, setDone] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (done) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(form)); } catch { /* noop */ }
  }, [form, done]);

  useEffect(() => {
    if (done) return;
    try { localStorage.setItem(STORAGE_STEP_KEY, String(step)); } catch { /* noop */ }
  }, [step, done]);

  const mut = useMutation({
    mutationFn: () => submit({ data: {
      first_name: form.first_name,
      email: form.email,
      phone: form.phone,
      instagram: form.instagram,
      main_goal: form.main_goal,
      target_outcome: form.why_now,
      // Selkirk-specific context packed into existing schema:
      training_location: "Iron Image Gym — Selkirk, MB",
      days_per_week: form.days_per_week ?? undefined,
      timeline: form.timeline,
      readiness: form.experience,
      why_now: form.why_now,
      why_now_tags: form.why_now_tags,
      preferred_contact: form.preferred_contact || undefined,
      best_time: form.best_time || undefined,
      consent_contact: form.consent_contact,
      honeypot: form.honeypot,
      source_page: "selkirk",
      page_url: typeof window !== "undefined" ? window.location.href : undefined,
      referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      form_name: "Quick Apply — Selkirk Personal Training",
      is_test: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("test") === "1",
    } as any }),
    onSuccess: () => {
      setDone(true);
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_STEP_KEY);
      } catch { /* noop */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't submit application."),
  });

  const steps = useMemo(() => buildSteps(form, set), [form]);
  const total = steps.length;
  const safeStep = Math.min(step, total - 1);
  const cur = steps[safeStep];
  useEffect(() => { if (step > total - 1) setStep(total - 1); }, [step, total]);
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

  useEffect(() => {
    if (suppressAutoAdvanceRef.current) {
      suppressAutoAdvanceRef.current = false;
      return;
    }
    if (!cur.autoAdvance) return;
    if (!cur.valid()) return;
    const t = setTimeout(() => { if (step < total - 1) setStep(step + 1); }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.autoKey, step, total]);

  if (done) {
    return (
      <SalesPageShell>
        <Section className="!py-12">
          <div className="mx-auto max-w-xl">
            <Card className="p-8 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
              <h1 className="mt-3 text-2xl md:text-3xl font-black tracking-tight">Application received.</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Thanks{form.first_name ? `, ${form.first_name}` : ""}. We'll reach out shortly to book your free consultation at Iron Image Gym in Selkirk.
              </p>
              <div className="mt-7">
                <Button size="lg" className="h-12" onClick={() => nav({ to: "/personal-trainer-selkirk" })}>
                  Back to Selkirk Page
                </Button>
              </div>
            </Card>
          </div>
        </Section>
      </SalesPageShell>
    );
  }

  return (
    <SalesPageShell>
      <Section className="!py-6 md:!py-10">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link to="/personal-trainer-selkirk" className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
              <X className="h-3 w-3" /> Exit
            </Link>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Step {step + 1} of {total}
            </div>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>

          {step === 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              In-person training at Iron Image Barbell Club · Selkirk, MB
            </div>
          )}

          <Card className="mt-4 p-5 md:p-6">
            <h1 className="text-xl md:text-2xl font-black tracking-tight">{cur.title}</h1>
            {cur.sub && <p className="mt-1 text-sm text-muted-foreground">{cur.sub}</p>}
            <div className="mt-5">{cur.body}</div>

            <input
              type="text" name="company" tabIndex={-1} autoComplete="off"
              value={form.honeypot} onChange={(e) => set("honeypot", e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden
            />
          </Card>

          <div className="sticky bottom-3 z-10 mt-4 flex items-center justify-between gap-3">
            <Button variant="ghost" size="lg" onClick={back} disabled={step === 0} className="h-12 px-4">
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
  autoKey?: string;
};

function buildSteps(f: FormState, set: <K extends keyof FormState>(k: K, v: FormState[K]) => void): StepDef[] {
  const steps: StepDef[] = [];

  steps.push({
    title: "What's your main goal?",
    sub: "Pick the one that fits best.",
    body: <CardGrid options={GOALS} value={f.main_goal} onChange={(v) => set("main_goal", v)} />,
    valid: () => !!f.main_goal,
    autoAdvance: true, autoKey: f.main_goal,
  });

  steps.push({
    title: "How much gym experience do you have?",
    body: <CardGrid options={EXPERIENCE} value={f.experience} onChange={(v) => set("experience", v)} />,
    valid: () => !!f.experience,
    autoAdvance: true, autoKey: f.experience,
  });

  steps.push({
    title: "Your schedule",
    body: (
      <div className="space-y-5">
        <SubSection label="How many days can you realistically train?">
          <CardGrid compact options={DAYS.map((d) => ({ v: String(d.v), l: d.l }))}
            value={f.days_per_week ? String(f.days_per_week) : ""}
            onChange={(v) => set("days_per_week", Number(v))} />
        </SubSection>
        <SubSection label="When are you free to train?">
          <CardGrid compact options={BEST_TIMES.map((b) => ({ v: b.v, l: b.l }))}
            value={f.best_time} onChange={(v) => set("best_time", v as any)} />
        </SubSection>
        <SubSection label="When do you want to start?">
          <CardGrid compact options={TIMELINES}
            value={f.timeline} onChange={(v) => set("timeline", v)} />
        </SubSection>
      </div>
    ),
    valid: () => !!f.days_per_week && !!f.best_time && !!f.timeline,
  });

  steps.push({
    title: "Why do you want to start now?",
    sub: "Tap a prompt to start, then edit if you want.",
    body: (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {WHY_NOW_TAGS.map((t) => (
            <button
              key={t} type="button"
              onClick={() => {
                const has = f.why_now_tags.includes(t);
                const nextTags = has ? f.why_now_tags.filter((x) => x !== t) : [...f.why_now_tags, t];
                set("why_now_tags", nextTags);
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
        <Textarea
          rows={3} maxLength={250}
          placeholder="I want hands-on coaching and a clear plan."
          value={f.why_now} onChange={(e) => set("why_now", e.target.value)}
          className="resize-none text-base"
        />
        <div className="text-right text-[11px] text-muted-foreground">{f.why_now.length}/250</div>
      </div>
    ),
    valid: () => f.why_now.trim().length >= 3 || f.why_now_tags.length > 0,
  });

  steps.push({
    title: "How can we reach you?",
    sub: "We'll only use this to follow up about your training.",
    body: (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="first_name">First name</Label>
          <Input id="first_name" autoComplete="given-name"
            value={f.first_name} onChange={(e) => set("first_name", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Mobile phone</Label>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel"
            placeholder="(204) 555-5555"
            value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" inputMode="email" autoComplete="email"
            value={f.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="instagram">Instagram handle</Label>
          <Input id="instagram" placeholder="@username"
            value={f.instagram} onChange={(e) => set("instagram", e.target.value)} />
          <p className="text-xs text-muted-foreground">Optional if you don't use Instagram.</p>
        </div>

        <SubSection label="Best way to reach you?">
          <CardGrid compact options={CONTACT_METHODS.map((c) => ({ v: c.v, l: c.l }))}
            value={f.preferred_contact} onChange={(v) => set("preferred_contact", v as any)} />
        </SubSection>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Checkbox
            checked={f.consent_contact}
            onCheckedChange={(c) => set("consent_contact", !!c)}
            className="mt-0.5"
          />
          <span className="text-muted-foreground">
            I agree that JF Effect may contact me about my Selkirk personal training inquiry by phone, text, and email. Message and data rates may apply.
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
      !!f.preferred_contact && f.consent_contact === true,
  });

  return steps;
}

/* ────────────────── building blocks ────────────────── */

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
              "min-h-[56px] rounded-xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.99] " +
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

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}