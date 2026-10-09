import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeWarmup, estimateOneRepMax, normalizeWarmupRow, repsLeftLabel, type WarmupSetRow, type WarmupUnit } from "@/lib/final-warmup";
import { validateSetField } from "@/lib/set-input-cascade";
import { WARMUP_MAX_REPS } from "@/lib/load-suggestion";

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
}) {
  const formOpen = canEdit && !!form;
  const editingId = formOpen && form !== "new" ? form : null;
  const warmupForm = (editing: WarmupSetRow | null) => (
    <WarmupForm
      key={editing?.id ?? "new"}
      editing={editing}
      unit={unit}
      seed={editing ? null : seed}
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
                  Last warm-up
                  {prompt.tunes && prompt.suggested && (
                    <span className="tabular-nums"> ~{fmt(prompt.suggested.load)} × {prompt.suggested.reps}</span>
                  )}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {!prompt.tunes
                    ? "Log it for a rough 1RM estimate"
                    : prompt.suggested
                      ? "Tunes today's weight · rough 1RM estimate"
                      : "Gets your working weight · rough 1RM estimate"}
                </span>
              </span>
              <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-orange-500 px-3.5 text-xs font-bold text-white">
                Log
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
 * Add / edit one warm-up: weight × reps @ RPE, typed like the set cells. The
 * suggested warm-up shows faded (used if left as is). A live line explains
 * the RPE and gives a rough 1RM estimate from RPE 6 up.
 */
function WarmupForm({
  editing,
  unit,
  seed,
  onCancel,
  onSave,
  onRemove,
}: {
  editing: WarmupSetRow | null;
  unit: WarmupUnit;
  seed: { load: number; reps: number } | null;
  onCancel: () => void;
  onSave: (v: WarmupSaveInput) => void | Promise<void>;
  onRemove: (() => void | Promise<void>) | null;
}) {
  const [load, setLoad] = useState(editing ? String(warmupDisplay(editing, unit)) : "");
  const [reps, setReps] = useState(editing ? String(editing.reps) : "");
  const [rpe, setRpe] = useState(editing?.rpe != null ? fmt(editing.rpe) : "");
  const ghostLoad = !editing && seed ? fmt(seed.load) : "";
  const ghostReps = !editing && seed ? String(seed.reps) : "";
  const loadRef = useRef<HTMLInputElement | null>(null);

  // A blank new warm-up starts with the weight field focused. Retried once the
  // opening menu has finished closing (its focus trap would otherwise win).
  const blankNew = !editing && !seed;
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
  const save = () => {
    if (!valid) return;
    void onSave({ id: editing?.id, load: loadNum, unit, reps: repsNum, rpe: rpeNum });
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

  return (
    <div className="space-y-2 border-t border-orange-500/30 bg-orange-500/[0.05] p-2.5" data-testid="warmup-form">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
          {editing ? "Edit warm-up" : "Last warm-up"}
          <span className="text-xs font-medium text-muted-foreground">· optional</span>
        </div>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Keyboard Next walks weight → reps → RPE; Done on RPE closes the
          keyboard. Saving is always the explicit Add / Save button. */}
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
            aria-label={`Warm-up weight in ${unit}`}
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
            aria-label="Warm-up reps"
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
            aria-label="Warm-up RPE"
            aria-invalid={!rpeCheck.ok}
          />
        </label>
      </form>
      <div className="flex items-start justify-between gap-3 text-[11px] leading-snug" aria-live="polite" data-testid="warmup-read">
        <span className={rpeCheck.ok ? "text-muted-foreground" : "font-semibold text-destructive"}>
          {!rpeCheck.ok
            ? rpeCheck.error
            : rpeNum != null
              ? `RPE ${fmt(rpeNum)} · ${repsLeftLabel(rpeNum)}`
              : "RPE = how many reps you had left"}
        </span>
        {max != null ? (
          <span className="shrink-0 text-right">
            <span className="font-bold text-foreground">≈ 1RM {fmt(max)} {unit}</span>
            <span className="block text-[10px] text-muted-foreground">rough estimate</span>
          </span>
        ) : valid && rpeNum != null ? (
          <span className="shrink-0 text-right text-muted-foreground">Too easy for a 1RM read (RPE 6+)</span>
        ) : null}
      </div>
      <div className="flex gap-1.5">
        {onRemove && (
          <button
            type="button"
            onClick={() => void onRemove()}
            className="h-11 shrink-0 rounded-lg border border-border bg-background px-3.5 text-sm font-semibold text-destructive transition active:scale-[0.99]"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className="h-11 min-w-0 flex-1 rounded-lg bg-primary text-sm font-bold text-primary-foreground transition active:scale-[0.99] disabled:opacity-40"
        >
          {editing ? "Save warm-up" : "Add warm-up"}
        </button>
      </div>
      <p className="text-center text-[11px] leading-snug text-muted-foreground">
        ≈1RM is a rough guide from weight × reps @ RPE, not a tested max. Not counted in volume, records or points.
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
