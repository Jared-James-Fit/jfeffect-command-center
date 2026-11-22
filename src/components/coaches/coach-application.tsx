/**
 * /coaches/apply: early access to JF Effect for coaches (apply.ts). One
 * question per screen, eight of them: what they coach, how many clients, solo
 * or team, what they use now (optional), their name, their brand (optional),
 * where the business is based (tax follows it), then their email with the
 * privacy notice ticked and marketing as its own unticked box. No account,
 * no business, no charge. Answers stay on this phone until it's sent.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, CheckCircle2, Loader2 } from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { Block, PrimaryCta } from "@/components/sales/apple";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { captureSource } from "@/lib/join-funnel";
import { submitCoachApplication, type CoachApplyResult } from "@/lib/coach-platform/coach-platform.functions";
import {
  CLIENT_BANDS,
  COACH_STEPS,
  COUNTRIES,
  CURRENT_PLATFORMS,
  EMPTY_COACH_ANSWERS,
  MARKETING_CONSENT,
  PRIVACY_NOTICE,
  PROVINCES,
  SPECIALTIES,
  TAP_STEPS,
  WORKS_AS,
  firstNameFrom,
  firstProblem,
  stepProblem,
  type CoachAnswers,
  type CoachStep,
} from "@/lib/coach-platform/apply";

const STORE_KEY = "jf_coach_apply_v1";
const STORE_MAX_AGE = 7 * 86_400_000;
type Saved = { answers: CoachAnswers; step: number; at: number };

function loadSaved(): Saved | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!s?.answers || Date.now() - Number(s.at) > STORE_MAX_AGE) return null;
    return s;
  } catch {
    return null;
  }
}
function store(s: Saved) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode: answers just aren't kept */
  }
}
function clearStore() {
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing kept */
  }
}

const QUESTION: Record<CoachStep, { title: (first: string) => string; hint?: string }> = {
  specialties: { title: () => "What do you coach?", hint: "Pick as many as fit." },
  client_band: { title: () => "How many clients do you coach now?" },
  works_as: { title: () => "Do you coach on your own or with a team?" },
  current_platform: { title: () => "What do you use to coach now?" },
  full_name: { title: () => "What's your name?" },
  brand: { title: (first) => (first ? `What's your coaching called, ${first}?` : "What's your coaching called?"), hint: "Both optional." },
  place: { title: () => "Where's your business based?", hint: "Prices and tax depend on it." },
  contact: { title: () => "Where should I email you?" },
};

