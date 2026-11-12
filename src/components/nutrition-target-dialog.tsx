import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion } from "@/components/ui/accordion";
import { Section } from "@/components/nutrition/nutrition-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { invalidateGroceryList } from "@/lib/grocery-query-keys";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listNutritionRequestsFn } from "@/lib/nutrition-ai-plans.functions";
import { currentRequest } from "@/lib/form-request-state";
import { phaseSourceText, suggestTargetsPhase } from "@/lib/nutrition-targets/phase-suggest";
import { NUTRITION_PHASES, NUTRITION_STRUCTURES, PHASE_GOAL, dayLabelsForStructure, TARGET_STATUSES } from "@/lib/nutrition-cardio";
import { addMonths, addWeeks, format, parseISO } from "date-fns";
import type React from "react";
import { CalendarDays, ClipboardPaste, FileText, Lock, MessageSquare, Pill, Plus, Settings2, Upload, X } from "lucide-react";
import { readPlanSupplements, type PlanSupplements } from "@/lib/nutrition-targets/supplements";
import { SupplementsEditor } from "@/components/nutrition/supplements-ui";
import { todayLocalISO } from "@/lib/today";
import { fireAppEvent } from "@/lib/push/app-events.functions";
import { WorkoutMealTagger } from "@/components/nutrition/WorkoutMealTagger";
import { AutoLabelWorkoutMeals } from "@/components/nutrition/AutoLabelWorkoutMeals";
import { MealPlanBulkPaste, type ParsedDay } from "@/components/nutrition/MealPlanBulkPaste";
import { PlanDayUseEditor, PlanDayWeekPreview } from "@/components/nutrition/PlanDayRules";
import { resolveTrainingWeekdays } from "@/lib/cardio-prescription";
import { cardioDraftsFor, dayKey, parseAiCardio, type CardioDraft } from "@/lib/nutrition-cardio-sync";
import { plainOrNull } from "@/lib/nutrition-targets/plain-paste";
import { archiveReplacedPlans, syncPlanCardio } from "@/lib/nutrition-targets/plan-publish";

const QUICK_DAY_TYPES = [
  "Training Day",
  "Non-Training Day",
  "High Day",
  "Low Day",
  "Rest Day",
  "Refeed Day",
  "Custom Day",
] as const;

const DEFAULT_NEW_DAYS = ["Training Day", "Non-Training Day", "High Day"];

type Day = {
  id?: string;
  day_label: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fibre?: number | null;
  notes?: string | null;
  sort_order: number;
  /** When it's used (null = read from the name; see PlanDayRules). */
  use_on?: string | null;
  weekdays?: string[] | null;
  /** The day's total step target. */
  steps?: number | null;
  /** This day type's cardio (synced to cardio_targets on save; never stored on the day). */
  cardio?: CardioDraft;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId?: string;
  clients?: Array<{ id: string; full_name: string }>;
  initial?: any;
  /** New targets pre-filled from an AI nutrition plan (ignored when `initial` is set). */
  prefill?: {
    days: Day[];
    structure?: string;
    food_weighing_rules?: string | null;
    admin_notes?: string | null;
    phase?: string | null;
    /** The AI targets text: its daily steps + cardio sessions fill each day. */
    targetsText?: string | null;
    /** The supplements the coach kept in the AI review. */
    supplements?: PlanSupplements | null;
  };
  /** Called after a successful save with the new/updated target id. */
  onSaved?: (targetId: string) => void;
};

