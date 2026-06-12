import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { SalesPageShell, Section } from "@/components/sales/sales-page-shell";
import { ArrowLeft, CheckCircle2, Flame, Sparkles, Snowflake, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { submitCoachingApplication } from "@/lib/coaching-applications.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/coaching/apply")({
  component: CoachingApply,
  head: () => ({
    meta: [
      { title: "Apply for JF Effect Coaching" },
      { name: "description", content: "Tell us about your goals so we can match you to the right coaching program." },
      { property: "og:title", content: "Apply for JF Effect Coaching" },
      { property: "og:description", content: "Tell us about your goals so we can match you to the right coaching program." },
    ],
  }),
});

const GOALS = [
  "Fat loss", "Muscle building", "Strength", "Powerlifting",
  "Lifestyle", "Glutes", "Health", "Other",
];
const BUDGETS = [
  "Under $200/mo", "$200–$400/mo", "$400–$700/mo",
  "$700–$1,000/mo", "$1,000+/mo", "Not sure yet",
];
const TIMELINES = ["ASAP", "Within 1 month", "1–3 months", "3–6 months", "Just exploring"];

const EMPTY_FORM = {
  first_name: "", last_name: "", email: "", phone: "", instagram: "", location_timezone: "",
  main_goal: "", why_now: "", tried_before: "", biggest_struggle: "", current_weight: "",
  target_outcome: "", timeline: "",
  seriousness: 7,
  ready_to_invest: false,
  monthly_investment: "",
  can_follow_plan: true,
  days_per_week: 4,
  gym_access: "", injuries: "", win_90_days: "",
};

