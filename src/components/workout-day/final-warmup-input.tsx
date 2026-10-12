import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Flame, Pencil, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeWarmup, estimateOneRepMax, normalizeWarmupRow, repsLeftLabel, type WarmupSetRow, type WarmupUnit } from "@/lib/final-warmup";
import { WARMUP_MAX_REPS, type LoadSuggestion } from "@/lib/load-suggestion";

const sb = supabase as any;
const MAX_WARMUPS = 8;

/**
 * Every exercise card asks for its warm-ups as it mounts; the asks made in the
 * same tick for one workout go out as one request instead of one per exercise.
 */
type WarmupWaiter = { resolve: (rows: WarmupSetRow[]) => void; reject: (e: unknown) => void };
const warmupBatches = new Map<string, Map<string, WarmupWaiter[]>>();

function loadWarmupSets(rowId: string, clientId: string, scheduledWorkoutId: string | null): Promise<WarmupSetRow[]> {
  const batchKey = `${clientId}|${scheduledWorkoutId ?? ""}`;
  let batch = warmupBatches.get(batchKey);
  if (!batch) {
    const fresh = new Map<string, WarmupWaiter[]>();
    warmupBatches.set(batchKey, fresh);
    batch = fresh;
    setTimeout(() => {
      warmupBatches.delete(batchKey);
      void flushWarmupBatch(fresh, clientId, scheduledWorkoutId);
    }, 0);
  }
  const waiters = batch.get(rowId) ?? [];
  batch.set(rowId, waiters);
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}

async function flushWarmupBatch(batch: Map<string, WarmupWaiter[]>, clientId: string, scheduledWorkoutId: string | null) {
  try {
    let q = sb.from("pl_warmup_sets").select("id,row_id,load,unit,reps,rpe,created_at")
      .in("row_id", Array.from(batch.keys())).eq("client_id", clientId);
    q = scheduledWorkoutId ? q.eq("scheduled_workout_id", scheduledWorkoutId) : q.is("scheduled_workout_id", null);
    const { data } = await q.order("created_at", { ascending: true }).throwOnError();
    const byRow = new Map<string, any[]>();
    for (const r of (data ?? []) as any[]) {
      const list = byRow.get(r.row_id) ?? [];
      list.push(r);
      byRow.set(r.row_id, list);
    }
    for (const [rowId, waiters] of batch) {
      const rows = (byRow.get(rowId) ?? []).map(normalizeWarmupRow).filter((r): r is WarmupSetRow => !!r);
      for (const w of waiters) w.resolve(rows);
    }
  } catch (e) {
    for (const waiters of batch.values()) for (const w of waiters) w.reject(e);
  }
}

/**
 * Logged warm-up sets for one exercise card (pl_warmup_sets — never counted as
 * work). Keyed to the workout instance like the logged sets, so a program day
 * that repeats weekly doesn't show last week's warm-ups.
 */
export function useWarmupSets(rowId: string, clientId: string | null | undefined, scheduledWorkoutId: string | null = null) {
  const qc = useQueryClient();
  const key = ["pl-warmup-sets", rowId, clientId ?? null, scheduledWorkoutId];
  const { data } = useQuery({
    queryKey: key,
    enabled: !!clientId && !!rowId,
    staleTime: 60_000,
    queryFn: () => loadWarmupSets(rowId, clientId!, scheduledWorkoutId),
  });
  const sets = data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (e: any) => toast.error(e?.message ?? "Could not save warm-up");
  const save = async (input: { id?: string; load: number; unit: WarmupUnit; reps: number; rpe: number | null }) => {
    if (!clientId) return;
    try {
      if (input.id) {
        await sb.from("pl_warmup_sets").update({ load: input.load, unit: input.unit, reps: input.reps, rpe: input.rpe })
          .eq("id", input.id).eq("client_id", clientId).throwOnError();
      } else {
        if (sets.length >= MAX_WARMUPS) { toast.error(`Up to ${MAX_WARMUPS} warm-up sets`); return; }
        await sb.from("pl_warmup_sets").insert({ row_id: rowId, client_id: clientId, scheduled_workout_id: scheduledWorkoutId, load: input.load, unit: input.unit, reps: input.reps, rpe: input.rpe }).throwOnError();
      }
      await refresh();
    } catch (e) { fail(e); }
  };
  const remove = async (id: string) => {
    if (!clientId) return;
    try {
      await sb.from("pl_warmup_sets").delete().eq("id", id).eq("client_id", clientId).throwOnError();
      await refresh();
    } catch (e) { fail(e); }
  };
  return { sets, save, remove, atLimit: sets.length >= MAX_WARMUPS };
}

