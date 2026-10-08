import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { describeWarmup, normalizeWarmupRow, type WarmupSetRow, type WarmupUnit } from "@/lib/final-warmup";
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

const FEEL: Array<{ rpe: number; label: string }> = [
  { rpe: 6, label: "Easy" },
  { rpe: 7, label: "Solid" },
  { rpe: 8, label: "Heavy" },
];

const feelLabel = (rpe: number | null) =>
  rpe == null ? null : FEEL.find((f) => f.rpe === rpe)?.label ?? `RPE ${rpe}`;

type WarmupSaveInput = { id?: string; load: number; unit: WarmupUnit; reps: number; rpe: number | null };

/**
 * Warm-up sets as "W" rows at the top of an exercise's set table, above Set 1 —
 * where the athlete is already looking when they need a weight. Before the
 * first working set on a compound lift with no warm-up yet, one row asks for
 * the last warm-up (it sets or fine-tunes the suggested working weight). Logged
 * warm-ups stay as W rows; tap one to edit or remove it. `form` is controlled so
 * the "Add set" menu can open it too. Never counted as work.
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
  /** False once working sets are logged / when read-only: the rows stay, edits go. */
  canEdit: boolean;
  /** Ask for the last warm-up (no warm-up logged yet). `suggested` = what to warm up to, when known. */
  prompt?: { suggested: { load: number; reps: number } | null } | null;
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
              {feelLabel(s.rpe) && <span className="text-xs text-muted-foreground">· {feelLabel(s.rpe)}</span>}
              {tunedId === s.id && (
                <span className="truncate text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">✓ set your weight</span>
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
                  {prompt.suggested && (
                    <span className="tabular-nums"> ~{fmt(prompt.suggested.load)} × {prompt.suggested.reps}</span>
                  )}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {prompt.suggested ? "Log how it felt to fine-tune your weight" : "Log it to get your working weight"}
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

/** Add / edit one warm-up: weight × reps and how it felt (Easy / Solid / Heavy). */
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
  const base = editing
    ? { load: warmupDisplay(editing, unit), reps: editing.reps, rpe: editing.rpe }
    : seed ? { load: seed.load, reps: seed.reps, rpe: null } : null;
  const [load, setLoad] = useState(base ? String(base.load) : "");
  const [reps, setReps] = useState(base ? String(base.reps) : "");
  const [rpe, setRpe] = useState<number | null>(base?.rpe ?? null);
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

  const loadNum = Number(load.replace(",", "."));
  const repsNum = Number(reps);
  const valid = loadNum > 0 && Number.isFinite(loadNum) && Number.isInteger(repsNum) && repsNum >= 1 && repsNum <= WARMUP_MAX_REPS;
  const save = () => {
    if (!valid) return;
    void onSave({ id: editing?.id, load: loadNum, unit, reps: repsNum, rpe });
  };

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
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <label className="relative min-w-0 flex-[1.4]">
          <span className="sr-only">Warm-up weight in {unit}</span>
          <input
            inputMode="decimal"
            enterKeyHint="next"
            value={load}
            ref={loadRef}
            placeholder="0"
            onChange={(e) => setLoad(e.target.value.replace(/[^0-9.,]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.currentTarget.form?.elements.namedItem("warmup-reps") as HTMLInputElement | null)?.focus(); }
            }}
            className="h-11 w-full rounded-lg border border-input bg-background pl-3 pr-9 text-center text-lg font-bold tabular-nums text-foreground placeholder:text-muted-foreground/40"
            aria-label={`Warm-up weight in ${unit}`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">{unit}</span>
        </label>
        <span className="text-base font-bold text-muted-foreground" aria-hidden>×</span>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Warm-up reps</span>
          <input
            name="warmup-reps"
            inputMode="numeric"
            enterKeyHint="done"
            value={reps}
            placeholder="0"
            onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-11 w-full rounded-lg border border-input bg-background pl-3 pr-11 text-center text-lg font-bold tabular-nums text-foreground placeholder:text-muted-foreground/40"
            aria-label="Warm-up reps"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">reps</span>
        </label>
      </form>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="How the warm-up felt">
        {FEEL.map((f) => (
          <button
            key={f.rpe}
            type="button"
            onClick={() => setRpe(rpe === f.rpe ? null : f.rpe)}
            aria-pressed={rpe === f.rpe}
            className={cn(
              "flex h-11 flex-col items-center justify-center rounded-lg border leading-tight transition active:scale-[0.98]",
              rpe === f.rpe ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            <span className="text-sm font-bold">{f.label}</span>
            <span className="text-[11px] font-medium opacity-70">RPE {f.rpe}</span>
          </button>
        ))}
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
      <p className="text-center text-[11px] leading-snug text-muted-foreground">Sets today's suggested weight. Not counted in volume, records or points.</p>
    </div>
  );
}

function warmupDisplay(w: WarmupSetRow, unit: WarmupUnit): number {
  const n = w.unit === unit ? w.load : unit === "kg" ? w.load * 0.45359237 : w.load / 0.45359237;
  return Math.round(n * 10) / 10;
}
