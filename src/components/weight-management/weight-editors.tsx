/**
 * The weight-management card's three sheets: the bodyweight goal (with the
 * date it's for; a meet's class comes from its prep), the few settings the
 * records can't tell (treadmill unit and top incline, time, heat, sweat, how
 * much the meet matters), and the treadmill prescription the coach edits
 * before it goes on the client's cardio plan. Every number is typed with the
 * number pad and checked; nothing saves until Save.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { weightKey } from "@/lib/weight-management/handoff";
import type { Assessment } from "@/lib/weight-management/assessment";
import { fmtDay, fmtWeight, kmhToMph, mphToKmh, round, type SpeedUnit } from "@/lib/weight-management/units";
import type { TreadmillSession } from "@/lib/weight-management/treadmill";
import { saveCardioPlanFn, saveWeightGoalFn, saveWeightProfileFn, type WeightManagementView } from "@/lib/weight-management/weight-management.functions";

const SHEET = "max-h-[92dvh] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:mx-auto sm:max-w-lg sm:rounded-t-2xl";
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;


function Chips<T extends string>({ value, options, onChange, label }: { value: T | null; options: Array<{ value: T; label: string }>; onChange: (v: T | null) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={cn(
            "h-10 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
            value === o.value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const num = (s: string) => {
  const n = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------------ */

type GoalType = "lose" | "gain" | "maintain" | "performance_cut" | "custom";
const GOAL_TYPES: Array<{ value: GoalType; label: string }> = [
  { value: "lose", label: "Lose" },
  { value: "performance_cut", label: "Make weight" },
  { value: "maintain", label: "Hold" },
  { value: "gain", label: "Gain" },
];

