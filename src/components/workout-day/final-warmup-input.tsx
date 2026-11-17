import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeWarmup, estimateOneRepMax, normalizeWarmupRow, repsLeftLabel, warmupInUnit, type WarmupSetRow, type WarmupUnit } from "@/lib/final-warmup";
import { WARMUP_MAX_REPS, type LoadSuggestion } from "@/lib/load-suggestion";
import { TypedValueInput } from "@/components/workout-day/typed-value-input";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";

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
  const enabled = !!clientId && !!rowId;
  const { data, isSuccess, isFetching } = useQuery({
    queryKey: key,
    enabled,
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
  /** Card undo / reset: make the warm-ups exactly `list` (in order). Throws so the caller can report it. */
  const replaceAll = async (list: Array<{ load: number; unit: string; reps: number; rpe: number | null }>) => {
    if (!clientId) return;
    let del = sb.from("pl_warmup_sets").delete().eq("row_id", rowId).eq("client_id", clientId);
    del = scheduledWorkoutId ? del.eq("scheduled_workout_id", scheduledWorkoutId) : del.is("scheduled_workout_id", null);
    await del.throwOnError();
    // One at a time so created_at keeps their order.
    for (const w of list.slice(0, MAX_WARMUPS)) {
      await sb.from("pl_warmup_sets").insert({ row_id: rowId, client_id: clientId, scheduled_workout_id: scheduledWorkoutId, load: w.load, unit: w.unit, reps: w.reps, rpe: w.rpe }).throwOnError();
    }
    await qc.refetchQueries({ queryKey: key });
  };
  return {
    sets,
    save,
    remove,
    replaceAll,
    atLimit: sets.length >= MAX_WARMUPS,
    /** Loaded and settled (nothing being fetched) — safe to read as the truth. */
    ready: !enabled || (isSuccess && !isFetching),
  };
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

/** The set table's columns the warm-up rows line up with (set-grid.ts). */
export type WarmupColumns = {
  focusMode?: boolean;
  showReps: boolean;
  showTimer: boolean;
  showDistance?: boolean;
  showCalories: boolean;
  showVelocity: boolean;
  videoColumn: boolean;
};

/** The video cell at the end of a warm-up row (set-video-cell.tsx, set 0), drawn by the card. */
export type WarmupVideoCell = (w: { warmupId: string | null; logged: boolean; label: string }) => React.ReactNode;

/**
 * Warm-up sets as "W" rows at the top of an exercise's set table, above Set 1.
 * On a compound lift, before the first working set, the last warm-up is an open
 * row in the set table's own columns (reps · RPE · weight · video): nothing to
 * expand, never required. Typing its weight saves it, and today's Suggested is
 * tuned from it at once. Earlier warm-ups (and any once a working set is in)
 * are slim W rows; tap one to fix it. Each can carry a video for the coach,
 * like a working set. Never counted as work. The rough 1RM lives in Workout
 * Tools → e1RM (today's best set is one tap there), not here.
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
  todayLoad = null,
  columns = null,
  effortKind = "rpe",
  video = null,
  looseClip = false,
  suggestOn = true,
  openRow = true,
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
  /**
   * The weight set 1's tap logs from a logged last warm-up while Suggest is off
   * (the card's own suggestion, never put in a box): said under the warm-up.
   */
  todayLoad?: number | null;
  /** The set table's columns: the open last warm-up lines up with them (null = the old one-line prompt). */
  columns?: WarmupColumns | null;
  /** The card's effort column: RPE, or RIR (stored as RPE = 10 − RIR). */
  effortKind?: "rpe" | "rir";
  /** A video cell per warm-up (a coaching client's, like their sets'). */
  video?: WarmupVideoCell | null;
  /** A clip was filmed on the open warm-up row before it was saved: keep the row so it's still there. */
  looseClip?: boolean;
  /** Suggested is on (the card's strip shows today's weight): the warm-up tunes it there. */
  suggestOn?: boolean;
  /**
   * The last warm-up is an open row (a barbell squat, bench or deadlift, where
   * the last warm-up really sets the day's weight); other compound lifts keep
   * the one-line prompt, so a workout isn't a stack of open warm-up rows.
   */
  openRow?: boolean;
}) {
  const formOpen = canEdit && !!form;
  const editingId = formOpen && form !== "new" ? form : null;
  const videoOn = !!columns?.videoColumn && !!video;
  // The open last warm-up: before the first working set (while it can tune
  // today's weight) with at most the one warm-up it saved, or while a clip
  // filmed on it waits for its weight. Never needed: the sets work without it.
  const inline =
    canEdit && !!columns?.showReps && !formOpen && (openRow || looseClip) &&
    (sets.length === 0 ? !!prompt?.tunes || looseClip : sets.length === 1 && !!prompt?.tunes);
  const inlineRow = inline ? (sets[0] ?? null) : null;
  const warmupForm = (editing: WarmupSetRow | null) => (
    <WarmupForm
      key={editing?.id ?? "new"}
      editing={editing}
      unit={unit}
      gridTemplate={gridTemplate}
      seed={editing ? null : seed}
      target={target}
      preview={preview}
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
        ) : inline && inlineRow?.id === s.id ? null : (
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
              style={{ gridColumn: videoOn ? "2 / -2" : "2 / -1" }}
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
            {videoOn && video!({ warmupId: s.id, logged: true, label: describeWarmup(s, unit) })}
          </div>
        ),
      )}
      {formOpen && !editingId ? (
        warmupForm(null)
      ) : inline ? (
        <LastWarmupRow
          key={inlineRow?.id ?? "new"}
          existing={inlineRow}
          unit={unit}
          gridTemplate={gridTemplate}
          columns={columns!}
          effortKind={effortKind}
          seed={seed}
          tuned={!!inlineRow && tunedId === inlineRow.id}
          canTune={!!prompt?.tunes}
          suggestOn={suggestOn}
          todayLoad={todayLoad}
          target={target}
          onSave={onSave}
          onOpenForm={inlineRow ? () => onFormChange(inlineRow.id) : null}
          video={videoOn ? video : null}
        />
      ) : (
        // The prompt is a suggestion, not a logged warm-up: quiet, no orange
        // (logged warm-ups keep their orange W so they never read as working sets).
        canEdit && prompt?.tunes && sets.length === 0 && !formOpen && (
          <button
            type="button"
            onClick={() => onFormChange("new")}
            data-testid="warmup-prompt"
            className="grid min-h-10 w-full items-center gap-1.5 border-t border-border px-2 py-1 text-left transition active:bg-muted"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <span className="text-center text-sm font-semibold text-muted-foreground" aria-hidden="true">W</span>
            <span className="flex min-w-0 items-center gap-1.5" style={{ gridColumn: "2 / -1" }}>
              <Flame className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                Last warm-up
                <span className="tabular-nums text-foreground">
                  {prompt.suggested ? ` · ~${fmt(prompt.suggested.load)} × ${prompt.suggested.reps}` : ""}
                </span>
                {!prompt.suggested && " · sets today's weight"}
              </span>
              <span className="shrink-0 text-xs font-semibold text-foreground">Log</span>
            </span>
          </button>
        )
      )}
    </div>
  );
}

