/**
 * The recommended setup (compact, every value with where it came from) and
 * the advanced controls (only what fits the chosen framework). Any edit is
 * the coach's requirement from then on; changing the days shows what that
 * does to the workload; conflicts are listed, never silently resolved.
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { EQUIPMENT_ITEMS, EQUIPMENT_LABEL } from "@/lib/program-intel/equipment";
import type { GeneratorIntel } from "@/lib/program-intel/intelligence";
import { blockStructure, type Conflict, type ExerciseRef, type GenerationSetup, type Redistribution, type SetupField, type Why } from "@/lib/program-intel/recommend";
import { BRAIN_LABEL, BRAINS, HYPERTROPHY_BRAINS, STRENGTH_BRAINS, type Brain, type EquipmentItem, type EquipmentProfile } from "@/lib/program-intel/types";
import { SectionTitle } from "./overview";

export type SetupChange = <K extends SetupField>(field: K, value: GenerationSetup[K]) => void;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function Stepper({ value, min, max, onChange, suffix, testId }: { value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string; testId?: string }) {
  return (
    <div className="inline-flex items-center gap-1" data-testid={testId}>
      <Button type="button" size="icon" variant="outline" className="h-9 w-9" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Less"><Minus className="h-4 w-4" /></Button>
      <span className="min-w-[3.5rem] text-center text-sm font-bold tabular-nums">{value}{suffix ? ` ${suffix}` : ""}</span>
      <Button type="button" size="icon" variant="outline" className="h-9 w-9" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="More"><Plus className="h-4 w-4" /></Button>
    </div>
  );
}

function Chips({ values, onChange, placeholder, suggestions = [] }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => {
    const t = v.trim();
    if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...values, t]);
    setDraft("");
  };
  const unused = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!values.length && <span className="text-[11px] text-muted-foreground">None</span>}
      </div>
      <div className="flex gap-1">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add(draft))} placeholder={placeholder} className="h-9 text-[13px]" />
        <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => add(draft)} disabled={!draft.trim()}>Add</Button>
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseChips({ values, onChange, options, placeholder }: { values: ExerciseRef[]; onChange: (v: ExerciseRef[]) => void; options: ExerciseRef[]; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = (r: ExerciseRef) => {
    if (!values.some((v) => (r.id && v.id === r.id) || v.name.toLowerCase() === r.name.toLowerCase())) onChange([...values, r]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <span key={v.id ?? v.name} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
            {v.name}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v.name}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {!values.length && <span className="text-[11px] text-muted-foreground">None</span>}
      </div>
      <div className="flex gap-1">
        <Select value="" onValueChange={(id) => { const o = options.find((x) => (x.id ?? x.name) === id); if (o) add(o); }}>
          <SelectTrigger className="h-9 flex-1 text-[12px]"><SelectValue placeholder="From their exercises" /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o.id ?? o.name} value={o.id ?? o.name}>{o.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="flex gap-1">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="h-9 text-[13px]" />
        <Button type="button" size="sm" variant="outline" className="h-9" disabled={!draft.trim()} onClick={() => add({ id: null, name: draft.trim() })}>Add</Button>
      </div>
    </div>
  );
}

function Row({ label, value, why, edited, children, testId }: { label: string; value: React.ReactNode; why?: Why; edited?: boolean; children?: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/50 py-2 first:border-0" data-testid={testId}>
      <button type="button" onClick={() => children && setOpen(!open)} className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={open}>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-muted-foreground">
            {label}
            {edited ? <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-bold uppercase text-primary">your change</span> : null}
          </span>
          <span className="block text-[13px] font-bold leading-snug">{value}</span>
          {why && !edited ? <span className="block text-[11px] leading-snug text-muted-foreground">{why.source}: {why.reason}</span> : null}
        </span>
        {children ? <Pencil className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground", open && "text-primary")} /> : null}
      </button>
      {open && children ? <div className="mt-2 rounded-xl bg-secondary/40 p-2.5">{children}</div> : null}
    </div>
  );
}

/** One line for a cardio session ("Incline Treadmill Walk 15 min"). */
const cardioLine = (c: { type: string; minutes: number; perWeek: number | null } | null | undefined, rest = false) =>
  c ? `${c.type} ${c.minutes} min${rest && c.perWeek ? ` ×${c.perWeek}` : ""}` : "none";

