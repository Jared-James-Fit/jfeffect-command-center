import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Lock, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  FALLBACK_BADGE_CATALOG,
  RARITY_STYLE,
  badgeEmoji,
  badgeProgress,
  featuredBadges,
  sortForCollection,
  type BadgeStats,
  type CatalogBadge,
} from "@/lib/athlete-badges";

/* ----------------------------------------------------------------- data */

export function useBadgeCatalog() {
  return useQuery({
    queryKey: ["athlete-badge-catalog"],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<CatalogBadge[]> => {
      const { data, error } = await (supabase as any)
        .from("athlete_badge_catalog")
        .select("badge_key, name, category, icon_key, rarity, description, requirement, metric, threshold, is_public, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error || !data?.length) return FALLBACK_BADGE_CATALOG;
      return data as CatalogBadge[];
    },
  });
}

export function useAthleteAchievements(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["athlete-achievements", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await (supabase as any)
        .from("athlete_achievements")
        .select("badge_key, earned_at")
        .eq("client_id", clientId);
      if (error) throw error;
      return new Map(((data ?? []) as any[]).map((r) => [r.badge_key as string, r.earned_at as string]));
    },
  });
}

/** Another athlete's PUBLIC earned badges only — never locked progress or private data. */
export function usePublicBadges(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["athlete-public-badges", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_athlete_public_badges", { _client_id: clientId });
      if (error) throw error;
      return (data ?? []) as Array<CatalogBadge & { earned_at: string }>;
    },
  });
}

/* ------------------------------------------------------------------- UI */