export function GoalSheet({ open, onOpenChange, clientId, view, current }: { open: boolean; onOpenChange: (b: boolean) => void; clientId: string; view: WeightManagementView; current: { type: GoalType | null; value: number | null; valueMax: number | null; date: string | null } }) {
  const qc = useQueryClient();
  const save = useServerFn(saveWeightGoalFn);
  const a = view.assessment;
  const unit = view.goalUnit ?? a.unit;
  const [type, setType] = useState<GoalType | null>(current.type);
  const [value, setValue] = useState(current.value != null ? String(current.value) : "");
  const [valueMax, setValueMax] = useState(current.valueMax != null ? String(current.valueMax) : "");
  const [date, setDate] = useState(current.date ?? "");
  useEffect(() => {
    if (!open) return;
    setType(current.type);
    setValue(current.value != null ? String(current.value) : "");
    setValueMax(current.valueMax != null ? String(current.valueMax) : "");
    setDate(current.date ?? "");
  }, [open, current.type, current.value, current.valueMax, current.date]);

  const m = useMutation({
    mutationFn: (clear: boolean) =>
      save({ data: { clientId, type: clear ? null : type, value: clear ? null : num(value), valueMax: clear || type !== "maintain" ? null : num(valueMax), unit, date: clear || !date ? null : date } }),
    onSuccess: () => {
      toast.success("Goal saved");
      qc.invalidateQueries({ queryKey: weightKey(clientId) });
      qc.invalidateQueries({ queryKey: ["client-bodyweight-goal", clientId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save the goal"),
  });
  const v = num(value);
  const problem = !type ? "Pick what the goal is" : v == null || v < (unit === "kg" ? 25 : 55) || v > (unit === "kg" ? 300 : 660) ? `Type a target in ${unit}` : date && date < a.today ? "The date has passed" : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={SHEET} data-weight-goal-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>Bodyweight goal</SheetTitle>
          <SheetDescription>What they're working toward and by when. The trend, the pace it takes and the projection follow from it.</SheetDescription>
        </SheetHeader>
        {a.goal?.source === "meet" && (
          <div className="mt-4 rounded-xl border border-border p-3 text-[13px]" data-weight-goal-meet>
            <div className="font-medium">From their meet: {a.goal.label}</div>
            <div className="mt-0.5 text-muted-foreground">
              Planned to {fmtWeight(a.goal.kg, a.unit)} by {a.goal.date ? fmtDay(a.goal.date, a.today) : "the meet"} in a normal state ({fmtWeight(a.goal.bufferKg ?? 0, a.unit)} under the limit). Change the class on the meet itself. A goal here is used once the meet is past.
            </div>
          </div>
        )}
        <div className="mt-4 space-y-4">
          <Field label="Goal">
            <Chips value={type} options={GOAL_TYPES} onChange={setType} label="Goal" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={type === "maintain" ? `From (${unit})` : `Target (${unit})`}>
              <Input inputMode="decimal" className="h-12 text-base" value={value} onChange={(e) => setValue(e.target.value)} placeholder={unit === "kg" ? "82.5" : "182"} />
            </Field>
            {type === "maintain" ? (
              <Field label={`To (${unit})`}>
                <Input inputMode="decimal" className="h-12 text-base" value={valueMax} onChange={(e) => setValueMax(e.target.value)} />
              </Field>
            ) : (
              <Field label="By (optional)">
                <Input type="date" className="h-12 text-base" value={date} min={a.today} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
          </div>
          {problem && (type || value) ? <p className="text-[13px] text-warning">{problem}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="h-11 flex-1" disabled={!!problem || m.isPending} onClick={() => m.mutate(false)}>
              Save
            </Button>
            {current.type && (
              <Button variant="ghost" className="h-11" disabled={m.isPending} onClick={() => m.mutate(true)}>
                Clear goal
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------------ */

type Profile = NonNullable<WeightManagementView["profile"]>;

export function SettingsSheet({ open, onOpenChange, clientId, view }: { open: boolean; onOpenChange: (b: boolean) => void; clientId: string; view: WeightManagementView }) {
  const qc = useQueryClient();
  const save = useServerFn(saveWeightProfileFn);
  const blank: Profile = { speed_unit: null, climate: null, sweat_level: null, max_incline: null, max_session_minutes: null, meet_importance: null };
  const [p, setP] = useState<Profile>(view.profile ?? blank);
  const [incline, setIncline] = useState(view.profile?.max_incline != null ? String(view.profile.max_incline) : "");
  const [minutes, setMinutes] = useState(view.profile?.max_session_minutes != null ? String(view.profile.max_session_minutes) : "");
  useEffect(() => {
    if (!open) return;
    setP(view.profile ?? blank);
    setIncline(view.profile?.max_incline != null ? String(view.profile.max_incline) : "");
    setMinutes(view.profile?.max_session_minutes != null ? String(view.profile.max_session_minutes) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view.profile]);
  const inc = incline.trim() ? num(incline) : null;
  const min = minutes.trim() ? num(minutes) : null;
  const problem = incline.trim() && (inc == null || inc < 0 || inc > 40) ? "Top incline: 0–40%" : minutes.trim() && (min == null || min < 10 || min > 180) ? "Longest session: 10–180 min" : null;
  const m = useMutation({
    mutationFn: () => save({ data: { clientId, ...p, speed_unit: (p.speed_unit as any) ?? null, climate: (p.climate as any) ?? null, sweat_level: (p.sweat_level as any) ?? null, meet_importance: (p.meet_importance as any) ?? null, max_incline: inc, max_session_minutes: min != null ? Math.round(min) : null } }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: weightKey(clientId) });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });
  const set = <K extends keyof Profile>(k: K) => (v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={SHEET} data-weight-settings-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>Cardio and water settings</SheetTitle>
          <SheetDescription>Only what their records can't tell. Leave anything blank to use the default.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <Field label="Their treadmill shows" hint={`Default: ${view.assessment.unit === "kg" ? "km/h" : "mph"}, from the unit they weigh in.`}>
            <Chips value={p.speed_unit as SpeedUnit | null} options={[{ value: "mph", label: "mph" }, { value: "kmh", label: "km/h" }]} onChange={set("speed_unit")} label="Speed unit" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Top incline (%)" hint="Their treadmill's highest.">
              <Input inputMode="decimal" className="h-12 text-base" value={incline} onChange={(e) => setIncline(e.target.value)} placeholder="15" />
            </Field>
            <Field label="Longest session (min)" hint="Time they have for one walk.">
              <Input inputMode="numeric" className="h-12 text-base" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="45" />
            </Field>
          </div>
          <Field label="Where they train">
            <Chips value={p.climate as "temperate" | "hot" | null} options={[{ value: "temperate", label: "Normal" }, { value: "hot", label: "Hot or humid" }]} onChange={set("climate")} label="Climate" />
          </Field>
          <Field label="How much they sweat">
            <Chips value={p.sweat_level as "light" | "average" | "heavy" | null} options={[{ value: "light", label: "Lightly" }, { value: "average", label: "Average" }, { value: "heavy", label: "Heavily" }]} onChange={set("sweat_level")} label="Sweat" />
          </Field>
          {view.assessment.goal?.source === "meet" && (
            <Field label="This meet is" hint="A tune-up meet makes a heavier class the easier call.">
              <Chips value={p.meet_importance as "primary" | "tune_up" | null} options={[{ value: "primary", label: "The main one" }, { value: "tune_up", label: "A tune-up" }]} onChange={set("meet_importance")} label="Meet importance" />
            </Field>
          )}
          {problem ? <p className="text-[13px] text-warning">{problem}</p> : null}
          <Button className="h-11 w-full" disabled={!!problem || m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------------ */

type Draft = { on: boolean; minutes: string; speed: string; incline: string; weekdays: string[] };
type Plan = { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null };

const toDraft = (s: TreadmillSession | null, unit: SpeedUnit, fallback: TreadmillSession | null): Draft => {
  const src = s ?? fallback;
  return {
    on: !!s,
    minutes: src ? String(src.minutes) : "20",
    speed: src ? (unit === "kmh" ? mphToKmh(src.speedMph) : src.speedMph).toFixed(1) : unit === "kmh" ? "4.8" : "3.0",
    incline: src ? String(src.inclinePct) : "5",
    weekdays: src?.weekdays ?? [],
  };
};

/**
 * The treadmill plan, editable: after lifting (every training day) and days
 * off (which days). Starts from their current plan, or the suggestion when
 * `start` says so. For a coach's non-treadmill plan, saving switches it to a
 * treadmill only when they tick that.
 */
export function TreadmillSheet({ open, onOpenChange, clientId, view, start, reviewId }: { open: boolean; onOpenChange: (b: boolean) => void; clientId: string; view: WeightManagementView; start: Plan; reviewId?: string | null }) {
  const qc = useQueryClient();
  const save = useServerFn(saveCardioPlanFn);
  const a = view.assessment;
  const unit = a.speedUnit;
  const trainDays = a.cardio.suggested.trainingDay?.weekdays ?? a.cardio.current.trainingDay?.weekdays ?? [];
  const [t, setT] = useState<Draft>(() => toDraft(start.trainingDay, unit, a.cardio.suggested.trainingDay));
  const [r, setR] = useState<Draft>(() => toDraft(start.restDay, unit, a.cardio.suggested.restDay));
  const [switchType, setSwitchType] = useState(false);
  useEffect(() => {
    if (!open) return;
    setT(toDraft(start.trainingDay, unit, a.cardio.suggested.trainingDay));
    setR(toDraft(start.restDay, unit, a.cardio.suggested.restDay));
    setSwitchType(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const other = a.cardio.modality === "other" && !switchType;

  const read = (d: Draft, kind: "trainingDay" | "restDay"): { session: TreadmillSession | null; problem: string | null } => {
    if (!d.on) return { session: null, problem: null };
    const minutes = num(d.minutes);
    const speed = num(d.speed);
    const incline = num(d.incline);
    const name = kind === "trainingDay" ? "After lifting" : "Days off";
    if (minutes == null || minutes < 5 || minutes > 90) return { session: null, problem: `${name}: 5–90 minutes` };
    if (!other && (speed == null || (unit === "kmh" ? speed < 2 || speed > 10 : speed < 1.2 || speed > 6))) return { session: null, problem: `${name}: a walking speed in ${unit === "kmh" ? "km/h" : "mph"}` };
    if (!other && (incline == null || incline < 0 || incline > 15)) return { session: null, problem: `${name}: incline 0–15%` };
    const weekdays = kind === "trainingDay" ? trainDays : d.weekdays;
    if (kind === "restDay" && !weekdays.length) return { session: null, problem: "Days off: pick at least one day" };
    const mph = other ? (start[kind]?.speedMph ?? 3) : unit === "kmh" ? kmhToMph(speed!) : speed!;
    return { session: { minutes: Math.round(minutes), speedMph: round(mph, 3), inclinePct: other ? (start[kind]?.inclinePct ?? 0) : round(incline!, 1), perWeek: weekdays.length || (kind === "trainingDay" ? trainDays.length : 0), weekdays }, problem: null };
  };
  const tr = read(t, "trainingDay");
  const rr = read(r, "restDay");
  const problem = tr.problem ?? rr.problem;
  const m = useMutation({
    mutationFn: () => save({ data: { clientId, reviewId: reviewId ?? null, plan: { trainingDay: tr.session, restDay: rr.session }, switchToTreadmill: switchType } }),
    onSuccess: (res) => {
      toast.success(res.changed ? "Cardio plan updated. Their workouts follow it." : "Nothing changed");
      qc.invalidateQueries({ queryKey: weightKey(clientId) });
      qc.invalidateQueries({ queryKey: ["cardio-targets", clientId] });
      qc.invalidateQueries({ queryKey: ["cardio_targets", clientId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save the cardio plan"),
  });
  const restOptions = WEEK.filter((d) => !trainDays.includes(d));

  const block = (kind: "trainingDay" | "restDay", d: Draft, set: (fn: (x: Draft) => Draft) => void) => (
    <div className="space-y-3 rounded-xl border border-border p-3" data-treadmill-session={kind}>
      <label className="flex min-h-10 items-center justify-between gap-3">
        <span className="text-[15px] font-medium">{kind === "trainingDay" ? "After lifting" : "On days off"}</span>
        <input type="checkbox" className="h-5 w-5 accent-foreground" checked={d.on} onChange={(e) => set((x) => ({ ...x, on: e.target.checked }))} aria-label={kind === "trainingDay" ? "Cardio after lifting" : "Cardio on days off"} />
      </label>
      {d.on && (
        <>
          <div className={cn("grid gap-2", other ? "grid-cols-1" : "grid-cols-3")}>
            <Field label="Minutes">
              <Input inputMode="numeric" className="h-12 text-base" value={d.minutes} onChange={(e) => set((x) => ({ ...x, minutes: e.target.value }))} />
            </Field>
            {!other && (
              <>
                <Field label={`Speed (${unit === "kmh" ? "km/h" : "mph"})`}>
                  <Input inputMode="decimal" className="h-12 text-base" value={d.speed} onChange={(e) => set((x) => ({ ...x, speed: e.target.value }))} />
                </Field>
                <Field label="Incline (%)">
                  <Input inputMode="decimal" className="h-12 text-base" value={d.incline} onChange={(e) => set((x) => ({ ...x, incline: e.target.value }))} />
                </Field>
              </>
            )}
          </div>
          {kind === "trainingDay" ? (
            <p className="text-xs text-muted-foreground">Every training day{trainDays.length ? ` (${trainDays.map((x) => x.slice(0, 3)).join(", ")})` : ""}, as the last thing in the workout.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days off">
              {restOptions.map((day) => {
                const on = d.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set((x) => ({ ...x, weekdays: on ? x.weekdays.filter((w) => w !== day) : WEEK.filter((w) => w === day || x.weekdays.includes(w)) }))}
                    className={cn("h-10 min-w-12 rounded-full border px-3 text-[13px] font-medium", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted")}
                  >
                    {day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={SHEET} data-treadmill-sheet>
        <SheetHeader className="text-left">
          <SheetTitle>{other ? `${a.cardio.keep} plan` : "Treadmill plan"}</SheetTitle>
          <SheetDescription>
            {other ? "Their cardio stays the type you chose; only its time and days change here." : "Easy to moderate walking: they can still talk in full sentences. It goes on their cardio plan and their workouts follow it."}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {a.cardio.modality === "other" && (
            <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-border p-3 text-[13px]">
              <span>Switch {a.cardio.keep} to a treadmill</span>
              <input type="checkbox" className="h-5 w-5 accent-foreground" checked={switchType} onChange={(e) => setSwitchType(e.target.checked)} />
            </label>
          )}
          {block("trainingDay", t, setT)}
          {block("restDay", r, setR)}
          {problem ? <p className="text-[13px] text-warning">{problem}</p> : null}
          <Button className="h-11 w-full" disabled={!!problem || m.isPending} onClick={() => m.mutate()}>
            Save cardio plan
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
