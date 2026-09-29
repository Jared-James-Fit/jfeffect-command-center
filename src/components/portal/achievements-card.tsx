import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Award, Calendar, Camera, ChartLine, ClipboardCheck, Clock, Crown, Droplet, Dumbbell, Flag, Flame, Gem, Hammer, Lock, Medal,
  MessageSquare, NotebookPen, Ruler, Scale, Shield, Star, Target, Trophy, Video, X, type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  RARITY_STYLE, RARITY_ORDER, featured, progressFor, isLegacyBadge, markAchievementsSeen, useUnseenAchievements,
  type AchievementMetrics, type CatalogBadge, type PublicBadge, type Rarity,
} from "@/lib/athlete-achievements";

const ICONS: Record<string, LucideIcon> = {
  flag: Flag, dumbbell: Dumbbell, calendar: Calendar, flame: Flame, shield: Shield, hammer: Hammer, notebook: NotebookPen,
  chart: ChartLine, target: Target, medal: Medal, crown: Crown, clock: Clock, star: Star,
  message: MessageSquare, clipboard: ClipboardCheck, camera: Camera, video: Video, scale: Scale, droplet: Droplet,
  ruler: Ruler, trophy: Trophy, gem: Gem,
};

const BADGE_PALETTES = [
  "from-rose-200 via-pink-300 to-red-400 border-rose-500 text-rose-800 shadow-rose-500/30",
  "from-orange-200 via-amber-300 to-yellow-400 border-orange-500 text-orange-800 shadow-orange-500/30",
  "from-emerald-200 via-green-300 to-teal-400 border-emerald-500 text-emerald-800 shadow-emerald-500/30",
  "from-cyan-200 via-sky-300 to-blue-400 border-sky-500 text-blue-800 shadow-sky-500/30",
  "from-indigo-200 via-violet-300 to-purple-400 border-violet-500 text-violet-800 shadow-violet-500/30",
  "from-fuchsia-200 via-pink-300 to-purple-400 border-fuchsia-500 text-fuchsia-800 shadow-fuchsia-500/30",
];
const paletteFor = (key:string) => BADGE_PALETTES[[...key].reduce((n,c)=>n+c.charCodeAt(0),0)%BADGE_PALETTES.length];

export function BadgeIcon({ icon, rarity, locked, size = "md", badgeKey = icon }: { icon: string; rarity: Rarity; locked?: boolean; size?: "sm" | "md" | "lg"; badgeKey?: string }) {
  const Icon = ICONS[icon] ?? Award;
  const r = RARITY_STYLE[rarity];
  const dims = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-8 w-8" : "h-12 w-12";
  const ic = size === "lg" ? "h-9 w-9" : size === "sm" ? "h-4 w-4" : "h-6 w-6";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center rounded-full border-2 transition-transform duration-200", dims,
      locked ? "border-dashed border-border bg-muted/40 text-muted-foreground" : cn("bg-gradient-to-br shadow-lg ring-2 ring-white/80 ring-offset-1", paletteFor(badgeKey), rarity==="legendary"&&"ring-amber-300"))}>
      {locked ? <Lock className={ic} /> : <><span className="absolute inset-1 rounded-full bg-white/20" /><Icon className={cn(ic,"relative z-10 drop-shadow-sm")} strokeWidth={2.6} /></>}
    </span>
  );
}

type DetailBadge = {
  badge_key: string; name: string; icon_key: string; rarity: Rarity; category: string;
  description: string; requirement: string; earned_at?: string | null;
  progress?: { value: number; pct: number; threshold: number } | null;
  legacy?: boolean;
};

