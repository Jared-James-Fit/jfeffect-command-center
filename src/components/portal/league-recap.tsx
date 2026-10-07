/**
 * Monthly League Recap — a full-screen, Stories-style animated recap of the
 * previous month: final rank, points, the grind, top 3 rivals and the podium.
 *
 * - Auto-advances; tap right/left to skip, press and hold to pause, X/Escape
 *   to close at any time.
 * - Built on its own Radix dialog so it also works when opened from inside
 *   the league sheet (nested dialogs keep pointer events).
 * - Always uses its own dark, high-contrast palette, so it looks the same in
 *   light and dark mode.
 * - LeagueRecapGate shows it once at the start of a new month (seen state is
 *   server-side); LeagueRecapButton reopens it anytime from the league.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ArrowDownRight, ArrowUpRight, Clapperboard, Dumbbell, Flame, Medal, Minus, NotebookPen, Scale, Swords, Trophy, Volume2, VolumeX, X, Share2, Download } from "lucide-react";
import { recapStoryBlob, shareOrSaveImage } from "@/lib/recap-story-card";
import { createRecapMusic, readRecapMuted, writeRecapMuted, type RecapMusic, type RecapSfx } from "@/lib/recap-music";
import { UserAvatar } from "@/components/user-avatar";
import { CoachTag } from "@/components/portal/coach-tag";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import { cn } from "@/lib/utils";
import { leagueToday } from "@/lib/league-boost";
import {
  fetchLeagueRecap, hasSeenFeature, inRecapWindow, markFeatureSeen, monthName, nextMonthName, ordinal,
  outroLine, previousLeagueMonth, rankChange, recapMonths, recapSeenKey, rivalLine, type LeagueRecap,
} from "@/lib/league-recap";

const SLIDE_MS = 5600;

// ------------------------------------------------------------------ hooks

function useCountUp(target: number, active: boolean, ms = 1100) {
  const [v, setV] = useState(active ? 0 : target);
  useEffect(() => {
    if (!active) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !target) { setV(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, ms]);
  return v;
}

function Count({ to, active, className }: { to: number; active: boolean; className?: string }) {
  const v = useCountUp(to, active);
  return <span className={cn("tabular-nums", className)}>{v.toLocaleString()}</span>;
}

// ------------------------------------------------------------------ slides

type Slide = { key: string; bg: string; ms?: number; render: (active: boolean) => ReactNode };

function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cn("jf-rc-rise", className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-black uppercase tracking-[0.28em] text-white/60">{children}</div>;
}

function buildSlides(r: LeagueRecap): Slide[] {
  const month = monthName(r.month_start);
  const me = r.me;
  const change = rankChange(r);
  const athletes = r.league?.athletes ?? 0;
  const recordsEra = r.month_start >= "2026-10-01";
  const recordCount = me.atpr_lifts + me.program_pr_lifts + me.block_pr_lifts;

  const bars = [
    { label: "Workouts", value: me.workout_points, color: "#ef4444" },
    { label: "Fully logged", value: me.logging_points, color: "#f97316" },
    { label: "Bodyweight", value: me.bodyweight_points, color: "#22c55e" },
    { label: recordsEra ? "Records" : "Beat your best", value: me.improvement_points, color: "#eab308" },
    { label: "Final Week Boost", value: me.match_points, color: "#a855f7" },
  ].filter((b) => b.value > 0);
  const barMax = Math.max(1, ...bars.map((b) => b.value));

  const slides: Slide[] = [
    {
      key: "intro",
      bg: "radial-gradient(120% 80% at 50% 0%, #7f1d1d 0%, #1a0a0a 55%, #050505 100%)",
      ms: 4200,
      render: () => (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <Rise><Kicker>Performance League</Kicker></Rise>
          <Rise delay={150}>
            <div
              className="mt-4 whitespace-nowrap font-black leading-none tracking-tight text-white"
              style={{ fontSize: `min(64px, calc((min(100vw, 420px) - 4rem) / ${(month.length * 0.64).toFixed(2)}))` }}
            >
              {month.split("").map((ch, i) => (
                <span key={i} className="jf-rc-letter inline-block" style={{ animationDelay: `${250 + i * 55}ms` }}>{ch}</span>
              ))}
            </div>
          </Rise>
          <Rise delay={700}><div className="mt-2 text-2xl font-black text-red-400">Recap</div></Rise>
          <Rise delay={1100}><p className="mt-6 text-base text-white/70">Here's how your month stacked up 👀</p></Rise>
        </div>
      ),
    },
    {
      key: "rank",
      bg: "radial-gradient(110% 70% at 50% 20%, #1e3a8a 0%, #0b1023 55%, #050505 100%)",
      render: (a) => (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <Rise><Kicker>You finished</Kicker></Rise>
          {me.rank ? (
            <>
              <Rise delay={150}>
                <div className="jf-rc-pop mt-3 text-[120px] font-black leading-none text-white">
                  #<Count to={me.rank} active={a} />
                </div>
              </Rise>
              <Rise delay={500}><div className="text-lg font-semibold text-white/75">of {athletes} athletes</div></Rise>
              {me.beat_pct != null && (
                <Rise delay={800}>
                  <div className="mt-6 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15">
                    You out-ranked {me.beat_pct}% of the league
                  </div>
                </Rise>
              )}
              {change && (
                <Rise delay={1100}>
                  <div className={cn("mt-3 inline-flex items-center gap-1 text-sm font-black",
                    change.dir === "up" ? "text-emerald-400" : change.dir === "down" ? "text-rose-400" : "text-white/70")}>
                    {change.dir === "up" ? <ArrowUpRight className="h-4 w-4" /> : change.dir === "down" ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    {change.text}
                  </div>
                </Rise>
              )}
            </>
          ) : (
            <Rise delay={150}>
              <div className="mt-4 text-3xl font-black text-white">Unranked</div>
              <p className="mt-3 text-sm text-white/70">Log a bodyweight to get on the board — your points still counted.</p>
            </Rise>
          )}
        </div>
      ),
    },
    {
      key: "points",
      bg: "radial-gradient(110% 70% at 50% 10%, #78350f 0%, #1c0f05 55%, #050505 100%)",
      render: (a) => (
        <div className="flex h-full flex-col justify-center px-7">
          <Rise><Kicker>Points</Kicker></Rise>
          <Rise delay={120}>
            <div className="mt-2 flex items-baseline gap-2">
              <Count to={me.total_points} active={a} className="text-[84px] font-black leading-none text-white" />
              <span className="text-2xl font-black text-amber-300">pts</span>
            </div>
          </Rise>
          <div className="mt-6 space-y-3">
            {bars.map((b, i) => (
              <Rise key={b.label} delay={350 + i * 140}>
                <div className="flex items-baseline justify-between text-sm font-semibold text-white/85">
                  <span>{b.label}</span>
                  <span className="font-black text-white">+{b.value}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="jf-rc-bar h-full rounded-full"
                    style={{ width: `${(b.value / barMax) * 100}%`, background: b.color, animationDelay: `${450 + i * 140}ms` }}
                  />
                </div>
              </Rise>
            ))}
          </div>
          {r.league && (
            <Rise delay={1200}>
              <div className="mt-6 text-sm text-white/70">
                League average <span className="font-black text-white">{r.league.avg_points}</span>
                {" · "}
                {me.total_points >= r.league.avg_points
                  ? <span className="font-black text-emerald-400">You +{me.total_points - r.league.avg_points}</span>
                  : <span className="font-black text-rose-300">{me.total_points - r.league.avg_points}</span>}
              </div>
            </Rise>
          )}
        </div>
      ),
    },
    {
      key: "grind",
      bg: "radial-gradient(110% 70% at 50% 10%, #064e3b 0%, #04140f 55%, #050505 100%)",
      render: (a) => {
        const tiles = [
          { icon: Dumbbell, label: "Workouts", value: me.workouts_completed },
          { icon: NotebookPen, label: "Fully logged", value: me.fully_logged },
          { icon: Scale, label: "Bodyweight logs", value: me.bodyweight_logs },
          recordsEra
            ? { icon: Trophy, label: me.atpr_lifts ? "ATPRs" : "Records", value: me.atpr_lifts || recordCount }
            : { icon: Flame, label: "Lifts improved", value: me.improved_exercises },
        ];
        return (
          <div className="flex h-full flex-col justify-center px-7">
            <Rise><Kicker>The grind</Kicker></Rise>
            <Rise delay={100}><div className="mt-2 text-3xl font-black leading-tight text-white">You put in the work.</div></Rise>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {tiles.map((t, i) => (
                <Rise key={t.label} delay={300 + i * 140}>
                  <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
                    <t.icon className="h-5 w-5 text-emerald-300" />
                    <Count to={t.value} active={a} className="mt-2 block text-4xl font-black text-white" />
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/60">{t.label}</div>
                  </div>
                </Rise>
              ))}
            </div>
            {me.adherence_pct != null && me.adherence_pct > 0 && (
              <Rise delay={1000}>
                <div className="mt-4 text-sm text-white/70">
                  Completed <span className="font-black text-white">{Math.round(me.adherence_pct)}%</span> of your prescribed workouts
                  {me.boost_qualified && <span className="font-black text-amber-300"> · Boost qualified 🔥</span>}
                </div>
              </Rise>
            )}
          </div>
        );
      },
    },
  ];

  if (r.rivals.length) {
    slides.push({
      key: "rivals",
      bg: "radial-gradient(110% 70% at 50% 10%, #4c1d95 0%, #12081f 55%, #050505 100%)",
      ms: 7600,
      render: () => (
        <div className="flex h-full flex-col justify-center px-6">
          <Rise><Kicker>Head to head</Kicker></Rise>
          <Rise delay={100}>
            <div className="mt-2 flex items-center gap-2 text-3xl font-black text-white">
              <Swords className="h-7 w-7 text-violet-300" /> Your top {r.rivals.length} rivals
            </div>
          </Rise>
          <Rise delay={200}><p className="mt-1 text-sm text-white/65">The athletes who finished closest to you.</p></Rise>
          <div className="mt-5 space-y-3">
            {r.rivals.map((rv, i) => {
              const line = rivalLine(rv.gap);
              const total = Math.max(1, rv.total_points, me.total_points);
              return (
                <div key={rv.display_name + i} className="jf-rc-slide rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10" style={{ animationDelay: `${400 + i * 260}ms` }}>
                  <div className="flex items-center gap-3">
                    <UserAvatar src={rv.avatar_url} name={rv.display_name} size={40} expandable={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-base font-black text-white">{rv.display_name}</span>{rv.is_coach && <CoachTag onDark />}</div>
                      <div className="text-xs text-white/60">
                        {rv.rank ? `#${rv.rank} · ` : ""}{rv.total_points} pts · {rv.workouts_completed} workouts
                        {rv.atpr_lifts ? ` · ${rv.atpr_lifts} ATPR` : ""}
                      </div>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide",
                      line.tone === "win" ? "bg-emerald-400/15 text-emerald-300" : line.tone === "loss" ? "bg-amber-400/15 text-amber-300" : "bg-white/10 text-white/80")}>
                      {line.tone === "win" ? "W" : line.tone === "loss" ? "L" : "T"}
                    </span>
                  </div>
                  {/* You vs them */}
                  <div className="mt-2.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-9 text-[10px] font-bold uppercase text-white/50">You</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="jf-rc-bar h-full rounded-full bg-red-500" style={{ width: `${(me.total_points / total) * 100}%`, animationDelay: `${600 + i * 260}ms` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-9 truncate text-[10px] font-bold uppercase text-white/50">{rv.display_name.split(" ")[0]}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="jf-rc-bar h-full rounded-full bg-violet-400" style={{ width: `${(rv.total_points / total) * 100}%`, animationDelay: `${600 + i * 260}ms` }} />
                      </div>
                    </div>
                  </div>
                  <div className={cn("mt-2 text-xs font-bold", line.tone === "win" ? "text-emerald-300" : line.tone === "loss" ? "text-amber-300" : "text-white/70")}>{line.text}</div>
                </div>
              );
            })}
          </div>
        </div>
      ),
    });
  }

  if (r.podium.length) {
    const order = [r.podium[1], r.podium[0], r.podium[2]];
    slides.push({
      key: "podium",
      bg: "radial-gradient(110% 70% at 50% 0%, #854d0e 0%, #1a1205 55%, #050505 100%)",
      render: () => (
        <div className="flex h-full flex-col justify-center px-6">
          <Rise><Kicker>{month} champions</Kicker></Rise>
          <Rise delay={100}><div className="mt-2 text-3xl font-black text-white">The podium</div></Rise>
          <div className="mt-8 grid grid-cols-3 items-end gap-2">
            {order.map((p, i) => p ? (
              <div key={p.display_name} className="flex flex-col items-center text-center">
                <div className="jf-rc-rise flex flex-col items-center" style={{ animationDelay: `${p.rank === 1 ? 1100 : p.rank === 2 ? 700 : 400}ms` }}>
                  <Medal className={cn("h-6 w-6", p.rank === 1 ? "text-yellow-300" : p.rank === 2 ? "text-slate-300" : "text-amber-600")} />
                  <UserAvatar src={p.avatar_url} name={p.display_name} size={p.rank === 1 ? 56 : 46} expandable={false} className="mt-1" />
                  <div className={cn("mt-1 w-full truncate text-xs font-black", p.is_me ? "text-red-300" : "text-white")}>{p.display_name}{p.is_me ? " (You)" : ""}</div>
                  {p.is_coach && <CoachTag onDark className="mt-0.5" />}
                  <div className="text-[11px] font-bold text-white/70">{p.total_points} pts</div>
                </div>
                <div
                  className={cn("jf-rc-grow mt-2 w-full rounded-t-xl", p.rank === 1 ? "h-28 bg-gradient-to-b from-yellow-300/70 to-yellow-600/30" : p.rank === 2 ? "h-20 bg-gradient-to-b from-slate-200/60 to-slate-500/25" : "h-14 bg-gradient-to-b from-amber-500/60 to-amber-800/25")}
                  style={{ animationDelay: `${p.rank === 1 ? 900 : p.rank === 2 ? 500 : 200}ms` }}
                >
                  <div className="pt-2 text-center text-lg font-black text-white/90">{p.rank}</div>
                </div>
              </div>
            ) : <div key={i} />)}
          </div>
          {me.rank && me.rank > 3 && (
            <Rise delay={1500}><div className="mt-5 text-center text-sm text-white/70">You were <span className="font-black text-white">{ordinal(me.rank)}</span> — {r.podium[2] ? `${Math.max(0, r.podium[2].total_points - me.total_points)} pts off the podium` : ""}</div></Rise>
          )}
        </div>
      ),
    });
  }

  slides.push({
    key: "outro",
    bg: "radial-gradient(120% 80% at 50% 100%, #991b1b 0%, #1a0a0a 55%, #050505 100%)",
    ms: 9000,
    render: () => (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <Rise><Kicker>New month · new board</Kicker></Rise>
        <Rise delay={150}><div className="mt-4 text-5xl font-black leading-tight text-white">{nextMonthName(r.month_start)} is live</div></Rise>
        <Rise delay={500}><p className="mt-4 text-base leading-relaxed text-white/75">{outroLine(r)}</p></Rise>
      </div>
    ),
  });

  return slides;
}


