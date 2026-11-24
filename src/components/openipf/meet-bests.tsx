/**
 * Meet bests → maxes: each competition lift's best single in competition in
 * the last two years (every meet on file, OpenIPF's or entered by hand),
 * offered as the athlete's 1RMs in one tap, with Undo. The training max moves
 * only when the coach ticks it; a block's own maxes are never touched.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { deleteClientMax, listClientMaxes, upsertClientMax } from "@/lib/pl-maxes";
import { useClientWeightUnit } from "@/hooks/use-client-weight-unit";
import { bestsLine, meetBests, meetDay, maxWritesFromBests, kg, type MeetRow } from "@/lib/openipf";

export function useMeetRows(clientId: string) {
  return useQuery({
    queryKey: ["openipf-meets", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<MeetRow[]> => {
      const { data: athlete } = await (supabase as any).from("powerlifting_athletes").select("id").eq("client_id", clientId).maybeSingle();
      const { data, error } = await (supabase as any)
        .from("athlete_powerlifting_results")
        .select("squat_kg, bench_kg, deadlift_kg, meet_date, meet_name")
        .or(athlete?.id ? `client_id.eq.${clientId},athlete_id.eq.${athlete.id}` : `client_id.eq.${clientId}`)
        .not("meet_date", "is", null)
        .order("meet_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as MeetRow[];
    },
  });
}

const today = () => new Date().toLocaleDateString("en-CA");

export function MeetBestsRow({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { unit } = useClientWeightUnit(clientId);
  const meets = useMeetRows(clientId);
  const maxes = useQuery({ queryKey: ["pl-client-maxes", clientId], queryFn: () => listClientMaxes(clientId), enabled: !!clientId });
  const bests = useMemo(() => meetBests(meets.data ?? [], today()), [meets.data]);
  const [asking, setAsking] = useState(false);
  const [withTm, setWithTm] = useState(false);
  const [pct, setPct] = useState("90");
  const [busy, setBusy] = useState(false);
  const line = bestsLine(bests);
  if (!line) return null;

  const writes = maxWritesFromBests(bests, (maxes.data ?? []) as any, { unit, trainingPct: withTm ? Number(pct) : null });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["pl-client-maxes", clientId] });
    void qc.invalidateQueries({ queryKey: ["competition-data", clientId] });
  };

  const apply = async () => {
    setBusy(true);
    const done: { lift: string; id: string; before: (typeof writes)[number]["before"] }[] = [];
    try {
      for (const w of writes) {
        const row = await upsertClientMax({
          client_id: clientId, lift: w.lift, block_id: null, unit: w.unit, one_rm: w.one_rm, training_max: w.training_max,
          source: "tested", tested_at: w.tested_at, active: true,
        } as any);
        done.push({ lift: w.lift, id: (row as any).id, before: w.before });
      }
      refresh();
      setAsking(false);
      toast.success(`Maxes set from meet bests (${done.length})`, {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              for (const d of done) {
                if (d.before) await upsertClientMax({ client_id: clientId, lift: d.lift, block_id: null, ...d.before } as any);
                else await deleteClientMax(d.id);
              }
              refresh();
              toast.success("Maxes put back");
            } catch (e: any) {
              toast.error(e?.message ?? "Couldn't put them back");
            }
          },
        },
      });
    } catch (e: any) {
      refresh();
      toast.error(e?.message ?? "Couldn't set the maxes");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 p-3" data-meet-bests>
      <div className="flex items-start gap-2">
        <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Meet bests, last 2 years</div>
          <div className="text-sm tabular-nums text-muted-foreground">{line}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            {(["squat", "bench", "deadlift"] as const)
              .filter((l) => bests[l])
              .map((l) => `${l[0].toUpperCase()}${l.slice(1)} ${meetDay(bests[l]!.date)}${bests[l]!.meet ? `, ${bests[l]!.meet}` : ""}`)
              .join(" · ")}
          </div>
        </div>
        {!asking && (
          <Button size="sm" className="h-10" variant="outline" onClick={() => setAsking(true)} data-meet-bests-use>
            Use as maxes
          </Button>
        )}
      </div>
      {asking && (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={withTm} onCheckedChange={(v) => setWithTm(v === true)} />
            Training maxes at
            <Input
              value={pct}
              onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))}
              inputMode="decimal"
              className="h-10 w-16 text-center"
              aria-label="Training max percent"
              disabled={!withTm}
            />
            %
          </label>
          {writes.length ? (
            <ul className="space-y-1 text-[13px]">
              {writes.map((w) => (
                <li key={w.lift} className="flex justify-between gap-2 tabular-nums">
                  <span className="text-muted-foreground">{w.lift}</span>
                  <span>
                    {w.before?.one_rm ? `${kg(w.before.one_rm)} → ` : ""}
                    {kg(w.one_rm)} {w.unit} 1RM{w.training_max && withTm ? ` · TM ${kg(w.training_max)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Their 1RMs already say this.</p>
          )}
          <p className="text-[12px] text-muted-foreground">Saved as tested maxes, dated on the meet. Training maxes stay as they are unless ticked.</p>
          <div className="flex gap-2">
            <Button size="sm" className="h-10" onClick={apply} disabled={busy || !writes.length} loading={busy}>Set {writes.length} max{writes.length === 1 ? "" : "es"}</Button>
            <Button size="sm" className="h-10" variant="ghost" onClick={() => setAsking(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
