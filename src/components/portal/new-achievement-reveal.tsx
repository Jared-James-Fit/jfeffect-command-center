import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BadgeIcon } from "@/components/portal/achievements-card";
import { RARITY_STYLE, type Rarity } from "@/lib/athlete-achievements";
import { cn } from "@/lib/utils";

type Row = { badge_key: string; athlete_badge_catalog: { name: string; icon_key: string; rarity: Rarity; description: string } | null };

/** Shows achievements the signed-in athlete unlocked in the last few minutes. RLS limits rows to their own. */
export function NewAchievementReveal({ open }: { open: boolean }) {
  const { data = [] } = useQuery({
    queryKey: ["new-achievements", open],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 1200)); // let the completion trigger finish
      const since = new Date(Date.now() - 10 * 60_000).toISOString();
      const { data, error } = await (supabase as any)
        .from("athlete_achievements")
        .select("badge_key, athlete_badge_catalog(name, icon_key, rarity, description)")
        .gte("created_at", since)
        .limit(3);
      if (error) return [];
      return (data ?? []) as Row[];
    },
  });
  const rows = data.filter((r) => r.athlete_badge_catalog);
  if (!rows.length) return null;
  return (
    <section className="animate-in zoom-in-95 fade-in rounded-2xl border-2 border-primary/40 bg-primary/5 p-3 duration-700">
      <div className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-primary">
        {rows.length === 1 ? "New achievement unlocked" : `${rows.length} achievements unlocked`}
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const b = r.athlete_badge_catalog!;
          return (
            <div key={r.badge_key} className="flex items-center gap-3">
              <BadgeIcon icon={b.icon_key} rarity={b.rarity} />
              <div className="min-w-0">
                <div className="text-sm font-black leading-tight">{b.name}</div>
                <div className={cn("text-[10px] font-semibold uppercase tracking-wider", RARITY_STYLE[b.rarity]?.text)}>{RARITY_STYLE[b.rarity]?.label}</div>
                <div className="truncate text-xs text-muted-foreground">{b.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
