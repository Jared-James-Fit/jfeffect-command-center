/**
 * One cardio session in the builder (Nov 23 2026): the kind of cardio as a row
 * of chips (treadmill walking first), the days, how long, then only the
 * settings that kind takes (speed in the coach's unit, incline, an incline
 * range for variable incline, a name for custom or conditioning), how hard
 * (RPE and/or heart rate), when it goes against lifting, how it progresses,
 * and what the client reads. The coach's private note folds away.
 */
import { useState } from "react";
import { ChevronDown, Copy, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CARDIO_WEEKDAYS, type CardioWeekday } from "@/lib/cardio-prescription";
import { MODALITIES, modalitySpec, rpeWords } from "@/lib/cardio/modalities";
import {
  DAYS_RULE_LABEL,
  PROGRESSION_LABEL,
  TIMING_LABEL,
  TIMING_SHORT,
  daysWords,
  sessionLine,
  speedInputToMph,
  speedText,
  weekdaysFor,
  withModality,
  type CardioSession,
  type DaysRule,
  type PlanContext,
  type ProgressionKind,
  type Timing,
} from "@/lib/cardio/plan";
import type { SpeedUnit } from "@/lib/weight-management/units";

const RULES: DaysRule[] = ["non_training", "training", "weekdays", "daily", "high"];
const TIMINGS: Timing[] = ["any", "after_lifting", "separate", "before_lifting"];
const HR_ZONES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4"];

function Chip({ on, children, onClick, disabled, title }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={cn(
        "h-9 shrink-0 cursor-pointer rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        on ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** A number box that keeps what's typed until it reads (never rewrites mid-typing). */
function NumberBox({ value, onChange, step = 1, min, max, placeholder, width = "w-20", label }: { value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; placeholder?: string; width?: string; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? "" : String(value));
  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      value={shown}
      placeholder={placeholder}
      className={cn("h-10 tabular-nums", width)}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.replace(",", ".").trim();
        if (!raw) return onChange(null);
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(n / step) * step)));
      }}
      onBlur={() => setText(null)}
    />
  );
}

