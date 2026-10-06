import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { FormPresentation, FormHistoryGroup as FormHistoryGroupData } from "@/lib/form-message-presentation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Flag,
  Loader2,
  MessageSquareText,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClientFormSheet } from "@/components/forms/client-form-sheet";
import { playAppSound } from "@/lib/app-sounds";
import {
  analyzeMessengerCheckin,
  getMessengerCheckin,
  submitMessengerCheckin,
  type MessengerCheckinTaskType,
} from "@/lib/messenger-checkins.functions";

type Role = "admin" | "client";

type Q = {
  key: string;
  prompt: string;
  helper?: string;
  type: "rating" | "single" | "multi" | "text";
  options?: string[];
  /** Word under each 1–5 rating button. */
  scale?: [string, string, string, string, string];
  optional?: boolean;
  showWhen?: (answers: Record<string, any>) => boolean;
};

const WEEKLY: Q[] = [
  {
    key: "week_rating",
    prompt: "How did this week go overall?",
    helper: "Tap a number. 1 = really rough · 5 = amazing.",
    type: "rating",
    scale: ["Rough", "Meh", "Okay", "Good", "Amazing"],
  },
  {
    key: "training_rating",
    prompt: "How did your workouts feel this week?",
    helper: "Think strength, energy and how your sessions went.",
    type: "rating",
    scale: ["Struggled", "Hard", "Okay", "Good", "Great"],
  },
  {
    key: "nutrition_rating",
    prompt: "How well did you stick to your meal plan?",
    helper: "1 = mostly off plan · 5 = on plan almost every day.",
    type: "rating",
    scale: ["Off plan", "Some days", "Half", "Most days", "Every day"],
  },
  {
    key: "recovery_flags",
    prompt: "Anything bugging you this week?",
    helper: "Tap everything that applies — or “All good” if nothing’s wrong.",
    type: "multi",
    options: [
      "All good",
      "Sleep",
      "Stress",
      "Energy",
      "Digestion / bloating",
      "Pain / injury",
      "Hunger / appetite",
      "Cardio",
      "Water / hydration",
    ],
  },
  {
    key: "pain_details",
    prompt: "Where does it hurt, and what makes it worse?",
    helper: "e.g. “Left knee hurts on squats and lunges.”",
    type: "text",
    showWhen: (a) => Array.isArray(a.recovery_flags) && a.recovery_flags.includes("Pain / injury"),
  },
  {
    key: "win",
    prompt: "What’s one win you’re proud of this week?",
    helper: "Anything counts — a PR, hitting your steps, better sleep. Optional.",
    type: "text",
    optional: true,
  },
  {
    key: "help",
    prompt: "Anything you need help with or want changed?",
    helper: "Workouts, meals, schedule — just tell me. Optional.",
    type: "text",
    optional: true,
  },
  {
    key: "next_week_goal",
    prompt: "What’s your #1 focus for next week?",
    helper: "Keep it simple, e.g. “Hit 8k steps every day.” Optional.",
    type: "text",
    optional: true,
  },
];

const NUTRITION: Q[] = [
  {
    key: "nutrition_rating",
    prompt: "How well did you stick to your meal plan?",
    helper: "1 = mostly off plan · 5 = on plan almost every day.",
    type: "rating",
    scale: ["Off plan", "Some days", "Half", "Most days", "Every day"],
  },
  {
    key: "hunger",
    prompt: "How hungry have you been?",
    type: "single",
    options: ["Not very hungry", "Just right", "Hungry a lot"],
  },
  {
    key: "digestion",
    prompt: "How has your stomach / digestion felt?",
    type: "single",
    options: ["Good — no issues", "A few issues (bloating, etc.)", "Bad most days"],
  },
  {
    key: "training_energy",
    prompt: "How’s your energy for workouts?",
    helper: "1 = drained · 5 = full of energy.",
    type: "rating",
    scale: ["Drained", "Low", "Okay", "Good", "Full"],
  },
  {
    key: "hardest",
    prompt: "What’s been the hardest part of your nutrition?",
    helper: "e.g. weekends, cravings, eating out, meal prep. Optional.",
    type: "text",
    optional: true,
  },
  {
    key: "food_changes",
    prompt: "Any foods or meals you want swapped?",
    helper: "Tell me what you’re sick of or can’t get. Optional.",
    type: "text",
    optional: true,
  },
  {
    key: "goal",
    prompt: "What’s your #1 nutrition goal until your next review?",
    helper: "e.g. “Hit my protein every day.” Optional.",
    type: "text",
    optional: true,
  },
];

