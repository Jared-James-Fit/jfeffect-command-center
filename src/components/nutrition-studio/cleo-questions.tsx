/**
 * Create with Cleo's questions: a few taps, one screen. The member's targets
 * are shown, never asked (Cleo writes to their own saved targets); with none,
 * the way to set them. The health question is screened on the phone too, so a
 * "no draft" answer says so at once, kindly, before anything is sent (the
 * server screens it again with their record).
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CleoAvatar, CLEO_ROLE_LINE } from "@/components/summer/cleo-avatar";
import { AiCreditsChip, AiCreditsSheet, useAiCredits } from "@/components/ai-credits/ai-credits";
import { FEATURE_COSTS } from "@/lib/ai-credits/packs";
import {
  AVOID_CHIPS,
  BUDGET_CHOICES,
  COOKING_CHOICES,
  createSafety,
  DIET_CHOICES,
  HEALTH_CHOICES,
  LIKE_CHIPS,
  MEAL_COUNTS,
  missingAnswers,
  TRAINING_TIMES,
  type CreateAnswers,
  type HealthKey,
} from "@/lib/nutrition-import/create";

const COST = FEATURE_COSTS.nutrition_create;

export type ShownTargets = { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;

function Chip({ on, children, onClick, className }: { on: boolean; children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3.5 text-[14px] transition-colors",
        on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Question({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export function CleoQuestions({
  targets,
  targetsLoading,
  busy,
  error,
  outOfCredits,
  onSubmit,
  consent = null,
}: {
  targets: ShownTargets;
  targetsLoading: boolean;
  busy: boolean;
  error: string | null;
  outOfCredits: boolean;
  /** The inline AI-processing request, shown here when the server asked for it. */
  consent?: ReactNode;
  onSubmit: (a: CreateAnswers) => void;
}) {
  const credits = useAiCredits();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [a, setA] = useState<CreateAnswers>({
    mealsPerDay: 4,
    trainingDays: 3,
    trainingTime: null,
    likes: [],
    likesText: "",
    avoid: [],
    avoidText: "",
    diet: "No restrictions",
    cooking: "meal_prep",
    budget: "moderate",
    health: [],
  });
  const set = (patch: Partial<CreateAnswers>) => setA((x) => ({ ...x, ...patch }));
  const missing = missingAnswers(a);
  const safety = useMemo(() => (a.health.length ? createSafety(a, { age: null, healthTexts: [] }) : { ok: true as const }), [a]);
  const blocked = !safety.ok;

  return (
    <div className="space-y-6" data-cleo-questions>
      <div className="flex items-start gap-3">
        <CleoAvatar />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">
            Cleo <span className="font-normal text-muted-foreground">· {CLEO_ROLE_LINE}</span>
          </div>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            Answer a few questions and Cleo drafts a meal plan to your targets. It's a starting point you check and edit food by food before
            anything is saved.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-border p-4" data-cleo-targets>
        {targetsLoading ? (
          <div className="h-10 jf-skeleton rounded-lg bg-muted" aria-hidden />
        ) : targets ? (
          <>
            <div className="text-[13px] text-muted-foreground">Written to your targets</div>
            <div className="mt-0.5 text-[15px] font-medium tabular-nums">
              {Math.round(targets.calories).toLocaleString("en-CA")} kcal · P {Math.round(targets.protein_g)} · C {Math.round(targets.carbs_g)} · F{" "}
              {Math.round(targets.fat_g)}
            </div>
            <Link to="/portal/nutrition-targets" className="mt-1 inline-block text-[13px] font-medium underline-offset-2 hover:underline">
              Change my targets
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold">Set your targets first</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Cleo writes to your own calories and macros. Work them out on your Nutrition page, then come back here.
            </p>
            <Button asChild variant="outline" className="mt-3 h-10">
              <Link to="/portal/nutrition-targets">Set my targets</Link>
            </Button>
          </>
        )}
      </section>

      <Question title="Meals a day">
        <div className="flex flex-wrap gap-2">
          {MEAL_COUNTS.map((n) => (
            <Chip key={n} on={a.mealsPerDay === n} onClick={() => set({ mealsPerDay: n })} className="min-w-12">
              {n}
            </Chip>
          ))}
        </div>
      </Question>

      <Question title="Training days a week">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <Chip key={n} on={a.trainingDays === n} onClick={() => set({ trainingDays: n, ...(n === 0 ? { trainingTime: null } : {}) })} className="min-w-12">
              {n === 0 ? "None" : n}
            </Chip>
          ))}
        </div>
      </Question>

      {a.trainingDays > 0 && (
        <Question title="When do you usually train?" hint="So the meals before and after training land around it.">
          <div className="flex flex-wrap gap-2">
            {TRAINING_TIMES.map((t) => (
              <Chip key={t} on={a.trainingTime === t} onClick={() => set({ trainingTime: t })}>
                {t}
              </Chip>
            ))}
          </div>
        </Question>
      )}

      <Question title="Foods you like" hint="Pick any. Cleo builds around them.">
        <div className="flex flex-wrap gap-2">
          {LIKE_CHIPS.map((c) => (
            <Chip key={c} on={a.likes.includes(c)} onClick={() => set({ likes: toggle(a.likes, c) })}>
              {c}
            </Chip>
          ))}
        </div>
        <Input className="h-11" value={a.likesText} onChange={(e) => set({ likesText: e.target.value })} placeholder="Anything else you like" maxLength={300} name="search-likes" autoComplete="off" />
      </Question>

      <Question title="Foods you won't eat or can't" hint="Allergies included. Cleo keeps them out.">
        <div className="flex flex-wrap gap-2">
          {AVOID_CHIPS.map((c) => (
            <Chip key={c} on={a.avoid.includes(c)} onClick={() => set({ avoid: toggle(a.avoid, c) })}>
              {c}
            </Chip>
          ))}
        </div>
        <Input className="h-11" value={a.avoidText} onChange={(e) => set({ avoidText: e.target.value })} placeholder="Anything else, or an allergy" maxLength={300} name="search-avoid" autoComplete="off" />
      </Question>

      <Question title="Diet">
        <div className="flex flex-wrap gap-2">
          {DIET_CHOICES.map((d) => (
            <Chip key={d} on={a.diet === d} onClick={() => set({ diet: d })}>
              {d}
            </Chip>
          ))}
        </div>
      </Question>

      <Question title="How you like to cook">
        <div className="grid grid-cols-2 gap-2">
          {COOKING_CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={a.cooking === c.key}
              onClick={() => set({ cooking: c.key })}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors",
                a.cooking === c.key ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
              )}
            >
              <div className="text-[14px] font-medium">{c.label}</div>
              <div className={cn("text-[12px]", a.cooking === c.key ? "text-background/80" : "text-muted-foreground")}>{c.text}</div>
            </button>
          ))}
        </div>
      </Question>

      <Question title="Budget">
        <div className="flex flex-wrap gap-2">
          {BUDGET_CHOICES.map((b) => (
            <Chip key={b.key} on={a.budget === b.key} onClick={() => set({ budget: b.key })}>
              {b.label}
            </Chip>
          ))}
        </div>
      </Question>

      <Question title="Do any of these apply to you?" hint="Some things need a meal plan from a doctor or dietitian, not an app.">
        <div className="flex flex-col gap-2">
          {HEALTH_CHOICES.map((h) => {
            const on = a.health.includes(h.key);
            return (
              <button
                key={h.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set({
                    health:
                      h.key === "none"
                        ? on
                          ? []
                          : ["none"]
                        : (toggle(a.health.filter((x) => x !== "none"), h.key) as HealthKey[]),
                  })
                }
                className={cn(
                  "min-h-11 rounded-xl border px-3.5 py-2 text-left text-[14px] transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
                )}
              >
                {h.label}
              </button>
            );
          })}
        </div>
        {blocked && (
          <p className="rounded-xl bg-muted px-4 py-3 text-[14px] leading-relaxed" role="status" data-cleo-safety>
            {(safety as { message: string }).message}
          </p>
        )}
      </Question>

      {consent}

      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive" role="alert">
          {error}
        </p>
      )}

      {outOfCredits && (
        <div className="rounded-2xl border border-border p-4" role="alert">
          <p className="text-[15px] font-semibold">Not enough credits this month</p>
          <p className="mt-1 text-[14px] text-muted-foreground">{`A draft takes ${COST} credits. Get more credits, or build your plan yourself, food by food.`}</p>
          <Button variant="outline" className="mt-3" onClick={() => setCreditsOpen(true)}>
            Get credits
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">{`A draft takes ${COST} credits, given back if it can't be written.`}</p>
          <AiCreditsChip state={credits.data} onClick={() => setCreditsOpen(true)} className="shrink-0" />
        </div>
        <Button
          className="h-12 w-full text-[16px]"
          disabled={busy || blocked || !targets || missing.length > 0}
          onClick={() => onSubmit(a)}
          data-cleo-write
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            "Write my draft"
          )}
        </Button>
        {missing.length > 0 && !blocked && (
          <p className="text-center text-[13px] text-muted-foreground">
            {missing.includes("time") ? "Pick when you train. " : ""}
            {missing.includes("health") ? "Answer the last question to go on." : ""}
          </p>
        )}
      </div>

      <AiCreditsSheet open={creditsOpen} onOpenChange={setCreditsOpen} out={outOfCredits} feature="nutrition_create" />
    </div>
  );
}
