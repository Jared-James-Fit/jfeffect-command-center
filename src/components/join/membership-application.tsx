/**
 * /join: the free membership application (membership-apply.ts). One question
 * per screen: three taps (goal, experience, coaching), their name, how Jared
 * should reach them, then only the contact details that way needs. No
 * account, no password. Next always answers: when something won't do, it
 * says what to fix. Answers stay on this phone, so a dropped Instagram
 * browser picks up where they were.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Instagram,
  Loader2,
  Mail,
  MessageSquare,
  Video,
} from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { Block, PrimaryCta, Surface, TextLink } from "@/components/sales/apple";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SOCIAL } from "@/lib/social-links";
import { instagramHandle } from "@/lib/apply-form";
import { trackJoin, captureSource, visitorId } from "@/lib/join-funnel";
import {
  submitMembershipApplication,
  type ApplyResult,
} from "@/lib/membership-applications.functions";
import {
  COACHING_INTEREST,
  CONTACT_METHODS,
  EMPTY_MEMBER_ANSWERS,
  MEMBER_EXPERIENCE,
  MEMBER_GOALS,
  MEMBER_STEPS,
  consentText,
  contactNeeds,
  firstMemberProblem,
  firstNameFrom,
  memberStepProblem,
  type MemberAnswers,
  type MemberStepKey,
} from "@/lib/membership-apply";

const STORE_KEY = "jf_join_v1";
const STORE_MAX_AGE = 7 * 86_400_000;
type Saved = { answers: MemberAnswers; step: number; at: number };

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

const QUESTION: Record<MemberStepKey, { title: (first: string) => string; hint?: string }> = {
  goal: { title: () => "What do you want from your training?" },
  experience: { title: () => "How long have you been lifting?" },
  coaching_interest: {
    title: () => "Interested in online coaching with me?",
    hint: "Online coaching is paid and optional. The app is free either way.",
  },
  full_name: { title: () => "What's your name?" },
  contact_method: {
    title: (first) =>
      first ? `How should I reach you, ${first}?` : "How should I reach you?",
    hint: "I read every application myself, and I might say hi before I approve you.",
  },
  contact: { title: () => "Where can we reach you?" },
};

const METHOD_ICON = { instagram: Instagram, text: MessageSquare, email: Mail } as const;

export function MembershipApplication() {
  const submit = useServerFn(submitMembershipApplication);
  const [answers, setAnswers] = useState<MemberAnswers>(EMPTY_MEMBER_ANSWERS);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [error, setError] = useState<{ field: keyof MemberAnswers | null; message: string } | null>(
    null,
  );
  const [shake, setShake] = useState(0);
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const ready = useRef(false);
  const moved = useRef(false);
  const started = useRef(false);
  const openedAt = useRef(Date.now());
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const igRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);

  const total = MEMBER_STEPS.length;
  const key = MEMBER_STEPS[step]!;
  const last = step === total - 1;
  const first = firstNameFrom(answers.full_name);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setAnswers({ ...EMPTY_MEMBER_ANSWERS, ...saved.answers });
      setStep(Math.max(0, Math.min(total - 1, Number(saved.step) || 0)));
      started.current = true;
    }
    captureSource();
    ready.current = true;
  }, [total]);

  useEffect(() => {
    if (!ready.current || result) return;
    store({ answers, step, at: Date.now() });
  }, [answers, step, result]);

  // Each screen counts once a day per visitor (the funnel's drop-off by question).
  useEffect(() => {
    if (ready.current && started.current) trackJoin("apply_step", key);
  }, [key]);

  // The field takes focus when a new screen comes up (not the first one, so the page opens calm).
  useEffect(() => {
    if (!moved.current) return;
    (key === "contact" ? emailRef.current : fieldRef.current)?.focus({ preventScroll: true });
  }, [step, key]);

  if (result) return <JoinResult result={result} answers={answers} />;

  const begin = () => {
    if (started.current) return;
    started.current = true;
    trackJoin("apply_start");
    trackJoin("apply_step", "goal");
  };
  const goTo = (i: number, d: 1 | -1) => {
    moved.current = true;
    setDir(d);
    setError(null);
    setStep(i);
    window.scrollTo({ top: 0 });
  };
  const fail = (field: keyof MemberAnswers | null, message: string) => {
    setError({ field, message });
    setShake((n) => n + 1);
    const ref =
      field === "instagram"
        ? igRef
        : field === "phone"
          ? phoneRef
          : field === "email"
            ? emailRef
            : fieldRef;
    ref.current?.focus({ preventScroll: true });
  };
  const set = (field: keyof MemberAnswers, v: string) => {
    begin();
    setAnswers((a) => ({ ...a, [field]: v }));
    if (error) setError(null);
  };
  const choose = (field: keyof MemberAnswers, v: string) => {
    begin();
    setAnswers((a) => ({ ...a, [field]: v }));
    setError(null);
    // a tap is the answer: on to the next screen once the pick has shown
    window.setTimeout(() => goTo(Math.min(step + 1, total - 1), 1), 180);
  };

  const send = async () => {
    const missing = firstMemberProblem(answers);
    if (missing >= 0) {
      const p = memberStepProblem(MEMBER_STEPS[missing]!, answers)!;
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
          visitor_id: visitorId(),
          source_page: src.source ?? "join",
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
    const p = memberStepProblem(key, answers);
    if (p) return fail(p.field, p.message);
    if (!last) return goTo(step + 1, 1);
    void send();
  };

  const pct = Math.round(((step + 1) / total) * 100);
  const q = QUESTION[key];
  const needs = contactNeeds(answers.contact_method);
  const fieldCls = "h-14 rounded-2xl bg-background px-4 text-[18px] md:text-[18px]";

  const choice = (
    field: keyof MemberAnswers,
    options: ReadonlyArray<{ v: string; l: string; hint?: string }>,
    icons?: Record<string, any>,
  ) => (
    <div role="radiogroup" aria-labelledby={`join-q-${key}`} className="grid gap-2.5">
      {options.map((o) => {
        const on = answers[field] === o.v;
        const Icon = icons?.[o.v];
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(field, o.v)}
            className={cn(
              "flex min-h-[58px] w-full items-center gap-3 rounded-2xl px-5 text-left text-[17px] font-medium transition active:scale-[0.99]",
              on
                ? "bg-foreground text-background"
                : "bg-muted/60 ring-1 ring-border/70 hover:bg-muted",
            )}
          >
            {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden />}
            <span className="min-w-0 flex-1">{o.l}</span>
            {o.hint && (
              <span
                className={cn(
                  "shrink-0 text-[13px]",
                  on ? "text-background/70" : "text-muted-foreground",
                )}
              >
                {o.hint}
              </span>
            )}
            {on && <Check className="h-5 w-5 shrink-0" aria-hidden />}
          </button>
        );
      })}
    </div>
  );

  return (
    <SalesPageShell pageId="join" hideMarketingNav>
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
            <p
              className="text-[13px] font-semibold tabular-nums text-muted-foreground"
              aria-live="polite"
            >
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
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>

          {step === 0 && (
            <div className="mt-6">
              <p className="text-[13px] font-semibold text-muted-foreground">
                Join JF Effect · Free
              </p>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                A few quick taps, about a minute. I read every application myself.
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
            <h1
              id={`join-q-${key}`}
              className="text-[26px] font-semibold leading-tight tracking-[-0.02em] md:text-[30px]"
            >
              {key === "full_name" ? (
                <label htmlFor="join-full_name">{q.title(first)}</label>
              ) : (
                q.title(first)
              )}
            </h1>
            {q.hint && <p className="mt-1.5 text-[15px] text-muted-foreground">{q.hint}</p>}

            <div key={shake} className={cn("mt-5", shake > 0 && error && "jf-auth-shake")}>
              {key === "goal" && choice("goal", MEMBER_GOALS)}
              {key === "experience" && choice("experience", MEMBER_EXPERIENCE)}
              {key === "coaching_interest" && choice("coaching_interest", COACHING_INTEREST)}
              {key === "contact_method" && choice("contact_method", CONTACT_METHODS, METHOD_ICON)}
              {key === "full_name" && (
                <Input
                  id="join-full_name"
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
              {key === "contact" && (
                <div className="space-y-4">
                  <ContactField
                    id="join-email"
                    label="Email"
                    note="Your invite goes here."
                    inputRef={emailRef}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={answers.email}
                    invalid={error?.field === "email"}
                    onChange={(v) => set("email", v)}
                    className={fieldCls}
                  />
                  <ContactField
                    id="join-instagram"
                    label="Instagram"
                    note={
                      needs.instagram === "required"
                        ? "So I can DM you."
                        : "Optional, but it helps me know who you are."
                    }
                    inputRef={igRef}
                    placeholder="@username"
                    value={answers.instagram}
                    invalid={error?.field === "instagram"}
                    onChange={(v) => set("instagram", v)}
                    className={fieldCls}
                  />
                  {needs.phone === "required" && (
                    <ContactField
                      id="join-phone"
                      label="Phone"
                      note="So I can text you. Any format works."
                      inputRef={phoneRef}
                      type="tel"
                      autoComplete="tel"
                      placeholder="(204) 555-0123"
                      value={answers.phone}
                      invalid={error?.field === "phone"}
                      onChange={(v) => set("phone", v)}
                      className={fieldCls}
                    />
                  )}
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-2.5 text-[14px] font-medium text-destructive">
                {error.message}
              </p>
            )}

            {key === "coaching_interest" && !answers.coaching_interest && (
              <button
                type="button"
                onClick={() => goTo(step + 1, 1)}
                className="mt-4 min-h-10 text-[15px] font-medium text-muted-foreground hover:text-foreground"
              >
                Skip this
              </button>
            )}

            {/* Choices move on by themselves; Next is there after Back, once one is picked. */}
            {(!["goal", "experience", "coaching_interest", "contact_method"].includes(key) ||
              !!answers[key as keyof MemberAnswers]) && (
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
            {last && (
              <p className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
                {consentText(answers.contact_method)} No spam, ever. See the{" "}
                <Link to="/privacy" className="underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </p>
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

          {step === 0 && (
            <p className="mt-10 text-center text-[14px] text-muted-foreground">
              Already a member?{" "}
              <Link
                to="/auth"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          )}
        </div>
      </Block>
    </SalesPageShell>
  );
}

function ContactField({
  id,
  label,
  note,
  inputRef,
  type = "text",
  autoComplete = "off",
  placeholder,
  value,
  invalid,
  onChange,
  className,
}: {
  id: string;
  label: string;
  note: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  placeholder: string;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
  className: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold">{label}</span>
        <span className="text-[13px] text-muted-foreground">{note}</span>
      </label>
      <Input
        id={id}
        ref={inputRef}
        type={type}
        inputMode={type === "email" ? "email" : type === "tel" ? "tel" : "text"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className={cn("mt-1.5", className)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* After sending                                                        */
/* ------------------------------------------------------------------ */

const REACH: Record<string, (a: MemberAnswers) => string> = {
  instagram: (a) => {
    const h = instagramHandle(a.instagram);
    return `I might DM you on Instagram${h ? ` (${h})` : ""} to say hi and hear about your goals.`;
  },
  text: () => "I might text you to say hi and hear about your goals.",
  email: () => "I might email you to say hi and hear about your goals.",
};

function JoinResult({ result, answers }: { result: ApplyResult; answers: MemberAnswers }) {
  const first = result.firstName;
  if (result.status === "has_account") {
    return (
      <ResultShell icon="check" title={`You already have an account${first ? `, ${first}` : ""}`}>
        <p className="text-[16px] leading-relaxed text-muted-foreground">
          That email is already a JF Effect account. Sign in to get back to your training.
        </p>
        <div className="mt-7 space-y-2">
          <PrimaryCta to="/auth" full>
            Sign in
          </PrimaryCta>
          <div className="pt-2">
            <TextLink to="/recover">Forgot your password?</TextLink>
          </div>
        </div>
      </ResultShell>
    );
  }
  if (result.status === "already_approved") {
    return (
      <ResultShell icon="check" title={`You're already approved${first ? `, ${first}` : ""}`}>
        <p className="text-[16px] leading-relaxed text-muted-foreground">
          Your invite is in your email. Tap the link in it, set a password, and you're in. Can't
          find it? Check spam, or message me on Instagram.
        </p>
        <div className="mt-6">
          <TextLink href={SOCIAL.instagram.url}>Message me on Instagram</TextLink>
        </div>
      </ResultShell>
    );
  }
  const coaching = result.coachingInterest === "yes" || result.coachingInterest === "maybe";
  const steps: Array<{ title: string; body: string; done?: boolean }> = [
    { title: "Application sent", body: "Nothing to pay, no card.", done: true },
    {
      title: "I read it",
      body: `Usually within a day. ${(REACH[result.contactMethod] ?? REACH.email)(answers)}`,
    },
    {
      title: "Your invite comes by email",
      body: `To ${answers.email.trim()}. Tap it, set a password, and pick your first program.`,
    },
  ];
  return (
    <ResultShell icon="check" title={`You're on the list${first ? `, ${first}` : ""}.`}>
      <p className="text-[16px] leading-relaxed text-muted-foreground">
        Here's what happens next. You don't need to do anything else.
      </p>
      <ol className="mt-6 space-y-4 text-left">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                s.done ? "bg-success text-white" : "bg-muted text-muted-foreground",
              )}
            >
              {s.done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold">{s.title}</div>
              <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {coaching && result.bookingUrl && (
        <Surface className="mt-7 p-5 text-left" data-join-call>
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-muted">
              <Video className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold">Want to talk about online coaching?</div>
              <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">
                We can sort it out over text, or pick a time for a short video call if you'd
                rather talk it through.
              </p>
              <div className="mt-3">
                <TextLink href={result.bookingUrl}>Pick a call time</TextLink>
              </div>
            </div>
          </div>
        </Surface>
      )}

      <div className="mt-8 border-t border-border/70 pt-6">
        <div className="text-[15px] font-semibold">While you wait</div>
        <div className="mt-3 flex flex-col items-center gap-3">
          <TextLink href={SOCIAL.instagram.url}>See how I train on Instagram</TextLink>
          <TextLink to="/about">More about me</TextLink>
        </div>
      </div>
    </ResultShell>
  );
}

function ResultShell({
  title,
  children,
}: {
  icon: "check";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <SalesPageShell pageId="join-done" hideMarketingNav>
      <Block narrow className="!py-10">
        <div className="mx-auto max-w-md text-center" data-join-result>
          <CheckCircle2 className="mx-auto h-14 w-14 text-success" aria-hidden />
          <h1 className="mt-4 text-balance text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[34px]">
            {title}
          </h1>
          <div className="mt-3">{children}</div>
        </div>
      </Block>
    </SalesPageShell>
  );
}
