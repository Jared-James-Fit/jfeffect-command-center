import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLeaguePoints } from "@/lib/league-points";
import { leagueToday } from "@/lib/league-boost";

type AdminRow = {
  client_id: string;
  display_name: string;
  qualified_for_board: boolean;
  rank: number | null;
  total_points: number;
  workout_points: number;
  legit_workout_points: number;
  eligible_workouts: number;
  completed_eligible: number;
  adherence_pct: number;
  needed_workouts: number;
  open_workouts: number;
  boost_status: string;
  boost_possible: boolean;
  boost_qualified: boolean;
  boost_reason: string;
  ceiling_points: number;
  coverage: number;
  match_target: number;
  projected_match: number;
  projected_total: number | null;
  awarded_match: number | null;
  awarded_at: string | null;
  award_reason: string | null;
  month_closed: boolean;
};

type SessionRow = {
  day_id: string;
  scheduled_date: string;
  title: string | null;
  counted: boolean;
  done: boolean;
  excused_at: string | null;
  excuse_reason: string | null;
  note: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "Qualified", cls: "bg-emerald-100 text-emerald-800" },
  chasing: { label: "Can qualify", cls: "bg-orange-100 text-orange-800" },
  out: { label: "Can't qualify", cls: "bg-muted text-muted-foreground" },
  none: { label: "Not eligible", cls: "bg-muted text-muted-foreground" },
};

