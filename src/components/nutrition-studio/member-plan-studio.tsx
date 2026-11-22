/**
 * A JF member's own meal plan, in the Nutrition Studio: their plan's days
 * (each day's targets and meals, built food by food), saved into the same
 * plan tables as a coach's plan (RLS: a self-serve member writes only their
 * own; 20270508090000_nutrition_studio.sql), so their Nutrition page, the PDF,
 * the grocery list and the food log read it like any plan. A new plan replaces
 * the one before it, archived with its dates, never deleted.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CardMenu, CardMenuItem, CardMenuSeparator } from "@/components/workout-day/card-menu";
import { MealBuilder } from "@/components/nutrition-studio/meal-builder";
import { PlanDayUseEditor } from "@/components/nutrition/PlanDayRules";
import { archiveReplacedPlans } from "@/lib/nutrition-targets/plan-publish";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { plainPastedText } from "@/lib/nutrition-targets/plain-paste";
import { PHASE_GOAL } from "@/lib/nutrition-cardio";

export type StudioPlanDay = {
  day_label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  notes: string;
  use_on: string | null;
  weekdays: string[] | null;
};

const today = () => new Date().toLocaleDateString("en-CA");

/** The plan's phase, the same names a coach's plan uses. */
export const PHASES = ["Fat Loss", "Maintenance", "Muscle Gain", "Recomp", "Performance"] as const;

export function blankDay(label: string, t?: { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null } | null): StudioPlanDay {
  return {
    day_label: label,
    calories: t?.calories ?? null,
    protein: t?.protein_g ?? null,
    carbs: t?.carbs_g ?? null,
    fats: t?.fat_g ?? null,
    notes: "",
    use_on: label === "Every day" ? "every_day" : label.startsWith("Training") ? "training" : label.startsWith("Rest") || label.startsWith("Non") ? "rest" : null,
    weekdays: null,
  };
}

/** The member's own client record and current plan (null when they have none). */
export function useMyStudioPlan() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  return useQuery({
    queryKey: ["nutrition-studio-plan", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data: client, error: ce } = await (supabase as any).from("clients").select("id, service_tier").eq("user_id", uid!).maybeSingle();
      if (ce) throw ce;
      if (!client) return { clientId: null as string | null, selfServe: false, plan: null as any };
      const { data: plan, error } = await (supabase as any)
        .from("nutrition_targets")
        .select("id, phase, start_date, status, client_notes, food_weighing_rules, assigned_coach_id, nutrition_target_days(day_label, calories, protein, carbs, fats, notes, sort_order, use_on, weekdays)")
        .eq("client_id", client.id)
        .neq("status", "Archived")
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return { clientId: client.id as string, selfServe: client.service_tier === "self_serve", plan };
    },
  });
}

