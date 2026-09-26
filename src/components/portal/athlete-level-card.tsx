import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Award, ChevronRight, Info, Lock, Medal, Sparkles, Trophy, Zap } from "lucide-react";
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
type EarnedBadge = { badge_key: string; earned_at: string };

type BadgeDefinition = {
  key: string;
  name: string;
  short: string;
  requirement: string;
  requiredWorkouts: number;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
};

const BADGES: BadgeDefinition[] = [
  { key: "first_workout", name: "First Step", short: "First workout", requirement: "Complete your first workout.", requiredWorkouts: 1, rarity: "Common" },
  { key: "workouts_10", name: "Momentum", short: "10 workouts", requirement: "Complete 10 workouts.", requiredWorkouts: 10, rarity: "Common" },
  { key: "workouts_25", name: "Committed", short: "25 workouts", requirement: "Complete 25 workouts.", requiredWorkouts: 25, rarity: "Rare" },
  { key: "workouts_50", name: "Built Different", short: "50 workouts", requirement: "Complete 50 workouts.", requiredWorkouts: 50, rarity: "Rare" },
  { key: "workouts_100", name: "Century", short: "100 workouts", requirement: "Complete 100 workouts.", requiredWorkouts: 100, rarity: "Epic" },
  { key: "workouts_250", name: "JF Veteran", short: "250 workouts", requirement: "Complete 250 workouts.", requiredWorkouts: 250, rarity: "Legendary" },
];

const rarityWeight = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 } as const;
const rarityClass = {
  Common: "border-border bg-secondary/30 text-foreground",
  Rare: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Epic: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Legendary: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
} as const;

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

function useOwnAchievements(clientId: string) {
  return useQuery({
    queryKey: ["athlete-achievements", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: earned, error }, { data: progress }] = await Promise.all([
        (supabase as any).from("athlete_achievements").select("badge_key, earned_at").eq("client_id", clientId).order("earned_at", { ascending: false }),
        (supabase as any).rpc("get_my_achievement_progress"),
      ]);
      if (error) throw error;
      return {
        earned: (earned ?? []) as EarnedBadge[],
        completedWorkouts: Number(progress?.[0]?.completed_workouts ?? 0),
      };
    },
  });
}

function usePublicAchievements(clientId: string | null) {
  return useQuery({
    queryKey: ["public-athlete-achievements", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_public_athlete_achievements", { _client_id: clientId });
      if (error) throw error;
      return (data ?? []) as EarnedBadge[];
    },
  });
}

