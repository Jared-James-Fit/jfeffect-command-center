/**
 * "Change it with AI" on the coach's Current plan card: the coach types what to
 * change about the client's current plan, the AI writes it in the background
 * (nutrition_plan_edits, nutrition-plan-edits.server.ts), and the coach sees
 * what changes day by day (the numbers before and after, which meals, the new
 * meals) before one tap puts it on the plan, with Undo. Nothing reaches the
 * client until then.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DayMeals } from "@/components/nutrition/nutrition-ui";
import {
  applyPlanEditFn,
  askPlanEditFn,
  discardPlanEditFn,
  getFoodHistoryFn,
  undoPlanEditFn,
} from "@/lib/nutrition-ai-plans.functions";
import { REVISE_MAX_CHARS } from "@/lib/nutrition-ai-prompts";
import {
  editChangesNothing,
  planAsMealPlanText,
  planAsTargetsText,
  planDays,
  planEditChanges,
  readEditedPlan,
  type DayChange,
  type PlanEditPlan,
} from "@/lib/nutrition-targets/plan-edit";
import { invalidateGroceryList } from "@/lib/grocery-query-keys";
import { introducedHardToFind, type HardToFind } from "@/lib/nutrition-targets/plan-foods";
import { allergenConflictLine, allergenConflicts, foodHistoryKey, onFileRules, type AllergenHit, type FoodHistory } from "@/lib/nutrition-targets/food-history";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { cn } from "@/lib/utils";

/** Changes coaches ask for most: a tap puts the words in the box to edit or send. */
export const PLAN_CHANGE_EXAMPLES = [
  { label: "Swap a food", text: "Swap the chicken for lean ground beef in one meal" },
  { label: "Fewer carbs", text: "Drop carbs by 20 g on rest days" },
  { label: "Fewer meals", text: "4 meals a day instead of 5" },
  { label: "Quicker breakfast", text: "Make breakfast something quick to make" },
];

type Edit = {
  id: string;
  status: "pending" | "generating" | "ready" | "error" | "applied" | "discarded" | "undone";
  instructions: string;
  before_targets_text: string;
  before_meal_plan_text: string;
  targets_text: string | null;
  meal_plan_text: string | null;
  error: string | null;
  applied_at: string | null;
  created_at: string;
};

const WORKING = new Set(["pending", "generating"]);
/** How long an applied change offers Undo on the card. */
const UNDO_FOR_MS = 7 * 24 * 3600_000;