export function CardioSessionEditor({
  session: s,
  ctx,
  unit,
  onChange,
  onDuplicate,
  onCopyTo,
  onRemove,
  problems,
  open = true,
  onToggle,
}: {
  session: CardioSession;
  ctx: PlanContext;
  unit: SpeedUnit;
  onChange: (next: CardioSession, tag: string) => void;
  onDuplicate: () => void;
  onCopyTo: (days: CardioWeekday[]) => void;
  onRemove: () => void;
  problems: Array<{ level: "error" | "warn"; text: string }>;
  /** Folded to its one-line summary when false (the builder keeps one session open at a time). */
  open?: boolean;
  onToggle?: () => void;
}) {
  const spec = modalitySpec(s.modality);
  const has = (f: string) => (spec.fields as string[]).includes(f);
  const days = weekdaysFor(s.days, s.weekdays, ctx);
  const set = (patch: Partial<CardioSession>, tag: string) => onChange({ ...s, ...patch }, `${s.key}:${tag}`);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDays, setCopyDays] = useState<CardioWeekday[]>([]);
  const [noteOpen, setNoteOpen] = useState(!!s.coachNote);
  const training = new Set(ctx.trainingDays);
  const u = unit === "kmh" ? "km/h" : "mph";
  const pickDays = s.days === "weekdays" || s.days === "non_training";

  return (
    <article className={cn("rounded-2xl border border-border bg-card p-4", !s.enabled && "opacity-70")} data-cardio-session={s.key}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className={cn("min-w-0 flex-1 text-left", onToggle && "cursor-pointer")}
          onClick={onToggle}
          disabled={!onToggle}
          aria-expanded={open}
          data-session-toggle
        >
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            {has("name") && s.name ? s.name : spec.label}
            {onToggle && <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {open
              ? `${s.minutes} min · ${days.length} day${days.length === 1 ? "" : "s"} a week${s.enabled ? "" : " · paused"}`
              : `${sessionLine(s, unit).split(" · ").slice(1).join(" · ")} · ${daysWords(s, ctx)}${s.timing !== "any" ? ` · ${TIMING_SHORT[s.timing]}` : ""}${s.enabled ? "" : " · paused"}`}
          </p>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10" aria-label="Session options">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCopyOpen(true)}>
              <Copy className="mr-2 h-4 w-4" /> Copy to other days…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => set({ enabled: !s.enabled }, "enabled")}>
              {s.enabled ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />} {s.enabled ? "Pause" : "Switch back on"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onRemove}>
              <Trash2 className="mr-2 h-4 w-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {open && (
        <>
      {copyOpen && (
        <div className="mt-3 rounded-xl border border-border p-3" data-copy-days>
          <p className="text-[13px] font-medium">Copy this session to</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CARDIO_WEEKDAYS.map((d) => (
              <Chip key={d} on={copyDays.includes(d)} onClick={() => setCopyDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))}>
                {d.slice(0, 3)}
              </Chip>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button className="h-9" disabled={!copyDays.length} onClick={() => { onCopyTo(copyDays); setCopyOpen(false); setCopyDays([]); }}>
              Copy
            </Button>
            <Button variant="ghost" className="h-9" onClick={() => setCopyOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* kind of cardio */}
      <div className="mt-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="radiogroup" aria-label="Kind of cardio" data-modality-chips>
        {MODALITIES.map((m) => (
          <Chip key={m.key} on={s.modality === m.key} onClick={() => onChange(withModality(s, m.key), `${s.key}:modality`)}>
            {m.short}
          </Chip>
        ))}
      </div>
      {has("name") && (
        <div className="mt-3">
          <Field label="What it is (the client sees this)">
            <Input value={s.name ?? ""} placeholder={s.modality === "conditioning" ? "Sled pushes, intervals…" : "Swimming, hiking…"} className="h-10" onChange={(e) => set({ name: e.target.value || null }, "name")} />
          </Field>
        </div>
      )}

      {/* days */}
      <div className="mt-4">
        <p className="text-[12px] font-medium text-muted-foreground">Days</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {RULES.map((r) => (
            <Chip
              key={r}
              on={s.days === r}
              disabled={(r === "training" && !ctx.trainingDays.length) || (r === "high" && !ctx.highDays.length)}
              title={r === "training" && !ctx.trainingDays.length ? "Their training days aren't set" : r === "high" && !ctx.highDays.length ? "They have no high day" : undefined}
              onClick={() => set({ days: r, weekdays: weekdaysFor(r, s.weekdays, ctx), timing: r === "training" && s.timing === "any" ? "after_lifting" : s.timing }, "days")}
            >
              {DAYS_RULE_LABEL[r]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1" aria-label="Weekdays">
          {CARDIO_WEEKDAYS.map((d) => {
            const on = days.includes(d);
            const locked = !pickDays || (s.days === "non_training" && training.has(d));
            return (
              <button
                key={d}
                type="button"
                disabled={locked}
                aria-pressed={on}
                onClick={() => set({ weekdays: on ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d] }, "weekdays")}
                className={cn(
                  "flex h-11 flex-col items-center justify-center rounded-lg border text-[12px] transition-colors",
                  on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
                  locked ? "cursor-default" : "cursor-pointer hover:bg-muted",
                  on && !locked && "hover:bg-foreground/90",
                )}
              >
                <span className="font-medium">{d.slice(0, 1)}</span>
                {training.has(d) && <span className={cn("mt-0.5 h-1 w-1 rounded-full", on ? "bg-background" : "bg-muted-foreground")} aria-label="lifting day" />}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">A dot marks a lifting day.</p>
      </div>

      {/* dose and settings */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-3">
        <Field label="Minutes">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-10 w-10" aria-label="5 minutes less" onClick={() => set({ minutes: Math.max(5, s.minutes - 5) }, "minutes")}>
              −
            </Button>
            <NumberBox label="Minutes" value={s.minutes} min={1} max={240} onChange={(v) => v != null && set({ minutes: v }, "minutes")} width="w-16" />
            <Button variant="outline" size="icon" className="h-10 w-10" aria-label="5 minutes more" onClick={() => set({ minutes: Math.min(240, s.minutes + 5) }, "minutes")}>
              +
            </Button>
          </div>
        </Field>
        {has("speed") && (
          <Field label={`Speed (${u})`}>
            <div className="flex items-center gap-1">
              <SpeedBox label="Lowest speed" mph={s.speedMinMph} unit={unit} onChange={(v) => set({ speedMinMph: v, speedMaxMph: s.speedMaxMph != null && v != null && s.speedMaxMph < v ? v : s.speedMaxMph }, "speed")} />
              <span className="text-muted-foreground">–</span>
              <SpeedBox label="Highest speed" mph={s.speedMaxMph} unit={unit} onChange={(v) => set({ speedMaxMph: v }, "speed")} />
            </div>
          </Field>
        )}
        {has("incline") && (
          <Field label={has("inclineMax") ? "Incline (%) from – to" : "Incline (%)"}>
            <div className="flex items-center gap-1">
              <NumberBox label="Incline" value={s.incline} step={0.5} min={0} max={15} onChange={(v) => set({ incline: v }, "incline")} width="w-16" />
              {has("inclineMax") && (
                <>
                  <span className="text-muted-foreground">–</span>
                  <NumberBox label="Top incline" value={s.inclineMax} step={0.5} min={0} max={15} onChange={(v) => set({ inclineMax: v }, "inclineMax")} width="w-16" />
                </>
              )}
            </div>
          </Field>
        )}
      </div>

      {/* effort */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-3">
        <Field label="Effort (RPE 1–10)" hint={rpeWords(s.rpeMin, s.rpeMax) ?? undefined}>
          <div className="flex items-center gap-1">
            <NumberBox label="Lowest RPE" value={s.rpeMin} min={1} max={10} step={0.5} onChange={(v) => set({ rpeMin: v }, "rpe")} width="w-16" />
            <span className="text-muted-foreground">–</span>
            <NumberBox label="Highest RPE" value={s.rpeMax} min={1} max={10} step={0.5} onChange={(v) => set({ rpeMax: v }, "rpe")} width="w-16" />
          </div>
        </Field>
        <Field label="Heart rate (optional)">
          <div className="flex flex-wrap items-center gap-1">
            <select
              aria-label="Heart-rate zone"
              value={s.hrMin != null ? "bpm" : (s.hrZone ?? "")}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "bpm") set({ hrZone: null, hrMin: s.hrMin ?? 120, hrMax: s.hrMax ?? 140 }, "hr");
                else set({ hrZone: v || null, hrMin: null, hrMax: null }, "hr");
              }}
              className="h-10 rounded-lg border border-input bg-background px-2 text-[14px]"
            >
              <option value="">None</option>
              {HR_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
              <option value="bpm">A bpm range</option>
            </select>
            {s.hrMin != null && (
              <>
                <NumberBox label="Lowest bpm" value={s.hrMin} min={60} max={210} onChange={(v) => set({ hrMin: v }, "hr")} width="w-16" />
                <span className="text-muted-foreground">–</span>
                <NumberBox label="Highest bpm" value={s.hrMax} min={60} max={210} onChange={(v) => set({ hrMax: v }, "hr")} width="w-16" />
              </>
            )}
          </div>
        </Field>
      </div>

      {/* timing */}
      <div className="mt-4">
        <p className="text-[12px] font-medium text-muted-foreground">When, against lifting</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TIMINGS.map((t) => (
            <Chip key={t} on={s.timing === t} onClick={() => set({ timing: t }, "timing")}>
              {TIMING_LABEL[t]}
            </Chip>
          ))}
        </div>
      </div>

      {/* progression */}
      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-2">
        <Field label="Progression">
          <select
            aria-label="Progression"
            value={s.progression.kind}
            onChange={(e) => {
              const kind = e.target.value as ProgressionKind;
              const step = kind === "minutes" ? 5 : kind === "incline" ? 1 : kind === "speed" ? 0.1 : kind === "sessions" ? 1 : 0;
              const cap = kind === "minutes" ? s.minutes + 20 : kind === "incline" ? 10 : kind === "speed" ? 3.6 : kind === "sessions" ? 5 : null;
              set({ progression: { kind, step, everyWeeks: kind === "none" ? 1 : 2, cap } }, "progression");
            }}
            className="h-10 rounded-lg border border-input bg-background px-2 text-[14px]"
          >
            {(Object.keys(PROGRESSION_LABEL) as ProgressionKind[]).map((k) => (
              <option key={k} value={k}>
                {PROGRESSION_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {s.progression.kind !== "none" && (
          <>
            <Field label={`Step${s.progression.kind === "speed" ? " (mph)" : s.progression.kind === "incline" ? " (%)" : ""}`}>
              <NumberBox label="Progression step" value={s.progression.step} step={s.progression.kind === "speed" ? 0.1 : 0.5} min={0} max={30} onChange={(v) => set({ progression: { ...s.progression, step: v ?? 0 } }, "progression")} width="w-16" />
            </Field>
            <Field label="Every (weeks)">
              <NumberBox label="Every how many weeks" value={s.progression.everyWeeks} min={1} max={8} onChange={(v) => set({ progression: { ...s.progression, everyWeeks: v ?? 1 } }, "progression")} width="w-16" />
            </Field>
            <Field label="Up to">
              <NumberBox label="Progression ceiling" value={s.progression.cap} step={0.1} min={0} max={240} onChange={(v) => set({ progression: { ...s.progression, cap: v } }, "progression")} width="w-20" />
            </Field>
          </>
        )}
      </div>

      {/* words */}
      <div className="mt-4">
        <Field label="Instructions (the client reads these)">
          <Textarea rows={2} value={s.instructions} maxLength={600} placeholder="Easy: you can talk in full sentences." onChange={(e) => set({ instructions: e.target.value }, "instructions")} />
        </Field>
      </div>
      {noteOpen ? (
        <div className="mt-3">
          <Field label="Private note (only you and Cleo see it)">
            <Textarea rows={2} value={s.coachNote} maxLength={600} onChange={(e) => set({ coachNote: e.target.value }, "note")} />
          </Field>
        </div>
      ) : (
        <button type="button" className="mt-2 cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground" onClick={() => setNoteOpen(true)}>
          + Private note
        </button>
      )}

        </>
      )}

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px]">
          {problems.map((p, i) => (
            <li key={i} className={p.level === "error" ? "text-destructive" : "text-warning"}>
              {p.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function SpeedBox({ mph, unit, onChange, label }: { mph: number | null; unit: SpeedUnit; onChange: (mph: number | null) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      inputMode="decimal"
      aria-label={label}
      className="h-10 w-16 tabular-nums"
      value={text ?? speedText(mph, unit) ?? ""}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) return onChange(null);
        const v = speedInputToMph(e.target.value, unit);
        if (v != null) onChange(v);
      }}
      onBlur={() => setText(null)}
    />
  );
}
