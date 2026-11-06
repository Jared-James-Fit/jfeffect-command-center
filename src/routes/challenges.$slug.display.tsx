import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Maximize, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AthleteAvatar,
  Countdown,
  QrImage,
  ScoreText,
  initialsOf,
  useNow,
} from "@/components/challenges/ui";
import {
  challengeUrl,
  joinUrl,
  mediaUrl,
  track,
  useBoardPages,
  useChallenge,
  useLiveChallenge,
  useOnPlatform,
} from "@/lib/challenges/api";
import { isFresh, type RankRow } from "@/lib/challenges/board";
import {
  STATUS_META,
  defaultDivision,
  formatScore,
  placeLabel,
  rankBadge,
  scoreUnit,
  scoreValue,
  selfSignupOpen,
  type ChallengePublic,
  type RecentAttempt,
} from "@/lib/challenges/model";

/**
 * The big screen: a TV or projector at the venue. Dark, huge type, readable
 * from across the room, live. No contact details, ever.
 */
export const Route = createFileRoute("/challenges/$slug/display")({
  head: () => ({
    meta: [{ title: "Live board | JF Effect Challenges" }, { name: "robots", content: "noindex" }],
  }),
  component: Display,
});

function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let off = false;
    const take = async () => {
      try {
        const wl = (
          navigator as Navigator & {
            wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
          }
        ).wakeLock;
        if (wl && !off) lock = await wl.request("screen");
      } catch {
        /* not supported or not allowed: the screen's own settings apply */
      }
    };
    void take();
    const onVis = () => document.visibilityState === "visible" && void take();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      off = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