export function CoachApplication() {
  const submit = useServerFn(submitCoachApplication);
  const [answers, setAnswers] = useState<CoachAnswers>(EMPTY_COACH_ANSWERS);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [error, setError] = useState<{ field: keyof CoachAnswers | null; message: string } | null>(null);
  const [shake, setShake] = useState(0);
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CoachApplyResult | null>(null);
  const ready = useRef(false);
  const moved = useRef(false);
  const openedAt = useRef(Date.now());
  const fieldRef = useRef<HTMLInputElement | null>(null);

  const total = COACH_STEPS.length;
  const key = COACH_STEPS[step]!;
  const last = step === total - 1;
  const first = firstNameFrom(answers.full_name);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setAnswers({ ...EMPTY_COACH_ANSWERS, ...saved.answers });
      setStep(Math.max(0, Math.min(total - 1, Number(saved.step) || 0)));
    }
    captureSource();
    ready.current = true;
  }, [total]);

  useEffect(() => {
    if (!ready.current || result) return;
    store({ answers, step, at: Date.now() });
  }, [answers, step, result]);

  useEffect(() => {
    if (!moved.current) return;
    fieldRef.current?.focus({ preventScroll: true });
  }, [step]);

  if (result) return <CoachApplyDone result={result} email={answers.email.trim()} />;

  const goTo = (i: number, d: 1 | -1) => {
    moved.current = true;
    setDir(d);
    setError(null);
    setStep(i);
    window.scrollTo({ top: 0 });
  };
  const fail = (field: keyof CoachAnswers | null, message: string) => {
    setError({ field, message });
    setShake((n) => n + 1);
  };
  const set = <K extends keyof CoachAnswers>(field: K, v: CoachAnswers[K]) => {
    setAnswers((a) => ({ ...a, [field]: v }));
    if (error) setError(null);
  };
  const choose = (field: keyof CoachAnswers, v: string) => {
    setAnswers((a) => ({ ...a, [field]: v }));
    setError(null);
    window.setTimeout(() => goTo(Math.min(step + 1, total - 1), 1), 180);
  };
  const toggleSpecialty = (v: string) =>
    set("specialties", answers.specialties.includes(v) ? answers.specialties.filter((s) => s !== v) : [...answers.specialties, v]);

  const send = async () => {
    const missing = firstProblem(answers);
    if (missing >= 0) {
      const p = stepProblem(COACH_STEPS[missing]!, answers)!;
      if (missing !== step) goTo(missing, -1);
      window.setTimeout(() => fail(p.field, p.message), 0);
      return;
    }
    setSending(true);
    setError(null);
    const src = captureSource();
    try {
      const r = await submit({
        data: {
          ...answers,
          honeypot,
          elapsed_ms: Math.min(86_400_000, Date.now() - openedAt.current),
          source_page: src.source ?? "coaches",
          referrer: src.referrer,
          utm_source: src.utm_source,
          utm_medium: src.utm_medium,
          utm_campaign: src.utm_campaign,
        },
      });
      clearStore();
      setResult(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const msg = String(e?.message ?? "");
      fail(
        null,
        offline
          ? "You're offline. Your answers are saved: tap Send again once you're back online."
          : msg && !/fetch|network|failed to/i.test(msg)
            ? msg
            : "That didn't send. Your answers are saved: tap Send again.",
      );
    } finally {
      setSending(false);
    }
  };

  const next = () => {
    const p = stepProblem(key, answers);
    if (p) return fail(p.field, p.message);
    if (!last) return goTo(step + 1, 1);
    void send();
  };

  const pct = Math.round(((step + 1) / total) * 100);
  const q = QUESTION[key];
  const fieldCls = "h-14 rounded-2xl bg-background px-4 text-[18px] md:text-[18px]";
  const optionCls = (on: boolean) =>
    cn(
      "flex min-h-[58px] w-full items-center gap-3 rounded-2xl px-5 text-left text-[17px] font-medium transition active:scale-[0.99]",
      on ? "bg-foreground text-background" : "bg-muted/60 ring-1 ring-border/70 hover:bg-muted",
    );

  const choice = (field: keyof CoachAnswers, options: ReadonlyArray<{ v: string; l: string; hint?: string }>) => (
    <div role="radiogroup" aria-labelledby={`coach-q-${key}`} className="grid gap-2.5">
      {options.map((o) => {
        const on = answers[field] === o.v;
        return (
          <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => choose(field, o.v)} className={optionCls(on)}>
            <span className="min-w-0 flex-1">{o.l}</span>
            {o.hint && <span className={cn("shrink-0 text-[13px]", on ? "text-background/70" : "text-muted-foreground")}>{o.hint}</span>}
            {on && <Check className="h-5 w-5 shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>
  );

  const tapStep = TAP_STEPS.includes(key);
  const showNext = !tapStep || !!answers[key as keyof CoachAnswers];

  return (
    <SalesPageShell pageId="coaches-apply" hideMarketingNav>
      <Block narrow className="!py-5 md:!py-10">
        <div className="mx-auto max-w-md">
          <div className="flex h-10 items-center justify-between">
            <button
              type="button"
              onClick={() => step > 0 && goTo(step - 1, -1)}
              disabled={step === 0 || sending}
              aria-label="Previous question"
              className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 text-[15px] font-medium text-muted-foreground transition hover:text-foreground disabled:invisible"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
            <p className="text-[13px] font-semibold tabular-nums text-muted-foreground" aria-live="polite">
              {step + 1} of {total}
            </p>
            <span className="w-16" aria-hidden />
          </div>
          <div
            role="progressbar"
            aria-label="Application progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={step + 1}
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>

          {step === 0 && (
            <div className="mt-6" data-coach-apply-intro>
              <p className="text-[13px] font-semibold text-muted-foreground">JF Effect for coaches · Early access</p>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                About two minutes. Applying is free, makes no account and doesn't commit you to anything.
              </p>
            </div>
          )}

          <form
            key={step}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
            className={cn(
              "animate-in fade-in duration-300 motion-reduce:animate-none",
              step === 0 ? "mt-5" : "mt-8",
              dir === 1 ? "slide-in-from-right-2" : "slide-in-from-left-2",
            )}
          >
            <h1 id={`coach-q-${key}`} className="text-[26px] font-semibold leading-tight tracking-[-0.02em] md:text-[30px]">
              {key === "full_name" ? <label htmlFor="coach-full_name">{q.title(first)}</label> : q.title(first)}
            </h1>
            {q.hint && <p className="mt-1.5 text-[15px] text-muted-foreground">{q.hint}</p>}

            <div key={shake} className={cn("mt-5", shake > 0 && error && "jf-auth-shake")}>
              {key === "specialties" && (
                <div role="group" aria-labelledby="coach-q-specialties" className="flex flex-wrap gap-2">
                  {SPECIALTIES.map((o) => {
                    const on = answers.specialties.includes(o.v);
                    return (
                      <button
                        key={o.v}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleSpecialty(o.v)}
                        className={cn(
                          "inline-flex min-h-[46px] items-center gap-1.5 rounded-full px-4 text-[16px] font-medium transition active:scale-[0.98]",
                          on ? "bg-foreground text-background" : "bg-muted/60 ring-1 ring-border/70 hover:bg-muted",
                        )}
                      >
                        {on && <Check className="h-4 w-4" aria-hidden />}
                        {o.l}
                      </button>
                    );
                  })}
                </div>
              )}
              {key === "client_band" && choice("client_band", CLIENT_BANDS)}
              {key === "works_as" && choice("works_as", WORKS_AS)}
              {key === "current_platform" && choice("current_platform", CURRENT_PLATFORMS)}
              {key === "full_name" && (
                <Input
                  id="coach-full_name"
                  ref={fieldRef}
                  autoComplete="name"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  placeholder="First and last name"
                  value={answers.full_name}
                  aria-invalid={error?.field === "full_name"}
                  onChange={(e) => set("full_name", e.target.value)}
                  className={fieldCls}
                />
              )}
              {key === "brand" && (
                <div className="space-y-4">
                  <Field label="Business or brand name" htmlFor="coach-business">
                    <Input
                      id="coach-business"
                      ref={fieldRef}
                      autoComplete="organization"
                      enterKeyHint="next"
                      placeholder="Your coaching business"
                      value={answers.business_name}
                      onChange={(e) => set("business_name", e.target.value)}
                      className={fieldCls}
                    />
                  </Field>
                  <Field label="Instagram or website" htmlFor="coach-link">
                    <Input
                      id="coach-link"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      placeholder="@yourcoaching or yoursite.com"
                      value={answers.link}
                      aria-invalid={error?.field === "link"}
                      onChange={(e) => set("link", e.target.value)}
                      className={fieldCls}
                    />
                  </Field>
                </div>
              )}
              {key === "place" && (
                <div className="space-y-4">
                  <div role="radiogroup" aria-label="Country" className="grid gap-2.5">
                    {COUNTRIES.map((o) => {
                      const on = answers.country === o.v;
                      return (
                        <button
                          key={o.v}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setAnswers((a) => ({ ...a, country: o.v, region: a.country === o.v ? a.region : "" }))}
                          className={optionCls(on)}
                        >
                          <span className="min-w-0 flex-1">{o.l}</span>
                          {on && <Check className="h-5 w-5 shrink-0" aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                  {answers.country === "CA" && (
                    <Field label="Province or territory" htmlFor="coach-region">
                      <select
                        id="coach-region"
                        value={answers.region}
                        aria-invalid={error?.field === "region"}
                        onChange={(e) => set("region", e.target.value)}
                        className="h-14 w-full rounded-2xl border border-input bg-background px-4 text-[18px]"
                      >
                        <option value="">Pick one</option>
                        {PROVINCES.map(([code, name]) => (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {(answers.country === "US" || answers.country === "OTHER") && (
                    <Field label={answers.country === "US" ? "State" : "Country and region (optional)"} htmlFor="coach-region">
                      <Input
                        id="coach-region"
                        autoComplete={answers.country === "US" ? "address-level1" : "country-name"}
                        enterKeyHint="next"
                        placeholder={answers.country === "US" ? "Texas" : "United Kingdom"}
                        value={answers.region}
                        aria-invalid={error?.field === "region"}
                        onChange={(e) => set("region", e.target.value)}
                        className={fieldCls}
                      />
                    </Field>
                  )}
                </div>
              )}
              {key === "contact" && (
                <div className="space-y-5">
                  <Input
                    id="coach-email"
                    ref={fieldRef}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="send"
                    placeholder="you@yourcoaching.com"
                    aria-label="Email"
                    value={answers.email}
                    aria-invalid={error?.field === "email"}
                    onChange={(e) => set("email", e.target.value)}
                    className={fieldCls}
                  />
                  <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-relaxed" data-coach-privacy>
                    <Checkbox
                      checked={answers.privacy_ack}
                      onCheckedChange={(v) => set("privacy_ack", v === true)}
                      aria-invalid={error?.field === "privacy_ack"}
                      className="mt-0.5 h-5 w-5"
                    />
                    <span>
                      {PRIVACY_NOTICE} See the{" "}
                      <Link to="/privacy" className="underline underline-offset-2">
                        Privacy Policy
                      </Link>
                      .
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-muted-foreground" data-coach-marketing>
                    <Checkbox
                      checked={answers.marketing_ok}
                      onCheckedChange={(v) => set("marketing_ok", v === true)}
                      className="mt-0.5 h-5 w-5"
                    />
                    <span>{MARKETING_CONSENT} (Optional.)</span>
                  </label>
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-2.5 text-[14px] font-medium text-destructive">
                {error.message}
              </p>
            )}

            {(key === "current_platform" || key === "brand") && !(key === "current_platform" && answers.current_platform) && (
              <button
                type="button"
                onClick={() => {
                  if (key === "brand") setAnswers((a) => ({ ...a, business_name: "", link: "" }));
                  goTo(step + 1, 1);
                }}
                className="mt-4 min-h-10 text-[15px] font-medium text-muted-foreground hover:text-foreground"
              >
                Skip this
              </button>
            )}

            {showNext && (
              <button
                type="submit"
                disabled={sending}
                className="mt-6 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground transition active:scale-[0.985] disabled:opacity-60"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Sending…
                  </>
                ) : last ? (
                  "Send application"
                ) : (
                  "Next"
                )}
              </button>
            )}
          </form>

          {/* bot trap: people never see it */}
          <input
            aria-hidden="true"
            tabIndex={-1}
            autoComplete="off"
            name="website"
            className="hidden"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>
      </Block>
    </SalesPageShell>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[15px] font-semibold">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function CoachApplyDone({ result, email }: { result: CoachApplyResult; email: string }) {
  return (
    <SalesPageShell pageId="coaches-apply" hideMarketingNav>
      <Block narrow className="!py-10 md:!py-16">
        <div className="mx-auto max-w-md text-center" data-coach-apply-done>
          <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
          <h1 className="mt-5 text-[30px] font-semibold leading-tight tracking-[-0.02em]">
            {result.status === "updated" ? "Updated" : "You're on the list"}
            {result.firstName ? `, ${result.firstName}` : ""}.
          </h1>
          <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">
            I read every application. If you're a fit for the first group, I'll email you at{" "}
            <span className="font-medium text-foreground">{email}</span> to set up a short call. Nothing is charged, and
            nothing is set up until you decide.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4">
            <PrimaryCta to="/join" className="w-full sm:w-auto sm:min-w-[260px]">
              Try the app free meanwhile
            </PrimaryCta>
            <Link to="/coaches" className="text-[15px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Back to JF Effect for coaches
            </Link>
          </div>
        </div>
      </Block>
    </SalesPageShell>
  );
}