export function PlanAiChange({
  clientId,
  plan,
  firstName,
}: {
  clientId: string;
  plan: PlanEditPlan & { id: string; status?: string | null; visible_to_client?: boolean | null };
  firstName: string | null;
}) {
  const qc = useQueryClient();
  const ask = useServerFn(askPlanEditFn);
  const apply = useServerFn(applyPlanEditFn);
  const undo = useServerFn(undoPlanEditFn);
  const discard = useServerFn(discardPlanEditFn);
  const [text, setText] = useState("");
  const key = ["nutrition-plan-edit", plan.id];

  // the client's food on file (the Food & diet card's read): an allergen on the changed plan is flagged
  const readFood = useServerFn(getFoodHistoryFn);
  const foodQ = useQuery({
    queryKey: foodHistoryKey(clientId),
    queryFn: () => readFood({ data: { clientId } }) as Promise<{ history: FoodHistory }>,
    staleTime: 30_000,
  });
  const onFile = useMemo(() => (foodQ.data ? onFileRules(foodQ.data.history) : {}), [foodQ.data]);
  const allergens = useMemo(() => Object.keys(onFile), [onFile]);

  const editQ = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Edit | null> => {
      const { data, error } = await (supabase as any)
        .from("nutrition_plan_edits")
        .select(
          "id, status, instructions, before_targets_text, before_meal_plan_text, targets_text, meal_plan_text, error, applied_at, created_at",
        )
        .eq("target_id", plan.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Edit | null) ?? null;
    },
    // while the AI writes, look again every few seconds
    refetchInterval: (q) => (q.state.data && WORKING.has(q.state.data.status) ? 4000 : false),
  });
  const edit = editQ.data ?? null;

  const refreshPlan = () => {
    qc.invalidateQueries({ queryKey: ["nutrition-targets", clientId] });
    qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
    qc.invalidateQueries({ queryKey: key });
    void invalidateGroceryList(qc, clientId);
  };
  const tellClient = () => {
    if (plan.visible_to_client !== false && plan.status !== "Archived")
      fireAppEvent("nutrition_targets_updated", clientId);
  };

  const askM = useMutation({
    mutationFn: (instructions: string) =>
      ask({ data: { clientId, targetId: plan.id, instructions } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't ask the AI"),
  });
  const undoM = useMutation({
    mutationFn: (editId: string) => undo({ data: { editId } }),
    onSuccess: () => {
      toast.success("Put back the plan from before the change");
      tellClient();
      refreshPlan();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't undo"),
  });
  const applyM = useMutation({
    mutationFn: (editId: string) => apply({ data: { editId } }),
    onSuccess: (_r, editId) => {
      toast.success(`${firstName ? `${firstName}'s` : "The"} plan is updated`, {
        action: { label: "Undo", onClick: () => undoM.mutate(editId) },
      });
      tellClient();
      refreshPlan();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Couldn't update the plan");
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const discardM = useMutation({
    mutationFn: (editId: string) => discard({ data: { editId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(e?.message ?? "Couldn't put it away"),
  });

  // The AI's answer read against the plan it was asked about; refused answers say why.
  const review = useMemo(() => {
    if (!edit || edit.status !== "ready" || !edit.meal_plan_text) return null;
    const stale =
      planAsMealPlanText(plan) !== edit.before_meal_plan_text ||
      planAsTargetsText(plan) !== edit.before_targets_text;
    try {
      const edited = readEditedPlan(plan, edit.meal_plan_text, edit.targets_text);
      const changes = planEditChanges(plan, edited);
      return {
        stale,
        changes,
        nothing: editChangesNothing(plan, edited, changes),
        rulesChanged:
          (edited.foodWeighingRules ?? "").trim() !== (plan.food_weighing_rules ?? "").trim(),
        // a specialty food the AI brought in that the coach didn't ask for (the server already sent it back once)
        hardToFind: introducedHardToFind(
          planDays(plan).map((d) => ({ label: d.day_label, notes: d.notes })),
          edited.days.map((d) => ({ label: d.day_label, notes: d.notes })),
          [{ value: edit.instructions }],
        ),
        // any food on the changed plan that carries an allergen on file, whoever asked for it
        allergy: allergenConflicts(
          edited.days.map((d) => ({ label: d.day_label, notes: d.notes })),
          allergens,
        ),
        error: null as string | null,
      };
    } catch (e: any) {
      return {
        stale,
        changes: [] as DayChange[],
        nothing: false,
        rulesChanged: false,
        hardToFind: [] as HardToFind[],
        allergy: [] as AllergenHit[],
        error: String(e?.message ?? e),
      };
    }
  }, [edit, plan, allergens]);

  const working = !!edit && WORKING.has(edit.status);
  const canUndo =
    edit?.status === "applied" &&
    !!edit.applied_at &&
    Date.now() - new Date(edit.applied_at).getTime() < UNDO_FOR_MS;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-plan-ai-change>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[15px] font-medium">Change it with AI</span>
      </div>

      {working && edit ? (
        <div className="space-y-2" data-plan-ai-state="working">
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">“{edit.instructions}”</p>
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Writing the change. About a minute; you can leave this screen.
          </p>
          <Button
            variant="ghost"
            className="h-10"
            disabled={discardM.isPending}
            onClick={() => discardM.mutate(edit.id)}
          >
            Cancel
          </Button>
        </div>
      ) : edit?.status === "ready" && review ? (
        <div className="space-y-3" data-plan-ai-state="ready">
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">“{edit.instructions}”</p>
          {review.error ? (
            <p className="text-[13px] text-destructive">{review.error}</p>
          ) : review.nothing ? (
            <p className="text-[13px] text-muted-foreground">
              The AI didn't change anything. Try saying it a different way.
            </p>
          ) : (
            <>
              {review.stale && (
                <p className="text-[13px] text-warning">
                  The plan changed since you asked. Ask again so the AI works from the plan as it is
                  now.
                </p>
              )}
              <ChangeRows changes={review.changes} />
              {review.allergy.length > 0 && (
                <p className="flex items-start gap-1.5 text-[13px] font-medium text-warning" data-plan-ai-allergen>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    Against what's on file: {allergenConflictLine(review.allergy, onFile)}. Discard and ask again, or check with them first.
                  </span>
                </p>
              )}
              {review.hardToFind.length > 0 && (
                <p className="text-[13px] text-warning" data-plan-ai-hard-to-find>
                  Hard to find in stores: {review.hardToFind.map((h) => h.food).join(", ")}. Discard
                  and ask for a common food instead, unless that's what you want.
                </p>
              )}
              {review.rulesChanged && (
                <p className="text-[13px] text-muted-foreground">
                  The food-weighing rules change too.
                </p>
              )}
            </>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {!review.error && !review.nothing && !review.stale && (
              <Button
                variant="default"
                className="h-11 flex-1 sm:flex-none"
                disabled={applyM.isPending}
                onClick={() => applyM.mutate(edit.id)}
              >
                {applyM.isPending
                  ? "Updating…"
                  : `Update ${firstName ? `${firstName}'s` : "the"} plan`}
              </Button>
            )}
            <Button
              variant="outline"
              className="h-11 flex-1 sm:flex-none"
              disabled={discardM.isPending}
              onClick={() => discardM.mutate(edit.id)}
            >
              {review.error || review.nothing || review.stale ? "Clear" : "Discard"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-plan-ai-state="ask">
          {edit?.status === "error" && (
            <div className="space-y-2 rounded-lg border border-destructive/40 px-3 py-2">
              <p className="text-[13px] text-destructive">
                {edit.error ?? "The AI couldn't write that change."}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-9"
                  disabled={askM.isPending}
                  onClick={() => askM.mutate(edit.instructions)}
                >
                  Try again
                </Button>
                <Button
                  variant="ghost"
                  className="h-9"
                  disabled={discardM.isPending}
                  onClick={() => discardM.mutate(edit.id)}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
          <Textarea
            rows={3}
            value={text}
            maxLength={REVISE_MAX_CHARS}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tell the AI what to change, e.g. salmon instead of chicken on rest days"
            className="text-base sm:text-sm"
          />
          {!text.trim() && (
            <div className="flex flex-wrap gap-1.5" aria-label="Examples">
              {PLAN_CHANGE_EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => setText(ex.text)}
                  className="h-9 rounded-full border border-border px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-11 gap-1.5"
              disabled={text.trim().length < 3 || askM.isPending}
              onClick={() => askM.mutate(text.trim())}
            >
              {askM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              Write the change
            </Button>
            <span className="text-[13px] text-muted-foreground">
              You'll see what changes before it reaches the client.
            </span>
          </div>
          {canUndo && edit && (
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
              <span className="min-w-0">Last AI change: “{edit.instructions}”</span>
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
                disabled={undoM.isPending}
                onClick={() => undoM.mutate(edit.id)}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const fmt = (v: number | null) => (v == null ? "—" : String(v));

/** Each day: calories before → after, the macros after (what moved in bold), which meals changed, and the new meals on a tap. */
function ChangeRows({ changes }: { changes: DayChange[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="divide-y divide-border rounded-xl border border-border" data-plan-ai-changes>
      {changes.map((c, i) => {
        const moved = c.before.kcal !== c.after.kcal;
        const same =
          !c.meals.length &&
          !moved &&
          c.before.protein === c.after.protein &&
          c.before.carbs === c.after.carbs &&
          c.before.fat === c.after.fat;
        const macro = (label: string, k: "protein" | "carbs" | "fat") => (
          <span className={cn(c.before[k] !== c.after[k] && "font-medium text-foreground")}>
            {label} {fmt(c.after[k])}
          </span>
        );
        return (
          <div key={i}>
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:hover:bg-transparent"
              disabled={same || !c.notes}
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <div className="min-w-0">
                <div className="text-[15px] font-medium">{c.label}</div>
                <div className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                  {macro("P", "protein")} · {macro("C", "carbs")} · {macro("F", "fat")}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {same
                    ? "No change"
                    : c.meals.length
                      ? `Changed: ${c.meals.join(", ")}`
                      : "Numbers only"}
                </div>
              </div>
              <div className="shrink-0 text-right text-[15px] tabular-nums">
                {moved ? (
                  <>
                    <span className="text-[13px] text-muted-foreground line-through">
                      {fmt(c.before.kcal)}
                    </span>{" "}
                    <span className="font-semibold">{fmt(c.after.kcal)}</span>
                  </>
                ) : (
                  <span className="font-semibold">{fmt(c.after.kcal)}</span>
                )}{" "}
                <span className="text-[13px] font-normal text-muted-foreground">kcal</span>
              </div>
            </button>
            {open === i && c.notes ? (
              <div className="px-3 pb-3">
                <DayMeals text={c.notes} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