function Display() {
  const { slug } = Route.useParams();
  const q = useChallenge(slug);
  const c = q.data;
  const [division, setDivision] = useState<string | null>(null);
  const pages = useBoardPages(slug, division, 0, c?.status, !!c);
  const page = pages.data?.pages[0] ?? null;
  const now = useOnPlatform(slug, c?.id, c?.status);
  useLiveChallenge(c?.id);
  useWakeLock();
  const clock = useNow(1000);

  useEffect(() => {
    if (c) setDivision((d) => d ?? defaultDivision(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id]);
  useEffect(() => {
    track("display_view", { slug });
  }, [slug]);
  // with several separate boards, the screen cycles through them
  useEffect(() => {
    if (!c?.separate_divisions || c.divisions.length < 2) return;
    const t = setInterval(() => {
      setDivision((d) => {
        const i = c.divisions.findIndex((x) => x.id === d);
        return c.divisions[(i + 1) % c.divisions.length]!.id;
      });
    }, 20_000);
    return () => clearInterval(t);
  }, [c?.separate_divisions, c?.divisions]);

  const rows = page?.rows ?? [];
  const leaderMoment = useNewLeaderName(rows);
  const recent = (page?.recent ?? []).filter(
    (r) => !r.tiebreak && (!division || r.division_id === division),
  );
  const flash = useFreshResult(recent[0] ?? null);

  if (!c) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0b0b0d] text-white/60">
        {q.isPending ? "Loading…" : "Challenge not found."}
      </div>
    );
  }
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  const signup = c.registration_open ?? selfSignupOpen(c);
  const qrUrl = signup ? joinUrl(slug, "display") : challengeUrl(slug, { src: "display" });
  const divisionLabel = c.divisions.find((d) => d.id === division);
  const up = now.data && isFresh(now.data, clock) ? now.data : null;
  const leader = rows.find((r) => (division ? r.rank_div : r.rank) === 1) ?? null;

  return (
    <div
      className="dark flex h-dvh flex-col overflow-hidden bg-[#0b0b0d] p-[1.6vw] text-white"
      // sized by whichever runs out first, width or height, so a 16:9 TV shows everything
      style={{ fontSize: "clamp(10px, min(1vw, 1.75vh), 30px)" }}
    >
      <button
        type="button"
        onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
        className="fixed right-3 top-3 z-10 rounded-lg bg-white/10 p-2 text-white/60 opacity-0 transition-opacity hover:bg-white/20 hover:opacity-100 focus:opacity-100"
        aria-label="Full screen"
      >
        <Maximize className="h-4 w-4" />
      </button>

      {/* header: one line */}
      <header className="flex items-center gap-[1.5vw]">
        <img src="/logo.png" alt="JF Effect" className="h-[3.2vw] w-[3.2vw] rounded-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[3.4em] uppercase leading-none tracking-wide">
            {c.title}
          </h1>
          <p className="mt-[0.3vw] truncate text-[1.4em] text-white/55">
            {[c.load_label, c.objective, divisionLabel?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <StatusBadge c={c} />
        <div className="flex items-center gap-[0.8vw] rounded-[0.8vw] bg-white p-[0.4vw] pr-[1vw] text-black">
          <QrImage value={qrUrl} size={Math.round(Math.min(150, 0.065 * viewportWidth()))} className="p-0" />
          <span className="max-w-[9vw] text-[1.15em] font-semibold leading-tight">
            {signup ? "Scan to enter" : "Scan for live rankings"}
          </span>
        </div>
      </header>

      {leaderMoment ? (
        <div className="jf-moment-in mt-[1.2vw] flex items-center gap-[1vw] rounded-[1vw] bg-[#f5b301] px-[2vw] py-[0.8vw] text-[2.2em] font-bold text-black">
          <Trophy className="h-[2.2vw] w-[2.2vw]" /> New leader: {leaderMoment}
        </div>
      ) : null}

      <main className="mt-[1.4em] grid min-h-0 flex-1 grid-cols-[1fr_1.25fr] gap-[2em]">
        {/* left: who's lifting now, else the latest result, else the leader */}
        <section className="flex min-h-0 flex-col gap-[1.2em] overflow-hidden">
          {up ? (
            <Hero label="On the platform" live>
              <BigAvatar name={up.name} photo={up.photo} />
              <p className="mt-[0.4em] max-w-full truncate text-[2.8em] font-semibold leading-tight">{up.name}</p>
              <p className="text-[1.5em] text-white/50">
                #{up.bib}
                {c.attempts_allowed > 1 ? ` · Attempt ${up.attempt_no} of ${c.attempts_allowed}` : ""}
              </p>
              {up.live_value != null ? (
                <p className="mt-[0.3em] font-display text-[9em] tabular-nums leading-[0.9]">
                  {scoreValue(up.live_value, shape)}
                  <span className="ml-[0.6vw] align-baseline font-sans text-[0.14em] font-medium text-white/50">
                    {scoreUnit(up.live_value, shape)} so far
                  </span>
                </p>
              ) : (
                <p className="mt-[1vw] text-[2.4em] text-white/60">Lifting now</p>
              )}
            </Hero>
          ) : flash ? (
            <Hero label="Just verified">
              <BigAvatar name={flash.name} photo={flash.photo} />
              <p className="mt-[0.4em] max-w-full truncate text-[2.8em] font-semibold leading-tight">{flash.name}</p>
              <p className="mt-[0.3em] font-display text-[6.5em] tabular-nums leading-[0.9]">
                {flash.valid ? formatScore(flash.value, shape) : "No lift"}
              </p>
              {flash.valid ? <FlashRank rows={rows} code={flash.code} division={division} /> : null}
            </Hero>
          ) : leader ? (
            <Hero label={c.final ? (leader.tied ? "Co-champion" : "Champion") : "Leader"} gold>
              <BigAvatar name={leader.name} photo={leader.photo} gold />
              <p className="mt-[0.4em] max-w-full truncate text-[2.8em] font-semibold leading-tight">{leader.name}</p>
              <ScoreText
                value={leader.score}
                shape={shape}
                className="mt-[0.3em] text-[6.5em] leading-none"
                unitClassName="text-white/50"
              />
            </Hero>
          ) : (
            <Hero label={c.status === "upcoming" ? "Starting soon" : "Leaderboard"}>
              {c.status === "upcoming" && c.starts_at ? (
                <Countdown to={c.starts_at} label="Starts in" size="xl" />
              ) : (
                <p className="text-[2.4em] text-white/60">Waiting for the first score</p>
              )}
              <p className="mt-[1.5vw] text-[1.8em] text-white/50">
                {page?.registered ?? c.registered} registered
              </p>
            </Hero>
          )}

          {recent.length ? (
            <div className="shrink-0 rounded-[1.2em] bg-white/[0.05] p-[1.2em]">
              <p className="text-[1.3em] font-medium text-white/50">Recent results</p>
              <ul className="mt-[0.6vw] space-y-[0.4vw]">
                {recent.slice(0, 3).map((r) => (
                  <li key={r.id} className="flex items-center gap-[0.6em] text-[1.6em]">
                    <AthleteAvatar name={r.name} photo={r.photo} size={32} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="font-display tabular-nums">
                      {r.valid ? formatScore(r.value, shape) : "No lift"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {/* right: the top ten */}
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="mb-[0.6vw] flex items-baseline justify-between text-white/50">
            <p className="text-[1.4em] font-medium">
              {c.final ? "Final results" : "Top 10"}
              {divisionLabel ? ` · ${divisionLabel.name}` : ""}
            </p>
            <p className="text-[1.2em]">
              {page ? `${page.total} ranked · ${page.registered} registered` : ""}
            </p>
          </div>
          <ol className="grid min-h-0 flex-1 grid-rows-[repeat(10,minmax(0,1fr))] gap-[0.45em]">
            {rows.slice(0, 10).map((r) => {
              const place = (division ? r.rank_div : r.rank) ?? 0;
              const shared = division ? r.tied_div : r.tied;
              const isUp = up?.code === r.code;
              return (
                <li
                  key={r.code}
                  className={cn(
                    "flex min-h-0 items-center gap-[1em] rounded-[0.8em] px-[1.2em]",
                    isUp ? "bg-white/[0.16]" : place <= 3 ? "bg-white/[0.09]" : "bg-white/[0.04]",
                  )}
                >
                  <span
                    className={cn(
                      "w-[2.4em] font-display text-[2.2em] tabular-nums",
                      place === 1 ? "text-[#f5b301]" : place <= 3 ? "text-white" : "text-white/45",
                    )}
                  >
                    {rankBadge(place, shared)}
                  </span>
                  <AthleteAvatar name={r.name} photo={r.photo} size={40} medal={place <= 3 ? place : null} />
                  <span className="min-w-0 flex-1 truncate text-[1.9em] font-medium">{r.name}</span>
                  <ScoreText
                    value={r.score}
                    shape={shape}
                    className="text-[2.4em]"
                    unitClassName="text-white/45"
                  />
                </li>
              );
            })}
            {!rows.length ? (
              <li className="row-span-2 rounded-[0.8em] bg-white/[0.04] p-[1.2em] text-[1.6em] text-white/50">
                The board fills in as judges record scores.
              </li>
            ) : null}
          </ol>
          {c.sponsors.length ? (
            <div className="mt-auto flex flex-wrap items-center gap-[1.5vw] pt-[1.2vw] opacity-80">
              <span className="text-[1.1em] text-white/45">Supported by</span>
              {c.sponsors.map((s) =>
                s.logo_path ? (
                  <img
                    key={s.name}
                    src={mediaUrl(s.logo_path) ?? ""}
                    alt={s.name}
                    className="h-[2.6vw] w-auto rounded bg-white p-[0.3vw]"
                  />
                ) : (
                  <span key={s.name} className="text-[1.4em] font-semibold">
                    {s.name}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function viewportWidth() {
  return typeof window !== "undefined" ? window.innerWidth : 1600;
}

function StatusBadge({ c }: { c: ChallengePublic }) {
  const live = c.status === "live";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-[0.5vw] rounded-full px-[1.1vw] py-[0.35vw] text-[1.3em] font-semibold",
        live ? "bg-[#ef3340] text-white" : "bg-white/10 text-white/80",
      )}
    >
      {live ? <span className="jf-live-dot h-[0.7vw] w-[0.7vw] rounded-full bg-white" /> : null}
      {c.final ? "Final results" : c.status === "verifying" ? "Checking scores" : STATUS_META[c.status].label}
    </span>
  );
}

function Hero({
  label,
  live,
  gold,
  children,
}: {
  label: string;
  live?: boolean;
  gold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-[1.4em] bg-white/[0.06] p-[1.6em] text-center">
      <p
        className={cn(
          "mb-[0.8em] flex items-center gap-[0.5em] text-[1.4em] font-semibold",
          gold ? "text-[#f5b301]" : "text-white/60",
        )}
      >
        {live ? <span className="jf-live-dot h-[0.8vw] w-[0.8vw] rounded-full bg-[#ef3340]" /> : null}
        {gold ? <Trophy className="h-[1.5vw] w-[1.5vw]" /> : null}
        {label}
      </p>
      {children}
    </div>
  );
}

function FlashRank({ rows, code, division }: { rows: RankRow[]; code: string; division: string | null }) {
  const r = rows.find((x) => x.code === code);
  const place = r ? (division ? r.rank_div : r.rank) : null;
  if (!place) return null;
  const shared = division ? r!.tied_div : r!.tied;
  return <p className="mt-[0.8vw] text-[2.4em] text-white/70">{placeLabel(place, shared)} on the board</p>;
}

/** A result that just landed stays big for a few seconds. */
function useFreshResult(latest: RecentAttempt | null): RecentAttempt | null {
  const seen = useRef<string | null>(null);
  const [shown, setShown] = useState<RecentAttempt | null>(null);
  useEffect(() => {
    if (!latest) return;
    if (seen.current === null) {
      seen.current = latest.id; // the first load isn't news
      return;
    }
    if (latest.id === seen.current) return;
    seen.current = latest.id;
    setShown(latest);
    const t = setTimeout(() => setShown(null), 12_000);
    return () => clearTimeout(t);
  }, [latest]);
  return shown;
}

function useNewLeaderName(rows: RankRow[]): string | null {
  const prev = useRef<Set<string> | null>(null);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!rows.length) return;
    const leaders = rows.filter((r) => r.rank === 1);
    const codes = new Set(leaders.map((r) => r.code));
    const before = prev.current;
    prev.current = codes;
    if (!before) return;
    const fresh = leaders.find((r) => !before.has(r.code));
    if (!fresh) return;
    setName(fresh.name);
    const t = setTimeout(() => setName(null), 8000);
    return () => clearTimeout(t);
  }, [rows]);
  return name;
}

function BigAvatar({ name, photo, gold }: { name: string; photo: string | null; gold?: boolean }) {
  const url = mediaUrl(photo);
  return (
    <span
      className={cn(
        "flex h-[8em] w-[8em] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 font-display text-white/70",
        gold && "ring-[0.35vw] ring-[#f5b301]",
      )}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-[3em] leading-none">{initialsOf(name)}</span>
      )}
    </span>
  );
}
