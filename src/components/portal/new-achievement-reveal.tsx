import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BadgeIcon } from "@/components/portal/achievements-card";
import { RARITY_STYLE, markAchievementsSeen, type Rarity } from "@/lib/athlete-achievements";
import { cn } from "@/lib/utils";
import { playAppSound } from "@/lib/app-sounds";

type Row = { badge_key: string; client_id: string; athlete_badge_catalog: { name: string; icon_key: string; rarity: Rarity; description: string } | null };

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
        .select("badge_key, client_id, athlete_badge_catalog(name, icon_key, rarity, description)")
        .gte("created_at", since)
        .limit(3);
      if (error) return [];
      return (data ?? []) as Row[];
    },
  });
  const rows = data.filter((r) => r.athlete_badge_catalog);
  const qc = useQueryClient();
  // Shown here in the recap → acknowledged, so the home reveal won't repeat them.
  const shownKey = rows.map((r) => r.badge_key).join(",");
  useEffect(() => {
    if (!rows.length) return;
    // A bell chime as the milestones appear (after the recap's sting has landed).
    playAppSound("milestone");
    markAchievementsSeen(rows[0].client_id, rows.map((r) => r.badge_key))
      .then(() => qc.invalidateQueries({ queryKey: ["athlete-achievements-unseen"] }))
      .catch(() => {});
  }, [shownKey]);
  if (!rows.length) return null;
  // Compact: one line a milestone (its badge, its name, how rare), its description on a long press / hover.
  return (
    <section className="animate-in fade-in rounded-2xl border border-border/80 bg-card px-3 py-2.5 duration-500" data-recap-milestone>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{rows.length === 1 ? "New milestone" : `${rows.length} new milestones`}</div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const b = r.athlete_badge_catalog!;
          return (
            <div key={r.badge_key} className="flex min-w-0 items-center gap-2.5" title={b.description}>
              <BadgeIcon icon={b.icon_key} rarity={b.rarity} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-tight">{b.name}</span>
              <span className={cn("shrink-0 text-[12px] font-medium", RARITY_STYLE[b.rarity]?.text)}>{RARITY_STYLE[b.rarity]?.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
