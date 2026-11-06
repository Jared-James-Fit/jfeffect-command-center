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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveApplicationDraft, submitCoachingApplication } from "@/lib/coaching-applications.functions";
import {
  APPLY_STEPS, EMPTY_ANSWERS, OUTCOME_MAX, answeredCount, clip, firstUnanswered, goalFromLink, hasContact, stepError,
  type ApplyAnswers,
} from "@/lib/apply-form";
import { bookOnline, getBookingPage, getBookingSlots } from "@/lib/booking.functions";
import { toast } from "sonner";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/coaching/apply")({
  component: QuestionFlow,
  head: () => ({
    meta: [
      { title: "Apply for JF Effect Coaching: 7 quick questions" },
      { name: "description", content: "Tell us who you are, what you want, and when you want to start." },
      ...shareMeta({ title: "Apply for JF Effect Coaching", description: "Tell us who you are, what you want, and when you want to start.", path: "/coaching/apply" }),
    ],
  }),
});

/* ────────────────── one question at a time ────────────────── */

/** Answers so far stay on this phone, so a reload or a dropped Instagram browser picks up where they were. */
const STORE_KEY = "jf_apply_v2";
const STORE_MAX_AGE = 7 * 24 * 60 * 60_000;
type SavedApply = { draftId: string; answers: ApplyAnswers; step: number; at: number };

function loadSavedApply(): SavedApply | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedApply;
    if (!saved?.draftId || Date.now() - Number(saved.at) > STORE_MAX_AGE) return null;
    return saved;
  } catch {
    return null;
  }
}
function storeApply(saved: SavedApply) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* private mode: answers just aren't kept */ }
}
function clearStoredApply() {
  try { window.localStorage.removeItem(STORE_KEY); } catch { /* nothing kept */ }
}
function newDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
  );
}

const DRAFT_SAVE_MS = 1200;

/**
 * The application, one question per screen: a progress bar and "Question N of 7" on top, a big
 * field or tap-to-pick answers, and Next. Next always works: when an answer won't do, it says
 * exactly what to fix (never a greyed-out button). Once there's an email or phone, what they've
 * answered is saved as an unfinished application, so the coach sees who it was even if Submit
 * never happens.
 */
