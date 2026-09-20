import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Flag,
  Loader2,
  MessageSquareText,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
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
  optional?: boolean;
  showWhen?: (answers: Record<string, any>) => boolean;
};

const WEEKLY: Q[] = [
  {
    key: "week_rating",
    prompt: "How was your week overall?",
    helper: "1 = rough · 5 = great",
    type: "rating",
  },
  {
    key: "training_rating",
    prompt: "How did training feel?",
    helper: "Think performance + how sessions felt.",
    type: "rating",
  },
  {
    key: "nutrition_rating",
    prompt: "How consistent was nutrition?",
    helper: "1 = way off · 5 = nailed it",
    type: "rating",
  },
  {
    key: "recovery_flags",
    prompt: "Anything we should pay attention to?",
    helper: "Pick all that apply.",
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
    prompt: "What hurts or what movements are affected?",
    type: "text",
    showWhen: (a) => Array.isArray(a.recovery_flags) && a.recovery_flags.includes("Pain / injury"),
  },
  {
    key: "win",
    prompt: "Biggest win this week?",
    helper: "Optional — keep it short.",
    type: "text",
    optional: true,
  },
  {
    key: "help",
    prompt: "Anything you need help with or want changed?",
    helper: "Optional — this is your chance to flag something.",
    type: "text",
    optional: true,
  },
  {
    key: "next_week_goal",
    prompt: "What do you want to nail next week?",
    helper: "One clear focus is enough.",
    type: "text",
    optional: true,
  },
];

const NUTRITION: Q[] = [
  {
    key: "nutrition_rating",
    prompt: "How consistent was nutrition?",
    helper: "1 = way off · 5 = nailed it",
    type: "rating",
  },
  {
    key: "hunger",
    prompt: "How was hunger / appetite?",
    type: "single",
    options: ["Low", "Good", "High"],
  },
  {
    key: "digestion",
    prompt: "How was digestion?",
    type: "single",
    options: ["Good", "Some issues", "Bad"],
  },
  {
    key: "training_energy",
    prompt: "How was energy around training?",
    helper: "1 = drained · 5 = great",
    type: "rating",
  },
  {
    key: "hardest",
    prompt: "What was hardest about nutrition?",
    helper: "Optional.",
    type: "text",
    optional: true,
  },
  {
    key: "food_changes",
    prompt: "Any foods or meals you want changed?",
    helper: "Optional.",
    type: "text",
    optional: true,
  },
  {
    key: "goal",
    prompt: "Main nutrition goal until the next review?",
    helper: "One clear target.",
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

function taskQuestions(taskType: MessengerCheckinTaskType) {
  return taskType === "nutrition_review" ? NUTRITION : WEEKLY;
}

function titleFor(taskType: MessengerCheckinTaskType) {
  return taskType === "nutrition_review" ? "Nutrition Review" : "Weekly Check-In";
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

  return (
    <>
      <div className="w-[min(76vw,310px)] rounded-2xl border border-border bg-background/90 p-3 text-foreground shadow-sm">
        <div className="flex items-start gap-3">
          <span className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
            done ? "bg-emerald-500/10 text-emerald-600" : "bg-primary/10 text-primary",
          )}>
            {done ? <CheckCircle2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{titleFor(taskType)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {isLoading ? "Loading…" : done ? "Submitted" : "About 60–90 seconds"}
            </div>
          </div>
        </div>

        {!isLoading && !done && role === "client" && (
          <Button
            className="mt-3 h-10 w-full font-semibold"
            onClick={() => setOpen(true)}
          >
            Start check-in <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
        {!isLoading && !done && role === "admin" && (
          <div className="mt-3 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Waiting for client
          </div>
        )}
        {done && (
          <div className="mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700">
            ✓ Complete
          </div>
        )}
      </div>

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
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["messenger-checkin", submissionId] }),
        qc.invalidateQueries({ queryKey: ["messages", clientId, "client"] }),
        qc.invalidateQueries({ queryKey: ["action-centre", clientId] }),
      ]);
      onOpenChange(false);
      setStep(0);
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
        className="max-h-[92dvh] rounded-t-3xl p-0"
      >
        <div className="mx-auto max-w-lg">
          <SheetHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
            <div className="mb-2 flex items-center justify-between gap-3">
              <SheetTitle className="text-base">{titleFor(taskType)}</SheetTitle>
              <span className="text-xs tabular-nums text-muted-foreground">
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
                        "h-14 rounded-2xl border text-lg font-bold transition active:scale-95",
                        current === n
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:bg-secondary/50",
                      )}
                    >
                      {n}
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

              {q.type === "multi" && (
                <div className="mt-6 grid grid-cols-2 gap-2">
                  {(q.options ?? []).map((o) => {
                    const selected = Array.isArray(current) && current.includes(o);
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => toggleOption(o)}
                        className={cn(
                          "min-h-14 rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98]",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card",
                        )}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}

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
  const { data, isLoading } = useQuery({
    queryKey: ["messenger-checkin", submissionId],
    queryFn: () => get({ data: { submissionId } }),
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex w-[min(76vw,330px)] items-center gap-2 rounded-2xl border border-border bg-background/90 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading check-in…
      </div>
    );
  }

  const answers = (data.answers ?? {}) as Record<string, any>;
  const analysis = data.ai_analysis as any;

  if (role === "client") {
    return (
      <div className="w-[min(76vw,310px)] rounded-2xl border border-emerald-500/20 bg-background/90 p-3 text-foreground shadow-sm">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <div className="text-sm font-bold">{titleFor(taskType)} sent</div>
            <div className="text-xs text-muted-foreground">Your coach has the full update.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[min(78vw,390px)] rounded-2xl border border-border bg-background p-3 text-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold">{titleFor(taskType)} recap</div>
          <div className="text-xs text-muted-foreground">AI-assisted coach summary</div>
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