function DetailSheet({ badge, onClose }: { badge: DetailBadge | null; onClose: () => void }) {
  const r = badge ? RARITY_STYLE[badge.rarity] : null;
  return (
    <Sheet open={!!badge} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe-bottom">
        {badge && r && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <BadgeIcon icon={badge.icon_key} rarity={badge.rarity} locked={!badge.earned_at} size="lg" badgeKey={badge.badge_key} />
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
            ) : badge.legacy ? (
              <div className="text-xs font-semibold text-muted-foreground">Legacy badge · no longer available to earn</div>
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
        earned ? cn("bg-card shadow-md hover:-translate-y-0.5 hover:shadow-lg", paletteFor(b.badge_key).split(" ").find(x=>x.startsWith("border-")),
          b.rarity === "legendary" && "border-2 border-amber-400 bg-gradient-to-b from-amber-50 to-card ring-1 ring-amber-300/60 dark:from-amber-500/10",
          b.rarity === "epic" && "border-violet-400 bg-gradient-to-b from-violet-50 to-card dark:from-violet-500/10") : "border-dashed border-border/70 opacity-70")}>
      <BadgeIcon icon={b.icon_key} rarity={b.rarity} locked={!earned} badgeKey={b.badge_key} />
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
    const legacy = isLegacyBadge(b);
    return { ...b, legacy, earned_at: at, progress: at || legacy ? null : { ...progressFor(b, metrics), threshold: b.threshold } };
  }).filter((i) => i.earned_at || !i.legacy); // hide unearnable legacy badges
  const got = items.filter((i) => i.earned_at).sort((a, b) => (b.earned_at ?? "").localeCompare(a.earned_at ?? ""));
  const locked = items.filter((i) => !i.earned_at).sort((a, b) => (b.progress?.pct ?? 0) - (a.progress?.pct ?? 0));
  const top = featured(got as (DetailBadge & { earned_at: string })[]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 flex w-full min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs transition hover:border-primary/40">
        <span className="flex shrink-0 -space-x-2">
          {top.length ? top.map((b) => <BadgeIcon key={b.badge_key} icon={b.icon_key} rarity={b.rarity} size="sm" badgeKey={b.badge_key} />)
            : <BadgeIcon icon="award" rarity="common" locked size="sm" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">Milestones</span>
          <span className="block text-[10px] text-muted-foreground">{got.length}/{items.length}</span>
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          <div className="space-y-5">
            <SheetHeader className="text-left">
              <SheetTitle>Milestones</SheetTitle>
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


/**
 * Unseen-achievement reveal. One lightweight overlay (no Radix scroll lock, no
 * animation loop) that steps through every unacknowledged badge. Each badge is
 * marked seen server-side only once it has been shown and acknowledged; closing
 * early leaves the rest for next time. Waits while another dialog/sheet is open
 * so it never stacks on top of the workout recap or other popups.
 */
export function AchievementCelebrations({ clientId, catalog }: { clientId: string; catalog: CatalogBadge[] }) {
  const qc = useQueryClient();
  const { data: unseen = [] } = useUnseenAchievements(clientId, catalog);
  const [queue, setQueue] = useState<DetailBadge[]>([]);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const acked = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);

  // Snapshot the queue once per batch so refetches can't reshuffle it mid-reveal.
  useEffect(() => {
    if (queue.length) return;
    const fresh = unseen.filter((b) => !acked.current.has(b.badge_key));
    if (fresh.length) { setQueue(fresh); setIndex(0); }
  }, [unseen, queue.length]);

  // Only open when nothing else modal is on screen.
  useEffect(() => {
    if (!queue.length) { setReady(false); return; }
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const busy = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
      if (busy) { t = window.setTimeout(check, 1500); return; }
      setReady(true);
    };
    let t = window.setTimeout(check, 800);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [queue.length]);

  const ack = (keys: string[]) => {
    keys.forEach((k) => acked.current.add(k));
    markAchievementsSeen(clientId, keys)
      .catch(() => { /* retried next launch; local set prevents replay this session */ })
      .finally(() => qc.invalidateQueries({ queryKey: ["athlete-achievements-unseen", clientId] }));
  };
  const ping = () => {
    try {
      const C = window.AudioContext || (window as any).webkitAudioContext; if (!C) return;
      const ctx = audio.current ?? new C(); audio.current = ctx;
      [523.25, 659.25, 783.99].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(.0001, ctx.currentTime + i * .07); g.gain.exponentialRampToValueAtTime(.06, ctx.currentTime + i * .07 + .015); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + i * .07 + .16); o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + i * .07); o.stop(ctx.currentTime + i * .07 + .18); });
    } catch {}
  };
  const finish = () => { setQueue([]); setIndex(0); setReady(false); };
  const next = () => {
    const b = queue[index]; if (!b) return;
    ack([b.badge_key]); ping();
    if (index < queue.length - 1) setIndex((i) => i + 1); else finish();
  };
  // Dismissing never acknowledges a milestone. Any unacknowledged badges
  // remain server-side as unseen and replay on the next app load/login.
  const close = () => { finish(); };

  const b = ready ? queue[index] : null;
  if (!b) return null;
  const r = RARITY_STYLE[b.rarity];
  const prestige = b.rarity === "legendary";
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 px-3 sm:items-center"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      role="dialog" aria-modal="true" aria-label="Milestone unlocked">
      <div key={b.badge_key} className={cn("relative w-full max-w-sm overflow-hidden rounded-3xl border bg-background p-5 text-center shadow-2xl motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in",
        prestige && "border-2 border-amber-400")}>
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-1", prestige ? "bg-amber-400" : b.rarity === "epic" ? "bg-violet-500" : "bg-primary/70")} />
        <button type="button" onClick={close} aria-label="Close" className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
        <div className="text-[10px] font-black uppercase tracking-[.24em] text-muted-foreground">{prestige ? "Prestige milestone" : "Milestone unlocked"}</div>
        <div className="mx-auto mt-4 w-fit"><BadgeIcon icon={b.icon_key} rarity={b.rarity} size="lg" badgeKey={b.badge_key} /></div>
        <div className={cn("mt-3 text-[10px] font-black uppercase tracking-[.2em]", r.text)}>{r.label}</div>
        <div className="mt-1 text-2xl font-black">{b.name}</div>
        <div className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">{b.description}</div>
        {b.earned_at && <div className="mt-2 text-[11px] font-semibold text-muted-foreground">Earned {format(new Date(b.earned_at), "MMM d, yyyy")}</div>}
        {queue.length > 1 && <div className="mt-4 text-xs font-bold text-muted-foreground">{index + 1} of {queue.length}</div>}
        <button type="button" onClick={next} className="mt-4 min-h-12 w-full rounded-2xl bg-primary px-4 text-sm font-black text-primary-foreground active:scale-[0.99]">
          {index < queue.length - 1 ? "Next milestone" : "Awesome"}
        </button>

      </div>
    </div>
  );
}