export function AthleteLevelCard({ clientId }: { clientId: string }) {
  const { data: events = [], isPending } = useXpEvents(clientId);
  const achievements = useOwnAchievements(clientId);
  const [open, setOpen] = useState<null | "levels" | "rankings" | "achievements">(null);
  const [selectedAthlete, setSelectedAthlete] = useState<RankRow | null>(null);
  const total = events.reduce((s, e) => s + (e.xp || 0), 0);
  const lvl = levelForXp(total);
  const earned = achievements.data?.earned ?? [];
  const earnedKeys = new Set(earned.map((b) => b.badge_key));
  const featured = BADGES.filter((b) => earnedKeys.has(b.key))
    .sort((a, b) => rarityWeight[b.rarity] - rarityWeight[a.rarity])
    .slice(0, 3);

  return (
    <>
      <Card className="overflow-hidden p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Athlete Level</div>
            <div className="mt-0.5 text-2xl font-black uppercase tracking-tight text-primary">{isPending ? "—" : lvl.current.name}</div>
            <div className="text-xs text-muted-foreground">{lvl.xp.toLocaleString()} lifetime XP</div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setOpen("rankings")} aria-label="Rankings"><Trophy className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setOpen("levels")}><Info className="mr-1 h-4 w-4" /> Levels</Button>
          </div>
        </div>
        <Progress value={lvl.pct} className="mt-3 h-2" />
        <div className="mt-1.5 text-xs text-muted-foreground">{lvl.next ? `${lvl.remaining.toLocaleString()} XP to ${lvl.next.name}` : "Top level reached — keep building your legacy."}</div>

        <button type="button" onClick={() => setOpen("achievements")} className="mt-4 flex w-full items-center gap-3 border-t border-border/70 pt-3 text-left">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Award className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider">Achievements</span>
              <span className="text-[10px] font-bold text-muted-foreground">{earned.length} / {BADGES.length}</span>
            </div>
            <div className="mt-1 flex min-w-0 gap-1.5">
              {featured.length ? featured.map((b) => <BadgePill key={b.key} badge={b} />) : <span className="text-[11px] text-muted-foreground">Complete workouts to build your collection.</span>}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </Card>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          {open === "levels" ? <LevelsView total={lvl.xp} events={events} /> : null}
          {open === "rankings" ? <RankingsView onSelect={setSelectedAthlete} /> : null}
          {open === "achievements" ? <AchievementsView earned={earned} completedWorkouts={achievements.data?.completedWorkouts ?? 0} /> : null}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedAthlete} onOpenChange={(o) => !o && setSelectedAthlete(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          {selectedAthlete && <PublicAthleteView athlete={selectedAthlete} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function BadgePill({ badge }: { badge: BadgeDefinition }) {
  return <span className={cn("max-w-[130px] truncate rounded-full border px-2 py-1 text-[10px] font-bold", rarityClass[badge.rarity])}>{badge.name}</span>;
}

function BadgeMedallion({ badge, locked = false }: { badge: BadgeDefinition; locked?: boolean }) {
  return (
    <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full border-2", locked ? "border-border bg-secondary/30 text-muted-foreground" : rarityClass[badge.rarity])}>
      {locked ? <Lock className="h-4 w-4" /> : badge.rarity === "Legendary" ? <Trophy className="h-5 w-5" /> : badge.rarity === "Epic" ? <Sparkles className="h-5 w-5" /> : <Award className="h-5 w-5" />}
    </div>
  );
}

function AchievementsView({ earned, completedWorkouts }: { earned: EarnedBadge[]; completedWorkouts: number }) {
  const [selected, setSelected] = useState<BadgeDefinition | null>(null);
  const earnedMap = new Map(earned.map((e) => [e.badge_key, e]));
  const sorted = [...BADGES].sort((a, b) => {
    const ae = earnedMap.has(a.key) ? 1 : 0;
    const be = earnedMap.has(b.key) ? 1 : 0;
    return be - ae || rarityWeight[b.rarity] - rarityWeight[a.rarity] || a.requiredWorkouts - b.requiredWorkouts;
  });
  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle>Achievements</SheetTitle>
        <SheetDescription>{earned.length} / {BADGES.length} unlocked · Build a résumé that shows the work behind your level.</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-2 gap-2">
        {sorted.map((badge) => {
          const hit = earnedMap.get(badge.key);
          const progress = Math.min(100, Math.round((completedWorkouts / badge.requiredWorkouts) * 100));
          return (
            <button key={badge.key} type="button" onClick={() => setSelected(badge)} className={cn("rounded-2xl border p-3 text-left transition active:scale-[.99]", hit ? rarityClass[badge.rarity] : "border-border bg-card")}>
              <BadgeMedallion badge={badge} locked={!hit} />
              <div className="mt-2 text-sm font-black">{badge.name}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{badge.rarity}</div>
              {!hit && <><Progress value={progress} className="mt-2 h-1.5" /><div className="mt-1 text-[10px] text-muted-foreground">{Math.min(completedWorkouts, badge.requiredWorkouts)} / {badge.requiredWorkouts} workouts</div></>}
            </button>
          );
        })}
      </div>
      {selected && <BadgeDetail badge={selected} earned={earnedMap.get(selected.key)} completedWorkouts={completedWorkouts} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BadgeDetail({ badge, earned, completedWorkouts, onClose }: { badge: BadgeDefinition; earned?: EarnedBadge; completedWorkouts: number; onClose: () => void }) {
  return (
    <div className="sticky bottom-0 rounded-2xl border border-border bg-background p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <BadgeMedallion badge={badge} locked={!earned} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black">{badge.name}</div>
          <div className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase", rarityClass[badge.rarity])}>{badge.rarity}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{badge.short}. {badge.requirement}</p>
      {earned ? <div className="mt-3 text-xs font-semibold">Earned {format(new Date(earned.earned_at), "MMM d, yyyy")}</div> : <div className="mt-3"><Progress value={Math.min(100, (completedWorkouts / badge.requiredWorkouts) * 100)} className="h-2" /><div className="mt-1 text-xs text-muted-foreground">{Math.min(completedWorkouts, badge.requiredWorkouts)} of {badge.requiredWorkouts} completed workouts</div></div>}
    </div>
  );
}

function LevelsView({ total, events }: { total: number; events: XpEvent[] }) {
  const lvl = levelForXp(total);
  return (
    <div className="space-y-5">
      <SheetHeader className="text-left"><SheetTitle>Athlete Levels</SheetTitle><SheetDescription>Lifetime progression. Your level never goes down.</SheetDescription></SheetHeader>
      <ul className="space-y-1.5">{[...ATHLETE_LEVELS].reverse().map((l) => {
        const here = l.index === lvl.current.index;
        const reached = total >= l.min;
        return <li key={l.name} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm", here ? "border-primary bg-primary/10" : "border-border", !reached && "opacity-60")}><div className="flex items-center gap-2"><span className="font-bold uppercase">{l.name}</span>{here && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">YOU'RE HERE</span>}</div><span className="text-xs text-muted-foreground">{l.min.toLocaleString()} XP</span></li>;
      })}</ul>
      <div><div className="mb-2 text-sm font-semibold">How to earn XP</div><ul className="space-y-1.5 text-sm">{XP_RULES.map((r) => <li key={r.label} className="flex items-center justify-between"><span className="text-muted-foreground">{r.label}</span><span className="font-bold text-primary">+{r.xp}</span></li>)}</ul></div>
      <div><div className="mb-2 text-sm font-semibold">XP History</div>{events.length === 0 ? <div className="text-sm text-muted-foreground">Finish a workout to earn your first XP.</div> : <ul className="divide-y text-sm">{events.slice(0, 20).map((e) => <li key={e.id} className="flex items-center justify-between py-2"><div className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-primary" /><span>{e.label ?? e.event_type}</span></div><div className="text-right"><div className="font-bold">+{e.xp}</div><div className="text-[10px] text-muted-foreground">{format(new Date(e.occurred_at), "MMM d, yyyy")}</div></div></li>)}</ul>}</div>
    </div>
  );
}

function RankingsView({ onSelect }: { onSelect: (row: RankRow) => void }) {
  const { data = [], isPending } = useQuery({
    queryKey: ["athlete-rankings"], staleTime: 5 * 60_000,
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
      <SheetHeader className="text-left"><SheetTitle>Top 10 JF Athletes</SheetTitle><SheetDescription>Career ranking by lifetime Athlete XP. Tap an athlete to see their public achievements.</SheetDescription></SheetHeader>
      {isPending ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div> : <>
        <div className="grid grid-cols-3 items-end gap-2">{[podium[1], podium[0], podium[2]].map((r, i) => r ? <button type="button" onClick={() => onSelect(r)} key={r.client_id} className={cn("flex flex-col items-center rounded-xl border p-2 text-center", r.rank === 1 ? "border-primary bg-primary/10 pb-4" : "border-border", r.is_me && "ring-2 ring-primary")}><Medal className={cn("mb-1 h-5 w-5", r.rank === 1 ? "text-primary" : "text-muted-foreground")} /><RankAvatar row={r} size={r.rank === 1 ? "h-14 w-14" : "h-11 w-11"} /><div className="mt-1 w-full truncate text-xs font-bold">{r.display_name}</div><div className="text-[10px] uppercase text-primary">{levelForXp(r.xp).current.name}</div><div className="text-[10px] text-muted-foreground">{r.xp.toLocaleString()} XP</div></button> : <div key={i} />)}</div>
        <ul className="divide-y rounded-xl border">{rest.map((r) => <RankLine key={r.client_id} row={r} onSelect={onSelect} />)}</ul>
        {me && <div><div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Your rank</div><ul className="rounded-xl border border-primary"><RankLine row={me} onSelect={onSelect} /></ul></div>}
      </>}
    </div>
  );
}

function PublicAthleteView({ athlete }: { athlete: RankRow }) {
  const { data: earned = [], isPending } = usePublicAchievements(athlete.client_id);
  const earnedMap = new Map(earned.map((e) => [e.badge_key, e]));
  const publicBadges = BADGES.filter((b) => earnedMap.has(b.key)).sort((a, b) => rarityWeight[b.rarity] - rarityWeight[a.rarity]);
  return (
    <div className="space-y-5">
      <SheetHeader className="text-left"><SheetTitle>{athlete.display_name}</SheetTitle><SheetDescription>JF Athlete profile · public achievements only</SheetDescription></SheetHeader>
      <div className="flex items-center gap-4 rounded-2xl border bg-card p-4"><RankAvatar row={athlete} size="h-16 w-16" /><div><div className="text-xl font-black uppercase text-primary">{levelForXp(athlete.xp).current.name}</div><div className="text-sm text-muted-foreground">{athlete.xp.toLocaleString()} lifetime XP · Rank #{athlete.rank}</div></div></div>
      <div><div className="mb-2 flex items-center justify-between"><div className="text-sm font-black">Achievements</div><div className="text-xs text-muted-foreground">{publicBadges.length} unlocked</div></div>{isPending ? <div className="text-sm text-muted-foreground">Loading…</div> : publicBadges.length ? <div className="grid grid-cols-2 gap-2">{publicBadges.map((b) => <div key={b.key} className={cn("rounded-xl border p-3", rarityClass[b.rarity])}><BadgeMedallion badge={b} /><div className="mt-2 text-sm font-black">{b.name}</div><div className="text-[10px] font-bold uppercase opacity-70">{b.rarity}</div><div className="mt-1 text-[10px] opacity-75">Earned {format(new Date(earnedMap.get(b.key)!.earned_at), "MMM d, yyyy")}</div></div>)}</div> : <div className="rounded-xl border p-4 text-sm text-muted-foreground">No public achievements yet.</div>}</div>
    </div>
  );
}

function RankAvatar({ row, size }: { row: RankRow; size: string }) {
  return <Avatar className={cn(size, "border border-border")}>{row.avatar_url && <AvatarImage src={row.avatar_url} alt={row.display_name} />}<AvatarFallback className="text-xs font-bold">{row.display_name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>;
}

function RankLine({ row, onSelect }: { row: RankRow; onSelect: (row: RankRow) => void }) {
  return <li><button type="button" onClick={() => onSelect(row)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm", row.is_me && "bg-primary/10")}><span className="w-6 text-center font-bold text-muted-foreground">{row.rank}</span><RankAvatar row={row} size="h-8 w-8" /><div className="min-w-0 flex-1"><div className="truncate font-semibold">{row.display_name}{row.is_me ? " (You)" : ""}</div><div className="text-[10px] uppercase text-primary">{levelForXp(row.xp).current.name}</div></div><span className="text-xs text-muted-foreground">{row.xp.toLocaleString()} XP</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button></li>;
}
