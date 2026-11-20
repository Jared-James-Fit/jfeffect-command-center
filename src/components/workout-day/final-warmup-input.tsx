import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Flame, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeWarmup, estimateOneRepMax, normalizeWarmupRow, WARMUP_LOG_MAX_REPS, WARMUP_TOO_EASY, type WarmupSetRow, type WarmupUnit } from "@/lib/final-warmup";
import { TypedValueInput } from "@/components/workout-day/typed-value-input";
import { WeightValueInput } from "@/components/workout-day/weight-value-input";
import { SwipeToReveal } from "@/components/workout-day/swipe-to-reveal";

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
  /** Saves one warm-up; resolves to its id (a new one's from the insert), or null when it didn't save. */
  const save = async (input: { id?: string; load: number; unit: WarmupUnit; reps: number; rpe: number | null }): Promise<string | null> => {
    if (!clientId) return null;
    try {
      let id = input.id ?? null;
      if (input.id) {
        await sb.from("pl_warmup_sets").update({ load: input.load, unit: input.unit, reps: input.reps, rpe: input.rpe })
          .eq("id", input.id).eq("client_id", clientId).throwOnError();
      } else {
        if (sets.length >= MAX_WARMUPS) { toast.error(`Up to ${MAX_WARMUPS} warm-up sets`); return null; }
        const { data } = await sb.from("pl_warmup_sets")
          .insert({ row_id: rowId, client_id: clientId, scheduled_workout_id: scheduledWorkoutId, load: input.load, unit: input.unit, reps: input.reps, rpe: input.rpe })
          .select("id").single().throwOnError();
        id = data?.id ?? null;
      }
      await refresh();
      return id;
    } catch (e) { fail(e); return null; }
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
  /**
   * "They were lb": every warm-up typed in the other unit keeps its number in
   * `to` (unit-relabel.ts). Shown at once, then saved; a failed save puts the
   * list back as it was.
   */
  const relabel = async (to: WarmupUnit) => {
    if (!clientId) return;
    const wrong = sets.filter((s) => s.unit !== to && Number(s.load) > 0);
    if (wrong.length === 0) return;
    qc.setQueryData(key, sets.map((s) => (s.unit !== to && Number(s.load) > 0 ? { ...s, unit: to } : s)));
    try {
      for (const s of wrong) {
        await sb.from("pl_warmup_sets").update({ unit: to }).eq("id", s.id).eq("client_id", clientId).throwOnError();
      }
    } catch (e) { fail(e); }
    await refresh();
  };
  return {
    sets,
    save,
    remove,
    replaceAll,
    relabel,
    atLimit: sets.length >= MAX_WARMUPS,
    /** Loaded and settled (nothing being fetched) — safe to read as the truth. */
    ready: !enabled || (isSuccess && !isFetching),
  };
}

type WarmupSaveInput = { id?: string; load: number; unit: WarmupUnit; reps: number; rpe: number | null };
/** A warm-up save: resolves to the warm-up's id (a new one's from the insert) when the caller passes it on. */
type WarmupSave = (v: WarmupSaveInput) => void | Promise<unknown>;

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
 * How a card shows warm-ups it has (warmupStyleOf, final-warmup.ts): "last" on a
 * heavy barbell compound (the squat, bench and deadlift and their barbell
 * variations, barbell squats, hinges, hip thrusts and presses), where a logged
 * warm-up can still tune the day's weight, so they stay open before set 1;
 * "secondary" everywhere else: folded away once logged. Either way a warm-up is
 * only ever added with + Warm-up under the sets (never an open row by itself).
 */
export type WarmupStyle = "last" | "secondary";

/** What the warm-ups did to today's weight, said once in the section's header. */
export type WarmupRead = "tuned" | "too_easy" | "too_easy_cold" | "light" | null;