/** Staff troubleshooting view for the Final Week Boost. */
export function LeagueBoostAdmin() {
  const [view, setView] = useState<"current" | "previous">("current");
  const [open, setOpen] = useState<string | null>(null);
  const previousMonth = (() => {
    const [y, m] = leagueToday().split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  })();
  const month = view === "previous" ? previousMonth : null;
  const { data: rows = [], isPending, error } = useQuery({
    queryKey: ["league-boost-admin", view],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_league_admin", { _month: month });
      if (error) throw error;
      return (data ?? []) as AdminRow[];
    },
  });
  const ceiling = rows[0]?.ceiling_points ?? 0;
  const label = format(view === "previous" ? new Date(previousMonth + "T12:00:00") : new Date(), "MMMM");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-black">🔥 Final Week Boost — {label}</div>
          <div className="text-xs text-muted-foreground">
            90%+ of prescribed workouts → workout points matched to the highest legitimate total
            {ceiling > 0 && <> (currently <b>{formatLeaguePoints(ceiling)}</b>)</>}. Min 6 prescribed, prorated for new clients.
          </div>
        </div>
        <div className="grid grid-cols-2 rounded-lg bg-muted/60 p-1 text-xs font-bold">
          {(["current", "previous"] as const).map((v) => (
            <button key={v} type="button" onClick={() => { setView(v); setOpen(null); }}
              className={cn("min-h-8 rounded-md px-3", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {v === "current" ? "This month" : format(new Date(previousMonth + "T12:00:00"), "MMMM")}
            </button>
          ))}
        </div>
      </div>

      {isPending ? <div className="py-6 text-sm text-muted-foreground">Loading…</div>
        : error ? <div className="py-6 text-sm text-destructive">{(error as Error).message}</div>
        : rows.length === 0 ? <div className="py-6 text-sm text-muted-foreground">No league activity for {label}.</div>
        : (
          <div className="mt-3 space-y-2">
            {rows.map((r) => {
              const st = STATUS[r.boost_status] ?? STATUS.none;
              const match = r.awarded_match != null ? r.awarded_match : r.projected_match;
              return (
                <div key={r.client_id} className="rounded-xl border">
                  <button type="button" onClick={() => setOpen(open === r.client_id ? null : r.client_id)} className="w-full p-3 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-8 text-xs font-black text-muted-foreground">{r.rank ? `#${r.rank}` : "—"}</span>
                      <span className="min-w-0 flex-1 truncate font-bold">{r.display_name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black uppercase", st.cls)}>{st.label}</span>
                      <span className="text-sm font-black">{formatLeaguePoints(r.total_points)} pts</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <Stat k="Prescribed" v={String(r.eligible_workouts)} />
                      <Stat k="Completed" v={`${r.completed_eligible} (${Number(r.adherence_pct).toFixed(1)}%)`} />
                      <Stat k="Needed for 90%" v={r.boost_qualified ? "0 ✓" : String(r.needed_workouts)} />
                      <Stat k="Workout pts / legit" v={`${r.workout_points} / ${r.legit_workout_points}`} />
                      <Stat k={r.awarded_match != null ? "Awarded match" : "Projected match"} v={`+${formatLeaguePoints(match ?? 0)}`} />
                      <Stat k="Match target" v={`${r.match_target}${Number(r.coverage) < 1 ? ` (${Math.round(Number(r.coverage) * 100)}% month)` : ""}`} />
                      <Stat k="Projected total" v={r.projected_total != null ? formatLeaguePoints(r.projected_total) : "—"} />
                      <Stat k="On board" v={r.qualified_for_board ? "Yes" : "No bodyweight"} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      {r.awarded_at ? `Finalized ${format(new Date(r.awarded_at), "MMM d, h:mm a")} — ${r.award_reason}` : r.boost_reason}
                    </div>
                  </button>
                  {open === r.client_id && <SessionLedger clientId={r.client_id} month={month} locked={r.awarded_at != null} />}
                </div>
              );
            })}
          </div>
        )}
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 sm:block">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-bold sm:block">{v}</span>
    </div>
  );
}

function SessionLedger({ clientId, month, locked }: { clientId: string; month: string | null; locked: boolean }) {
  const qc = useQueryClient();
  const { data = [], isPending } = useQuery({
    queryKey: ["league-boost-admin-sessions", clientId, month],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_league_admin_sessions", { _client_id: clientId, _month: month });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });
  const toggle = async (s: SessionRow) => {
    const excuse = !s.excused_at;
    const reason = excuse ? window.prompt("Reason for excusing this session (e.g. injury)?")?.trim() : "";
    if (excuse && !reason) return;
    const { error } = await (supabase as any).rpc("league_excuse_session", {
      _client_id: clientId, _day_id: s.day_id, _reason: reason ?? "", _month: month, _excuse: excuse,
    });
    if (error) return toast.error(error.message);
    toast.success(excuse ? "Session excused" : "Excuse removed");
    qc.invalidateQueries({ queryKey: ["league-boost-admin"] });
    qc.invalidateQueries({ queryKey: ["league-boost-admin-sessions", clientId, month] });
  };

  if (isPending) return <div className="border-t p-3 text-xs text-muted-foreground">Loading sessions…</div>;
  if (data.length === 0) return <div className="border-t p-3 text-xs text-muted-foreground">No prescribed sessions recorded this month.</div>;
  return (
    <ul className="divide-y border-t text-xs">
      {data.map((s) => (
        <li key={s.day_id} className={cn("flex items-center gap-2 px-3 py-2", !s.counted && "opacity-60")}>
          <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{format(new Date(s.scheduled_date + "T12:00:00"), "EEE d")}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{s.title ?? "Workout"}</span>
            {(s.note || s.excuse_reason) && <span className="block text-muted-foreground">{s.note}{s.excuse_reason ? ` — ${s.excuse_reason}` : ""}</span>}
          </span>
          <span className={cn("shrink-0 font-black", s.done ? "text-emerald-600" : s.counted && !s.excused_at ? "text-destructive" : "text-muted-foreground")}>
            {s.done ? "Done" : s.excused_at ? "Excused" : s.counted ? "Missed/Open" : "Not counted"}
          </span>
          {!locked && s.counted && !s.done && (
            <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void toggle(s)}>
              {s.excused_at ? "Unexcuse" : "Excuse"}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
