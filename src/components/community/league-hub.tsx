import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AthleteLevelCard } from "@/components/portal/athlete-level-card";
import { StrengthBoardSlide } from "@/components/portal/strength-board";

export type RankingsBoard = "monthly" | "strength";

/**
 * Which board a link asks for: `#rankings=strength` / `#league=strength` (Home's
 * Hall of Strength tile) → Strength; `#rankings`, `#league`, `#league=standings`
 * → Monthly; anything else → null (not a Rankings link).
 */
export function rankingsFromHash(hash = typeof window === "undefined" ? "" : window.location.hash): RankingsBoard | null {
  if (!/#(rankings|league)/.test(hash)) return null;
  return /(rankings|league)=strength/.test(hash) ? "strength" : "monthly";
}

/**
 * Crew → Rankings: one board at a time. Monthly (this month's League) and
 * Strength (the Hall of Strength), picked with the switch at the top. Every
 * card opens its full view.
 */
export function RankingsHub() {
  // the person whose portal this is (the client in coach "View as")
  const userId = usePortalUserId();
  const { data: client, isPending } = useQuery({
    queryKey: ["my-client", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });
  const [board, setBoard] = useState<RankingsBoard>(() => rankingsFromHash() ?? "monthly");
  return (
    <div data-league-hub className="space-y-3">
      <div className="flex items-center gap-2">
      <div className="grid flex-1 grid-cols-2 rounded-full bg-muted/60 p-1 text-[13px] font-bold" role="tablist" aria-label="Leaderboard">
        {([["monthly", "Monthly"], ["strength", "Strength"]] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={board === k}
            onClick={() => setBoard(k)}
            className={cn("min-h-9 rounded-full transition-colors", board === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
        {/* both boards update as people train: one Live mark for the page */}
        <span className="inline-flex shrink-0 items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>
      {board === "strength" ? (
        <section data-standing="strength" className="overflow-hidden rounded-2xl border bg-card">
          <StrengthBoardSlide />
        </section>
      ) : client?.id ? (
        <AthleteLevelCard clientId={client.id} />
      ) : isPending && userId ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-[13px] text-muted-foreground">The monthly League is for active coaching clients.</div>
      )}
    </div>
  );
}