export function AchievementsCard({ clientId, stats }: { clientId: string; stats: BadgeStats }) {
  const { data: catalog = FALLBACK_BADGE_CATALOG } = useBadgeCatalog();
  const { data: earned = new Map<string, string>() } = useAthleteAchievements(clientId);
  const [open, setOpen] = useState(false);
  const featured = useMemo(() => featuredBadges(catalog, earned, 5), [catalog, earned]);

  return (
    <>
      <Card className="p-4">
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center justify-between gap-3 text-left">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Achievements</div>
            <div className="mt-0.5 text-lg font-black tracking-tight">
              {earned.size}
              <span className="text-sm font-bold text-muted-foreground">/{catalog.length} unlocked</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xl">
            {featured.length > 0
              ? featured.map((x) => <span key={x.badge_key}>{badgeEmoji(x.icon_key)}</span>)
              : <span className="text-xs text-muted-foreground">None yet</span>}
          </div>
        </button>
        <Progress value={catalog.length ? (earned.size / catalog.length) * 100 : 0} className="mt-3 h-1.5" />
      </Card>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          <SheetHeader className="text-left">
            <SheetTitle>Achievement Collection</SheetTitle>
            <SheetDescription>
              {earned.size} of {catalog.length} unlocked. Earned badges are visible to other athletes — your progress is not.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <BadgeCollection catalog={catalog} earned={earned} stats={stats} showProgress />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function BadgeCollection({
  catalog, earned, stats, showProgress,
}: { catalog: CatalogBadge[]; earned: Map<string, string>; stats?: BadgeStats; showProgress?: boolean }) {
  const [detail, setDetail] = useState<CatalogBadge | null>(null);
  const zero: BadgeStats = { xp: 0, workoutsCompleted: 0, workoutsFullyLogged: 0, firstWorkoutAt: null };
  const s = stats ?? zero;
  const ordered = useMemo(() => sortForCollection(catalog, earned, s), [catalog, earned, s]);

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {ordered.map((badge) => (
          <BadgeTile
            key={badge.badge_key}
            badge={badge}
            earnedAt={earned.get(badge.badge_key) ?? null}
            onSelect={() => setDetail(badge)}
          />
        ))}
      </div>
      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe-bottom">
          {detail && (
            <BadgeDetail
              badge={detail}
              earnedAt={earned.get(detail.badge_key) ?? null}
              stats={showProgress ? s : null}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function BadgeTile({ badge, earnedAt, onSelect }: { badge: CatalogBadge; earnedAt: string | null; onSelect: () => void }) {
  const r = RARITY_STYLE[badge.rarity];
  const earned = !!earnedAt;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center transition active:scale-95",
        earned ? r.ring : "border-dashed border-border opacity-60",
      )}
    >
      <span className="text-2xl">{earned ? badgeEmoji(badge.icon_key) : <Lock className="h-5 w-5 text-muted-foreground" />}</span>
      <span className="line-clamp-2 text-[11px] font-bold leading-tight">{badge.name}</span>
      <span className={cn("text-[9px] font-semibold uppercase tracking-wide", earned ? r.text : "text-muted-foreground")}>
        {r.label}
      </span>
    </button>
  );
}

function BadgeDetail({ badge, earnedAt, stats }: { badge: CatalogBadge; earnedAt: string | null; stats: BadgeStats | null }) {
  const r = RARITY_STYLE[badge.rarity];
  const p = stats ? badgeProgress(badge, stats) : null;
  return (
    <div className="space-y-4 pb-4">
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2">
          <span className="text-2xl">{earnedAt ? badgeEmoji(badge.icon_key) : "🔒"}</span>
          {badge.name}
        </SheetTitle>
        <SheetDescription>{badge.description}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", r.chip)}>{r.label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {badge.category}
        </span>
      </div>
      <div className="rounded-xl border px-3 py-2 text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">How to unlock</div>
        <div className="mt-0.5 font-medium">{badge.requirement}</div>
      </div>
      {earnedAt ? (
        <div className="rounded-xl border border-primary/50 bg-primary/10 px-3 py-2 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">Unlocked</div>
          <div className="mt-0.5 font-bold">{format(new Date(earnedAt), "MMM d, yyyy")}</div>
        </div>
      ) : p ? (
        <div className="rounded-xl border px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Your progress</span>
            <span className="font-bold">{Math.min(p.value, p.target).toLocaleString()} / {p.target.toLocaleString()}</span>
          </div>
          <Progress value={p.pct} className="mt-2 h-1.5" />
        </div>
      ) : null}
    </div>
  );
}

/** Compact public strip for another athlete's profile — earned + public only. */
export function PublicBadgeStrip({ clientId, limit = 4 }: { clientId: string; limit?: number }) {
  const { data = [], isPending } = usePublicBadges(clientId);
  const [open, setOpen] = useState(false);
  const catalog = data as Array<CatalogBadge & { earned_at: string }>;
  const earned = useMemo(() => new Map(catalog.map((x) => [x.badge_key, x.earned_at])), [catalog]);
  const featured = useMemo(() => featuredBadges(catalog, earned, limit), [catalog, earned, limit]);

  if (isPending) return <div className="text-sm text-muted-foreground">Loading badges…</div>;
  if (catalog.length === 0) return <div className="text-sm text-muted-foreground">No badges earned yet.</div>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {featured.map((x) => (
          <span key={x.badge_key} className={cn("flex items-center gap-1 rounded-full border-2 px-2 py-1 text-xs font-semibold", RARITY_STYLE[x.rarity].ring)}>
            <span>{badgeEmoji(x.icon_key)}</span> {x.name}
          </span>
        ))}
        {catalog.length > featured.length && (
          <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary underline-offset-2 hover:underline">
            View achievements ({catalog.length})
          </button>
        )}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          <SheetHeader className="text-left">
            <SheetTitle>Earned achievements</SheetTitle>
            <SheetDescription>Public badges only.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <BadgeCollection catalog={catalog} earned={earned} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Lightweight celebration used in the workout completion recap. */
export function NewBadgeCelebration({ clientId, sinceMinutes = 30 }: { clientId: string | null | undefined; sinceMinutes?: number }) {
  const { data: catalog = FALLBACK_BADGE_CATALOG } = useBadgeCatalog();
  const { data: earned } = useAthleteAchievements(clientId);
  const fresh = useMemo(() => {
    if (!earned) return [] as CatalogBadge[];
    const cutoff = Date.now() - sinceMinutes * 60_000;
    return catalog.filter((x) => {
      const at = earned.get(x.badge_key);
      return !!at && new Date(at).getTime() >= cutoff;
    });
  }, [catalog, earned, sinceMinutes]);

  if (!clientId || fresh.length === 0) return null;

  return (
    <section className="rounded-2xl border border-primary/40 bg-primary/[0.07] p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        {fresh.length === 1 ? "New achievement unlocked" : `${fresh.length} achievements unlocked`}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {fresh.map((x) => (
          <span key={x.badge_key} className={cn("flex items-center gap-1 rounded-full border-2 px-2 py-1 text-xs font-bold", RARITY_STYLE[x.rarity].ring)}>
            <span>{badgeEmoji(x.icon_key)}</span> {x.name}
          </span>
        ))}
      </div>
    </section>
  );
}
