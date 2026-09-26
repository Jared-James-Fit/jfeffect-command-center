import { useState } from "react";
import { format } from "date-fns";
import {
  Award, Calendar, ChartLine, Clock, Crown, Dumbbell, Flag, Flame, Hammer, Lock, Medal, NotebookPen, Shield, Star, Target,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  RARITY_STYLE, featured, progressFor, type AchievementMetrics, type CatalogBadge, type PublicBadge, type Rarity,
} from "@/lib/athlete-achievements";

const ICONS: Record<string, LucideIcon> = {
  flag: Flag, dumbbell: Dumbbell, calendar: Calendar, flame: Flame, shield: Shield, hammer: Hammer, notebook: NotebookPen,
  chart: ChartLine, target: Target, medal: Medal, crown: Crown, clock: Clock, star: Star,
};

export function BadgeIcon({ icon, rarity, locked, size = "md" }: { icon: string; rarity: Rarity; locked?: boolean; size?: "sm" | "md" | "lg" }) {
  const Icon = ICONS[icon] ?? Award;
  const r = RARITY_STYLE[rarity];
  const dims = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-8 w-8" : "h-12 w-12";
  const ic = size === "lg" ? "h-9 w-9" : size === "sm" ? "h-4 w-4" : "h-6 w-6";
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full border-2", dims,
      locked ? "border-dashed border-border bg-muted/40 text-muted-foreground" : cn(r.ring, r.glow, r.text))}>
      {locked ? <Lock className={ic} /> : <Icon className={ic} />}
    </span>
  );
}

type DetailBadge = {
  badge_key: string; name: string; icon_key: string; rarity: Rarity; category: string;
  description: string; requirement: string; earned_at?: string | null;
  progress?: { value: number; pct: number; threshold: number } | null;
};

function DetailSheet({ badge, onClose }: { badge: DetailBadge | null; onClose: () => void }) {
  const r = badge ? RARITY_STYLE[badge.rarity] : null;
  return (
    <Sheet open={!!badge} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe-bottom">
        {badge && r && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <BadgeIcon icon={badge.icon_key} rarity={badge.rarity} locked={!badge.earned_at} size="lg" />
            <SheetHeader className="items-center text-center">
              <div className={cn("text-[10px] font-black uppercase tracking-[0.2em]", r.text)}>{r.label} · {badge.category}</div>
              <SheetTitle className="text-xl font-black">{badge.name}</SheetTitle>
              <SheetDescription>{badge.description}</SheetDescription>
            </SheetHeader>
            <div className="w-full rounded-xl border bg-muted/30 p-3 text-left">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Requirement</div>
              <div className="text-sm font-semibold">{badge.requirement}</div>
            </div>
            {badge.earned_at ? (
              <div className="text-sm font-semibold text-primary">Earned {format(new Date(badge.earned_at), "MMMM d, yyyy")}</div>
            ) : badge.progress ? (
              <div className="w-full text-left">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>Your progress</span>
                  <span className="font-semibold">{badge.progress.value.toLocaleString()} / {badge.progress.threshold.toLocaleString()}</span>
                </div>
                <Progress value={badge.progress.pct} className="h-2" />
              </div>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Tile({ b, onClick }: { b: DetailBadge; onClick: () => void }) {
  const r = RARITY_STYLE[b.rarity];
  const earned = !!b.earned_at;
  return (
    <button type="button" onClick={onClick}
      className={cn("flex min-h-[112px] flex-col items-center justify-start gap-1 rounded-xl border p-2 text-center transition active:scale-95",
        earned ? "border-border bg-card" : "border-dashed border-border/70 opacity-70")}>
      <BadgeIcon icon={b.icon_key} rarity={b.rarity} locked={!earned} />
      <span className="text-[11px] font-bold leading-tight">{b.name}</span>
      {earned ? (
        <span className={cn("text-[9px] font-semibold uppercase tracking-wider", r.text)}>{r.label}</span>
      ) : b.progress ? (
        <Progress value={b.progress.pct} className="mt-auto h-1 w-full" />
      ) : null}
    </button>
  );
}

/** Own collection: earned first, then locked with private progress. */
export function MyAchievementsRow({ catalog, earned, metrics }: {
  catalog: CatalogBadge[]; earned: { badge_key: string; earned_at: string }[]; metrics: AchievementMetrics;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<DetailBadge | null>(null);
  const earnedMap = new Map(earned.map((e) => [e.badge_key, e.earned_at]));
  const items: DetailBadge[] = catalog.map((b) => {
    const at = earnedMap.get(b.badge_key) ?? null;
    return { ...b, earned_at: at, progress: at ? null : { ...progressFor(b, metrics), threshold: b.threshold } };
  });
  const got = items.filter((i) => i.earned_at).sort((a, b) => (b.earned_at ?? "").localeCompare(a.earned_at ?? ""));
  const locked = items.filter((i) => !i.earned_at).sort((a, b) => (b.progress?.pct ?? 0) - (a.progress?.pct ?? 0));
  const top = featured(got as (DetailBadge & { earned_at: string })[]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs transition hover:border-primary/40">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex -space-x-2">
            {top.length ? top.map((b) => <BadgeIcon key={b.badge_key} icon={b.icon_key} rarity={b.rarity} size="sm" />)
              : <BadgeIcon icon="award" rarity="common" locked size="sm" />}
          </span>
          <span className="font-semibold">Achievements <span className="font-normal text-muted-foreground">{got.length}/{items.length}</span></span>
        </span>
        <span className="shrink-0 font-semibold text-primary">View</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          <div className="space-y-5">
            <SheetHeader className="text-left">
              <SheetTitle>Achievements</SheetTitle>
              <SheetDescription>{got.length} of {items.length} unlocked. Earned badges are visible to other athletes; your progress stays private.</SheetDescription>
            </SheetHeader>
            {got.length > 0 && (
              <section>
                <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Earned</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{got.map((b) => <Tile key={b.badge_key} b={b} onClick={() => setDetail(b)} />)}</div>
              </section>
            )}
            {locked.length > 0 && (
              <section>
                <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">In progress</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{locked.map((b) => <Tile key={b.badge_key} b={b} onClick={() => setDetail(b)} />)}</div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <DetailSheet badge={detail} onClose={() => setDetail(null)} />
    </>
  );
}

/** Another athlete's public earned badges: featured + View Achievements. */
export function PublicAchievements({ badges, name }: { badges: PublicBadge[]; name: string }) {
  const [all, setAll] = useState(false);
  const [detail, setDetail] = useState<DetailBadge | null>(null);
  const top = featured(badges, 3);
  const shown = all ? badges : top;
  return (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <div>
          <div className="text-sm font-black">Achievements</div>
          <div className="text-[11px] text-muted-foreground">Only earned public badges are shared.</div>
        </div>
        <span className="text-xs font-bold text-muted-foreground">{badges.length} earned</span>
      </div>
      {badges.length === 0 ? (
        <div className="rounded-2xl border p-4 text-sm text-muted-foreground">{name} hasn't unlocked any achievements yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shown.map((b) => <Tile key={b.badge_key} b={b} onClick={() => setDetail(b)} />)}
          </div>
          {badges.length > top.length && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 min-h-10 w-full text-xs font-semibold text-primary">
              {all ? "Show featured" : `View Achievements (${badges.length})`}
            </button>
          )}
        </>
      )}
      <DetailSheet badge={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