type WarmupSaveInput = { id?: string; load: number; unit: WarmupUnit; reps: number; rpe: number | null };

/**
 * How the last warm-up felt, as four taps instead of a typed RPE. The middle of a
 * normal ramp is "Smooth" (RPE 7) — the engine's own default — so a warm-up that
 * felt like any other day changes nothing; easier nudges today's weight up, heavier
 * or a grind brings it down (see load-suggestion.ts note 8).
 */
export const WARMUP_FEELS: ReadonlyArray<{ rpe: number; label: string }> = [
  { rpe: 6, label: "Easy" },
  { rpe: 7, label: "Smooth" },
  { rpe: 8, label: "Heavy" },
  { rpe: 9, label: "Grind" },
];

/**
 * Warm-up sets as "W" rows at the top of an exercise's set table, above Set 1.
 * On a compound lift, before the first working set, one slim row says what to
 * work up to; tap it, tap how it felt, tap "Use" — today's weight is in every
 * open set (2–3 taps, no typing when the suggested warm-up was used). Logged
 * warm-ups stay as W rows; tap one to fix it. Never counted as work. The rough
 * 1RM lives in its own chip on the card (E1rmChip), not here.
 */
export function WarmupRows({
  sets,
  unit,
  gridTemplate,
  form,
  onFormChange,
  onSave,
  onRemove,
  canEdit,
  prompt = null,
  seed = null,
  tunedId = null,
  target = null,
  preview = null,
  openSets = 0,
  onUseForAllSets = null,
}: {
  sets: WarmupSetRow[];
  unit: WarmupUnit;
  /** The set table's column template, so "W" lines up under "Set". */
  gridTemplate: string;
  /** null = closed, "new" = adding, otherwise the id being edited. */
  form: string | null;
  onFormChange: (f: string | null) => void;
  onSave: (v: WarmupSaveInput) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  /** False when read-only: the rows stay, edits go. */
  canEdit: boolean;
  /** Ask for the last warm-up (nothing logged yet). Only shown while it can still `tunes` today's weight. */
  prompt?: { suggested: { load: number; reps: number } | null; tunes: boolean } | null;
  /** Pre-fill for a NEW warm-up (the suggested last warm-up). */
  seed?: { load: number; reps: number } | null;
  /** The warm-up today's suggestion is tuned from. */
  tunedId?: string | null;
  /** Today's prescription the warm-up can set a weight for (null once it can't tune). */
  target?: { reps: number; rpe: number } | null;
  /** The engine's suggestion if this warm-up were saved — same math as the card. */
  preview?: ((w: { load: number; reps: number; rpe: number | null }) => LoadSuggestion | null) | null;
  /** Open (unconfirmed) working sets, for "use for all N sets". */
  openSets?: number;
  /** Put one weight into every open set as a draft; resolves to how many were filled. */
  onUseForAllSets?: ((load: number) => Promise<number>) | null;
}) {
  const formOpen = canEdit && !!form;
  const editingId = formOpen && form !== "new" ? form : null;
  const warmupForm = (editing: WarmupSetRow | null) => (
    <WarmupForm
      key={editing?.id ?? "new"}
      editing={editing}
      unit={unit}
      gridTemplate={gridTemplate}
      seed={editing ? null : seed}
      target={target}
      preview={preview}
      openSets={openSets}
      onUseForAllSets={onUseForAllSets}
      onCancel={() => onFormChange(null)}
      onSave={async (v) => { onFormChange(null); await onSave(v); }}
      onRemove={editing ? async () => { onFormChange(null); await onRemove(editing.id); } : null}
    />
  );
  return (
    <div data-testid="warmup-rows">
      {sets.map((s) =>
        editingId === s.id ? (
          <div key={s.id}>{warmupForm(s)}</div>
        ) : (
          <div
            key={s.id}
            className="grid items-center gap-1.5 border-t border-builder-card-border/70 bg-orange-500/[0.05] px-2 py-1"
            style={{ gridTemplateColumns: gridTemplate }}
            data-testid="warmup-row"
          >
            <WBadge />
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onFormChange(s.id)}
              aria-label={canEdit ? `Edit warm-up ${describeWarmup(s, unit)}` : undefined}
              className="flex min-h-9 min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-sm transition enabled:active:bg-orange-500/10 disabled:cursor-default"
              style={{ gridColumn: "2 / -1" }}
            >
              <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">
                {warmupDisplay(s, unit)} {unit} × {s.reps}
              </span>
              {s.rpe != null && (
                <span className="truncate text-xs text-muted-foreground">
                  {WARMUP_FEELS.find((f) => f.rpe === s.rpe)?.label ?? "RPE"} {fmt(s.rpe)}
                </span>
              )}
              {tunedId === s.id && (
                <span className="truncate text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">✓ tuned</span>
              )}
              {canEdit && <Pencil className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </button>
          </div>
        ),
      )}
      {formOpen && !editingId ? (
        warmupForm(null)
      ) : (
        canEdit && prompt?.tunes && sets.length === 0 && !formOpen && (
          <button
            type="button"
            onClick={() => onFormChange("new")}
            data-testid="warmup-prompt"
            className="grid w-full items-center gap-1.5 border-t border-orange-500/25 bg-orange-500/[0.07] px-2 py-1.5 text-left transition active:bg-orange-500/15"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <WBadge />
            <span className="flex min-w-0 items-center gap-1.5" style={{ gridColumn: "2 / -1" }}>
              <Flame className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                <span className="font-bold">Last warm-up</span>
                <span className="text-muted-foreground">
                  {prompt.suggested ? ` · ~${fmt(prompt.suggested.load)} × ${prompt.suggested.reps}` : " · sets today's weight"}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold text-orange-600 dark:text-orange-400">Log</span>
            </span>
          </button>
        )
      )}
    </div>
  );
}

