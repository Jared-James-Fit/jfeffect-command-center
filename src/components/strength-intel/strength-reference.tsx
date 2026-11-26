/**
 * The coach's view of the strength read beside their reference maxes: per
 * competition lift, the current estimate (how sure, from what), the
 * competition PR, and the coach's controls over what a "% of Est. 1RM" reads:
 * Pin (the estimate stops moving until unpinned), Lock for a block (the
 * reference as it stands today, for that block only), and a History of every
 * change with Restore. Every number comes from the strength read
 * (src/lib/strength-intel) or the coach's own rows; the writes are rows in
 * `pl_client_maxes`, each kept by the database in `pl_client_max_history`.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Lock, Pin, PinOff, RotateCcw, Unlock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { billingDay } from "@/lib/date-range";
import { todayLocalISO } from "@/lib/today";
import { useClientWeightUnit } from "@/hooks/use-client-weight-unit";
import { deleteClientMax, listClientMaxes, upsertClientMax, type ClientMaxRow } from "@/lib/pl-maxes";
import { fetchStrengthReadInputs } from "@/lib/workouts/card-suggestion-reads";
import { strengthIntelFrom } from "@/lib/strength-intel/read";
import { currentRef, notPlannable, type LiftFamily } from "@/lib/strength-intel/planning";
import { LB_PER_KG } from "@/lib/strength-intel/rules";
import {
  blockRow,
  historyLine,
  lockWrite,
  pinWrite,
  profileRow,
  restoreWrite,
  unpinWrite,
  type MaxHistoryEntry,
} from "@/lib/strength-intel/max-history";

const db = supabase as any;
const FAMILIES: LiftFamily[] = ["squat", "bench", "deadlift"];
const LIFT_NAME: Record<LiftFamily, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

const inUnit = (lb: number, unit: "kg" | "lb") =>
  unit === "kg" ? `${Math.round((lb / LB_PER_KG) * 2) / 2} kg` : `${Math.round(lb)} lb`;
const day = (d: string) => billingDay(d) ?? d;

function useStrength(clientId: string) {
  return useQuery({
    queryKey: ["logged-e1rm", "v3", clientId],
    queryFn: () => fetchStrengthReadInputs(clientId),
    enabled: !!clientId,
    staleTime: 5 * 60_000,
  });
}

function refreshMaxes(qc: ReturnType<typeof useQueryClient>, clientId: string) {
  void qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId] });
  void qc.invalidateQueries({ queryKey: ["pl-client-max-history", clientId] });
}

/**
 * Per lift: the estimate, the PR, and Pin / Unpin (or, with `blockId`, Lock
 * for this block / Unlock). Hidden when there's no squat, bench or deadlift
 * history at all.
 */