// ------------------------------------------------------------------ sound cues

type Cue = [ms: number, sfx: RecapSfx, opts?: { pitch?: number; gain?: number; dur?: number }];

/** Sound effects timed to each slide's animation delays. */
function slideCues(key: string, r: LeagueRecap): Cue[] {
  const me = r.me;
  const counting = (start: number, n: number, steps = 10): Cue[] =>
    Array.from({ length: Math.min(steps, Math.max(1, n)) }, (_, k) => [start + k * 95, "tick", { pitch: 1 + k * 0.06, gain: 0.8 }] as Cue);
  switch (key) {
    case "intro": {
      const letters = monthName(r.month_start).length;
      return [
        [0, "whoosh"],
        ...Array.from({ length: letters }, (_, i) => [250 + i * 55, "tick", { pitch: 0.8 + i * 0.05, gain: 0.6 }] as Cue),
        [700, "chime"],
        [1100, "sparkle", { gain: 0.6 }],
      ];
    }
    case "rank": {
      const change = rankChange(r);
      return [
        [0, "whoosh"],
        [150, "pop"],
        ...counting(200, me.rank ?? 1),
        [1250, "thud", { gain: 0.7 }],
        ...(me.beat_pct != null ? [[800, "sparkle", { gain: 0.7 }] as Cue] : []),
        ...(change ? [[1100, change.dir === "down" ? "fall" : "rise"] as Cue] : []),
      ];
    }
    case "points":
      return [
        [0, "whoosh"],
        ...counting(150, me.total_points, 11),
        ...[0, 1, 2, 3, 4].map((i) => [450 + i * 140, "swish", { gain: 0.7 }] as Cue),
        [1250, "chime", { pitch: 1.12 }],
      ];
    case "grind":
      return [[0, "whoosh"], ...[0, 1, 2, 3].map((i) => [300 + i * 140, "pop", { pitch: 0.9 + i * 0.12, gain: 0.8 }] as Cue)];
    case "rivals":
      return [[0, "whoosh"], ...r.rivals.map((_, i) => [400 + i * 260, "swish"] as Cue), [400 + r.rivals.length * 260 + 200, "pop", { pitch: 1.2 }]];
    case "podium":
      return [[0, "whoosh"], [150, "roll", { dur: 0.95 }], [400, "thud", { pitch: 0.9 }], [700, "thud"], [1100, "fanfare"], [1150, "sparkle"]];
    case "outro":
      return [[0, "whoosh"], [150, "chime", { pitch: 0.75 }], [500, "sparkle"]];
    default:
      return [[0, "whoosh"]];
  }
}