export function NutritionTargetDialog({ open, onOpenChange, clientId, clients = [], initial, prefill, onSaved }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<any>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [saving, setSaving] = useState(false);
  /** True while Phase / Goal holds a value detected from a paste (cleared on manual change). */
  const [phaseAuto, setPhaseAuto] = useState(false);
  /** The coach picked Phase / Goal themselves (the default "Maintenance" isn't a choice). */
  const [phasePicked, setPhasePicked] = useState(false);
  /** Where an auto-filled Phase / Goal came from (shown under it). */
  const [phaseSource, setPhaseSource] = useState<string | null>(null);
  /** What set it: the suggestion re-runs (another client picked), a paste or an AI prefill stays. */
  const [phaseFrom, setPhaseFrom] = useState<"suggest" | "paste" | "prefill" | null>(null);
  /** Which days are open (a new plan opens its first, an added day opens itself). */
  const [openDays, setOpenDays] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const today = todayLocalISO();
    setPhaseAuto(false);
    setPhasePicked(false);
    setPhaseSource(null);
    setPhaseFrom(null);
    setOpenDays([]);
    if (initial) {
      setForm({ ...initial });
      supabase.from("nutrition_target_days").select("*").eq("target_id", initial.id).order("sort_order").then(({ data }) => {
        setDays((data ?? []) as Day[]);
      });
    } else {
      const f = {
        client_id: clientId ?? "",
        phase: "Maintenance",
        custom_phase: "",
        goal: "Maintain bodyweight",
        custom_goal: "",
        structure: "Same Every Day",
        start_date: today,
        end_date: format(addMonths(parseISO(today), 1), "yyyy-MM-dd"),
        status: "Active",
        ending_soon_days: 7,
        client_notes: "",
        admin_notes: "",
        visible_to_client: true,
        pdf_url: "",
        pdf_name: "",
        water: "3.5 L",
      };
      if (prefill) {
        Object.assign(f, {
          structure: prefill.structure ?? "Custom",
          ...(prefill.phase ? { phase: prefill.phase, goal: PHASE_GOAL[prefill.phase] ?? f.goal } : {}),
        });
        setPhaseAuto(!!prefill.phase);
        setPhaseSource(prefill.phase ? "From the AI plan for their Nutrition Update" : null);
        setPhaseFrom(prefill.phase ? "prefill" : null);
        Object.assign(f, {
          food_weighing_rules: prefill.food_weighing_rules ?? "",
          admin_notes: prefill.admin_notes ?? "",
        });
      }
      if (prefill?.supplements) Object.assign(f, { supplements: prefill.supplements });
      setForm(f);
      setDays(prefill?.days.length
        ? prefill.days.map((d, i) => ({ ...d, sort_order: i }))
        : DEFAULT_NEW_DAYS.map((label, i) => ({ day_label: label, sort_order: i })));
    }
  }, [open, initial, clientId, prefill]);

  // New targets start on the phase the client is actually working toward
  // (suggestTargetsPhase), never the default "Maintenance".
  const suggestFor = open && !initial ? (form?.client_id || clientId || null) : null;
  const listRequests = useServerFn(listNutritionRequestsFn);
  const requestsQ = useQuery({
    queryKey: ["nutrition-requests", suggestFor],
    enabled: !!suggestFor,
    queryFn: () => listRequests({ data: { clientId: suggestFor! } }),
    staleTime: 60_000,
    retry: false,
  });
  const contextQ = useQuery({
    queryKey: ["nutrition-phase-context", suggestFor],
    enabled: !!suggestFor,
    staleTime: 60_000,
    queryFn: async () => {
      const [t, c] = await Promise.all([
        (supabase as any)
          .from("nutrition_targets")
          .select("phase, custom_phase, created_at")
          .eq("client_id", suggestFor!)
          .neq("status", "Archived")
          .order("created_at", { ascending: false })
          .limit(1),
        (supabase as any).from("clients").select("goals").eq("id", suggestFor!).maybeSingle(),
      ]);
      return {
        current: (t.data?.[0] ?? null) as { phase: string | null; custom_phase: string | null; created_at: string } | null,
        goals: c.data?.goals ? String(c.data.goals) : null,
      };
    },
  });
  useEffect(() => {
    if (!form || initial || phasePicked || phaseFrom === "paste" || phaseFrom === "prefill" || !suggestFor) return;
    if (requestsQ.isLoading || contextQ.isLoading) return;
    const data = requestsQ.data as any;
    const latest = data ? currentRequest(data.requests ?? [], data.requestedAt ?? null) : null;
    const answered = latest && latest.status !== "in_progress" ? latest : null;
    const qas = (answered?.answers ?? []) as Array<{ label: string; value: string }>;
    const goalAnswer = qas.find((q) => /^goal\b/i.test(q.label.trim()))?.value ?? null;
    const goalDetail = qas.find((q) => /goal/i.test(q.label) && !/^goal\b/i.test(q.label.trim()))?.value ?? null;
    const s = suggestTargetsPhase({
      requestPhase: data?.requestedPhase ?? null,
      aiPhase: answered?.plan?.phase ?? null,
      goalAnswer,
      goalDetail,
      submittedAt: answered?.submitted_at ?? null,
      current: contextQ.data?.current ?? null,
      profileGoals: contextQ.data?.goals ?? null,
    });
    if (!s) return;
    const name = String(data?.client?.name ?? "").trim().split(/\s+/)[0] || null;
    setForm((f: any) => (f ? { ...f, phase: s.phase, goal: PHASE_GOAL[s.phase] ?? f.goal } : f));
    setPhaseAuto(true);
    setPhaseFrom("suggest");
    setPhaseSource(phaseSourceText(s, { name, submittedAt: answered?.submitted_at ?? null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestFor, requestsQ.data, requestsQ.isLoading, contextQ.data, contextQ.isLoading, !!form, initial, phasePicked, phaseFrom]);

  // Cardio moves with the plan: each day carries its cardio (and steps), filled
  // from the AI plan when there is one, else from the client's current cardio.
  const cardioClient = open ? (form?.client_id || clientId || null) : null;
  const cardioQ = useQuery({
    queryKey: ["nutrition-dialog-cardio", cardioClient],
    enabled: !!cardioClient,
    staleTime: 0,
    queryFn: async () => {
      const [rows, prefs] = await Promise.all([
        supabase
          .from("cardio_targets")
          .select("id, day_type, status, enabled, program_name, cardio_type, duration_minutes, frequency_per_week, calorie_target_min, calorie_target_mode, updated_at")
          .eq("client_id", cardioClient!),
        (supabase as any)
          .from("clients")
          .select("committed_training_days, preferred_training_days, preferred_high_days")
          .eq("id", cardioClient!)
          .maybeSingle(),
      ]);
      return { rows: (rows.data ?? []) as any[], prefs: (prefs.data ?? null) as any };
    },
  });
  // Any day without cardio yet (opened, pasted, added) gets it filled in.
  useEffect(() => {
    if (!open || !cardioQ.data || !cardioClient || !days.some((d) => !d.cardio)) return;
    const ai = !initial && prefill?.targetsText ? parseAiCardio(prefill.targetsText) : null;
    const trainingDays = resolveTrainingWeekdays(cardioQ.data.prefs).length;
    const drafts = cardioDraftsFor({ labels: days.map((d) => d.day_label), rows: cardioQ.data.rows, ai, trainingDays });
    setDays((cur) =>
      cur.map((d) =>
        d.cardio
          ? d
          : { ...d, steps: d.steps ?? ai?.get(dayKey(d.day_label))?.steps ?? null, cardio: drafts[d.day_label] },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cardioQ.data, days, cardioClient, initial?.id]);

  if (!form) return null;
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  const uploadPdf = async (file: File) => {
    if (!form.client_id) return toast.error("Pick a client first");
    if (file.type !== "application/pdf") return toast.error("PDF files only");
    if (file.size > 25 * 1024 * 1024) return toast.error("Max 25MB");
    const path = `${form.client_id}/${Date.now()}-${file.name.replace(/[^a-z0-9.\-_]/gi, "_")}`;
    const { error } = await supabase.storage.from("nutrition-plans").upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (error) return toast.error(error.message);
    setForm({ ...form, pdf_url: path, pdf_name: file.name });
    toast.success("PDF uploaded");
  };

  const removePdf = async () => {
    if (form.pdf_url) await supabase.storage.from("nutrition-plans").remove([form.pdf_url]);
    setForm({ ...form, pdf_url: "", pdf_name: "" });
  };

  const updateStructure = (v: string) => {
    setForm({ ...form, structure: v });
    if (!initial) setDays(dayLabelsForStructure(v).map((label, i) => ({ day_label: label, sort_order: i })));
  };

  const updateDay = (i: number, k: keyof Day, v: any) => {
    const next = [...days];
    (next[i] as any)[k] = v === "" ? null : k === "day_label" || k === "notes" ? v : Number(v);
    setDays(next);
  };

  const setDayRule = (i: number, patch: { use_on?: string; weekdays?: string[] }) =>
    setDays(days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const trainingDayCount = resolveTrainingWeekdays(cardioQ.data?.prefs).length;
  const setCardio = (i: number, patch: Partial<CardioDraft>) =>
    setDays(days.map((d, idx) => {
      if (idx !== i) return d;
      const base: CardioDraft = d.cardio ?? cardioDraftsFor({ labels: [d.day_label], rows: cardioQ.data?.rows ?? [], trainingDays: trainingDayCount })[d.day_label];
      return { ...d, cardio: { ...base, ...patch, fromAi: false } };
    }));

  const addDay = (label?: string) => {
    setOpenDays((o) => [...o, `day-${days.length}`]);
    setDays([...days, { day_label: label ?? `Day ${days.length + 1}`, sort_order: days.length }]);
  };
  const removeDay = (i: number) => {
    setOpenDays([]);
    setDays(days.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    if (!form.client_id) return toast.error("Pick a client first");
    setSaving(true);
    const payload: any = {
      client_id: form.client_id,
      phase: form.phase,
      custom_phase: form.phase === "Custom" ? form.custom_phase : null,
      // One Phase / Goal field: the goal text follows the phase.
      goal: form.phase === "Custom" ? "Custom" : PHASE_GOAL[form.phase] ?? form.goal,
      custom_goal: form.phase === "Custom" ? form.custom_phase : null,
      structure: form.structure,
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      ending_soon_days: Number(form.ending_soon_days) || 7,
      client_notes: plainOrNull(form.client_notes),
      food_weighing_rules: plainOrNull(form.food_weighing_rules || null),
      admin_notes: form.admin_notes,
      visible_to_client: form.visible_to_client,
      pdf_url: form.pdf_url || null,
      pdf_name: form.pdf_name || null,
      last_updated_at: new Date().toISOString(),
      water: plainOrNull(form.water || null),
      supplements: supplementsOf(form).items.length || supplementsOf(form).notes.length ? supplementsOf(form) : null,
    };
    let targetId = form.id;
    if (targetId) {
      const { error } = await supabase.from("nutrition_targets").update(payload).eq("id", targetId);
      if (error) { setSaving(false); return toast.error(error.message); }
      await supabase.from("nutrition_target_days").delete().eq("target_id", targetId);
    } else {
      const { data, error } = await supabase.from("nutrition_targets").insert(payload).select("id").single();
      if (error || !data) { setSaving(false); return toast.error(error?.message ?? "Failed"); }
      targetId = data.id;
    }
    if (days.length) {
      const rows = days.map((d, i) => {
        const { id: _omit, cardio: _cardio, ...rest } = d as any;
        delete (rest as any).created_at;
        delete (rest as any).updated_at;
        delete (rest as any).target_id;
        return { ...rest, notes: plainOrNull(rest.notes ?? null), target_id: targetId, sort_order: i };
      });
      const { error } = await supabase.from("nutrition_target_days").insert(rows);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    // A new current plan replaces the one before it: archived with its dates, never deleted.
    let replacedMsg = "";
    if (form.status === "Active" && (!form.id || initial?.status === "Archived")) {
      try {
        const n = await archiveReplacedPlans(form.client_id, targetId, form.start_date);
        if (n) replacedMsg = " · the old plan is in Previous plans";
      } catch (e: any) {
        toast.error(`Saved, but the old plan wasn't archived: ${e?.message ?? "error"}`);
      }
    }
    // Cardio follows the plan the client is on: only an Active plan changes it.
    let cardioMsg = "";
    if (form.status === "Active" && cardioQ.data) {
      try {
        const sync = await syncPlanCardio(form.client_id, days.map((d) => ({ label: d.day_label, draft: d.cardio })), cardioQ.data);
        if (sync.inserted + sync.updated) cardioMsg = ` · cardio synced (${[sync.updated && `${sync.updated} updated`, sync.inserted && `${sync.inserted} added`].filter(Boolean).join(", ")})`;
        for (const k of [["cardio-targets", form.client_id], ["cal-client-cardio", form.client_id], ["client-cardio-resolved", form.client_id], ["week-sched-data"], ["nutrition-dialog-cardio", form.client_id]]) {
          qc.invalidateQueries({ queryKey: k });
        }
      } catch (e: any) {
        toast.error(`Nutrition saved, but cardio didn't sync: ${e?.message ?? "error"}. Fix it in Cardio Targets.`);
      }
    }
    setSaving(false);
    toast.success(`${form.id ? "Updated" : "Created"}${replacedMsg}${cardioMsg}`);
    qc.invalidateQueries({ queryKey: ["nutrition-targets"] });
    qc.invalidateQueries({ queryKey: ["nutrition-targets", form.client_id] });
    void invalidateGroceryList(qc, form.client_id);
    // Let the client know their plan changed (only when they can see it).
    if (form.visible_to_client && form.status === "Active") fireAppEvent("nutrition_targets_updated", form.client_id);
    onSaved?.(targetId);
    onOpenChange(false);
  };

  const phaseText = form.phase === "Custom" ? form.custom_phase || "Custom" : form.phase;
  const numberField = (i: number, k: keyof Day) => (e: React.ChangeEvent<HTMLInputElement>) =>
    updateDay(i, k, e.target.value.replace(/[^0-9.]/g, ""));
  const fmtNum = (v: number | null | undefined) => (v == null ? "—" : Math.round(v));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh] sm:max-w-3xl sm:p-0" data-plan-editor>
        <DialogHeader className="shrink-0 space-y-0.5 border-b border-border py-2 pr-4 sm:pr-6">
          <DialogTitle>{form.id ? "Edit nutrition plan" : "New nutrition plan"}</DialogTitle>
          <DialogDescription className="text-[13px]">
            {[phaseText, form.start_date ? (form.end_date ? `${format(parseISO(form.start_date), "MMM d")} – ${format(parseISO(form.end_date), "MMM d")}` : `from ${format(parseISO(form.start_date), "MMM d")}, ongoing`) : null].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {!clientId && (
            <div className="space-y-1.5">
              <Label className="text-[13px] text-muted-foreground">Client</Label>
              <Select value={form.client_id} onValueChange={(v) => set("client_id", v)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Pick a client" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {/* What it's for and when it runs: the three things every plan needs. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label className="text-[13px] text-muted-foreground">Phase</Label>
              <Select value={form.phase} onValueChange={(v) => { setPhaseAuto(false); setPhasePicked(true); setPhaseSource(null); setPhaseFrom(null); set("phase", v); }}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NUTRITION_PHASES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}{PHASE_GOAL[s] ? <span className="text-muted-foreground"> · {PHASE_GOAL[s]}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {phaseAuto && phaseSource && <p className="text-[13px] text-muted-foreground">{phaseSource}</p>}
              {form.phase === "Custom" && (
                <Input className="h-11" value={form.custom_phase ?? ""} onChange={(e) => set("custom_phase", e.target.value)} placeholder="e.g. Contest prep, 12 weeks out" />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-muted-foreground">Starts</Label>
              <Input className="h-11" type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-muted-foreground">Next update due</Label>
              <Input className="h-11" type="date" value={form.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} />
            </div>
            <div className="col-span-2 flex flex-wrap gap-1.5 sm:col-span-3" aria-label="Next update in">
              {([["2 weeks", 2], ["4 weeks", 4], ["6 weeks", 6], ["8 weeks", 8], ["12 weeks", 12]] as const).map(([label, w]) => {
                const end = form.start_date ? format(addWeeks(parseISO(form.start_date), w), "yyyy-MM-dd") : null;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => end && set("end_date", end)}
                    aria-pressed={!!end && form.end_date === end}
                    className={cn(
                      "h-9 rounded-full border border-border px-3 text-[13px] transition-colors hover:bg-muted",
                      end && form.end_date === end && "border-foreground bg-foreground text-background hover:bg-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => set("end_date", "")}
                aria-pressed={!form.end_date}
                className={cn("h-9 rounded-full border border-border px-3 text-[13px] transition-colors hover:bg-muted", !form.end_date && "border-foreground bg-foreground text-background hover:bg-foreground")}
              >
                Ongoing
              </button>
            </div>
          </div>

          <Accordion type="single" collapsible defaultValue={!initial && !prefill ? "paste" : undefined} className="rounded-xl border border-border">
            <Section value="paste" icon={ClipboardPaste} title="Paste a meal plan" meta="Fills the days">
              <MealPlanBulkPaste
                clientId={form.client_id || clientId || null}
                phase={initial || phasePicked || phaseAuto ? (form.phase === "Custom" ? form.custom_phase || null : form.phase) : null}
                onApply={(parsed: ParsedDay[], rules: string | null, phase: string | null) => {
                  setDays(parsed.map((d, i) => ({ ...d, sort_order: i })));
                  setOpenDays([]);
                  setForm((f: any) => ({
                    ...f,
                    ...(rules ? { food_weighing_rules: rules } : {}),
                    ...(phase ? { phase, goal: PHASE_GOAL[phase] ?? f.goal } : {}),
                  }));
                  if (phase) {
                    setPhaseAuto(true);
                    setPhaseFrom("paste");
                    setPhaseSource("From the pasted plan's PHASE line");
                  }
                }}
              />
            </Section>
          </Accordion>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">Days</h3>
              <div className="ml-auto">
                <AutoLabelWorkoutMeals clientId={form.client_id || clientId} days={days} onApply={setDays} />
              </div>
            </div>
            {days.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No days yet. Paste a meal plan, or add a day.</p>
            ) : (
              <Accordion type="multiple" value={openDays} onValueChange={setOpenDays} className="rounded-xl border border-border">
                {days.map((d, i) => (
                  <Section
                    key={i}
                    value={`day-${i}`}
                    title={d.day_label || "Untitled day"}
                    sub={d.calories == null && d.protein == null && d.carbs == null && d.fats == null
                      ? "Not filled in yet"
                      : `${fmtNum(d.calories)} kcal · P ${fmtNum(d.protein)} · C ${fmtNum(d.carbs)} · F ${fmtNum(d.fats)}`}
                  >
                    <div className="space-y-4">
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label className="text-[13px] text-muted-foreground">Name</Label>
                          <Input className="h-11" value={d.day_label} onChange={(e) => updateDay(i, "day_label", e.target.value)} />
                        </div>
                        {days.length > 1 && (
                          <Button variant="ghost" className="h-11 text-destructive" onClick={() => removeDay(i)}>
                            Remove
                          </Button>
                        )}
                      </div>
                      <PlanDayUseEditor day={d} planSize={days.length} onChange={(patch) => setDayRule(i, patch)} />
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {([["calories", "Calories"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fats", "Fat (g)"], ["fibre", "Fibre (g)"], ["steps", "Steps"]] as const).map(([k, label]) => (
                          <div key={k} className="space-y-1.5">
                            <Label className="text-[13px] text-muted-foreground">{label}</Label>
                            <Input className="h-11 tabular-nums" inputMode="numeric" value={d[k] ?? ""} onChange={numberField(i, k)} />
                          </div>
                        ))}
                      </div>
                      <DayCardio draft={d.cardio} onChange={(patch) => setCardio(i, patch)} willSync={form.status === "Active"} />
                      <div className="space-y-1.5">
                        <Label className="text-[13px] text-muted-foreground">Meals</Label>
                        <Textarea
                          rows={8}
                          placeholder={`Meal 1\n120 g oats\n3 whole eggs\n\nApproximate macros:\n40 g protein\n70 g carbohydrates\n18 g fat`}
                          value={d.notes ?? ""}
                          onChange={(e) => updateDay(i, "notes", e.target.value)}
                          className="font-mono text-xs leading-relaxed whitespace-pre"
                          spellCheck={false}
                        />
                        <WorkoutMealTagger text={d.notes ?? ""} onChange={(t) => updateDay(i, "notes", t)} />
                        <p className="text-[13px] text-muted-foreground">Write "Meal 1", "Meal 2"… on their own lines; the client sees each meal as a card.</p>
                      </div>
                    </div>
                  </Section>
                ))}
              </Accordion>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-11 w-full gap-1.5">
                  <Plus className="h-4 w-4" /> Add day
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-56">
                {QUICK_DAY_TYPES.map((t) => (
                  <DropdownMenuItem key={t} onClick={() => addDay(t)}>
                    {t}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Accordion type="multiple" className="rounded-xl border border-border">
            <Section value="week" icon={CalendarDays} title="This week for the client">
              <PlanDayWeekPreview clientId={form.client_id || clientId} days={days} />
            </Section>
            <Section value="client-notes" icon={MessageSquare} title="For the client" meta={form.pdf_url ? "Notes · weighing rules · PDF" : "Notes · weighing rules"}>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Notes to the client</Label>
                  <Textarea rows={3} value={form.client_notes ?? ""} onChange={(e) => set("client_notes", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Food-weighing rules</Label>
                  <Textarea rows={4} placeholder="Filled in from the FOOD-WEIGHING RULES section when you paste a meal plan" value={form.food_weighing_rules ?? ""} onChange={(e) => set("food_weighing_rules", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">PDF</Label>
                  {form.pdf_url ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{form.pdf_name || "nutrition-plan.pdf"}</span>
                      <Button variant="ghost" size="sm" className="h-9 text-destructive" onClick={removePdf}><X className="mr-1 h-4 w-4" /> Remove</Button>
                    </div>
                  ) : (
                    <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground hover:bg-muted/40">
                      <Upload className="h-4 w-4" /> Upload a PDF
                      <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && uploadPdf(e.target.files[0])} />
                    </label>
                  )}
                </div>
              </div>
            </Section>
            <Section
              value="supplements"
              icon={Pill}
              title="Supplements"
              meta={supplementsOf(form).items.length ? supplementsOf(form).items.map((x) => x.name).join(", ") : "None"}
            >
              <SupplementsEditor
                clientId={form.client_id || clientId}
                value={supplementsOf(form)}
                onChange={(v) => set("supplements", v)}
                foods={days.map((d) => d.notes ?? "").join("\n")}
                kcal={(() => {
                  const k = days.map((d) => Number(d.calories)).filter((v) => v > 0);
                  return k.length ? Math.round(k.reduce((a, b) => a + b, 0) / k.length) : null;
                })()}
              />
            </Section>
            <Section value="private" icon={Lock} title="Private notes" meta="Only staff see these">
              <Textarea rows={4} value={form.admin_notes ?? ""} onChange={(e) => set("admin_notes", e.target.value)} />
            </Section>
            <Section value="settings" icon={Settings2} title="Settings" meta={[form.status, form.structure].filter(Boolean).join(" · ")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Status</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v)}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{TARGET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Day types</Label>
                  <Select value={form.structure} onValueChange={updateStructure}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{NUTRITION_STRUCTURES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-muted-foreground">Warn me this many days before the update</Label>
                  <Input className="h-11" inputMode="numeric" value={form.ending_soon_days} onChange={(e) => set("ending_soon_days", e.target.value.replace(/[^0-9]/g, ""))} />
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3 self-end rounded-lg border border-border px-3">
                  <Label htmlFor="plan-visible" className="text-sm">The client can see it</Label>
                  <Switch id="plan-visible" checked={form.visible_to_client} onCheckedChange={(v) => set("visible_to_client", v)} />
                </div>
              </div>
            </Section>
          </Accordion>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border bg-background px-4 py-3 dark:bg-card sm:justify-end sm:px-6">
          <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11 flex-1 sm:flex-none" onClick={save} disabled={saving}>{saving ? "Saving…" : form.id ? "Save changes" : "Save plan"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One day type's cardio, edited with its calories and saved with the plan. */
function DayCardio({ draft, onChange, willSync }: { draft?: CardioDraft; onChange: (p: Partial<CardioDraft>) => void; willSync: boolean }) {
  if (draft?.program) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">
        Cardio comes from the <span className="font-medium text-foreground">{draft.program}</span> program. Change it in Cardio.
      </p>
    );
  }
  const on = !!draft?.enabled;
  const num = (v: string) => (v === "" ? null : Math.max(0, Math.round(Number(v.replace(/[^0-9]/g, "")))));
  return (
    <div className="space-y-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={(v) => onChange({ enabled: v })} aria-label="Cardio on this day" />
        <span className="text-sm font-medium">Cardio</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          {on ? draft?.cardio_type ?? "On" : "None on this day"}
          {draft?.fromAi ? " · from the AI" : ""}
          {!willSync ? " · saved to Cardio when the plan is Active" : ""}
        </span>
      </div>
      {on && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5"><Label className="text-[13px] text-muted-foreground">Minutes</Label><Input className="h-11" inputMode="numeric" value={draft?.duration_minutes ?? ""} onChange={(e) => onChange({ duration_minutes: num(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label className="text-[13px] text-muted-foreground">Times a week</Label><Input className="h-11" inputMode="numeric" value={draft?.frequency_per_week ?? ""} onChange={(e) => onChange({ frequency_per_week: num(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label className="text-[13px] text-muted-foreground">kcal</Label><Input className="h-11" inputMode="numeric" placeholder="auto" value={draft?.kcal ?? ""} onChange={(e) => onChange({ kcal: num(e.target.value) })} /></div>
        </div>
      )}
    </div>
  );
}

/** The plan's supplements as the editor holds them (a stored value, or nothing yet). */
function supplementsOf(form: any): PlanSupplements {
  return readPlanSupplements(form?.supplements ?? null);
}