/**
 * Cardio is the client's cardio plan, not part of the program: the app adds its training-day
 * session to every workout. Their plan is shown as is (it changes in their cardio targets or
 * nutrition plan); a plan proposed because they have none can be switched off here.
 */
function CardioRow({ setup, recommended, why, edited, onChange }: { setup: GenerationSetup; recommended: GenerationSetup["cardio"]; why?: Why; edited: boolean; onChange: (field: SetupField, value: any) => void }) {
  const c = setup.cardio;
  const value = !c || c.source === "none"
    ? "No added cardio"
    : `${c.source === "proposed" ? "Proposed · " : ""}After lifting: ${cardioLine(c.trainingDay)} · Days off: ${cardioLine(c.restDay, true)}`;
  return (
    <Row label="Cardio" value={value} why={why} edited={edited} testId="gen-cardio">
      {recommended?.source === "plan" ? (
        <p className="text-[12px] text-muted-foreground">
          This is their cardio plan: the app adds the after-lifting session to every workout and the program leaves time for it. Change it in their cardio targets or nutrition plan.
        </p>
      ) : recommended?.source === "proposed" ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground">They have no cardio plan. On Assign this becomes their plan until their nutrition plan sets one.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant={c?.source === "proposed" ? "default" : "outline"} onClick={() => onChange("cardio", recommended)}>Use this plan</Button>
            <Button type="button" size="sm" variant={c?.source === "none" ? "default" : "outline"} onClick={() => onChange("cardio", { ...recommended, source: "none", trainingDay: null, restDay: null, why: "The coach chose no added cardio." })}>No added cardio</Button>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">No cardio is added for this goal (daily steps only). Set a cardio plan in their cardio targets or nutrition plan if they need one.</p>
      )}
    </Row>
  );
}