/** A warm-up's place in the set column: a flame, hollow while it's being typed. */
function WarmupBadge({ saved, focusMode = false }: { saved: boolean; focusMode?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border text-muted-foreground",
        focusMode ? "h-9 w-9" : "h-8 w-8 sm:h-7 sm:w-7",
        saved ? "border-border bg-muted/40" : "border-dashed border-muted-foreground/40",
      )}
    >
      <Flame className="h-3.5 w-3.5" />
    </span>
  );
}

/**
 * Warm-up sets at the top of an exercise's set table, above set 1, under one
 * quiet header ("Warm-up · 2 sets · ✓ Suggested tuned"). Nothing shows until
 * the athlete taps + Warm-up (the card's footer): there is no open row and no
 * suggested warm-up weight. Every warm-up is a row in the set table's own
 * columns (reps · effort · weight · video), typed straight into like a set and
 * saved as it's typed; a swipe left shows Delete, and its flame opens the same
 * Remove for anyone who doesn't swipe (both with Undo). Logged warm-ups fold
 * into the header on accessories and once the working sets start, one tap to
 * open. Never counted as work: no volume, records, League points or completion.
 */
export function WarmupRows({
  sets,
  unit,
  gridTemplate,
  canEdit,
  onSave,
  onRemove,
  style = "secondary",
  ramp = false,
  tunes = false,
  read = null,
  suggestOn = true,
  todayLoad = null,
  target = null,
  columns,
  effortKind = "rpe",
  video = null,
  looseClip = false,
  addToken = 0,
  draftEditRef,
}: {
  sets: WarmupSetRow[];
  unit: WarmupUnit;
  /** The set table's column template, so the rows line up with the sets. */
  gridTemplate: string;
  /** False when read-only: the rows stay, edits go. */
  canEdit: boolean;
  onSave: WarmupSave;
  onRemove: (id: string) => void | Promise<void>;
  style?: WarmupStyle;
  /** Before the first working set: a "last" card's logged warm-ups stay unfolded. */
  ramp?: boolean;
  /** It can still set today's weight: before the first working set, where the engine reads warm-ups. */
  tunes?: boolean;
  /** What the warm-ups did to today's weight (said in the header). */
  read?: WarmupRead;
  /** Suggested is on (the card's strip shows today's weight). */
  suggestOn?: boolean;
  /** Suggest off: today's weight from the warm-up, what set 1's tap logs (said in the header). */
  todayLoad?: number | null;
  /** Today's prescription the weight is for. */
  target?: { reps: number; rpe: number } | null;
  columns: WarmupColumns;
  /** The card's effort column: RPE, or RIR (stored as RPE = 10 − RIR). */
  effortKind?: "rpe" | "rir";
  /** A video cell per warm-up (a coaching client's, like their sets'). */
  video?: WarmupVideoCell | null;
  /** A clip was filmed on a new warm-up row before it was saved: keep the row so it's still there. */
  looseClip?: boolean;
  /** Bumped by the card's + Warm-up: a new row to type into. */
  addToken?: number;
  /** The new row's weight box, opened inside + Warm-up's tap (the phone raises the keyboard). */
  draftEditRef?: { current: (() => void) | null };
}) {
  // The row being typed into: its key (a new one per + Warm-up), whether + Warm-up
  // asked for it, and the warm-up its first save made (it stays mounted through
  // that save so nothing typed meanwhile is lost).
  // Worked out in the render from the token (never an effect), so + Warm-up's own
  // tap mounts the row and opens its weight box: the phone raises the keyboard.
  const [dismissedToken, setDismissedToken] = useState(addToken);
  const asked = addToken !== dismissedToken;
  const [saved, setSaved] = useState<{ token: number; id: string } | null>(null);
  const [openState, setOpenState] = useState<boolean | null>(null);
  // The first working set is in: the last warm-up that was typed into folds away
  // with the rest (the sets lead the card now), unless + Warm-up asked for a row.
  const draftSavedId = saved && saved.token === addToken && (ramp || asked) && sets.some((s) => s.id === saved.id) ? saved.id : null;
  const draftKey = addToken;

  const videoOn = !!columns.videoColumn && !!video;
  const draftShown = canEdit && !!columns.showReps && (asked || (looseClip && sets.length === 0) || !!draftSavedId);
  const draftExisting = draftSavedId ? sets.find((s) => s.id === draftSavedId) ?? null : null;
  const listed = sets.filter((s) => s.id !== draftSavedId);
  if (!listed.length && !draftShown) return null;

  // Folded: an accessory's warm-ups, and any once the working sets start. Open
  // while one is being typed, or while the last warm-up still sets the weight.
  const foldable = sets.length > 0 && !draftShown;
  const expanded = !foldable || (openState ?? (style === "last" && ramp));

  const remove = async (s: WarmupSetRow) => {
    await onRemove(s.id);
    toast("Warm-up removed", {
      action: { label: "Undo", onClick: () => void onSave({ load: s.load, unit: s.unit, reps: s.reps, rpe: s.rpe }) },
      duration: 5000,
    });
  };
  const status = sets.length > 0 && tunes ? warmupStatus({ read, suggestOn, todayLoad, unit, target }) : null;
  const header = (
    <>
      <span className="font-medium text-foreground/80">Warm-up</span>
      <span className="min-w-0 text-muted-foreground">
        {sets.length > 0
          ? ` · ${sets.length} ${sets.length === 1 ? "set" : "sets"}`
          : " · optional"}
        {status}
      </span>
    </>
  );
  return (
    <div data-testid="warmup-rows" data-warmup-style={style} data-warmup-expanded={expanded ? "true" : "false"}>
      {foldable ? (
        <button
          type="button"
          onClick={() => setOpenState(!expanded)}
          aria-expanded={expanded}
          data-warmup-label
          className="flex min-h-10 w-full items-center gap-1 border-t border-builder-card-border/70 px-3 text-left text-xs transition active:bg-muted/50"
        >
          <span className="min-w-0 flex-1 leading-snug">{header}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden />
        </button>
      ) : (
        <div className="flex min-h-9 items-center border-t border-builder-card-border/70 px-3 text-xs leading-snug" data-warmup-label>
          <span className="min-w-0 flex-1">{header}</span>
        </div>
      )}
      {expanded && listed.map((s) => (
        <WarmupLine
          key={s.id}
          existing={s}
          unit={unit}
          gridTemplate={gridTemplate}
          columns={columns}
          effortKind={effortKind}
          canEdit={canEdit}
          onSave={onSave}
          onRemove={() => void remove(s)}
          video={videoOn ? video : null}
        />
      ))}
      {expanded && draftShown && (
        <WarmupLine
          key={`draft-${draftKey}`}
          existing={draftExisting}
          unit={unit}
          gridTemplate={gridTemplate}
          columns={columns}
          effortKind={effortKind}
          canEdit={canEdit}
          onSave={onSave}
          onFirstSave={(id) => setSaved({ token: addToken, id })}
          onRemove={draftExisting ? () => void remove(draftExisting) : asked ? () => setDismissedToken(addToken) : null}
          video={videoOn ? video : null}
          editRef={draftEditRef}
        />
      )}
    </div>
  );
}