const LABELS: Record<MessengerCheckinTaskType, Record<string, string>> = {
  weekly_checkin: {
    week_rating: "Overall week",
    training_rating: "Training",
    nutrition_rating: "Nutrition",
    recovery_flags: "Recovery / issues",
    pain_details: "Pain / injury",
    win: "Biggest win",
    help: "Help / changes",
    next_week_goal: "Next-week goal",
  },
  nutrition_review: {
    nutrition_rating: "Nutrition",
    hunger: "Hunger",
    digestion: "Digestion",
    training_energy: "Training energy",
    hardest: "Hardest part",
    food_changes: "Foods / meals to change",
    goal: "Nutrition goal",
  },
};

// Form / check-in cards are always blue so "action required" reads differently
// from coach (red) and client (neutral) bubbles.
const FORM_CARD =
  "w-[min(76vw,310px)] max-w-full rounded-2xl border border-blue-200 bg-blue-50 p-3 text-slate-900 shadow-sm dark:border-blue-400/30 dark:bg-blue-950 dark:text-blue-50";
const FORM_ICON = "bg-blue-600/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300";
const FORM_MUTED = "text-blue-900/70 dark:text-blue-100/70";

function taskQuestions(taskType: MessengerCheckinTaskType) {
  return taskType === "nutrition_review" ? NUTRITION : WEEKLY;
}

function titleFor(taskType: MessengerCheckinTaskType) {
  return taskType === "nutrition_review" ? "Nutrition Review" : "Weekly Check-In";
}

export function durationFor(taskType: MessengerCheckinTaskType) {
  return taskType === "nutrition_review" ? "About 2–3 minutes" : "About 60–90 seconds";
}

function displayAnswer(v: unknown) {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return `${v}/5`;
  return String(v ?? "—");
}

