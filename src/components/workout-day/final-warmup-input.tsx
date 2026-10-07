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

/** Logged warm-up sets for one exercise card (pl_warmup_sets — never counted as work). */
export function useWarmupSets(rowId: string, clientId: string | null | undefined) {
  const qc = useQueryClient();
  const key = ["pl-warmup-sets", rowId, clientId ?? null];
  const { data } = useQuery({
    queryKey: key,
    enabled: !!clientId && !!rowId,
    staleTime: 60_000,
    queryFn: async (): Promise<WarmupSetRow[]> => {
      const { data } = await sb.from("pl_warmup_sets").select("id,load,unit,reps,rpe,created_at")
        .eq("row_id", rowId).eq("client_id", clientId).order("created_at", { ascending: true }).throwOnError();
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
        await sb.from("pl_warmup_sets").insert({ row_id: rowId, client_id: clientId, load: input.load, unit: input.unit, reps: input.reps, rpe: input.rpe }).throwOnError();
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

/**
 * Warm-up sets for one exercise card: the logged list, the add/edit form and (for
 * squat / bench / deadlift, before any warm-up exists) a one-tap prompt. The
 * heaviest logged warm-up sharpens the first working-set suggestion; skipping it
 * changes nothing. `form` is controlled so the "Add set" menu can open it.
 */
export function WarmupSection({
  sets,
  unit,
  form,
  onFormChange,
  onSave,
  onRemove,
  canEdit,
  showPrompt,
  hasHistory,
  seed = null,
  showList = true,
}: {
  sets: WarmupSetRow[];
  unit: WarmupUnit;
  /** null = closed, "new" = adding, otherwise the id being edited. */
  form: string | null;
  onFormChange: (f: string | null) => void;
  onSave: (v: { id?: string; load: number; unit: WarmupUnit; reps: number; rpe: number | null }) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  /** False once working sets are logged / when read-only: the list stays, edits go. */
  canEdit: boolean;
  /** Offer the one-tap "final warm-up" prompt (SBD cards with no warm-up yet). */
  showPrompt: boolean;
  /** True when there is already enough history for a suggestion (so this only sharpens it). */
  hasHistory: boolean;
  /** Pre-fill for a NEW warm-up (the suggested last warm-up), so the athlete only picks how it felt. */
  seed?: { load: number; reps: number } | null;
  /** The suggestion card already shows the final warm-up — list only when there are more. */
  showList?: boolean;
}) {
  const editing = form && form !== "new" ? sets.find((s) => s.id === form) ?? null : null;
  const [load, setLoad] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const loadRef = useRef<HTMLInputElement | null>(null);

  // A blank new warm-up starts with the weight field focused. Retried once the
  // opening menu has finished closing (its focus trap would otherwise win).
  const hasSeed = !!seed;
  useEffect(() => {
    if (form !== "new" || hasSeed) return;
    const focus = () => { if (document.activeElement !== loadRef.current) loadRef.current?.focus(); };
    const raf = requestAnimationFrame(focus);
    const t = setTimeout(focus, 260);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [form, hasSeed]);

  // Seed the fields once each time the form opens (new or a specific warm-up).
  if (form !== seeded) {
    setSeeded(form);
    if (form) {
      const base = editing
        ? { load: warmupDisplay(editing, unit), reps: editing.reps, rpe: editing.rpe }
        : seed ? { load: seed.load, reps: seed.reps, rpe: null } : null;
      setLoad(base ? String(base.load) : "");
      setReps(base ? String(base.reps) : "");
      setRpe(base?.rpe ?? null);
    }
  }

  const loadNum = Number(load.replace(",", "."));
  const repsNum = Number(reps);
  const valid = loadNum > 0 && Number.isFinite(loadNum) && Number.isInteger(repsNum) && repsNum >= 1 && repsNum <= WARMUP_MAX_REPS;
  const save = async () => {
    if (!valid) return;
    onFormChange(null);
    await onSave({ id: editing?.id, load: loadNum, unit, reps: repsNum, rpe });
  };

  return (
    <div data-testid="warmup-section">
      {showList && sets.length > 0 && (
        <div className="mt-1.5 space-y-1" data-testid="warmup-list">
          {sets.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              <Flame className="h-3 w-3 text-orange-500" aria-hidden="true" />
              <span>Warm-up {sets.length > 1 ? i + 1 : ""}</span>
              <span className="font-bold tabular-nums text-foreground">{describeWarmup(s, unit)}</span>
              {canEdit && <span className="ml-auto flex items-center gap-0.5">
                <button type="button" onClick={() => onFormChange(s.id)} aria-label="Edit warm-up" className="rounded p-1 hover:bg-foreground/10">
                  <Pencil className="h-3 w-3" />
                </button>
                <button type="button" onClick={() => void onRemove(s.id)} aria-label="Remove warm-up" className="rounded p-1 hover:bg-foreground/10">
                  <X className="h-3 w-3" />
                </button>
              </span>}
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div className="mt-2 space-y-2 rounded-xl border border-orange-500/30 bg-orange-500/[0.04] p-2.5" data-testid="warmup-form">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-bold">
              <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
              {editing ? "Edit warm-up" : "Last warm-up"}
              <span className="text-xs font-medium text-muted-foreground">· optional</span>
            </div>
            <button type="button" onClick={() => onFormChange(null)} aria-label="Cancel" className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
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
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid}
            className="h-11 w-full rounded-lg bg-primary text-sm font-bold text-primary-foreground transition active:scale-[0.99] disabled:opacity-40"
          >
            {editing ? "Save warm-up" : "Add warm-up"}
          </button>
          <p className="text-center text-[11px] leading-snug text-muted-foreground">Sharpens today's suggestion. Not counted in volume, records or points.</p>
        </div>
      ) : (
        showPrompt && sets.length === 0 && (
          <button
            type="button"
            onClick={() => onFormChange("new")}
            data-testid="final-warmup-prompt"
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted active:scale-[0.98]"
          >
            <Flame className="h-3 w-3 text-orange-500" aria-hidden="true" />
            {hasHistory ? "Add final warm-up (optional)" : "Add final warm-up for a suggestion (optional)"}
          </button>
        )
      )}
    </div>
  );
}

function warmupDisplay(w: WarmupSetRow, unit: WarmupUnit): number {
  const n = w.unit === unit ? w.load : unit === "kg" ? w.load * 0.45359237 : w.load / 0.45359237;
  return Math.round(n * 10) / 10;
}