// ------------------------------------------------------------------ story

export function LeagueRecapStory({ recap, open, onClose }: { recap: LeagueRecap; open: boolean; onClose: () => void }) {
  const slides = useMemo(() => buildSlides(recap), [recap]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const last = i === slides.length - 1;
  const slide = slides[i];
  const ms = slide.ms ?? SLIDE_MS;

  useEffect(() => { if (open) { setI(0); setPaused(false); } }, [open]);

  // Background music: starts with the story (or on the first tap if the
  // browser blocked autoplay), ducks while paused, fades out on close.
  const music = useRef<RecapMusic | null>(null);
  const [muted, setMuted] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  useEffect(() => {
    if (!open) return;
    const m = createRecapMusic();
    music.current = m;
    const startMuted = readRecapMuted();
    setMuted(startMuted);
    m?.setMuted(startMuted);
    void m?.start().then(setMusicOn);
    return () => { m?.stop(); music.current = null; setMusicOn(false); };
  }, [open]);
  useEffect(() => { music.current?.duck(paused); }, [paused]);
  // Fire this slide's sound effects in sync with its animations.
  useEffect(() => {
    if (!open || !musicOn) return;
    const ids = slideCues(slide.key, recap).map(([ms, name, o]) =>
      window.setTimeout(() => music.current?.sfx(name, o), ms));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [open, musicOn, slide.key, recap]);

  const [sharing, setSharing] = useState<"share" | "save" | null>(null);
  const shareRecap = async (mode: "share" | "save") => {
    setSharing(mode);
    setPaused(true);
    try {
      const blob = await recapStoryBlob(recap, recap.me.display_name);
      if (!blob) return;
      music.current?.sfx("shutter");
      await shareOrSaveImage(blob, `jf-effect-${recap.month_start.slice(0, 7)}-recap.png`, `My ${monthName(recap.month_start)} Recap`, mode);
    } catch (e) {
      console.warn("Recap share failed", e);
    } finally {
      setSharing(null);
      setPaused(false);
    }
  };
  const ensureMusic = () => { if (!musicOn) void music.current?.start().then(setMusicOn); };
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    writeRecapMuted(m);
    music.current?.setMuted(m);
    ensureMusic();
  };

  const next = useCallback(() => setI((v) => Math.min(v + 1, slides.length - 1)), [slides.length]);
  const prev = useCallback(() => setI((v) => Math.max(v - 1, 0)), []);

  useEffect(() => {
    if (!open || paused || last) return;
    const t = window.setTimeout(next, ms);
    return () => window.clearTimeout(t);
  }, [open, paused, last, next, ms, i]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, prev]);

  // ---- Swipe down to close (like Instagram stories) ----
  // The whole story follows the finger, shrinks a little and fades the page
  // behind it. Release past ~120px (or flick down) to dismiss; otherwise it
  // snaps back. The story is paused while dragging.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; lastY: number; lastT: number; v: number; active: boolean } | null>(null);
  useEffect(() => { if (open) { setDragY(0); setDragging(false); setLeaving(false); drag.current = null; } }, [open]);

  const onDragStart = (e: React.PointerEvent) => {
    if (leaving || (e.target as HTMLElement).closest("button, a, [role='button']")) { drag.current = null; return; }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, lastT: performance.now(), v: 0, active: false };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || leaving) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      // Only a mostly-vertical, downward pull starts a dismiss drag.
      if (dy > 12 && dy > Math.abs(dx) * 1.2) {
        d.active = true;
        if (holdTimer.current) window.clearTimeout(holdTimer.current);
        held.current = false;
        setPaused(true);
        setDragging(true);
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      } else {
        return;
      }
    }
    const now = performance.now();
    d.v = (e.clientY - d.lastY) / Math.max(1, now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
    setDragY(Math.max(0, dy));
  };
  const endDrag = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return; // a plain tap — handled by the slide area
    setDragging(false);
    const dy = Math.max(0, e.clientY - d.y);
    if (!cancelled && (dy > 120 || (dy > 40 && d.v > 0.5))) {
      setLeaving(true);
      setDragY(typeof window !== "undefined" ? window.innerHeight : 800);
      window.setTimeout(onClose, 190);
    } else {
      setDragY(0);
      setPaused(false);
    }
  };
  const dragProgress = Math.min(dragY, 320) / 320;

  const onPointerDown = () => {
    ensureMusic();
    held.current = false;
    holdTimer.current = window.setTimeout(() => { held.current = true; setPaused(true); }, 220);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    if (held.current) { held.current = false; setPaused(false); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX - rect.left < rect.width * 0.3) prev();
    else if (!last) next();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[95] bg-black"
          style={{ opacity: 1 - dragProgress * 0.85, transition: dragging ? "none" : "opacity 190ms ease" }}
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[96] flex select-none flex-col overflow-hidden text-white outline-none md:inset-y-4 md:left-1/2 md:w-[420px] md:-translate-x-1/2 md:rounded-[2rem]"
          style={{
            background: slide.bg,
            transform: dragY > 0 ? `translateY(${dragY}px) scale(${1 - dragProgress * 0.08})` : undefined,
            borderRadius: dragY > 0 ? Math.min(28, dragY / 4) : undefined,
            transition: dragging ? "background 600ms ease" : "background 600ms ease, transform 190ms ease, border-radius 190ms ease",
            touchAction: "none",
          }}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
        >
          <DialogPrimitive.Title className="sr-only">{monthName(recap.month_start)} League Recap</DialogPrimitive.Title>

          {/* Progress */}
          <div className="relative z-20 flex gap-1 px-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
            {slides.map((s, idx) => (
              <div key={s.key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
                <div
                  key={idx === i ? `${s.key}-active` : s.key}
                  className={cn("h-full rounded-full bg-white", idx === i && !last ? "jf-rc-progress" : "")}
                  style={idx < i || (idx === i && last) ? { width: "100%" } : idx > i ? { width: "0%" } : { animationDuration: `${ms}ms`, animationPlayState: paused ? "paused" : "running" }}
                />
              </div>
            ))}
          </div>
          <div className="relative z-20 flex items-center justify-between px-4 pt-3">
            <div className="flex items-center gap-2 text-xs font-bold text-white/80">
              <Clapperboard className="h-4 w-4" /> {monthName(recap.month_start)} Recap
            </div>
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void shareRecap("share")}
              disabled={!!sharing}
              aria-label="Share recap"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 active:scale-95 disabled:opacity-60"
            >
              <Share2 className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute music" : "Mute music"}
              aria-pressed={!muted}
              className="relative grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 active:scale-95"
            >
              {muted ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
              {!muted && musicOn && (
                <span aria-hidden className="absolute -bottom-0.5 left-1/2 flex -translate-x-1/2 items-end gap-[2px]">
                  {[0, 1, 2].map((b) => <span key={b} className="jf-rc-eq w-[2px] rounded-full bg-white/80" style={{ animationDelay: `${b * 160}ms` }} />)}
                </span>
              )}
            </button>
            <DialogPrimitive.Close
              aria-label="Close recap"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25 active:scale-95"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
            </div>
          </div>

          {/* Slide */}
          <div
            className="relative z-10 min-h-0 flex-1"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { if (holdTimer.current) window.clearTimeout(holdTimer.current); setPaused(false); }}
          >
            <div key={slide.key} className="h-full">{slide.render(true)}</div>
          </div>

          {/* Footer */}
          <div className="relative z-20 px-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
            {last ? (
              <div className="space-y-2">
                <div className="jf-rc-rise grid grid-cols-2 gap-2" style={{ animationDelay: "700ms" }}>
                  <button
                    type="button"
                    onClick={() => void shareRecap("share")}
                    disabled={!!sharing}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 text-[14px] font-black text-white ring-1 ring-white/20 backdrop-blur transition active:scale-[0.98] disabled:opacity-60"
                  >
                    <Share2 className="h-4 w-4" /> {sharing === "share" ? "Preparing…" : "Share"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void shareRecap("save")}
                    disabled={!!sharing}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 text-[14px] font-black text-white ring-1 ring-white/20 backdrop-blur transition active:scale-[0.98] disabled:opacity-60"
                  >
                    <Download className="h-4 w-4" /> {sharing === "save" ? "Preparing…" : "Save image"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="jf-rc-rise h-12 w-full rounded-2xl bg-white text-[15px] font-black text-black transition active:scale-[0.98]"
                  style={{ animationDelay: "900ms" }}
                >
                  Let's go 💪
                </button>
              </div>
            ) : (
              <div className="text-center text-[11px] font-semibold text-white/45">Tap to continue · hold to pause · swipe down to close</div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ------------------------------------------------------------------ gate + button

/** Shows the previous month's recap once, during the first week of a new month. */
export function LeagueRecapGate() {
  const { user } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  // The auto-play story is for the real client only; in coach POV the home
  // tile is there instead (and we must not mark it "seen" for anyone).
  const userId = isImpersonating ? null : user?.id ?? null;
  const qc = useQueryClient();
  const today = leagueToday();
  const month = previousLeagueMonth(today);
  const key = recapSeenKey(month);
  const enabled = !!userId && inRecapWindow(today);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);

  const { data: seen, isFetchedAfterMount } = useQuery({
    queryKey: ["feature-announcement", key, userId],
    enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: () => hasSeenFeature(userId!, key),
  });
  const { data: recap } = useQuery({
    queryKey: ["league-recap", month, userId],
    enabled: enabled && seen === false,
    staleTime: 10 * 60_000,
    queryFn: () => fetchLeagueRecap(month),
  });

  useEffect(() => {
    if (!enabled || !isFetchedAfterMount || seen !== false || !recap || closed || open) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries++;
      const busy = document.querySelector('[role="dialog"], [role="alertdialog"], [data-vaul-drawer]');
      if (!busy) { setOpen(true); window.clearInterval(id); }
      else if (tries > 60) window.clearInterval(id);
    }, 1500);
    return () => window.clearInterval(id);
  }, [enabled, isFetchedAfterMount, seen, recap, closed, open]);

  if (!recap) return null;
  return (
    <LeagueRecapStory
      recap={recap}
      open={open}
      onClose={() => {
        setOpen(false);
        setClosed(true);
        qc.setQueryData(["feature-announcement", key, userId], true);
        if (userId) void markFeatureSeen(userId, key);
      }}
    />
  );
}

/** Entry point inside the league: replay last month's recap anytime. */
export function LeagueRecapButton({ className }: { className?: string }) {
  const viewerId = usePortalUserId() ?? null;
  const month = previousLeagueMonth();
  const [open, setOpen] = useState(false);
  const { data: recap } = useQuery({
    queryKey: ["league-recap", month, viewerId],
    enabled: !!viewerId,
    staleTime: 10 * 60_000,
    queryFn: () => fetchLeagueRecap(month, viewerId),
  });
  if (!recap) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl p-3 text-left text-white shadow-md transition active:scale-[0.99]",
          className,
        )}
        style={{ background: "linear-gradient(120deg, #7f1d1d 0%, #b91c1c 45%, #4c1d95 100%)" }}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15"><Clapperboard className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black">Your {monthName(recap.month_start)} Recap</span>
          <span className="block truncate text-xs text-white/75">
            {recap.me.rank ? `#${recap.me.rank} · ` : ""}{recap.me.total_points} pts · see your rivals
          </span>
        </span>
        <span className="text-xs font-black text-white/90">Play ▶</span>
        <span aria-hidden className="jf-record-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2" />
      </button>
      <LeagueRecapStory recap={recap} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Home-screen access point: last month's recap one tap away all month, plus
 * an archive of every past recap.
 */