function QuestionFlow() {
  const submit = useServerFn(submitCoachingApplication);
  const saveDraft = useServerFn(saveApplicationDraft);
  const [answers, setAnswers] = useState<ApplyAnswers>(EMPTY_ANSWERS);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [honeypot, setHoneypot] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof submit>> | null>(null);
  const draftId = useRef("");
  const sourcePage = useRef("coaching_apply");
  const ready = useRef(false);
  const moved = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  /** The goal they tapped on the coaching page (`?goal=`): already answered, so Next steps over it (Back still reaches it). */
  const goalPicked = useRef(false);

  const total = APPLY_STEPS.length;
  const current = APPLY_STEPS[step]!;
  const value = answers[current.key];
  const last = step === total - 1;

  useEffect(() => {
    const saved = loadSavedApply();
    const params = new URLSearchParams(window.location.search);
    const linkedGoal = goalFromLink(params.get("goal"));
    draftId.current = saved?.draftId ?? newDraftId();
    if (saved || linkedGoal) {
      const base = { ...EMPTY_ANSWERS, ...(saved?.answers ?? {}) };
      // The goal they just picked wins over one from an older visit.
      if (linkedGoal) {
        base.main_goal = linkedGoal;
        goalPicked.current = true;
      }
      setAnswers(base);
    }
    if (saved) setStep(Math.max(0, Math.min(total - 1, Number(saved.step) || 0)));
    sourcePage.current = clip(params.get("from") || "coaching_apply", 80);
    ready.current = true;
  }, [total]);

  useEffect(() => {
    if (!ready.current || result) return;
    storeApply({ draftId: draftId.current, answers, step, at: Date.now() });
  }, [answers, step, result]);

  // Saved as an unfinished application a beat after they stop typing, once we can reach them.
  useEffect(() => {
    if (!ready.current || result || !hasContact(answers)) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      void saveDraft({
        data: {
          draft_id: draftId.current,
          ...answers,
          step: APPLY_STEPS[step]?.key ?? "",
          answered: answeredCount(answers),
          source_page: sourcePage.current,
          page_url: clip(window.location.href, 500),
          referrer: clip(document.referrer, 500),
          honeypot,
        },
      }).catch(() => { /* best effort: the real application is what counts */ });
    }, DRAFT_SAVE_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [answers, step, result, honeypot, saveDraft]);

  // The field takes focus when a new question comes up (not on the first one, so the page opens calm).
  useEffect(() => {
    if (!moved.current) return;
    fieldRef.current?.focus({ preventScroll: true });
  }, [step]);

  const mutation = useMutation({
    mutationFn: () =>
      submit({
        data: {
          ...answers,
          honeypot,
          source_page: sourcePage.current,
          page_url: clip(window.location.href, 500),
          referrer: clip(document.referrer, 500),
          form_name: "Public Coaching Application",
          draft_id: draftId.current || undefined,
        },
      }),
    onSuccess: (next) => {
      clearStoredApply();
      setResult(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: any) => {
      setError(
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "You're offline. Your answers are saved: tap Send again once you're back online."
          : "That didn't send. Your answers are saved: tap Send again.",
      );
      setShake((n) => n + 1);
      console.warn("[apply] submit failed", e?.message ?? e);
    },
  });

  if (result) return <PostSubmit result={result} />;

  const fail = (message: string) => {
    setError(message);
    setShake((n) => n + 1);
    fieldRef.current?.focus({ preventScroll: true });
  };
  const goTo = (i: number, d: 1 | -1) => {
    moved.current = true;
    setDir(d);
    setError(null);
    setStep(i);
  };
  const next = () => {
    const problem = stepError(current.key, value);
    if (problem) return fail(problem);
    if (!last) {
      const after = step + 1;
      const skipGoal = goalPicked.current && APPLY_STEPS[after]?.key === "main_goal" && !stepError("main_goal", answers.main_goal);
      return goTo(skipGoal ? Math.min(after + 1, total - 1) : after, 1);
    }
    // Everything is checked again before sending (answers can come back from an older visit).
    const missing = firstUnanswered(answers);
    if (missing >= 0) {
      goTo(missing, -1);
      setError(stepError(APPLY_STEPS[missing]!.key, answers[APPLY_STEPS[missing]!.key]));
      return;
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setError(null);
    mutation.mutate();
  };
  const back = () => step > 0 && goTo(step - 1, -1);
  const set = (v: string) => {
    setAnswers((a) => ({ ...a, [current.key]: v }));
    if (error) setError(null);
  };
  const choose = (v: string) => {
    setAnswers((a) => ({ ...a, [current.key]: v }));
    setError(null);
    // A tap is the answer: on to the next question once the pick has shown.
    window.setTimeout(() => goTo(Math.min(step + 1, total - 1), 1), 180);
  };

  const pct = Math.round(((step + 1) / total) * 100);
  const fieldCls = "h-14 rounded-2xl bg-background px-4 text-[18px] md:text-[18px]";
  const contactStep = current.key === "email" || current.key === "phone" || current.key === "instagram";

  return (
    <SalesPageShell>
      <Block narrow className="!py-6 md:!py-10">
        <div className="mx-auto max-w-md">
          {/* Where they are: back, "Question N of 7", and the bar. */}
          <div className="flex h-10 items-center justify-between">
            <button
              type="button"
              onClick={back}
              disabled={step === 0 || mutation.isPending}
              aria-label="Previous question"
              className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 text-[15px] font-medium text-muted-foreground transition hover:text-foreground disabled:invisible"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
            <p className="text-[13px] font-semibold tabular-nums text-muted-foreground" aria-live="polite">
              Question {step + 1} of {total}
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
            <div className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>

          {step === 0 && (
            <div className="mt-7">
              <p className="text-[13px] font-semibold text-primary">JF Effect Coaching</p>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                {total} quick questions, about a minute. No payment to apply.
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
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] md:text-[30px]">
              <label htmlFor={`apply-${current.key}`}>{current.question}</label>
            </h1>
            {current.hint && <p className="mt-1.5 text-[15px] text-muted-foreground">{current.hint}</p>}

            <div key={shake} className={cn("mt-5", shake > 0 && error && "jf-auth-shake")}>
              {current.kind === "choice" ? (
                <div role="radiogroup" aria-labelledby={`apply-${current.key}`} className="grid gap-2.5">
                  {current.options!.map((o) => {
                    const on = value === o.v;
                    return (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => choose(o.v)}
                        className={cn(
                          "flex min-h-[56px] w-full items-center justify-between rounded-2xl px-5 text-left text-[17px] font-medium transition active:scale-[0.99]",
                          on ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/60 ring-1 ring-border/70 hover:bg-muted",
                        )}
                      >
                        {o.l}
                        {on && <CheckCircle2 className="h-5 w-5" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              ) : current.kind === "long" ? (
                <>
                  <Textarea
                    id={`apply-${current.key}`}
                    ref={(el) => { fieldRef.current = el; }}
                    rows={3}
                    maxLength={OUTCOME_MAX}
                    enterKeyHint="next"
                    placeholder={current.placeholder}
                    value={value}
                    aria-invalid={!!error}
                    onChange={(e) => set(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        next();
                      }
                    }}
                    className="resize-none rounded-2xl bg-background px-4 py-3 text-[18px] md:text-[18px]"
                  />
                  <p className="mt-1 text-right text-[12px] tabular-nums text-muted-foreground">{value.length}/{OUTCOME_MAX}</p>
                </>
              ) : (
                <Input
                  id={`apply-${current.key}`}
                  ref={(el) => { fieldRef.current = el; }}
                  type={current.kind === "email" ? "email" : current.kind === "tel" ? "tel" : "text"}
                  inputMode={current.kind === "email" ? "email" : current.kind === "tel" ? "tel" : "text"}
                  autoComplete={current.key === "full_name" ? "name" : current.kind === "email" ? "email" : current.kind === "tel" ? "tel" : "off"}
                  autoCapitalize={current.key === "full_name" ? "words" : "none"}
                  autoCorrect={current.key === "full_name" ? "on" : "off"}
                  spellCheck={false}
                  enterKeyHint={last ? "send" : "next"}
                  placeholder={current.placeholder}
                  value={value}
                  aria-invalid={!!error}
                  onChange={(e) => set(e.target.value)}
                  className={fieldCls}
                />
              )}
            </div>

            {error && (
              <p role="alert" className="mt-2.5 text-[14px] font-medium text-destructive">
                {error}
              </p>
            )}

            {/* Choices move on by themselves; Next is still there after Back, once one is picked. */}
            {(current.kind !== "choice" || value) && (
              <button
                type="submit"
                disabled={mutation.isPending}
                className="mt-6 flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--primary)_70%,transparent)] transition active:scale-[0.985] disabled:opacity-60"
              >
                {mutation.isPending ? (
                  <><Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Sending…</>
                ) : last ? (
                  "Send application"
                ) : (
                  "Next"
                )}
              </button>
            )}
            {contactStep && (
              <p className="mt-3 text-center text-[13px] text-muted-foreground">Only used to reach you about coaching.</p>
            )}
            {last && !mutation.isPending && (
              <p className="mt-2 text-center text-[13px] text-muted-foreground">Next you'll pick a time for a quick call.</p>
            )}
          </form>

          <input
            aria-hidden="true"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>
      </Block>
    </SalesPageShell>
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
  const getLink = useServerFn(getBookingPage);
  const getSlots = useServerFn(getBookingSlots);
  const book = useServerFn(bookOnline);

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
    queryFn: () => getSlots({ data: { slug, from: date, to: date } }),
    enabled: !!slug && !!date,
  });

  const [chosen, setChosen] = useState<string | null>(null);

  const bookMut = useMutation({
    mutationFn: async (start: string) => book({ data: {
      slug, start, name, email, phone: phone || null, applicationId: applicationId || null,
    } }),
    onSuccess: (r) => onBooked({
      starts_at: r.start,
      tz: localTz,
      duration: linkQ.data?.durationMin ?? 20,
      meet_link: r.meetLink,
    }),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't book that slot. Please try another time."),
  });

  const duration = linkQ.data?.durationMin ?? 20;
  const coachName = linkQ.data?.hostName ?? "Your coach";

  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onCancel} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back
        </button>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Pick a time</div>
      </div>

      <h2 className="mt-3 text-xl md:text-2xl font-bold tracking-tight">Book your coaching call</h2>
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
              <div className="text-base font-bold">{d.label}</div>
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
            {slotsQ.data?.error === "calendar_unavailable"
              ? "We couldn't check the calendar just now. Try again in a minute."
              : "No times available on this day. Try another date."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slotsQ.data!.slots.map((s) => {
              const active = chosen === s.start;
              const localLabel = new Date(s.start).toLocaleTimeString(undefined, {
                hour: "numeric", minute: "2-digit",
              });
              return (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => setChosen(s.start)}
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
          className="h-14 w-full text-base font-bold"
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