/** A warm-up's effort as the card shows it: its RPE, or RIR (10 − RPE) on an RIR card. */
export function warmupEffortText(rpe: number | null, kind: "rpe" | "rir"): string {
  if (rpe == null) return "";
  return fmt(kind === "rir" ? Math.max(0, 10 - rpe) : rpe);
}

/** The card's effort back to the warm-up's stored RPE (an RIR card's "3" is RPE 7). */
export function warmupRpeFrom(text: string, kind: "rpe" | "rir"): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return kind === "rir" ? Math.min(10, Math.max(1, 10 - n)) : n;
}

/**
 * The last warm-up as an open row in the set table's own columns: reps (the
 * suggested warm-up's, pre-filled like a set's), effort (RPE 7, "smooth", the
 * engine's own assumption for a last warm-up, so leaving it is honest), the
 * weight (empty, a neutral box: it's optional) and its video. Typing the weight
 * saves it; reps or effort changed afterwards update it. The W opens the full
 * warm-up form (feel taps, Use for all sets, Remove).
 */
function LastWarmupRow({
  existing,
  unit,
  gridTemplate,
  columns,
  effortKind,
  seed,
  tuned,
  canTune,
  suggestOn,
  todayLoad,
  target,
  onSave,
  onOpenForm,
  video,
}: {
  existing: WarmupSetRow | null;
  unit: WarmupUnit;
  gridTemplate: string;
  columns: WarmupColumns;
  effortKind: "rpe" | "rir";
  seed: { load: number; reps: number } | null;
  tuned: boolean;
  canTune: boolean;
  suggestOn: boolean;
  /** Today's weight from this warm-up while Suggest is off: what set 1's tap logs. */
  todayLoad: number | null;
  target: { reps: number; rpe: number } | null;
  onSave: (v: WarmupSaveInput) => void | Promise<void>;
  onOpenForm: (() => void) | null;
  video: WarmupVideoCell | null;
}) {
  const [load, setLoad] = useState(existing ? String(warmupDisplay(existing, unit)) : "");
  const [reps, setReps] = useState(existing ? String(existing.reps) : seed ? String(seed.reps) : "");
  const [effort, setEffort] = useState(
    existing ? warmupEffortText(existing.rpe, effortKind) : effortKind === "rir" ? "3" : "7",
  );
  // The suggested warm-up loads after the row: take its reps until they're typed or saved.
  const repsTyped = useRef(!!existing);
  useEffect(() => {
    if (!repsTyped.current && seed?.reps) setReps(String(seed.reps));
  }, [seed?.reps]);

  const save = (next: { load?: string; reps?: string; effort?: string }) => {
    const l = Number((next.load ?? load).replace(",", "."));
    const r = Number(next.reps ?? reps);
    if (!(l > 0) || !Number.isFinite(l) || !Number.isInteger(r) || r < 1 || r > WARMUP_MAX_REPS) return;
    void onSave({ id: existing?.id, load: l, unit, reps: r, rpe: warmupRpeFrom(next.effort ?? effort, effortKind) });
  };
  const focusMode = !!columns.focusMode;
  const labelText = existing ? describeWarmup(existing, unit) : "";
  const blank = <div aria-hidden />;

  return (
    <div className="border-t border-builder-card-border/70" data-testid="warmup-open" data-warmup-saved={existing ? "true" : "false"}>
      <div className="grid items-center gap-1.5 px-2 py-1.5" style={{ gridTemplateColumns: gridTemplate }}>
        {onOpenForm ? (
          <button
            type="button"
            onClick={onOpenForm}
            aria-label="Warm-up options"
            className="flex h-11 w-full items-center justify-center rounded-md sm:h-9"
          >
            <WBadge />
          </button>
        ) : (
          <span className="text-center text-sm font-semibold text-muted-foreground" title="Last warm-up (optional)">W</span>
        )}
        <TypedValueInput
          value={reps}
          kind="reps"
          onCommit={(v) => {
            repsTyped.current = true;
            setReps(v);
            if (existing) save({ reps: v });
          }}
          ariaLabel="Last warm-up reps"
          focusMode={focusMode}
        />
        {columns.showTimer && blank}
        {columns.showDistance && blank}
        {columns.showCalories && blank}
        <TypedValueInput
          value={effort}
          kind={effortKind}
          onCommit={(v) => {
            setEffort(v);
            if (existing) save({ effort: v });
          }}
          ariaLabel={`Last warm-up ${effortKind === "rir" ? "RIR" : "RPE"}`}
          focusMode={focusMode}
        />
        {columns.showVelocity && blank}
        <WeightValueInput
          value={load}
          isBodyweight={false}
          unit={unit}
          plain
          focusMode={focusMode}
          ariaLabel={`Last warm-up weight in ${unit}`}
          onPick={(next) => {
            if (next.load === "") return;
            setLoad(next.load);
            save({ load: next.load });
          }}
        />
        {video ? video({ warmupId: existing?.id ?? null, logged: !!existing, label: labelText }) : null}
      </div>
      <p className="px-2 pb-1.5 pl-[42px] text-[12px] leading-snug text-muted-foreground" data-warmup-caption>
        {existing && suggestOn && tuned ? (
          <span className="font-medium text-success">✓ Suggested is tuned from this warm-up</span>
        ) : existing && !suggestOn && todayLoad != null && target ? (
          // Suggest is off: today's weight is said here, and set 1's tap logs it
          <span>
            Today:{" "}
            <span className="font-semibold tabular-nums text-foreground" data-warmup-answer>{fmt(todayLoad)} {unit}</span>
            {` × ${target.reps} @ RPE ${fmt(target.rpe)} · tap set 1 to log it`}
          </span>
        ) : existing ? (
          "Last warm-up logged"
        ) : canTune ? (
          <>
            Last warm-up · optional
            {seed ? <span className="tabular-nums text-foreground">{` · about ${fmt(seed.load)} ${unit} × ${seed.reps}`}</span> : null}
            {suggestOn ? " · tunes Suggested" : " · sets today's weight"}
          </>
        ) : (
          "Last warm-up · optional"
        )}
      </p>
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
 * A warm-up, in the W row's own space: weight × reps (pre-filled with the
 * suggested warm-up), four "how did it feel" taps, and — while it can still set
 * today's weight — the answer, which a tap on set 1's number logs once it's
 * saved (no button that fills the sets with drafts).
 */
function WarmupForm({
  editing,
  unit,
  gridTemplate,
  seed,
  target,
  preview,
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

      {/* Row 3: the answer: what set 1's tap logs once this warm-up is in. */}
      {tuning ? (
        <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[11px] text-muted-foreground">
              Today: {target!.reps} {target!.reps === 1 ? "rep" : "reps"} @ RPE {fmt(target!.rpe)}
            </div>
            <div className="truncate">
              <span className="text-base font-bold tabular-nums text-foreground" data-testid="warmup-target">
                {hint ? `${fmt(hint.target)} ${unit}` : "—"}
              </span>
              {range && <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">({range})</span>}
              {hint && <span className="ml-1.5 text-[11px] text-muted-foreground">· save, then tap set 1 to log it</span>}
            </div>
          </div>
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        {onRemove ? (
          <button type="button" onClick={() => void onRemove()} className="h-8 font-semibold text-destructive">Remove</button>
        ) : <span />}
        <button
          type="button"
          onClick={() => void saveWarmup()}
          disabled={!valid}
          data-testid="warmup-save"
          className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98] disabled:opacity-40"
        >
          Save warm-up
        </button>
      </div>
    </div>
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
export function ReplaceInput({
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
