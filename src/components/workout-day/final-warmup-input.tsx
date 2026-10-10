import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeWarmup, estimateOneRepMax, normalizeWarmupRow, repsLeftLabel, type WarmupSetRow, type WarmupUnit } from "@/lib/final-warmup";
import { validateSetField } from "@/lib/set-input-cascade";
import { WARMUP_MAX_REPS, percentOf1RM, type LoadSuggestion } from "@/lib/load-suggestion";

const sb = supabase as any;
const MAX_WARMUPS = 8;

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
    queryFn: async (): Promise<WarmupSetRow[]> => {
      let q = sb.from("pl_warmup_sets").select("id,load,unit,reps,rpe,created_at")
        .eq("row_id", rowId).eq("client_id", clientId);
      q = scheduledWorkoutId ? q.eq("scheduled_workout_id", scheduledWorkoutId) : q.is("scheduled_workout_id", null);
      const { data } = await q.order("created_at", { ascending: true }).throwOnError();
      return ((data ?? []) as any[]).map(normalizeWarmupRow).filter((r): r is WarmupSetRow => !!r);
    },
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
 * Warm-up sets as "W" rows at the top of an exercise's set table, above Set 1 —
 * where the athlete is already looking when they need a weight. On a compound
 * lift with no warm-up yet, one row asks for the last warm-up: before the first
 * working set it sets or fine-tunes the suggested weight; any time, it gives a
 * rough 1RM estimate (weight × reps @ RPE). Logged warm-ups stay as W rows; tap
 * one to edit or remove it. `form` is controlled so the "Add set" menu can open
 * it too. Never counted as work.
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
  /**
   * Ask for the last warm-up (no warm-up logged yet). `tunes` = it still feeds
   * today's suggestion (before the first working set); `suggested` = what to
   * warm up to, when known.
   */
  prompt?: { suggested: { load: number; reps: number } | null; tunes: boolean } | null;
  /** Pre-fill for a NEW warm-up (the suggested last warm-up), so the athlete only picks how it felt. */
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
              <span className="font-bold tabular-nums text-foreground">
                {warmupDisplay(s, unit)} {unit} × {s.reps}
              </span>
              {s.rpe != null && <span className="shrink-0 text-xs text-muted-foreground">@ {fmt(s.rpe)}</span>}
              {(() => {
                const max = estimateOneRepMax({ load: warmupDisplay(s, unit), reps: s.reps, rpe: s.rpe }, unit);
                return max != null ? (
                  <span className="truncate text-xs text-muted-foreground" title="Rough estimate, not a tested max">· ≈1RM {fmt(max)}</span>
                ) : null;
              })()}
              {tunedId === s.id && (
                <span className="shrink-0 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">✓ tuned</span>
              )}
              {canEdit && <Pencil className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            </button>
          </div>
        ),
      )}
      {formOpen && !editingId ? (
        warmupForm(null)
      ) : (
        canEdit && prompt && sets.length === 0 && !formOpen && (
          <button
            type="button"
            onClick={() => onFormChange("new")}
            data-testid="warmup-prompt"
            className="grid w-full items-center gap-1.5 border-t border-orange-500/30 bg-orange-500/[0.09] px-2 py-2 text-left transition active:bg-orange-500/15"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <WBadge />
            <span className="flex min-w-0 items-center gap-2" style={{ gridColumn: "2 / -1" }}>
              <Flame className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-bold text-foreground">
                  {prompt.tunes ? "Last warm-up → today's weight" : "e1RM calculator"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {!prompt.tunes
                    ? "Any set · weight × reps @ RPE → rough 1RM"
                    : prompt.suggested
                      ? `Work up to ~${fmt(prompt.suggested.load)} × ${prompt.suggested.reps}, log it, get your sets`
                      : "Log it to get your working weight"}
                </span>
              </span>
              <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-orange-500 px-3.5 text-xs font-bold text-white">
                {prompt.tunes ? "Log" : "Open"}
              </span>
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
 * Last warm-up / e1RM calculator — weight × reps @ RPE, typed like the set cells.
 *  - "Set today's weight" (before the first working set, when there's a reps @
 *    RPE target): previews the engine's suggestion for today's sets from this
 *    warm-up; one tap logs the warm-up and puts that weight in every open set
 *    as a draft. The suggested warm-up shows faded (used if left as is).
 *  - "e1RM only": a calculator — rough 1RM from any set, nothing saved.
 */
function WarmupForm({
  editing,
  unit,
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
  seed: { load: number; reps: number } | null;
  target: { reps: number; rpe: number } | null;
  preview: ((w: { load: number; reps: number; rpe: number | null }) => LoadSuggestion | null) | null;
  openSets: number;
  onUseForAllSets: ((load: number) => Promise<number>) | null;
  onCancel: () => void;
  onSave: (v: WarmupSaveInput) => void | Promise<void>;
  onRemove: (() => void | Promise<void>) | null;
}) {
  const canTune = !!target && !!preview;
  const [mode, setMode] = useState<"weight" | "e1rm">(canTune ? "weight" : "e1rm");
  const tuning = canTune && mode === "weight";
  const [load, setLoad] = useState(editing ? String(warmupDisplay(editing, unit)) : "");
  const [reps, setReps] = useState(editing ? String(editing.reps) : "");
  const [rpe, setRpe] = useState(editing?.rpe != null ? fmt(editing.rpe) : "");
  const ghostLoad = tuning && !editing && seed ? fmt(seed.load) : "";
  const ghostReps = tuning && !editing && seed ? String(seed.reps) : "";
  const loadRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  // A blank form starts with the weight field focused. Retried once the
  // opening menu has finished closing (its focus trap would otherwise win).
  const blankNew = !editing && !ghostLoad;
  useEffect(() => {
    if (!blankNew) return;
    const focus = () => { if (document.activeElement !== loadRef.current) loadRef.current?.focus(); };
    const raf = requestAnimationFrame(focus);
    const t = setTimeout(focus, 260);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [blankNew]);

  const loadNum = Number((load || ghostLoad).replace(",", "."));
  const repsNum = Number(reps || ghostReps);
  const rpeCheck = validateSetField("rpe", rpe);
  const rpeNum = rpeCheck.ok && rpeCheck.value !== "" ? Number(rpeCheck.value) : null;
  const valid =
    loadNum > 0 && Number.isFinite(loadNum) && Number.isInteger(repsNum) && repsNum >= 1 && repsNum <= WARMUP_MAX_REPS && rpeCheck.ok;
  const max = valid ? estimateOneRepMax({ load: loadNum, reps: repsNum, rpe: rpeNum }, unit) : null;
  const hint = tuning && valid ? preview!({ load: loadNum, reps: repsNum, rpe: rpeNum }) : null;

  const saveWarmup = () => onSave({ id: editing?.id, load: loadNum, unit, reps: repsNum, rpe: rpeNum });
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
  const next = (name: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = e.currentTarget.form?.elements.namedItem(name) as HTMLInputElement | null;
    if (el) el.focus();
    else e.currentTarget.blur();
  };
  const cell =
    "h-11 w-full rounded-lg border border-input bg-background px-1 text-center text-lg font-bold tabular-nums text-foreground placeholder:text-muted-foreground/40";
  const label = "mb-1 block text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground";
  const range = hint && hint.low !== hint.high ? `${fmt(hint.low)}–${fmt(hint.high)} ${unit}` : null;
  // What this warm-up alone says (the e1RM shown × today's %). When the
  // suggestion differs, say why instead of showing numbers that don't add up.
  const pct = tuning ? percentOf1RM(target!.reps, 10 - target!.rpe) : null;
  const fromWarmup = max != null && pct ? Math.round((max * pct) / (unit === "kg" ? 2.5 : 5)) * (unit === "kg" ? 2.5 : 5) : null;
  const blended = hint != null && fromWarmup != null && Math.abs(fromWarmup - hint.target) >= (unit === "kg" ? 2.5 : 5);

  return (
    <div className="space-y-2.5 border-t border-orange-500/30 bg-orange-500/[0.05] p-2.5" data-testid="warmup-form">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
          {editing ? "Edit warm-up" : "Last warm-up / e1RM"}
        </div>
        <button type="button" onClick={onCancel} aria-label="Close" className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {canTune && (
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-0.5 text-xs font-bold" role="tablist" aria-label="What this is for">
          {([
            ["weight", "Set today's weight"],
            ["e1rm", "e1RM only"],
          ] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={mode === v}
              onClick={() => setMode(v)}
              className={cn("h-8 rounded-md transition", mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] leading-snug text-muted-foreground" data-testid="warmup-mode-help">
        {tuning
          ? `Log your last warm-up and we'll suggest your ${target!.reps} reps @ RPE ${fmt(target!.rpe)}.`
          : "Any set — weight × reps @ RPE gives a rough 1RM. Nothing is saved or changed."}
      </p>

      {/* Keyboard Next walks weight → reps → RPE; Done on RPE closes the keyboard. */}
      <form
        className="grid grid-cols-[1.3fr_auto_1fr_auto_1fr] items-end gap-1.5"
        onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}
      >
        <label className="min-w-0">
          <span className={label}>Wt ({unit})</span>
          <ReplaceInput
            name="warmup-load"
            inputMode="decimal"
            enterKeyHint="next"
            value={load}
            ghost={ghostLoad}
            inputRef={loadRef}
            clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 6)}
            onValue={setLoad}
            onKeyDown={next("warmup-reps")}
            className={cell}
            aria-label={`Weight in ${unit}`}
          />
        </label>
        <span className="pb-3 text-sm font-bold text-muted-foreground" aria-hidden>×</span>
        <label className="min-w-0">
          <span className={label}>Reps</span>
          <ReplaceInput
            name="warmup-reps"
            inputMode="numeric"
            enterKeyHint="next"
            value={reps}
            ghost={ghostReps}
            clean={(v) => v.replace(/[^0-9]/g, "").slice(0, 2)}
            onValue={setReps}
            onKeyDown={next("warmup-rpe")}
            className={cell}
            aria-label="Reps"
          />
        </label>
        <span className="pb-3 text-sm font-bold text-muted-foreground" aria-hidden>@</span>
        <label className="min-w-0">
          <span className={label}>RPE</span>
          <ReplaceInput
            name="warmup-rpe"
            inputMode="decimal"
            enterKeyHint="done"
            value={rpe}
            clean={(v) => v.replace(/[^0-9.,]/g, "").slice(0, 4)}
            onValue={setRpe}
            onKeyDown={next("")}
            className={cn(cell, !rpeCheck.ok && "border-destructive")}
            aria-label="RPE"
            aria-invalid={!rpeCheck.ok}
          />
        </label>
      </form>
      <p className={cn("text-[11px] leading-snug", rpeCheck.ok ? "text-muted-foreground" : "font-semibold text-destructive")}>
        {!rpeCheck.ok
          ? rpeCheck.error
          : rpeNum != null
            ? `RPE ${fmt(rpeNum)} · ${repsLeftLabel(rpeNum)}`
            : "RPE = how many reps you had left (10 = none)"}
      </p>

      {/* The answer, in one box. */}
      <div className="rounded-lg border border-border bg-background px-3 py-2" aria-live="polite" data-testid="warmup-read">
        {tuning && hint ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Today: {target!.reps} @ RPE {fmt(target!.rpe)}
              </span>
              <span className="text-lg font-black tabular-nums text-foreground" data-testid="warmup-target">{fmt(hint.target)} {unit}</span>
            </div>
            {range && (
              <div className="text-right text-[11px] tabular-nums text-muted-foreground">range {range}</div>
            )}
            {blended && (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground" data-testid="warmup-blended">
                Warm-up alone says ~{fmt(fromWarmup!)} {unit}. Below RPE 8 it's blended with your recent sessions.
              </p>
            )}
          </>
        ) : null}
        <div className={cn("flex items-baseline justify-between gap-2", tuning && hint && "mt-0.5")}>
          <span className="text-xs text-muted-foreground">e1RM <span className="text-[10px]">· rough estimate</span></span>
          <span className={cn("tabular-nums", max != null ? "text-sm font-bold text-foreground" : "text-xs text-muted-foreground")}>
            {max != null
              ? `≈ ${fmt(max)} ${unit}`
              : !valid
                ? "enter weight × reps"
                : rpeNum == null
                  ? "add an RPE"
                  : "needs RPE 6+"}
          </span>
        </div>
      </div>

      {tuning ? (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            {onRemove && (
              <button type="button" onClick={() => void onRemove()} className="h-11 shrink-0 rounded-lg border border-border bg-background px-3.5 text-sm font-semibold text-destructive">
                Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => void useForAll()}
              disabled={!hint || busy || openSets === 0 || !onUseForAllSets}
              className="h-11 min-w-0 flex-1 truncate rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground transition active:scale-[0.99] disabled:opacity-40"
              data-testid="warmup-use-all"
            >
              {hint
                ? openSets > 1
                  ? `Use ${fmt(hint.target)} ${unit} for all ${openSets} sets`
                  : `Use ${fmt(hint.target)} ${unit}`
                : "Use this weight"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void saveWarmup()}
            disabled={!valid || busy}
            className="h-9 w-full rounded-lg text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
          >
            {editing ? "Save warm-up only" : "Just log the warm-up"}
          </button>
        </div>
      ) : editing ? (
        <div className="flex gap-1.5">
          {onRemove && (
            <button type="button" onClick={() => void onRemove()} className="h-11 shrink-0 rounded-lg border border-border bg-background px-3.5 text-sm font-semibold text-destructive">
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveWarmup()}
            disabled={!valid}
            className="h-11 min-w-0 flex-1 rounded-lg bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40"
          >
            Save warm-up
          </button>
        </div>
      ) : (
        <button type="button" onClick={onCancel} className="h-11 w-full rounded-lg border border-border bg-background text-sm font-bold">
          Done
        </button>
      )}
      <p className="text-center text-[10px] leading-snug text-muted-foreground">
        e1RM is a rough guide from weight × reps @ RPE, not a tested max.
        {(tuning || editing) && " Warm-ups never count toward volume, records or points."}
      </p>
    </div>
  );
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
  ghost = "",
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onFocus" | "onBlur" | "placeholder"> & {
  value: string;
  onValue: (v: string) => void;
  clean: (raw: string) => string;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Suggested value shown faded while the field is empty (the caller uses it if left blank). */
  ghost?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const before = useRef("");
  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      value={draft ?? value}
      placeholder={draft != null ? before.current || ghost : ghost || "–"}
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