export function MessengerCheckinRequestCard({
  submissionId,
  taskType,
  role,
  clientId,
}: {
  submissionId: string;
  taskType: MessengerCheckinTaskType;
  role: Role;
  clientId: string;
}) {
  const get = useServerFn(getMessengerCheckin);
  const { data, isLoading } = useQuery({
    queryKey: ["messenger-checkin", submissionId],
    queryFn: () => get({ data: { submissionId } }),
    staleTime: 15_000,
  });
  const [open, setOpen] = useState(false);

  const done = data?.status === "completed";
  const superseded = data?.status === "superseded";

  return (
    <>
      <div className={FORM_CARD}>
        <div className="flex items-start gap-3">
          <span className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            done ? "bg-emerald-500/10 text-emerald-600" : FORM_ICON,
          )}>
            {done ? <CheckCircle2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{titleFor(taskType)}</div>
            <div className={cn("mt-0.5 text-xs", FORM_MUTED)}>
              {isLoading ? "Loading…" : done ? "Submitted" : superseded ? "Replaced by a newer check-in" : durationFor(taskType)}
            </div>
          </div>
        </div>

        {!isLoading && !done && !superseded && role === "client" && (
          <Button
            className="mt-3 h-10 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
            onClick={() => setOpen(true)}
          >
            {taskType === "nutrition_review" ? "Start review" : "Start check-in"} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
        {!isLoading && !done && !superseded && role === "admin" && (
          <div className="mt-3 rounded-xl bg-blue-600/10 px-3 py-2 text-xs font-medium text-blue-700 dark:bg-blue-400/15 dark:text-blue-200">
            Waiting for client
          </div>
        )}
        {done && role === "admin" && (
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-10 w-full border-emerald-500/25 bg-emerald-500/10 font-semibold text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800"
            onClick={() => setOpen(true)}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            View {taskType === "nutrition_review" ? "Nutrition Review" : "Check-In"}
          </Button>
        )}
        {done && role === "client" && (
          <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700">
            ✓ Complete
          </div>
        )}
      </div>

      {role === "admin" && done && (
        <AdminCompletedCheckinSheet
          open={open}
          onOpenChange={setOpen}
          taskType={taskType}
          answers={(data?.answers ?? {}) as Record<string, any>}
        />
      )}

      {role === "client" && (
        <CheckinWizard
          open={open}
          onOpenChange={setOpen}
          submissionId={submissionId}
          taskType={taskType}
          clientId={clientId}
          initialAnswers={(data?.answers ?? {}) as Record<string, any>}
        />
      )}
    </>
  );
}

function AdminCompletedCheckinSheet({
  open,
  onOpenChange,
  taskType,
  answers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskType: MessengerCheckinTaskType;
  answers: Record<string, any>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl p-0">
        <div className="mx-auto max-w-lg">
          <SheetHeader className="min-h-0 border-b border-border px-5 py-4 text-left">
            <SheetTitle>{titleFor(taskType)}</SheetTitle>
            <p className="text-sm text-muted-foreground">Client submission</p>
          </SheetHeader>
          <div className="space-y-3 px-5 py-5">
            {Object.entries(answers)
              .filter(([, v]) => v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0))
              .map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-border bg-card p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {LABELS[taskType][k] ?? k}
                  </div>
                  <div className="mt-1 text-sm font-medium">{displayAnswer(v)}</div>
                </div>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CheckinWizard({
  open,
  onOpenChange,
  submissionId,
  taskType,
  clientId,
  initialAnswers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  submissionId: string;
  taskType: MessengerCheckinTaskType;
  clientId: string;
  initialAnswers: Record<string, any>;
}) {
  const qc = useQueryClient();
  const submit = useServerFn(submitMessengerCheckin);
  const analyze = useServerFn(analyzeMessengerCheckin);
  const [answers, setAnswers] = useState<Record<string, any>>(initialAnswers);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(
    () => taskQuestions(taskType).filter((q) => !q.showWhen || q.showWhen(answers)),
    [taskType, answers],
  );
  const q = visible[Math.min(step, Math.max(0, visible.length - 1))];
  const current = q ? answers[q.key] : undefined;
  const isLast = step >= visible.length - 1;
  const answered =
    q?.optional ||
    (q?.type === "multi"
      ? Array.isArray(current) && current.length > 0
      : current !== undefined && current !== null && String(current).trim() !== "");

  function setAnswer(value: any, autoAdvance = false) {
    setAnswers((prev) => {
      let next = { ...prev, [q.key]: value };
      if (q.key === "recovery_flags" && Array.isArray(value)) {
        if (value.includes("All good") && value.length > 1) {
          next = { ...next, recovery_flags: ["All good"], pain_details: undefined };
        } else if (!value.includes("Pain / injury")) {
          next = { ...next, pain_details: undefined };
        }
      }
      return next;
    });
    if (autoAdvance) {
      window.setTimeout(() => setStep((s) => Math.min(s + 1, visible.length - 1)), 120);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      await submit({ data: { submissionId, answers } });
      playAppSound("success");
      // Close right away — refresh and the AI recap happen in the background.
      onOpenChange(false);
      setStep(0);
      toast.success("Sent to your coach ✅");
      void qc.invalidateQueries({ queryKey: ["messenger-checkin", submissionId] });
      void qc.invalidateQueries({ queryKey: ["messages", clientId, "client"] });
      void qc.invalidateQueries({ queryKey: ["action-centre", clientId] });
      void analyze({ data: { submissionId } }).catch(() => {});
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggleOption(option: string) {
    const arr: string[] = Array.isArray(current) ? current : [];
    if (option === "All good") {
      setAnswer(arr.includes("All good") ? [] : ["All good"]);
      return;
    }
    const withoutAllGood = arr.filter((x) => x !== "All good");
    setAnswer(
      withoutAllGood.includes(option)
        ? withoutAllGood.filter((x) => x !== option)
        : [...withoutAllGood, option],
    );
  }

  if (!q) return null;
  const pct = Math.round(((step + 1) / visible.length) * 100);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="max-h-[92dvh] rounded-t-3xl p-0"
      >
        <div className="mx-auto max-w-lg">
          <SheetHeader className="min-h-0 space-y-0 border-b border-border px-5 pb-4 pt-4 text-left">
            <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
              <SheetClose
                aria-label="Back"
                className="inline-flex h-10 min-w-[78px] shrink-0 items-center justify-center gap-1 rounded-full border border-border bg-background/95 px-3 text-sm font-semibold text-foreground shadow-sm transition hover:bg-secondary active:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Back</span>
              </SheetClose>
              <SheetTitle className="min-w-0 truncate text-base">
                {titleFor(taskType)}
              </SheetTitle>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {step + 1} / {visible.length}
              </span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </SheetHeader>

          <div className="px-5 py-6">
            <div className="min-h-[230px]">
              <h3 className="text-xl font-black leading-tight">{q.prompt}</h3>
              {q.helper && <p className="mt-2 text-sm text-muted-foreground">{q.helper}</p>}

              {q.type === "rating" && (
                <div className="mt-7 grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAnswer(n, true)}
                      className={cn(
                        "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl border px-0.5 transition active:scale-95",
                        current === n
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:bg-secondary/50",
                      )}
                    >
                      <span className="text-lg font-bold leading-none">{n}</span>
                      {q.scale && (
                        <span className={cn(
                          "text-[10px] font-semibold leading-tight",
                          current === n ? "text-primary-foreground/90" : "text-muted-foreground",
                        )}>
                          {q.scale[n - 1]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {q.type === "single" && (
                <div className="mt-6 space-y-2">
                  {(q.options ?? []).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setAnswer(o, true)}
                      className={cn(
                        "flex min-h-14 w-full items-center justify-between rounded-2xl border px-4 text-left text-sm font-semibold transition active:scale-[0.99]",
                        current === o
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card",
                      )}
                    >
                      {o}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {q.type === "multi" && (() => {
                const picked: string[] = Array.isArray(current) ? current : [];
                const flags = picked.filter((x) => x !== "All good");
                return (
                  <div className="mt-6 space-y-2" data-no-doubletap>
                    <div className="grid grid-cols-2 gap-2">
                      {(q.options ?? []).map((o) => {
                        const selected = picked.includes(o);
                        const isAllGood = o === "All good";
                        return (
                          <button
                            key={o}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleOption(o)}
                            className={cn(
                              "relative flex min-h-14 touch-manipulation select-none items-center justify-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98]",
                              isAllGood && "col-span-2",
                              selected
                                ? isAllGood
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card",
                            )}
                          >
                            {selected && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                            {isAllGood ? "All good — nothing to flag" : o}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      {flags.length > 0
                        ? `${flags.length} selected · tap more to add`
                        : picked.includes("All good")
                          ? "Nothing to flag this week 👍"
                          : "Tap every one that applies"}
                    </p>
                  </div>
                );
              })()}

              {q.type === "text" && (
                <Textarea
                  autoFocus
                  rows={4}
                  value={current ?? ""}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type here…"
                  className="mt-6 min-h-[130px] resize-none rounded-2xl text-base"
                />
              )}
            </div>

            <div className="mt-5 flex gap-2">
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 px-5"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={saving}
                >
                  Back
                </Button>
              )}
              <Button
                type="button"
                className="h-12 flex-1 font-bold"
                disabled={!answered || saving}
                onClick={() => {
                  if (isLast) void finish();
                  else setStep((s) => Math.min(s + 1, visible.length - 1));
                }}
              >
                {saving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
                ) : isLast ? (
                  "Send to Coach"
                ) : q.optional && !current ? (
                  "Skip"
                ) : (
                  "Next"
                )}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function MessengerCheckinSubmissionCard({
  submissionId,
  taskType,
  role,
  onUseReply,
}: {
  submissionId: string;
  taskType: MessengerCheckinTaskType;
  role: Role;
  onUseReply?: (text: string) => void;
}) {
  const get = useServerFn(getMessengerCheckin);
  const analyze = useServerFn(analyzeMessengerCheckin);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["messenger-checkin", submissionId],
    queryFn: () => get({ data: { submissionId } }),
    staleTime: 30_000,
    // Coach view: the AI recap fills in a few seconds after submit.
    refetchInterval: (q) =>
      role === "admin" && (q.state.data as any)?.status === "completed" && (q.state.data as any)?.ai_status !== "ready"
        ? 4000
        : false,
  });
  // If the recap never ran (client closed the app right after sending),
  // the coach's view finishes it.
  const kicked = useRef(false);
  useEffect(() => {
    if (role !== "admin" || kicked.current || !data) return;
    if ((data as any).status !== "completed" || (data as any).ai_status === "ready") return;
    kicked.current = true;
    void analyze({ data: { submissionId } })
      .then(() => qc.invalidateQueries({ queryKey: ["messenger-checkin", submissionId] }))
      .catch(() => {});
  }, [role, data, analyze, submissionId, qc]);

  if (isLoading || !data) {
    return (
      <div className={cn(FORM_CARD, "flex items-center gap-2 text-xs")}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading check-in…
      </div>
    );
  }

  const answers = (data.answers ?? {}) as Record<string, any>;
  const analysis = data.ai_analysis as any;

  if (role === "client") {
    return (
      <div className={FORM_CARD}>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <div className="text-sm font-bold">{titleFor(taskType)} sent</div>
            <div className={cn("text-xs", FORM_MUTED)}>Your coach has the full update.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(FORM_CARD, "w-[min(78vw,390px)]")}>
      <div className="flex items-center gap-2">
        <span className={cn("grid h-9 w-9 place-items-center rounded-full", FORM_ICON)}>
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold">{titleFor(taskType)} recap</div>
          <div className={cn("text-xs", FORM_MUTED)}>AI-assisted coach summary</div>
        </div>
      </div>

      {analysis ? (
        <div className="mt-3 space-y-2">
          <RecapRow icon={Trophy} label="Win" items={analysis.wins} empty="No clear win flagged" />
          <RecapRow icon={Target} label="Focus" items={analysis.focus} empty="No major focus flagged" />
          <RecapRow icon={CheckCircle2} label="Goals" items={analysis.goals} empty="No goal entered" />
          <RecapRow
            icon={Flag}
            label="Red flags"
            items={analysis.red_flags}
            empty="None"
            danger={(analysis.red_flags ?? []).length > 0}
          />

          <details className="rounded-xl border border-border bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold">All answers</summary>
            <div className="mt-2 space-y-2">
              {Object.entries(answers)
                .filter(([, v]) => v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0))
                .map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {LABELS[taskType][k] ?? k}
                    </div>
                    <div className="text-xs">{displayAnswer(v)}</div>
                  </div>
                ))}
            </div>
          </details>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <MessageSquareText className="h-3.5 w-3.5" /> Suggested response
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {analysis.suggested_response}
            </p>
            {onUseReply && analysis.suggested_response && (
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full"
                onClick={() => onUseReply(String(analysis.suggested_response))}
              >
                Use reply
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          AI recap unavailable. Open all answers below.
          <details className="mt-2 rounded-xl border border-border p-3">
            <summary className="cursor-pointer font-semibold">All answers</summary>
            <div className="mt-2 space-y-2">
              {Object.entries(answers).map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    {LABELS[taskType][k] ?? k}
                  </div>
                  <div className="text-xs">{displayAnswer(v)}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function RecapRow({
  icon: Icon,
  label,
  items,
  empty,
  danger = false,
}: {
  icon: any;
  label: string;
  items?: string[];
  empty: string;
  danger?: boolean;
}) {
  const vals = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2",
      danger ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/20",
    )}>
      <div className={cn(
        "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
        danger ? "text-destructive" : "text-muted-foreground",
      )}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      {vals.length ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {vals.slice(0, 3).map((x, i) => <li key={i}>• {x}</li>)}
        </ul>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}


function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Compact history row for a recurring chat form that is no longer the
 * current action (older, superseded, or completed). Roughly the height of a
 * normal chat line; tap to reveal timestamps and open the submitted answers.
 */
export function FormHistoryRow({ p, role }: { p: FormPresentation; role: Role }) {
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const completed = p.state === "completed";
  const statusLine = completed
    ? "Completed"
    : role === "admin"
    ? `Not completed · ${p.readAt ? `Read ${fmtShortDate(p.readAt)}` : "Unread"}`
    : "Not completed";

  return (
    <div className="mx-auto w-full max-w-sm" data-form-history-row>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-secondary/60 active:bg-secondary"
      >
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            completed ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
          )}
        >
          {completed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
            {titleFor(p.taskType)} · {fmtShortDate(p.sentAt)}
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">{statusLine}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", expanded ? "rotate-0" : "-rotate-90")}
        />
      </button>

      {expanded && (
        <div className="mx-3 mb-1 mt-0.5 space-y-1 border-l-2 border-border pl-4 text-[11px] text-muted-foreground">
          <div>Sent {fmtDateTime(p.sentAt)}</div>
          {role === "admin" && <div>{p.readAt ? `Read ${fmtDateTime(p.readAt)}` : "Not opened"}</div>}
          {p.submittedAt ? (
            <div>Submitted {fmtDateTime(p.submittedAt)}</div>
          ) : (
            <div>Replaced by a newer {titleFor(p.taskType).toLowerCase()}</div>
          )}
          {completed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1.5 h-8 rounded-full px-3 text-xs font-semibold"
              onClick={() => setSheetOpen(true)}
            >
              View {p.taskType === "nutrition_review" ? "review" : "check-in"}
            </Button>
          )}
        </div>
      )}

      {completed && (
        <CheckinAnswersSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          submissionId={p.submissionId}
          taskType={p.taskType}
          role={role}
          submittedAt={p.submittedAt}
        />
      )}
    </div>
  );
}

/**
 * One row for ALL older requests of a form type: "Weekly Check-In history ·
 * 6 filled · 2 missed". Tap to open the individual rows. The point is tracking
 * (anything missed?), not a log of every old request.
 */
export function FormHistoryGroup({ group, role }: { group: FormHistoryGroupData; role: Role }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto w-full max-w-sm" data-form-history-group>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-secondary/60 active:bg-secondary"
      >
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            group.missed > 0 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {group.missed > 0 ? <CircleDashed className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
            Earlier {titleFor(group.taskType).toLowerCase()}s
          </span>
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            {group.filled} filled
            {group.missed > 0 && (
              <span className="font-semibold text-amber-600 dark:text-amber-400"> · {group.missed} missed</span>
            )}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", open ? "rotate-0" : "-rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {group.units.map((p) => (
            <FormHistoryRow key={p.submissionId} p={p} role={role} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckinAnswersSheet({
  open,
  onOpenChange,
  submissionId,
  taskType,
  role,
  submittedAt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  submissionId: string;
  taskType: MessengerCheckinTaskType;
  role: Role;
  submittedAt: string | null;
}) {
  const get = useServerFn(getMessengerCheckin);
  const { data, isLoading } = useQuery({
    queryKey: ["messenger-checkin", submissionId],
    queryFn: () => get({ data: { submissionId } }),
    staleTime: 30_000,
    enabled: open,
  });
  const answers = (data?.answers ?? {}) as Record<string, any>;
  const analysis = role === "admin" ? (data?.ai_analysis as any) : null;
  const when = (data?.submitted_at as string | null) ?? submittedAt;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl p-0">
        <div className="mx-auto max-w-lg">
          <SheetHeader className="min-h-0 border-b border-border px-5 py-4 text-left">
            <SheetTitle>{titleFor(taskType)}</SheetTitle>
            <p className="text-sm text-muted-foreground">
              {when ? `Submitted ${fmtDateTime(when)}` : "Submitted"}
            </p>
          </SheetHeader>
          <div className="space-y-3 px-5 py-5">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                {analysis && (
                  <div className="space-y-2">
                    <RecapRow icon={Trophy} label="Win" items={analysis.wins} empty="No clear win flagged" />
                    <RecapRow icon={Target} label="Focus" items={analysis.focus} empty="No major focus flagged" />
                    <RecapRow icon={CheckCircle2} label="Goals" items={analysis.goals} empty="No goal entered" />
                    <RecapRow
                      icon={Flag}
                      label="Red flags"
                      items={analysis.red_flags}
                      empty="None"
                      danger={(analysis.red_flags ?? []).length > 0}
                    />
                  </div>
                )}
                {Object.entries(answers)
                  .filter(([, v]) => v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0))
                  .map(([k, v]) => (
                    <div key={k} className="rounded-2xl border border-border bg-card p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {LABELS[taskType][k] ?? k}
                      </div>
                      <div className="mt-1 text-sm font-medium">{displayAnswer(v)}</div>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Native form request (e.g. Nutrition Update Request) styled like the
 * Weekly Check-In card. Clients fill it in-app in a sheet; coaches see the
 * status and jump to the result.
 */
export function FormRequestChatCard({
  formId,
  title,
  note,
  clientId,
  role,
  sentAt,
}: {
  formId: string;
  title?: string | null;
  note?: string | null;
  clientId: string;
  role: Role;
  sentAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: sub, isLoading } = useQuery({
    queryKey: ["chat-form-request-status", formId, clientId, sentAt ?? null],
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      let q = (supabase as any)
        .from("nf_submissions")
        .select("id, status, submitted_at, created_at")
        .eq("form_id", formId)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1);
      // Only count a submission made for THIS request (after it was sent).
      if (sentAt) q = q.gte("created_at", new Date(new Date(sentAt).getTime() - 60_000).toISOString());
      const { data } = await q;
      return (data?.[0] ?? null) as { id: string; status: string; submitted_at: string | null } | null;
    },
  });
  const done = !!sub && sub.status !== "in_progress";
  const started = !!sub && sub.status === "in_progress";
  const isNutrition = formId === NUTRITION_FORM_ID;
  const heading = title || (isNutrition ? "Nutrition Update" : "Form");
  return (
    <>
      <div className={FORM_CARD}>
        <div className="flex items-start gap-3">
          <span className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            done ? "bg-emerald-500/10 text-emerald-600" : FORM_ICON,
          )}>
            {done ? <CheckCircle2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{heading}</div>
            <div className={cn("mt-0.5 text-xs", FORM_MUTED)}>
              {isLoading ? "Loading…" : done ? "Submitted" : started ? "In progress" : isNutrition ? "About 3–4 minutes" : "A few minutes"}
            </div>
          </div>
        </div>
        {note && !done && <div className={cn("mt-2 text-xs", FORM_MUTED)}>{note}</div>}
        {!isLoading && !done && role === "client" && (
          <Button
            className="mt-3 h-10 w-full bg-blue-600 font-semibold text-white hover:bg-blue-700"
            onClick={() => setOpen(true)}
          >
            {started ? "Continue" : isNutrition ? "Start nutrition update" : "Start form"} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
        {!isLoading && !done && role === "admin" && (
          <div className="mt-3 rounded-xl bg-blue-600/10 px-3 py-2 text-xs font-medium text-blue-700 dark:bg-blue-400/15 dark:text-blue-200">
            {started ? "Client is filling it out" : "Waiting for client"}
          </div>
        )}
        {done && role === "admin" && (
          <a
            href={`/admin/clients/${clientId}?tab=${isNutrition ? "nutrition" : "documents"}`}
            className="mt-3 flex h-10 w-full items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/10 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {isNutrition ? "View AI plan" : "View submission"}
          </a>
        )}
        {done && role === "client" && (
          <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700">
            ✓ Sent to your coach{isNutrition ? " — your new plan is on the way" : ""}
          </div>
        )}
      </div>
      {role === "client" && open && (
        <ClientFormSheet
          formId={formId}
          title={heading}
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) qc.invalidateQueries({ queryKey: ["chat-form-request-status", formId] });
          }}
        />
      )}
    </>
  );
}

const NUTRITION_FORM_ID = "b7a1f0c2-5d3e-4c8a-9f21-6e0d4a1b2c3d";