function CoachingApply() {
  const submit = useServerFn(submitCoachingApplication);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }));
  const [result, setResult] = useState<Awaited<ReturnType<typeof submit>> | null>(null);

  const mut = useMutation({
    mutationFn: () => submit({ data: { ...form } as any }),
    onSuccess: (r) => {
      setResult(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't submit application."),
  });

  const set = (k: keyof typeof EMPTY_FORM, v: any) => setForm((f) => ({ ...f, [k]: v }));

  if (result) return <Success result={result} />;

  return (
    <SalesPageShell>
      <Section className="!py-8">
        <Link to="/coaching" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" />Back to coaching page
        </Link>
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">Apply for JF Effect Coaching</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Takes about 3 minutes. We use this to match you with the right program and coach.
          </p>

          <form
            autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
            className="mt-6 space-y-6"
          >
            <SectionCard title="About you">
              <Row>
                <Field label="First name"><Input required value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></Field>
                <Field label="Last name"><Input required value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></Field>
              </Row>
              <Row>
                <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
                <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
              </Row>
              <Row>
                <Field label="Instagram handle"><Input placeholder="@yourhandle" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} /></Field>
                <Field label="Location / timezone"><Input placeholder="Toronto, ET" value={form.location_timezone} onChange={(e) => set("location_timezone", e.target.value)} /></Field>
              </Row>
            </SectionCard>

            <SectionCard title="Your goal">
              <Field label="Main goal">
                <div className="flex flex-wrap gap-2">
                  {GOALS.map((g) => (
                    <ChipButton key={g} active={form.main_goal === g} onClick={() => set("main_goal", g)}>{g}</ChipButton>
                  ))}
                </div>
              </Field>
              <Field label="Why now?"><Textarea rows={3} value={form.why_now} onChange={(e) => set("why_now", e.target.value)} /></Field>
              <Field label="What have you tried before?"><Textarea rows={3} value={form.tried_before} onChange={(e) => set("tried_before", e.target.value)} /></Field>
              <Field label="Biggest struggle right now?"><Textarea rows={2} value={form.biggest_struggle} onChange={(e) => set("biggest_struggle", e.target.value)} /></Field>
              <Row>
                <Field label="Current weight (optional)"><Input value={form.current_weight} onChange={(e) => set("current_weight", e.target.value)} /></Field>
                <Field label="Target outcome"><Input placeholder="e.g. lose 20 lb, squat 405" value={form.target_outcome} onChange={(e) => set("target_outcome", e.target.value)} /></Field>
              </Row>
              <Field label="Desired timeline">
                <div className="flex flex-wrap gap-2">
                  {TIMELINES.map((t) => (
                    <ChipButton key={t} active={form.timeline === t} onClick={() => set("timeline", t)}>{t}</ChipButton>
                  ))}
                </div>
              </Field>
            </SectionCard>

            <SectionCard title="Readiness">
              <Field label={`How serious are you about solving this right now? (${form.seriousness}/10)`}>
                <input
                  type="range" min={1} max={10} value={form.seriousness}
                  onChange={(e) => set("seriousness", Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={form.ready_to_invest} onCheckedChange={(c) => set("ready_to_invest", !!c)} />
                <span>I'm ready to invest in coaching if it's the right fit.</span>
              </label>
              <Field label="Monthly investment range you're comfortable with">
                <div className="flex flex-wrap gap-2">
                  {BUDGETS.map((b) => (
                    <ChipButton key={b} active={form.monthly_investment === b} onClick={() => set("monthly_investment", b)}>{b}</ChipButton>
                  ))}
                </div>
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={form.can_follow_plan} onCheckedChange={(c) => set("can_follow_plan", !!c)} />
                <span>I'm able to follow a structured plan.</span>
              </label>
              <Row>
                <Field label="Days per week you can train">
                  <Input type="number" min={0} max={14} value={form.days_per_week}
                    onChange={(e) => set("days_per_week", Number(e.target.value))} />
                </Field>
                <Field label="Gym access"><Input placeholder="Commercial gym / home / none" value={form.gym_access} onChange={(e) => set("gym_access", e.target.value)} /></Field>
              </Row>
              <Field label="Any injuries or limitations?"><Textarea rows={2} value={form.injuries} onChange={(e) => set("injuries", e.target.value)} /></Field>
              <Field label="What would make this a win 90 days from now?"><Textarea rows={3} value={form.win_90_days} onChange={(e) => set("win_90_days", e.target.value)} /></Field>
            </SectionCard>

            <Button type="submit" size="lg" disabled={mut.isPending} className="w-full h-12 text-base font-bold">
              {mut.isPending ? "Submitting…" : "Submit application"}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              By submitting you agree to be contacted about your application.
            </p>
          </form>
        </div>
      </Section>
    </SalesPageShell>
  );
}

function Success({ result }: { result: { lead_temperature?: string; lead_score?: number; recommended_offer?: string | null; booking_slug?: string | null } }) {
  const temp = (result.lead_temperature || "warm") as "hot" | "warm" | "cold";
  const Icon = temp === "hot" ? Flame : temp === "warm" ? Sparkles : Snowflake;
  const headline =
    temp === "hot" ? "Your application looks like a strong fit." :
    temp === "warm" ? "Thanks — your application looks promising." :
    "Thanks for applying.";
  return (
    <SalesPageShell>
      <Section className="!py-12">
        <div className="mx-auto max-w-2xl">
          <Card className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-3 text-2xl font-black tracking-tight">{headline}</h1>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs uppercase tracking-widest">
              <Icon className="h-3.5 w-3.5" /> {temp} lead
            </div>
            {result.recommended_offer && (
              <p className="mt-4 text-sm text-muted-foreground">
                Recommended program: <span className="font-semibold text-foreground">{result.recommended_offer}</span>
              </p>
            )}
            {result.booking_slug ? (
              <div className="mt-6">
                <p className="mb-3 text-sm">Book your coaching call below.</p>
                <Link to="/book/$slug" params={{ slug: result.booking_slug }}>
                  <Button size="lg" className="h-12 text-base font-bold">
                    <CalendarClock className="mr-2 h-4 w-4" /> Book your call
                  </Button>
                </Link>
              </div>
            ) : (
              <p className="mt-6 text-sm text-muted-foreground">
                We've received your application and will reach out by email shortly.
              </p>
            )}
          </Card>
        </div>
      </Section>
    </SalesPageShell>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 md:p-6 space-y-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </Card>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs transition ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
      }`}
    >{children}</button>
  );
}