/** The header's one line on what the warm-ups did to today's weight (only while they still can). */
function warmupStatus({ read, suggestOn, todayLoad, unit, target }: {
  read: WarmupRead;
  suggestOn: boolean;
  todayLoad: number | null;
  unit: WarmupUnit;
  target: { reps: number; rpe: number } | null;
}): React.ReactNode {
  if (read === "light") {
    return <span data-warmup-light>{" · too light to tune today's weight"}</span>;
  }
  if (read === "too_easy" || read === "too_easy_cold") {
    return (
      <span data-warmup-too-easy>
        {` · ${WARMUP_TOO_EASY}`}
        {read === "too_easy_cold" ? " · your first set sets it" : suggestOn ? "" : todayLoad != null && target ? <> · today <TodayLoad load={todayLoad} unit={unit} /></> : ""}
      </span>
    );
  }
  if (read === "tuned" && suggestOn) return <span className="font-medium text-success" data-warmup-tuned>{" · ✓ Suggested tuned"}</span>;
  if (read === "tuned" && todayLoad != null && target) {
    return <span data-warmup-today>{" · today "}<TodayLoad load={todayLoad} unit={unit} />{" · tap set 1 to log it"}</span>;
  }
  return null;
}

function TodayLoad({ load, unit }: { load: number; unit: WarmupUnit }) {
  return <span className="font-semibold tabular-nums text-foreground" data-warmup-answer>{fmt(load)} {unit}</span>;
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
 * One warm-up as a row in the set table's own columns: reps, effort (blank
 * reads as a normal last warm-up, RPE 7, the engine's own assumption) and the
 * weight (an empty neutral box: nothing suggested), then its video. Typing the weight saves it; reps or
 * effort changed afterwards update it. Saves run one at a time, in order, each
 * with what's on screen when it runs, onto the warm-up the first save made: the
 * same in any typing order, however fast. Its flame opens Remove.
 */
function WarmupLine({
  existing,
  unit,
  gridTemplate,
  columns,
  effortKind,
  canEdit,
  onSave,
  onFirstSave,
  onRemove,
  video,
  editRef,
}: {
  existing: WarmupSetRow | null;
  unit: WarmupUnit;
  gridTemplate: string;
  columns: WarmupColumns;
  effortKind: "rpe" | "rir";
  canEdit: boolean;
  onSave: WarmupSave;
  onFirstSave?: (id: string) => void;
  /** Remove (a saved one, with Undo) or discard (a new one nobody typed into). Null: nothing to take away. */
  onRemove: (() => void) | null;
  video: WarmupVideoCell | null;
  editRef?: { current: (() => void) | null };
}) {
  const [load, setLoad] = useState(existing ? String(warmupDisplay(existing, unit)) : "");
  const [reps, setReps] = useState(existing ? String(existing.reps) : "");
  const [effort, setEffort] = useState(existing ? warmupEffortText(existing.rpe, effortKind) : "");

  // What's on screen, read when a save runs (never a value from when it was queued).
  const shown = useRef({ load, reps, effort });
  shown.current = { load, reps, effort };
  const idRef = useRef<string | null>(existing?.id ?? null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const lastSent = useRef<string | null>(null);
  const lastInput = useRef<{ load: number; unit: WarmupUnit; reps: number; rpe: number | null } | null>(null);
  const runSave = () => {
    pending.current += 1;
    queue.current = queue.current
      .then(async () => {
        const v = shown.current;
        const l = Number(v.load.replace(",", "."));
        const r = Number(v.reps);
        if (!(l > 0) || !Number.isFinite(l) || !Number.isInteger(r) || r < 1 || r > WARMUP_LOG_MAX_REPS) return;
        const input = { load: l, unit, reps: r, rpe: warmupRpeFrom(v.effort, effortKind) };
        const sig = JSON.stringify(input);
        if (idRef.current && sig === lastSent.current) return;
        const id = await onSave({ ...(idRef.current ? { id: idRef.current } : {}), ...input });
        if (typeof id === "string" && !idRef.current) {
          idRef.current = id;
          onFirstSave?.(id);
        }
        lastSent.current = sig;
        lastInput.current = input;
      })
      .catch(() => undefined)
      .finally(() => {
        pending.current -= 1;
      });
  };
  // Changed from outside (undo, another card's unit switch, removed): show it as it
  // is now, unless this row is saving what's on screen.
  useEffect(() => {
    if (pending.current > 0) return;
    if (!existing) {
      if (!idRef.current) return;
      idRef.current = null;
      lastSent.current = null;
      lastInput.current = null;
      setLoad("");
      return;
    }
    idRef.current = existing.id;
    const mine = lastInput.current;
    if (mine && existing.unit === mine.unit && Number(existing.load) === mine.load && Number(existing.reps) === mine.reps && (existing.rpe ?? null) === mine.rpe) return;
    setLoad(String(warmupDisplay(existing, unit)));
    setReps(String(existing.reps));
    setEffort(warmupEffortText(existing.rpe, effortKind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, existing?.load, existing?.unit, existing?.reps, existing?.rpe, unit, effortKind]);

  /** Saves once there's a weight; reps or effort typed before it ride with the weight's save. */
  const save = (next: { load?: string; reps?: string; effort?: string }) => {
    shown.current = { ...shown.current, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v != null)) };
    if (!(Number(shown.current.load.replace(",", ".")) > 0)) return;
    runSave();
  };
  const focusMode = !!columns.focusMode;
  const saved = !!existing;
  const label = existing ? describeWarmup(existing, unit) : "";
  const blank = <div aria-hidden />;
  const needsReps = !saved && Number(load.replace(",", ".")) > 0 && !(Number(reps) >= 1 && Number(reps) <= WARMUP_LOG_MAX_REPS && Number.isInteger(Number(reps)));

  return (
    // a swipe left shows Delete (a warm-up never counts as work, so it just goes, with Undo)
    <SwipeToReveal
      variant="row"
      enabled={canEdit && !!onRemove}
      actionText="Delete"
      actionLabel={saved ? `Delete warm-up ${label}` : "Discard new warm-up"}
      onAction={() => onRemove?.()}
    >
    <div data-testid={saved ? "warmup-row" : "warmup-open"} data-warmup-saved={saved ? "true" : "false"}>
      <div className="grid items-center gap-1.5 px-2 py-1" style={{ gridTemplateColumns: gridTemplate }}>
        {canEdit && onRemove ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={saved ? `Warm-up ${label}: options` : "New warm-up: options"}
                data-warmup-menu
                className="flex h-11 w-full items-center justify-center rounded-md sm:h-9"
              >
                <WarmupBadge saved={saved} focusMode={focusMode} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onSelect={() => onRemove()} className="text-destructive focus:text-destructive" data-warmup-remove>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                {saved ? "Remove warm-up" : "Discard"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="flex justify-center" title="Warm-up: not counted as a working set">
            <WarmupBadge saved={saved} focusMode={focusMode} />
          </span>
        )}
        <TypedValueInput
          value={reps}
          kind="reps"
          disabled={!canEdit}
          quiet
          onCommit={(v) => {
            setReps(v);
            save({ reps: v });
          }}
          ariaLabel="Warm-up reps"
          focusMode={focusMode}
        />
        {columns.showTimer && blank}
        {columns.showDistance && blank}
        {columns.showCalories && blank}
        <TypedValueInput
          value={effort}
          kind={effortKind}
          disabled={!canEdit}
          quiet
          onCommit={(v) => {
            setEffort(v);
            save({ effort: v });
          }}
          ariaLabel={`Warm-up ${effortKind === "rir" ? "RIR" : "RPE"} (optional)`}
          focusMode={focusMode}
        />
        {columns.showVelocity && blank}
        <WeightValueInput
          value={load}
          isBodyweight={false}
          unit={unit}
          plain
          disabled={!canEdit}
          focusMode={focusMode}
          editRef={editRef}
          ariaLabel={`Warm-up weight in ${unit}`}
          onPick={(next) => {
            if (next.load === "") return;
            setLoad(next.load);
            save({ load: next.load });
          }}
        />
        {video ? video({ warmupId: existing?.id ?? null, logged: saved, label }) : null}
      </div>
      {needsReps && (
        // a weight with no reps can't be saved yet: say so instead of doing nothing
        <p className="px-3 pb-1 text-[12px] font-medium text-foreground" data-warmup-needs-reps>Add its reps (1–{WARMUP_LOG_MAX_REPS}) to save it</p>
      )}
    </div>
    </SwipeToReveal>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

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