export function StrengthReference({ clientId, blockId = null }: { clientId: string; blockId?: string | null }) {
  const qc = useQueryClient();
  const { unit } = useClientWeightUnit(clientId);
  const inputs = useStrength(clientId);
  const maxes = useQuery({
    queryKey: blockId ? ["pl-client-maxes", clientId, blockId] : ["pl-client-maxes", clientId],
    queryFn: () => listClientMaxes(clientId, blockId),
    enabled: !!clientId,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayLocalISO();
  const intel = useMemo(() => (inputs.data ? strengthIntelFrom(inputs.data, today) : null), [inputs.data, today]);

  if (!intel) return null;
  const lifts = FAMILIES.filter((f) => intel.lifts[f].current || intel.lifts[f].competitionPR);
  if (!lifts.length) return null;
  const rows = (maxes.data ?? []) as ClientMaxRow[];

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast.success(await fn());
      refreshMaxes(qc, clientId);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save that");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2" data-strength-reference>
      <div>
        <div className="text-sm font-semibold">From their training</div>
        <p className="text-xs text-muted-foreground">
          {blockId
            ? "Lock a lift to keep this block's % loads where they are today, whatever their training or the profile max does."
            : "What a % of Est. 1RM reads. It moves with their training; pin it to hold it still."}
        </p>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {lifts.map((fam) => {
          const l = intel.lifts[fam];
          const ref = currentRef(l);
          const why = notPlannable(l.current, intel.today, l.otherStyle?.current?.value ?? null);
          // a block is locked to an estimate a program would plan from (or the coach's pin), never a one-off
          const lockRef = why ? null : ref;
          const prof = profileRow(rows, fam);
          const locked = blockId ? blockRow(rows, fam, blockId) : null;
          const pinned = !blockId && prof?.estimated_1rm != null ? prof : null;
          const c = l.current;
          const src = c
            ? c.basis.kind === "meet"
              ? `from ${c.basis.name ?? "a meet"}, ${day(c.basis.day)}`
              : `from ${inUnit(c.basis.load, unit)} × ${c.basis.reps}${c.basis.effort != null ? ` @ ${c.basis.effort}` : ""}, ${day(c.basis.day)}`
            : null;
          return (
            <div key={fam} className="px-3 py-2.5" data-strength-lift={fam}>
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-medium">
                  {LIFT_NAME[fam]}
                  {l.style ? <span className="ml-1 text-xs font-normal text-muted-foreground">{l.style}</span> : null}
                </div>
                <div className="text-right text-sm font-semibold tabular-nums" data-strength-current>
                  {c ? `${c.state === "floor" ? "at least " : ""}${inUnit(c.value, unit)}` : "No estimate"}
                </div>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {[c ? `${c.word.charAt(0).toUpperCase()}${c.word.slice(1)} confidence` : null, src, l.competitionPR ? `Comp PR ${inUnit(l.competitionPR.value, unit)}` : null].filter(Boolean).join(" · ")}
                {why && c ? <span className="block">Not used for % loads by itself: {why}</span> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2 empty:hidden">
                {blockId ? (
                  locked ? (
                    <>
                      <span className="text-xs">
                        <Lock className="mr-1 inline h-3 w-3" />
                        Locked for this block
                        {locked.estimated_1rm != null ? ` · Est. 1RM ${locked.estimated_1rm} ${locked.unit}` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        loading={busy === `unlock-${fam}`}
                        onClick={() =>
                          run(`unlock-${fam}`, async () => {
                            await deleteClientMax(locked.id);
                            return `${LIFT_NAME[fam]} unlocked: this block reads the profile max and the live estimate again.`;
                          })
                        }
                      >
                        <Unlock className="mr-1 h-3.5 w-3.5" /> Unlock
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs"
                      loading={busy === `lock-${fam}`}
                      disabled={!lockRef && !prof}
                      onClick={() =>
                        run(`lock-${fam}`, async () => {
                          await upsertClientMax({ client_id: clientId, ...(lockWrite(rows, fam, blockId, lockRef, today, unit) as any) });
                          return `${LIFT_NAME[fam]} locked for this block.`;
                        })
                      }
                    >
                      <Lock className="mr-1 h-3.5 w-3.5" /> Lock for this block
                    </Button>
                  )
                ) : pinned ? (
                  <>
                    <span className="text-xs" data-strength-pinned>
                      <Pin className="mr-1 inline h-3 w-3" />
                      Pinned at {pinned.estimated_1rm} {pinned.unit}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      loading={busy === `unpin-${fam}`}
                      onClick={() =>
                        run(`unpin-${fam}`, async () => {
                          const w = unpinWrite(pinned);
                          if (w?.kind === "delete") await deleteClientMax(w.id);
                          else if (w?.kind === "put") await upsertClientMax({ client_id: clientId, ...(w.row as any) });
                          return `${LIFT_NAME[fam]} unpinned: a % of Est. 1RM follows their training again.`;
                        })
                      }
                    >
                      <PinOff className="mr-1 h-3.5 w-3.5" /> Unpin
                    </Button>
                  </>
                ) : ref ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2.5 text-xs"
                    loading={busy === `pin-${fam}`}
                    onClick={() =>
                      run(`pin-${fam}`, async () => {
                        const w = pinWrite(rows, fam, ref, today, unit);
                        await upsertClientMax({ client_id: clientId, ...(w as any) });
                        return `${LIFT_NAME[fam]} Est. 1RM pinned at ${w.estimated_1rm} ${w.unit}.`;
                      })
                    }
                  >
                    <Pin className="mr-1 h-3.5 w-3.5" /> Pin
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Every change to their maxes, newest first, each with Restore (the version
 * before it, as a new change). Hidden when there's nothing to show or the
 * history isn't readable here.
 */
export function MaxHistory({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["pl-client-max-history", clientId],
    queryFn: async () => {
      const { data, error } = await db
        .from("pl_client_max_history")
        .select("id, max_id, client_id, op, before, after, changed_by, changed_at")
        .eq("client_id", clientId)
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as MaxHistoryEntry[];
    },
    enabled: !!clientId,
    retry: false,
  });
  const entries = history.data ?? [];
  if (history.isError || !entries.length) return null;

  const restore = async (e: MaxHistoryEntry) => {
    const w = restoreWrite(e);
    if (!w) return;
    setBusy(e.id);
    try {
      if (w.kind === "delete") await deleteClientMax(w.id);
      else {
        let done = false;
        if (w.id) {
          const { data, error } = await db.from("pl_client_maxes").update(w.row).eq("id", w.id).select("id");
          if (error) throw error;
          done = !!data?.length;
        }
        if (!done) await upsertClientMax({ client_id: clientId, ...(w.row as any) });
      }
      toast.success("Restored. The change is in the history too.");
      refreshMaxes(qc, clientId);
    } catch (err: any) {
      toast.error(err?.message ?? "Couldn't restore that");
    } finally {
      setBusy(null);
    }
  };

  const shown = open ? entries : entries.slice(0, 3);
  return (
    <div className="space-y-1.5" data-max-history>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-3.5 w-3.5" /> History
        </div>
        {entries.length > 3 ? (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : `All ${entries.length}`}
          </Button>
        ) : null}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {shown.map((e) => {
          const row = e.after ?? e.before;
          return (
            <li key={e.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {row?.lift}
                  {row?.block_id ? <span className="ml-1 text-xs text-muted-foreground">(block)</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {historyLine(e)} · {billingDay(e.changed_at.slice(0, 10)) ?? e.changed_at.slice(0, 10)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-xs"
                loading={busy === e.id}
                onClick={() => restore(e)}
                title={e.op === "insert" ? "Undo this add" : "Put back the version before this change"}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> {e.op === "insert" ? "Undo" : "Restore"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