export function MemberPlanStudio({
  seed,
  onSaved,
}: {
  seed?: { days: StudioPlanDay[]; phase?: string | null; weighing?: string | null } | null;
  /** After the plan is saved (an import files its original in their documents); never blocks the save. */
  onSaved?: (planId: string) => void | Promise<void>;
}) {
  const planQ = useMyStudioPlan();
  const targetsFn = useServerFn(getActiveMemberTargets);
  const targetsQ = useQuery({ queryKey: ["m-nutrition-targets-studio"], queryFn: () => targetsFn({}), retry: false });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [days, setDays] = useState<StudioPlanDay[] | null>(null);
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<string>("Maintenance");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // start from the plan they have, a draft handed in (an import, a Cleo draft), or one day at their own targets
  useEffect(() => {
    if (days || !planQ.data) return;
    if (seed?.days?.length) {
      setDays(seed.days);
      if (seed.phase) setPhase(seed.phase);
      setDirty(true);
      return;
    }
    const plan = planQ.data.plan;
    if (plan && !plan.assigned_coach_id) {
      const ds = ((plan.nutrition_target_days ?? []) as any[]).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setDays(ds.map((d) => ({ day_label: d.day_label, calories: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats, notes: d.notes ?? "", use_on: d.use_on, weekdays: d.weekdays })));
      setPhase(plan.phase ?? "Maintenance");
      return;
    }
    if (targetsQ.isLoading) return;
    setDays([blankDay("Every day", targetsQ.data as any)]);
  }, [planQ.data, targetsQ.data, targetsQ.isLoading, seed, days]);

  const editDay = (i: number, patch: Partial<StudioPlanDay>) => {
    setDays((ds) => ds!.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  const save = async () => {
    const info = planQ.data;
    if (!info?.clientId || !days) return;
    if (!info.selfServe) return toast.error("Your coach writes your plan.");
    setSaving(true);
    try {
      // an import or a Cleo draft is a new plan: the one before is archived with its dates, never overwritten
      const existing = !seed?.days?.length && info.plan && !info.plan.assigned_coach_id ? info.plan : null;
      const payload = { client_id: info.clientId, phase, goal: PHASE_GOAL[phase] ?? null, start_date: existing?.start_date ?? today(), status: "Active", visible_to_client: true, last_updated_at: new Date().toISOString(), food_weighing_rules: seed?.weighing ?? existing?.food_weighing_rules ?? null };
      let id = existing?.id as string | undefined;
      if (id) {
        const { error } = await (supabase as any).from("nutrition_targets").update(payload).eq("id", id);
        if (error) throw error;
        const { error: de } = await (supabase as any).from("nutrition_target_days").delete().eq("target_id", id);
        if (de) throw de;
      } else {
        const { data, error } = await (supabase as any).from("nutrition_targets").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id;
        await archiveReplacedPlans(info.clientId, id!, payload.start_date);
      }
      const rows = days.map((d, i) => ({ target_id: id, sort_order: i, day_label: d.day_label.trim() || `Day ${i + 1}`, calories: d.calories, protein: d.protein, carbs: d.carbs, fats: d.fats, notes: d.notes.trim() ? plainPastedText(d.notes) : null, use_on: d.use_on, weekdays: d.weekdays }));
      const { error: ie } = await (supabase as any).from("nutrition_target_days").insert(rows);
      if (ie) throw ie;
      setDirty(false);
      for (const k of [["nutrition-studio-plan"], ["m-coach-meal-plan"], ["grocery-list"], ["nutrition-dashboard"]]) qc.invalidateQueries({ queryKey: k });
      toast.success("Plan saved");
      if (onSaved) await Promise.resolve(onSaved(id!)).catch(() => undefined);
      navigate({ to: "/portal/nutrition-targets" });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the plan");
    } finally {
      setSaving(false);
    }
  };

  if (planQ.isLoading || !days) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (planQ.data && !planQ.data.selfServe) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <PageHeader title="Meal plan" backTo="/portal/nutrition-targets" />
        <p className="px-4 py-6 text-sm text-muted-foreground">Your coach writes your meal plan. You'll find it on your Nutrition page.</p>
      </div>
    );
  }
  const day = days[Math.min(active, days.length - 1)];
  const i = Math.min(active, days.length - 1);
  const memberTargets = targetsQ.data as any;

  return (
    <div className="mx-auto w-full max-w-2xl pb-28" data-member-studio>
      <PageHeader
        title="Your meal plan"
        backTo="/portal/nutrition-targets"
        actions={
          <Button className="h-10" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        }
        actionsInline
      />
      <div className="space-y-4 px-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Phase" data-studio-phase>
          {PHASES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={phase === p}
              onClick={() => {
                setPhase(p);
                setDirty(true);
              }}
              className={cn("h-8 shrink-0 rounded-lg px-2.5 text-[13px]", phase === p ? "bg-secondary font-medium text-foreground" : "text-muted-foreground")}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Days">
          {days.map((d, j) => (
            <button
              key={j}
              type="button"
              role="tab"
              aria-selected={j === i}
              onClick={() => setActive(j)}
              className={cn("h-9 shrink-0 rounded-full border px-3 text-[13px]", j === i ? "border-foreground bg-foreground text-background" : "border-border")}
            >
              {d.day_label || `Day ${j + 1}`}
            </button>
          ))}
          <button
            type="button"
            className="h-9 shrink-0 rounded-full border border-dashed border-border px-3 text-[13px] text-muted-foreground"
            onClick={() => {
              const label = days.length === 1 && days[0].day_label === "Every day" ? "Rest day" : `Day ${days.length + 1}`;
              const next = days.length === 1 && days[0].day_label === "Every day" ? [{ ...days[0], day_label: "Training day", use_on: "training" }, blankDay(label, memberTargets)] : [...days, blankDay(label, memberTargets)];
              setDays(next);
              setActive(next.length - 1);
              setDirty(true);
            }}
          >
            <Plus className="inline h-3.5 w-3.5" /> Day
          </button>
        </div>

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <label className="text-[13px] text-muted-foreground" htmlFor="studio-day-name">Day</label>
            <Input id="studio-day-name" className="h-11" value={day.day_label} onChange={(e) => editDay(i, { day_label: e.target.value })} name="search-day-name" autoComplete="off" />
          </div>
          <CardMenu name={day.day_label} description="Options for this day" buttonClassName="h-11 w-11" align="end">
            <CardMenuItem
              onSelect={() => {
                const copy = { ...day, day_label: `${day.day_label} (copy)` };
                const next = [...days.slice(0, i + 1), copy, ...days.slice(i + 1)];
                setDays(next);
                setActive(i + 1);
                setDirty(true);
              }}
            >
              <Copy className="h-4 w-4" /> Duplicate day
            </CardMenuItem>
            {days.length > 1 && (
              <>
                <CardMenuSeparator />
                <CardMenuItem
                  className="text-destructive"
                  onSelect={() => {
                    const before = days;
                    setDays(days.filter((_, j) => j !== i));
                    setActive(Math.max(0, i - 1));
                    setDirty(true);
                    toast(`${day.day_label} removed`, { action: { label: "Undo", onClick: () => setDays(before) } });
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Remove day
                </CardMenuItem>
              </>
            )}
          </CardMenu>
        </div>

        {days.length > 1 && <PlanDayUseEditor day={day as any} planSize={days.length} onChange={(rule) => editDay(i, rule as any)} />}

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Targets</span>
            {memberTargets?.calories ? (
              <button type="button" className="ml-auto text-[13px] font-medium underline-offset-2 hover:underline" onClick={() => editDay(i, { calories: memberTargets.calories, protein: memberTargets.protein_g, carbs: memberTargets.carbs_g, fats: memberTargets.fat_g })}>
                Use my targets
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ["calories", "Calories"],
                ["protein", "Protein g"],
                ["carbs", "Carbs g"],
                ["fats", "Fat g"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-1">
                <label className="text-[12px] text-muted-foreground">{label}</label>
                <Input
                  className="h-11 tabular-nums"
                  inputMode="numeric"
                  value={day[k] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    editDay(i, { [k]: v ? Number(v) : null } as any);
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <MealBuilder key={`day-${i}`} notes={day.notes} onChange={(t) => editDay(i, { notes: t })} targets={day} dayLabel={day.day_label} />
      </div>
    </div>
  );
}

/** Import a plan and Create with Cleo (studio-start.tsx) are offered beside Build it yourself. */
export const STUDIO_DRAFTS_READY = true;

/** The three ways in, on a member's Nutrition page when they have no plan of their own. */
export function StudioStartOptions() {
  const navigate = useNavigate();
  const opts = useMemo(
    () => [
      { key: "build", title: "Build it yourself", text: "Pick foods and amounts. It adds up the day for you.", to: "/portal/nutrition-studio" as const, search: {} },
      { key: "import", title: "Import a plan", text: "A plan you already have: a file, a photo or pasted text.", to: "/portal/nutrition-studio" as const, search: { start: "import" } },
      { key: "cleo", title: "Create with Cleo", text: "Answer a few questions and get a draft to edit.", to: "/portal/nutrition-studio" as const, search: { start: "cleo" } },
    ],
    [],
  );
  return (
    <div className="grid gap-2" data-studio-start>
      {opts.filter((o) => STUDIO_DRAFTS_READY || o.key === "build").map((o) => (
        <button key={o.key} type="button" onClick={() => navigate({ to: o.to, search: o.search as any })} className="rounded-2xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/60" data-studio-option={o.key}>
          <div className="text-[15px] font-semibold">{o.title}</div>
          <div className="text-[13px] text-muted-foreground">{o.text}</div>
        </button>
      ))}
    </div>
  );
}