export function LeagueRecapHomeTile({ className }: { className?: string }) {
  // The person whose portal this is (the client in coach "View as" mode).
  const userId = usePortalUserId() ?? null;
  const month = previousLeagueMonth();
  const [playing, setPlaying] = useState<LeagueRecap | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { data: recap } = useQuery({
    queryKey: ["league-recap", month, userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: () => fetchLeagueRecap(month, userId),
  });

  const months = useMemo(() => recapMonths(month, 12), [month]);
  const archive = useQueries({
    queries: months.map((m) => ({
      queryKey: ["league-recap", m, userId],
      enabled: !!userId && archiveOpen,
      staleTime: 30 * 60_000,
      queryFn: () => fetchLeagueRecap(m, userId),
    })),
  });
  const past = archive.map((q) => q.data).filter((r): r is LeagueRecap => !!r && (r.me?.total_points ?? 0) > 0);
  const archiveLoading = archiveOpen && archive.some((q) => q.isLoading);

  if (!recap) return null;
  const isNew = inRecapWindow();

  return (
    <>
      <div
        className={cn("relative overflow-hidden rounded-2xl text-white shadow-md", className)}
        style={{ background: "linear-gradient(120deg, #450a0a 0%, #991b1b 45%, #3b0764 100%)" }}
      >
        <button
          type="button"
          onClick={() => setPlaying(recap)}
          className="flex w-full items-center gap-3 p-3.5 text-left transition active:scale-[0.99]"
          aria-label={`Play your ${monthName(recap.month_start)} recap`}
        >
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15">
            <Clapperboard className="h-6 w-6" />
            {isNew && <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-[9px] font-black uppercase text-black">New</span>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/60">Performance League</span>
            <span className="block text-[15px] font-black leading-tight">Your {monthName(recap.month_start)} Recap</span>
            <span className="block truncate text-xs text-white/75">
              {recap.me.rank ? `Finished #${recap.me.rank} · ` : ""}{recap.me.total_points} pts · 🎧
            </span>
          </span>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black shadow">
            <span className="ml-0.5 text-sm font-black">▶</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setArchiveOpen(true)}
          className="flex w-full items-center justify-between border-t border-white/10 px-3.5 py-2 text-[11px] font-bold text-white/80 transition hover:bg-white/5"
        >
          All recaps <span aria-hidden>→</span>
        </button>
        <span aria-hidden className="jf-record-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2" />
      </div>

      <Sheet open={archiveOpen} onOpenChange={setArchiveOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl px-5 pb-safe-bottom pt-5">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2"><Clapperboard className="h-5 w-5 text-primary" /> Your Recaps</SheetTitle>
            <SheetDescription>Replay any month of the Performance League.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {past.map((r) => (
              <button
                key={r.month_start}
                type="button"
                onClick={() => { setArchiveOpen(false); setPlaying(r); }}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:bg-muted/50 active:scale-[0.99]"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black">{monthName(r.month_start, { month: "long", year: "numeric" })}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.me.rank ? `#${r.me.rank} · ` : ""}{r.me.total_points} pts
                  </span>
                </span>
                <span className="text-xs font-black text-primary">Play ▶</span>
              </button>
            ))}
            {archiveLoading && <div className="py-6 text-center text-xs text-muted-foreground">Loading recaps…</div>}
            {!archiveLoading && past.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">Your recaps will show up here after each month.</div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {playing && <LeagueRecapStory recap={playing} open={!!playing} onClose={() => setPlaying(null)} />}
    </>
  );
}