export function SetupCard({
  intel,
  setup,
  edited,
  onChange,
  onBrain,
  onReset,
  redistribution,
  onEditEquipment,
}: {
  intel: GeneratorIntel;
  setup: GenerationSetup;
  edited: Set<SetupField>;
  onChange: SetupChange;
  onBrain: (b: Brain) => void;
  onReset: () => void;
  redistribution: Redistribution | null;
  onEditEquipment: () => void;
}) {
  const why = intel.recommendation.why;
  const meetWeeks = setup.meetDate ? Math.round((Date.parse(setup.meetDate) - Date.parse(intel.ctx.today)) / (7 * 86_400_000)) : null;
  const liftsAndMuscles = [...(STRENGTH_BRAINS.includes(setup.brain) ? ["Squat", "Bench", "Deadlift"] : []), ...intel.recommendation.baseline.muscleSets.map((m) => m.muscle)];
  return (
    <Card className="p-3.5" data-testid="gen-setup">
      <div className="flex items-center justify-between">
        <SectionTitle>Recommended setup</SectionTitle>
        {edited.size > 0 && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onReset}><RotateCcw className="mr-1 h-3 w-3" /> Reset {edited.size}</Button>
        )}
      </div>
      <Row label="Program type" value={BRAIN_LABEL[setup.brain]} why={why.brain} edited={edited.has("brain")} testId="gen-row-brain">
        <Select value={setup.brain} onValueChange={(v) => onBrain(v as Brain)}>
          <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
          <SelectContent>{BRAINS.map((b) => <SelectItem key={b} value={b}>{BRAIN_LABEL[b]}{b === intel.classification.auto ? " (auto)" : ""}</SelectItem>)}</SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Read from: {intel.classification.reasons.slice(0, 5).join("; ")}.</p>
      </Row>
      <Row label="Main goal" value={setup.mainGoal} why={why.mainGoal} edited={edited.has("mainGoal")}>
        <Input value={setup.mainGoal} onChange={(e) => onChange("mainGoal", e.target.value)} className="h-10" />
      </Row>
      <Row label="Training days" value={`${setup.daysPerWeek} days / week${setup.trainingDays.length ? ` · ${setup.trainingDays.map((d) => d.slice(0, 3)).join(" ")}` : ""}`} why={why.daysPerWeek} edited={edited.has("daysPerWeek")} testId="gen-row-days">
        <Stepper value={setup.daysPerWeek} min={1} max={7} onChange={(n) => onChange("daysPerWeek", n)} suffix="days" testId="gen-days-stepper" />
        <div className="mt-2 flex flex-wrap gap-1">
          {WEEKDAYS.map((d) => {
            const on = setup.trainingDays.includes(d);
            return (
              <button key={d} type="button" onClick={() => onChange("trainingDays", on ? setup.trainingDays.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || setup.trainingDays.includes(x)))} className={cn("h-8 rounded-full px-2.5 text-[11px] font-bold", on ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}>
                {d.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </Row>
      {redistribution && (
        <div className={cn("mb-1 space-y-0.5 rounded-xl p-2.5 text-[11px]", redistribution.fits ? "bg-info/10 text-info" : "bg-warning/10 text-warning")} data-testid="gen-redistribution">
          <div className="font-bold">What {redistribution.fromDays} → {redistribution.toDays} days does</div>
          {redistribution.lines.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
      <Row label="Duration" value={`${setup.weeks} weeks${meetWeeks != null ? ` · meet in ${meetWeeks}` : ""}`} why={why.weeks} edited={edited.has("weeks")}>
        <Stepper value={setup.weeks} min={1} max={16} onChange={(n) => onChange("weeks", n)} suffix="wk" />
      </Row>
      <Row label="Session length" value={`${setup.sessionMinutes ?? "—"} min${setup.maxSessionMinutes ? ` (max ${setup.maxSessionMinutes})` : ""}`} why={why.sessionMinutes} edited={edited.has("sessionMinutes") || edited.has("maxSessionMinutes")}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[11px]">Target minutes</Label>
            <Input inputMode="numeric" value={setup.sessionMinutes ?? ""} onChange={(e) => onChange("sessionMinutes", e.target.value ? Math.max(15, Math.min(240, Number(e.target.value) || 0)) : null)} className="h-10" />
          </div>
          <div>
            <Label className="text-[11px]">Maximum minutes</Label>
            <Input inputMode="numeric" value={setup.maxSessionMinutes ?? ""} onChange={(e) => onChange("maxSessionMinutes", e.target.value ? Math.max(15, Math.min(300, Number(e.target.value) || 0)) : null)} className="h-10" />
          </div>
        </div>
      </Row>
      <CardioRow setup={setup} recommended={intel.recommendation.setup.cardio} why={why.cardio} edited={edited.has("cardio")} onChange={onChange} />
      <Row label="Block structure" value={setup.blocks.map((b) => `${b.name} ${b.weeks}w`).join(" → ")} why={why.blocks} edited={edited.has("blocks")}>
        <BlocksEditor setup={setup} onChange={onChange} meetWeeks={meetWeeks} />
      </Row>
      <Row label="Priorities" value={setup.priorities.join(", ") || "None set"} why={why.priorities} edited={edited.has("priorities")}>
        <Chips values={setup.priorities} onChange={(v) => onChange("priorities", v)} placeholder="A lift or muscle" suggestions={liftsAndMuscles} />
      </Row>
      <Row label="Equipment" value={setup.equipment.location ?? (setup.equipment.items.length ? "On file" : "Not on file")} why={why.equipment} edited={edited.has("equipment")}>
        <p className="text-[12px]">{setup.equipment.items.map((i) => EQUIPMENT_LABEL[i]).join(", ") || "Nothing on file: nothing is ruled out."}</p>
        {intel.ctx.equipment.constraints.length > 0 && <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">{intel.ctx.equipment.constraints.map((c) => <li key={c}>{c}</li>)}</ul>}
        <Button type="button" size="sm" variant="outline" className="mt-2 h-9" onClick={onEditEquipment}>Edit and confirm equipment</Button>
      </Row>
      <Row label="Restrictions" value={setup.restrictions.join(" · ") || "None on file"} why={why.restrictions} edited={edited.has("restrictions")}>
        <Chips values={setup.restrictions} onChange={(v) => onChange("restrictions", v)} placeholder="e.g. No barbell back squat (knee)" />
      </Row>
      <Row label="Keep" value={setup.retain.map((r) => r.name).join(", ") || "—"} why={why.retain} edited={edited.has("retain")}>
        <ExerciseChips values={setup.retain} onChange={(v) => onChange("retain", v)} options={exerciseOptions(intel)} placeholder="Exercise name" />
      </Row>
      <Row label="Reconsider" value={setup.replace.map((r) => r.name).join(", ") || "—"} why={why.replace} edited={edited.has("replace")}>
        <ExerciseChips values={setup.replace} onChange={(v) => onChange("replace", v)} options={exerciseOptions(intel)} placeholder="Exercise name" />
      </Row>
    </Card>
  );
}

export function exerciseOptions(intel: GeneratorIntel): ExerciseRef[] {
  const seen = new Set<string>();
  const out: ExerciseRef[] = [];
  for (const e of [...(intel.prev?.exercises ?? []), ...intel.history.exercises]) {
    const k = e.exerciseId ?? e.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: e.exerciseId, name: e.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function BlocksEditor({ setup, onChange, meetWeeks }: { setup: GenerationSetup; onChange: SetupChange; meetWeeks: number | null }) {
  const total = setup.blocks.reduce((n, b) => n + b.weeks, 0);
  const set = (i: number, patch: Partial<GenerationSetup["blocks"][number]>) => onChange("blocks", setup.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {setup.blocks.map((b, i) => (
        <div key={i} className="space-y-1 rounded-lg bg-background p-2">
          <div className="flex items-center gap-1">
            <Input value={b.name} onChange={(e) => set(i, { name: e.target.value })} className="h-9 flex-1 text-[13px] font-semibold" aria-label="Block name" />
            <Stepper value={b.weeks} min={1} max={16} onChange={(n) => set(i, { weeks: n })} suffix="wk" />
            {setup.blocks.length > 1 && <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={() => onChange("blocks", setup.blocks.filter((_, j) => j !== i))} aria-label="Remove block"><X className="h-4 w-4" /></Button>}
          </div>
          <Textarea value={b.objective} onChange={(e) => set(i, { objective: e.target.value })} rows={2} className="text-[12px]" aria-label="Objective" />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn("font-semibold", total !== setup.weeks && "text-destructive")}>{total} of {setup.weeks} weeks</span>
        {setup.blocks.length < 4 && <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => onChange("blocks", [...setup.blocks, { name: `Block ${setup.blocks.length + 1}`, weeks: Math.max(1, setup.weeks - total), objective: "" }])}>Add block</Button>}
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => onChange("blocks", blockStructure(setup.brain, setup.weeks, meetWeeks))}>Fit to {setup.weeks} weeks</Button>
      </div>
    </div>
  );
}

export function AdvancedControls({ intel, setup, edited, onChange }: { intel: GeneratorIntel; setup: GenerationSetup; edited: Set<SetupField>; onChange: SetupChange }) {
  const strength = STRENGTH_BRAINS.includes(setup.brain);
  const hyper = HYPERTROPHY_BRAINS.includes(setup.brain) || setup.brain === "general_fitness";
  const options = exerciseOptions(intel);
  const mark = (k: SetupField) => (edited.has(k) ? <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-bold uppercase text-primary">changed</span> : null);
  const listEditor = (k: "frequency" | "volume", unit: string, max: number) => {
    const rows = setup[k] as Array<{ target: string; perWeek?: number; setsPerWeek?: number }>;
    const field = k === "frequency" ? "perWeek" : "setsPerWeek";
    return (
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={`${r.target}-${i}`} className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{r.target}</span>
            <Input inputMode="decimal" value={String((r as any)[field] ?? "")} onChange={(e) => onChange(k, rows.map((x, j) => (j === i ? { ...x, [field]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) } : x)) as any)} className="h-8 w-16 text-center text-[12px]" aria-label={`${r.target} ${unit}`} />
            <span className="w-16 text-[11px] text-muted-foreground">{unit}</span>
            <button type="button" onClick={() => onChange(k, rows.filter((_, j) => j !== i) as any)} aria-label={`Remove ${r.target}`}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
          </div>
        ))}
        <AddTarget onAdd={(t) => onChange(k, [...rows, { target: t, [field]: k === "frequency" ? 2 : 10 }] as any)} />
      </div>
    );
  };
  return (
    <Card className="p-3.5" data-testid="gen-advanced">
      <details>
        <summary className="flex cursor-pointer select-none items-center justify-between">
          <SectionTitle>Advanced programming controls</SectionTitle>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </summary>
        <div className="mt-3 space-y-4 text-[12px]">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Goal and emphasis</legend>
            <div>
              <Label className="text-[11px]">Secondary goals{mark("secondaryGoals")}</Label>
              <Chips values={setup.secondaryGoals} onChange={(v) => onChange("secondaryGoals", v)} placeholder="Add a goal" />
            </div>
            {(strength || setup.brain === "hybrid" || setup.brain === "other") && (
              <div>
                <Label className="text-[11px]">Competition / event date{mark("meetDate")}</Label>
                <Input type="date" value={setup.meetDate ?? ""} onChange={(e) => onChange("meetDate", e.target.value || null)} className="h-10" />
              </div>
            )}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Training prescription</legend>
            <div>
              <Label className="text-[11px]">Frequency per week{mark("frequency")}</Label>
              {listEditor("frequency", "× / week", 7)}
            </div>
            <div>
              <Label className="text-[11px]">Weekly volume targets{mark("volume")}</Label>
              {listEditor("volume", strength && !hyper ? "sets / wk" : "hard sets", 60)}
            </div>
            <div>
              <Label className="text-[11px]">Intensity distribution{mark("intensity")}</Label>
              <Textarea value={setup.intensity} onChange={(e) => onChange("intensity", e.target.value)} rows={2} className="text-[12px]" />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-[11px]">RPE / RIR targets{mark("effort")}</Label>
                <Input value={setup.effort} onChange={(e) => onChange("effort", e.target.value)} className="h-10 text-[12px]" />
              </div>
              <div>
                <Label className="text-[11px]">Progression method{mark("progression")}</Label>
                <Input value={setup.progression} onChange={(e) => onChange("progression", e.target.value)} className="h-10 text-[12px]" />
              </div>
            </div>
            {setup.brain === "powerlifting" && (
              <div>
                <Label className="text-[11px]">Competition-lift specificity{mark("specificity")}</Label>
                <Input value={setup.specificity} onChange={(e) => onChange("specificity", e.target.value)} className="h-10 text-[12px]" />
              </div>
            )}
            <div>
              <Label className="text-[11px]">Required exercises{mark("required")}</Label>
              <ExerciseChips values={setup.required} onChange={(v) => onChange("required", v)} options={options} placeholder="Any exercise name" />
            </div>
            <div>
              <Label className="text-[11px]">Excluded exercises{mark("excluded")}</Label>
              <ExerciseChips values={setup.excluded} onChange={(v) => onChange("excluded", v)} options={options} placeholder="Any exercise name" />
            </div>
            <div>
              <Label className="text-[11px]">Recovery constraints{mark("recovery")}</Label>
              <Textarea value={setup.recovery} onChange={(e) => onChange("recovery", e.target.value)} rows={2} className="text-[12px]" placeholder="e.g. Night shifts Thursdays: keep Friday light" />
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Athlete context</legend>
            <div>
              <Label className="text-[11px]">Exercise preferences{mark("preferences")}</Label>
              <Textarea value={setup.preferences} onChange={(e) => onChange("preferences", e.target.value)} rows={2} className="text-[12px]" placeholder="e.g. Prefers safety-bar squats; dislikes lunges" />
            </div>
            <div>
              <Label className="text-[11px]">Coach notes for this program{mark("coachNotes")}</Label>
              <Textarea value={setup.coachNotes} onChange={(e) => onChange("coachNotes", e.target.value)} rows={3} maxLength={2000} className="text-[12px]" placeholder="Anything the program must do" />
            </div>
            <div>
              <Label className="text-[11px]">New circumstances not in the records yet{mark("newCircumstances")}</Label>
              <Textarea value={setup.newCircumstances} onChange={(e) => onChange("newCircumstances", e.target.value)} rows={2} maxLength={2000} className="text-[12px]" placeholder="e.g. Moving gyms in 3 weeks; new baby" />
            </div>
          </fieldset>
        </div>
      </details>
    </Card>
  );
}

function AddTarget({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <div className="flex gap-1 pt-0.5">
      <Input value={t} onChange={(e) => setT(e.target.value)} placeholder="Lift or muscle" className="h-8 text-[12px]" />
      <Button type="button" size="sm" variant="outline" className="h-8" disabled={!t.trim()} onClick={() => (onAdd(t.trim()), setT(""))}>Add</Button>
    </div>
  );
}

export function ConflictsCard({ conflicts }: { conflicts: Conflict[] }) {
  if (!conflicts.length) return null;
  return (
    <Card className="space-y-2 border-warning/40 p-3.5" data-testid="gen-conflicts">
      <SectionTitle hint={`${conflicts.filter((c) => c.severity === "blocker").length} to fix`}>Conflicts</SectionTitle>
      {conflicts.map((c) => (
        <div key={c.id} className={cn("flex gap-2 rounded-xl p-2 text-[12px]", c.severity === "blocker" ? "bg-destructive/10" : "bg-warning/10")}>
          <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", c.severity === "blocker" ? "text-destructive" : "text-warning")} />
          <div>
            <div className="font-semibold">{c.title}{c.severity === "blocker" ? " (fix before generating)" : ""}</div>
            {c.detail ? <div className="text-muted-foreground">{c.detail}</div> : null}
            {c.options.length > 0 && <div className="mt-0.5 text-[11px] text-muted-foreground">Options: {c.options.join(" · ")}</div>}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">Warnings go to the AI with your setup, which must address each one; nothing is dropped silently.</p>
    </Card>
  );
}

export function EquipmentSheet({ open, onOpenChange, intel, onSave, saving }: { open: boolean; onOpenChange: (v: boolean) => void; intel: GeneratorIntel; onSave: (p: EquipmentProfile) => Promise<void>; saving: boolean }) {
  const e = intel.ctx.equipment;
  const [items, setItems] = useState<EquipmentItem[]>(e.items);
  const [location, setLocation] = useState(e.location ?? "");
  const [cables, setCables] = useState<number>(e.cableStations ?? 0);
  const [space, setSpace] = useState(e.space ?? "");
  const [notes, setNotes] = useState(e.notes ?? "");
  const toggle = (i: EquipmentItem) => setItems(items.includes(i) ? items.filter((x) => x !== i) : [...items, i]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Their equipment</SheetTitle>
          <SheetDescription>Saved for this client and used as the authoritative list for every generated program. Proven by the last program: {e.proven.map((i) => EQUIPMENT_LABEL[i]).join(", ") || "nothing yet"}.</SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-3 text-[12px]">
          <div>
            <Label className="text-[11px]">Where they train</Label>
            <Input value={location} onChange={(ev) => setLocation(ev.target.value)} placeholder="e.g. Home gym (10×10 ft room)" className="h-10" />
          </div>
          <div className="flex flex-wrap gap-1">
            {EQUIPMENT_ITEMS.map((i) => (
              <button key={i} type="button" onClick={() => toggle(i)} className={cn("h-8 rounded-full px-2.5 text-[11px] font-semibold", items.includes(i) ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")} aria-pressed={items.includes(i)}>
                {EQUIPMENT_LABEL[i]}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px]">Cable columns (each with a high and a low position)</Label>
            <Stepper value={cables} min={0} max={4} onChange={setCables} />
          </div>
          <div>
            <Label className="text-[11px]">Space</Label>
            <Input value={space} onChange={(ev) => setSpace(ev.target.value)} placeholder="e.g. 10×10 ft room, no room for a barbell row next to the rack" className="h-10" />
          </div>
          <div>
            <Label className="text-[11px]">Notes</Label>
            <Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={2} placeholder="e.g. Dumbbells go to 50 lb; bench has a leg attachment" />
          </div>
          <Button
            className="h-11 w-full"
            disabled={saving || !items.length}
            onClick={async () => {
              try {
                await onSave({ location: location.trim() || null, items, cableStations: cables || null, space: space.trim() || null, notes: notes.trim() || null });
                toast.success("Equipment confirmed for this client");
                onOpenChange(false);
              } catch (err: any) {
                toast.error(err?.message ?? "Couldn't save");
              }
            }}
          >
            Confirm equipment
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