function WBadge() {
  return (
    <span className="text-center text-sm font-bold text-orange-500" title="Warm-up — not counted as a working set">
      W
    </span>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/**
 * The last warm-up, in the W row's own space: weight × reps (pre-filled with the
 * suggested warm-up), four "how did it feel" taps, and — while it can still set
 * today's weight — the answer with one "Use" button that puts it in every open set.
 */
function WarmupForm({
  editing,
  unit,
  gridTemplate,
  seed,
  target,
  preview,
  openSets,
  onUseForAllSets,
  onCancel,
  onSave,
  onRemove,
}: {
  editing: WarmupSetRow | null;
  unit: WarmupUnit;
  gridTemplate: string;
  seed: { load: number; reps: number } | null;
  target: { reps: number; rpe: number } | null;
  preview: ((w: { load: number; reps: number; rpe: number | null }) => LoadSuggestion | null) | null;
  openSets: number;
  onUseForAllSets: ((load: number) => Promise<number>) | null;
  onCancel: () => void;
  onSave: (v: WarmupSaveInput) => void | Promise<void>;
  onRemove: (() => void | Promise<void>) | null;
}) {
  const tuning = !!target && !!preview;
  const [load, setLoad] = useState(editing ? String(warmupDisplay(editing, unit)) : seed ? fmt(seed.load) : "");
  const [reps, setReps] = useState(editing ? String(editing.reps) : seed ? String(seed.reps) : "");
  // A normal final warm-up is RPE 7 — the engine's own assumption — so leaving it is honest.
  const [rpe, setRpe] = useState<number | null>(editing ? editing.rpe : 7);
  const loadRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  // Nothing to pre-fill: start on the weight.
  const blankNew = !editing && !seed;
  useEffect(() => {
    if (!blankNew) return;
    const focus = () => { if (document.activeElement !== loadRef.current) loadRef.current?.focus(); };
    const raf = requestAnimationFrame(focus);
    const t = setTimeout(focus, 260);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [blankNew]);

  const loadNum = Number(load.replace(",", "."));
  const repsNum = Number(reps);
  const valid = loadNum > 0 && Number.isFinite(loadNum) && Number.isInteger(repsNum) && repsNum >= 1 && repsNum <= WARMUP_MAX_REPS;
  const hint = tuning && valid ? preview!({ load: loadNum, reps: repsNum, rpe }) : null;
  const saveWarmup = () => onSave({ id: editing?.id, load: loadNum, unit, reps: repsNum, rpe });
  const useForAll = async () => {
    if (!hint || !onUseForAllSets || busy) return;
    setBusy(true);
    try {
      await saveWarmup();
      const n = await onUseForAllSets(hint.target);
      if (n > 0) toast.success(`${fmt(hint.target)} ${unit} in ${n} set${n === 1 ? "" : "s"} — tap ✓ as you finish each`);
    } finally {
      setBusy(false);
    }
  };
  const cell =
    "h-9 w-full rounded-md border border-input bg-background px-1 text-center text-base font-bold tabular-nums text-foreground placeholder:text-muted-foreground/40";
  const range = hint && hint.low !== hint.high ? `${fmt(hint.low)}–${fmt(hint.high)}` : null;

  return (
    <div className="border-t border-orange-500/30 bg-orange-500/[0.06] px-2 pb-2 pt-1.5" data-testid="warmup-form">
      {/* Row 1: W | weight × reps | close — lined up with the set table. */}
      <form
        className="grid items-center gap-1.5"
        style={{ gridTemplateColumns: gridTemplate }}
        onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}
      >
        <WBadge />
        <div className="flex min-w-0 items-center gap-1.5" style={{ gridColumn: "2 / -1" }}>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{editing ? "Warm-up" : "Last warm-up"}</span>
          <ReplaceInput
            name="warmup-load"
            inputMode="decimal"
            enterKeyHint="next"
            value={load}
            inputRef={loadRef}
            clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 6)}
            onValue={setLoad}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              (e.currentTarget.form?.elements.namedItem("warmup-reps") as HTMLInputElement | null)?.focus();
            }}
            className={cn(cell, "min-w-0 flex-[1.4]")}
            aria-label={`Warm-up weight in ${unit}`}
          />
          <span className="shrink-0 text-xs font-bold text-muted-foreground" aria-hidden>{unit} ×</span>
          <ReplaceInput
            name="warmup-reps"
            inputMode="numeric"
            enterKeyHint="done"
            value={reps}
            clean={(v) => v.replace(/[^0-9]/g, "").slice(0, 2)}
            onValue={setReps}
            className={cn(cell, "min-w-0 flex-1")}
            aria-label="Warm-up reps"
          />
          <button type="button" onClick={onCancel} aria-label="Close" className="-mr-1 inline-flex h-9 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </form>

      {/* Row 2: how it felt — one tap. */}
      <div className="mt-1.5 grid grid-cols-4 gap-1" role="radiogroup" aria-label="How did it feel?">
        {WARMUP_FEELS.map((f) => (
          <button
            key={f.rpe}
            type="button"
            role="radio"
            aria-checked={rpe === f.rpe}
            onClick={() => setRpe(f.rpe)}
            className={cn(
              "flex h-10 flex-col items-center justify-center rounded-md border text-xs font-bold leading-none transition active:scale-[0.97]",
              rpe === f.rpe ? "border-orange-500 bg-orange-500 text-white" : "border-border bg-background text-foreground",
            )}
          >
            {f.label}
            <span className={cn("mt-0.5 text-[9px] font-semibold", rpe === f.rpe ? "text-white/80" : "text-muted-foreground")}>RPE {f.rpe}</span>
          </button>
        ))}
      </div>

      {/* Row 3: the answer and one button. */}
      {tuning ? (
        <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[11px] text-muted-foreground">
              Today: {target!.reps} {target!.reps === 1 ? "rep" : "reps"} @ RPE {fmt(target!.rpe)}
            </div>
            <div className="truncate">
              <span className="text-base font-black tabular-nums text-foreground" data-testid="warmup-target">
                {hint ? `${fmt(hint.target)} ${unit}` : "—"}
              </span>
              {range && <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">({range})</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void useForAll()}
            disabled={!hint || busy || openSets === 0 || !onUseForAllSets}
            className="h-10 shrink-0 rounded-md bg-primary px-3.5 text-sm font-bold text-primary-foreground transition active:scale-[0.98] disabled:opacity-40"
            data-testid="warmup-use-all"
          >
            {openSets > 1 ? `Use for ${openSets} sets` : "Use"}
          </button>
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        {onRemove ? (
          <button type="button" onClick={() => void onRemove()} className="h-8 font-semibold text-destructive">Remove</button>
        ) : <span />}
        <button
          type="button"
          onClick={() => void saveWarmup()}
          disabled={!valid || busy}
          className={cn(
            "h-8 font-semibold disabled:opacity-40",
            tuning ? "text-muted-foreground underline-offset-2 hover:underline" : "rounded-md bg-primary px-4 text-primary-foreground",
          )}
        >
          {tuning ? "Log warm-up only" : "Save warm-up"}
        </button>
      </div>
    </div>
  );
}

/**
 * e1RM, on its own: a small chip on the exercise card. It reads today's best
 * logged set (weight × reps @ RPE) as a rough 1RM; tap it for a quick
 * calculator. Nothing is saved — a guide, not a tested max.
 */
export function E1rmChip({
  sets,
  unit,
  className,
}: {
  /** Today's logged sets (working and warm-up), in `unit`. */
  sets: Array<{ load: number; reps: number; rpe: number | null }>;
  unit: WarmupUnit;
  className?: string;
}) {
  const best = bestE1rm(sets, unit);
  const [load, setLoad] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState<number | null>(8);
  const start = best?.from ?? null;
  const l = Number((load || (start ? fmt(start.load) : "")).replace(",", "."));
  const r = Number(reps || (start ? String(start.reps) : ""));
  const calc = estimateOneRepMax({ load: l, reps: r, rpe: rpe ?? (start?.rpe ?? null) }, unit);
  const cell = "h-9 w-full rounded-md border border-input bg-background px-1 text-center text-base font-bold tabular-nums placeholder:text-muted-foreground/50";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="e1rm-chip"
          className={cn("inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-xs font-semibold tabular-nums text-foreground transition active:scale-[0.97]", className)}
          aria-label={best ? `Estimated 1RM about ${fmt(best.e1rm)} ${unit}` : "e1RM calculator"}
        >
          <Calculator className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {best ? <>e1RM <span className="font-black">≈{fmt(best.e1rm)}</span></> : "e1RM"}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-[17rem] space-y-2 p-3">
        <div className="text-xs font-bold">Rough 1RM</div>
        <div className="grid grid-cols-[1.4fr_auto_1fr] items-center gap-1.5">
          <input inputMode="decimal" value={load} placeholder={start ? fmt(start.load) : unit} onChange={(e) => setLoad(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))} className={cell} aria-label={`Weight in ${unit}`} />
          <span className="text-xs font-bold text-muted-foreground">×</span>
          <input inputMode="numeric" value={reps} placeholder={start ? String(start.reps) : "reps"} onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} className={cell} aria-label="Reps" />
        </div>
        <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="RPE">
          {[6, 7, 8, 9, 10].map((v) => (
            <button key={v} type="button" role="radio" aria-checked={rpe === v} onClick={() => setRpe(v)}
              className={cn("h-8 rounded-md border text-xs font-bold", rpe === v ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
              @{v}
            </button>
          ))}
        </div>
        <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-2.5 py-1.5" aria-live="polite">
          <span className="text-[11px] text-muted-foreground">{rpe != null ? repsLeftLabel(rpe) : "pick an RPE"}</span>
          <span className="text-base font-black tabular-nums" data-testid="e1rm-result">{calc != null ? `≈ ${fmt(calc)} ${unit}` : "—"}</span>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {best ? `Today's best: ${fmt(best.from.load)} × ${best.from.reps} @ ${fmt(best.from.rpe!)}. ` : ""}A guide from weight × reps @ RPE, not a tested max. Nothing is saved.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Today's highest rough 1RM from sets with an RPE (6+, ≤10 reps), and the set it came from. */
export function bestE1rm(
  sets: Array<{ load: number; reps: number; rpe: number | null }>,
  unit: WarmupUnit,
): { e1rm: number; from: { load: number; reps: number; rpe: number | null } } | null {
  let best: { e1rm: number; from: { load: number; reps: number; rpe: number | null } } | null = null;
  for (const s of sets) {
    const e = estimateOneRepMax(s, unit);
    if (e != null && (!best || e > best.e1rm)) best = { e1rm: e, from: s };
  }
  return best;
}

/**
 * Number box that types like the set table's cells: tapping it turns the
 * current value into the placeholder so the first digit replaces it, and
 * leaving it blank keeps the old value (a blank never wipes a number).
 */
function ReplaceInput({
  value,
  onValue,
  clean,
  inputRef,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onFocus" | "onBlur" | "placeholder"> & {
  value: string;
  onValue: (v: string) => void;
  clean: (raw: string) => string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const before = useRef("");
  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      value={draft ?? value}
      placeholder={draft != null ? before.current : "–"}
      onFocus={() => {
        before.current = value;
        setDraft("");
      }}
      onChange={(e) => {
        const v = clean(e.target.value);
        setDraft(v);
        onValue(v || before.current);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function warmupDisplay(w: WarmupSetRow, unit: WarmupUnit): number {
  const n = w.unit === unit ? w.load : unit === "kg" ? w.load * 0.45359237 : w.load / 0.45359237;
  return Math.round(n * 10) / 10;
}
