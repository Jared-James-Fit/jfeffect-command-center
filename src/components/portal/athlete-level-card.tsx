import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Info, Trophy, Medal, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ATHLETE_LEVELS, XP_RULES, levelForXp } from "@/lib/athlete-level";
import { cn } from "@/lib/utils";

type XpEvent = { id: string; event_type: string; label: string | null; xp: number; occurred_at: string };
type RankRow = { client_id: string; display_name: string; avatar_url: string | null; xp: number; rank: number; is_me: boolean };

function useXpEvents(clientId: string) {
  return useQuery({
    queryKey: ["athlete-xp", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("athlete_xp_events")
        .select("id, event_type, label, xp, occurred_at")
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as XpEvent[];
    },
  });
}

export function AthleteLevelCard({ clientId }: { clientId: string }) {
  const { data: events = [], isPending } = useXpEvents(clientId);
  const [open, setOpen] = useState<null | "levels" | "rankings">(null);
  const total = events.reduce((s, e) => s + (e.xp || 0), 0);
  const lvl = levelForXp(total);

  return (
    <>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Athlete Level</div>
            <div className="mt-0.5 text-2xl font-black uppercase tracking-tight text-primary">
              {isPending ? "—" : lvl.current.name}
            </div>
            <div className="text-xs text-muted-foreground">{lvl.xp.toLocaleString()} lifetime XP</div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setOpen("rankings")} aria-label="Rankings">
              <Trophy className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setOpen("levels")}>
              <Info className="mr-1 h-4 w-4" /> Levels
            </Button>
          </div>
        </div>
        <Progress value={lvl.pct} className="mt-3 h-2" />
        <div className="mt-1.5 text-xs text-muted-foreground">
          {lvl.next ? `${lvl.remaining.toLocaleString()} XP to ${lvl.next.name}` : "Top level reached — keep building your legacy."}
        </div>
      </Card>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          {open === "levels" ? <LevelsView total={lvl.xp} events={events} /> : open === "rankings" ? <RankingsView /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function LevelsView({ total, events }: { total: number; events: XpEvent[] }) {
  const lvl = levelForXp(total);
  return (
    <div className="space-y-5">
      <SheetHeader className="text-left">
        <SheetTitle>Athlete Levels</SheetTitle>
        <SheetDescription>Lifetime progression. Your level never goes down.</SheetDescription>
      </SheetHeader>
      <ul className="space-y-1.5">
        {[...ATHLETE_LEVELS].reverse().map((l) => {
          const here = l.index === lvl.current.index;
          const reached = total >= l.min;
          return (
            <li key={l.name} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
              here ? "border-primary bg-primary/10" : "border-border", !reached && "opacity-60")}>
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase">{l.name}</span>
                {here && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">YOU'RE HERE</span>}
              </div>
              <span className="text-xs text-muted-foreground">{l.min.toLocaleString()} XP</span>
            </li>
          );
        })}
      </ul>
      <div>
        <div className="mb-2 text-sm font-semibold">How to earn XP</div>
        <ul className="space-y-1.5 text-sm">
          {XP_RULES.map((r) => (
            <li key={r.label} className="flex items-center justify-between">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-bold text-primary">+{r.xp}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">XP History</div>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">Finish a workout to earn your first XP.</div>
        ) : (
          <ul className="divide-y text-sm">
            {events.slice(0, 20).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span>{e.label ?? e.event_type}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold">+{e.xp}</div>
                  <div className="text-[10px] text-muted-foreground">{format(new Date(e.occurred_at), "MMM d, yyyy")}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RankingsView() {
  const { data = [], isPending } = useQuery({
    queryKey: ["athlete-rankings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_athlete_rankings", { _limit: 10 });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({ ...r, xp: Number(r.xp), rank: Number(r.rank) })) as RankRow[];
    },
  });
  const top = data.filter((r) => r.rank <= 10);
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  const me = data.find((r) => r.is_me && r.rank > 10);

  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle>Top 10 JF Athletes</SheetTitle>
        <SheetDescription>Career ranking by lifetime Athlete XP.</SheetDescription>
      </SheetHeader>
      {isPending ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? (
                <div key={r.client_id} className={cn("flex flex-col items-center rounded-xl border p-2 text-center",
                  r.rank === 1 ? "border-primary bg-primary/10 pb-4" : "border-border", r.is_me && "ring-2 ring-primary")}>
                  <Medal className={cn("mb-1 h-5 w-5", r.rank === 1 ? "text-primary" : "text-muted-foreground")} />
                  <RankAvatar row={r} size={r.rank === 1 ? "h-14 w-14" : "h-11 w-11"} />
                  <div className="mt-1 w-full truncate text-xs font-bold">{r.display_name}</div>
                  <div className="text-[10px] uppercase text-primary">{levelForXp(r.xp).current.name}</div>
                  <div className="text-[10px] text-muted-foreground">{r.xp.toLocaleString()} XP</div>
                </div>
              ) : <div key={i} />,
            )}
          </div>
          <ul className="divide-y rounded-xl border">
            {rest.map((r) => <RankLine key={r.client_id} row={r} />)}
          </ul>
          {me && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Your rank</div>
              <ul className="rounded-xl border border-primary"><RankLine row={me} /></ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RankAvatar({ row, size }: { row: RankRow; size: string }) {
  return (
    <Avatar className={cn(size, "border border-border")}>
      {row.avatar_url && <AvatarImage src={row.avatar_url} alt={row.display_name} />}
      <AvatarFallback className="text-xs font-bold">{row.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function RankLine({ row }: { row: RankRow }) {
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2 text-sm", row.is_me && "bg-primary/10")}>
      <span className="w-6 text-center font-bold text-muted-foreground">{row.rank}</span>
      <RankAvatar row={row} size="h-8 w-8" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{row.display_name}{row.is_me ? " (You)" : ""}</div>
        <div className="text-[10px] uppercase text-primary">{levelForXp(row.xp).current.name}</div>
      </div>
      <span className="text-xs text-muted-foreground">{row.xp.toLocaleString()} XP</span>
    </li>
  );
}
