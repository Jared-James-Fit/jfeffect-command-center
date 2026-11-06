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
  useRankedRows,
} from "@/components/challenges/ui";
import {
  challengeUrl,
  joinUrl,
  mediaUrl,
  track,
  useBoard,
  useChallenge,
  useLiveChallenge,
} from "@/lib/challenges/api";
import {
  STATUS_META,
  boardMoments,
  defaultDivision,
  formatScore,
  rankBadge,
  selfSignupOpen,
  type BoardMoment,
  type BoardRow,
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
  const board = useBoard(slug, c?.status, !!c);
  const [division, setDivision] = useState<string | null>(null);
  const [moment, setMoment] = useState<BoardMoment | null>(null);
  const prev = useRef<BoardRow[] | undefined>(undefined);
  useLiveChallenge(c?.id);
  useWakeLock();
  useNow(1000);

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
  useEffect(() => {
    const rows = board.data?.rows;
    if (!rows) return;
    const m = boardMoments(prev.current, rows);
    prev.current = rows;
    if (m.length) {
      setMoment(m.find((x) => x.kind === "new_leader") ?? m[0]!);
      const t = setTimeout(() => setMoment(null), 8000);
      return () => clearTimeout(t);
    }
  }, [board.data?.rows]);

  const rows = useRankedRows(board.data?.rows, division);

  if (!c) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#0b0b0d] text-white/60">
        {q.isPending ? "Loading…" : "Challenge not found."}
      </div>
    );
  }
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  const leader = rows[0];
  const latest = board.data?.recent?.find(
    (r) => !r.tiebreak && (!division || r.division_id === division),
  );
  const signup = selfSignupOpen(c);
  const qrUrl = signup ? joinUrl(slug, "display") : challengeUrl(slug, { src: "display" });
  const divisionLabel = c.divisions.find((d) => d.id === division);

  return (
    <div
      className="dark min-h-dvh overflow-hidden bg-[#0b0b0d] p-[2.5vw] text-white"
      style={{ fontSize: "clamp(12px, 1.1vw, 28px)" }}
    >
      <button
        type="button"
        onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
        className="fixed right-3 top-3 z-10 rounded-lg bg-white/10 p-2 text-white/70 hover:bg-white/20"
        aria-label="Full screen"
      >
        <Maximize className="h-4 w-4" />
      </button>

      {/* header */}
      <div className="flex items-start gap-[2vw]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[0.8vw]">
            <img src="/logo.png" alt="" className="h-[3vw] w-[3vw] rounded-lg" />
            <span className="text-[1.3em] font-black uppercase tracking-[0.3em] text-white/70">
              JF Effect
            </span>
            <span
              className={cn(
                "ml-[1vw] inline-flex items-center gap-[0.5vw] rounded-full px-[1vw] py-[0.3vw] text-[1.2em] font-bold uppercase",
                c.status === "live" ? "bg-[#ef3340] text-white" : "bg-white/10 text-white/80",
              )}
            >
              {c.status === "live" ? (
                <span className="jf-live-dot h-[0.7vw] w-[0.7vw] rounded-full bg-white" />
              ) : null}
              {c.final ? "Final results" : STATUS_META[c.status].label}
            </span>
          </div>
          <h1 className="mt-[1vw] font-display text-[5.2em] uppercase leading-[0.9] tracking-wide">
            {c.title}
          </h1>
          <p className="mt-[0.5vw] text-[1.6em] text-white/60">
            {[c.load_label, c.objective, divisionLabel ? divisionLabel.name : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-[1.5vw]">
          {c.status === "upcoming" && c.starts_at ? (
            <Countdown to={c.starts_at} label="Starts in" size="xl" />
          ) : null}
          {c.status === "live" && c.ends_at ? (
            <Countdown to={c.ends_at} label="Ends in" size="xl" />
          ) : null}
          <div className="text-center">
            <QrImage
              value={qrUrl}
              size={Math.round(
                Math.min(220, (typeof window !== "undefined" ? window.innerWidth : 1600) * 0.11),
              )}
              label={signup ? "Scan to enter" : "Scan for the live board"}
            />
            <p className="mt-[0.4vw] text-[1.2em] font-semibold text-white/80">
              {signup ? "Scan to enter" : "Scan for the live board"}
            </p>
          </div>
        </div>
      </div>

      {moment ? (
        <div className="jf-moment-in mt-[1.5vw] flex items-center gap-[1vw] rounded-[1vw] bg-[#f5b301] px-[2vw] py-[1vw] text-[2.4em] font-black uppercase text-black">
          <Trophy className="h-[2.4vw] w-[2.4vw]" />
          {moment.kind === "new_leader"
            ? `New leader: ${moment.name}`
            : `${moment.name} moves into the top three`}
        </div>
      ) : null}

      <div className="mt-[2vw] grid grid-cols-[1fr_1.35fr] gap-[2vw]">
        {/* leader + latest */}
        <div className="space-y-[2vw]">
          <div className="rounded-[1.5vw] bg-white/[0.06] p-[2vw]">
            <p className="flex items-center gap-[0.6vw] text-[1.4em] font-bold uppercase tracking-wider text-[#f5b301]">
              <Trophy className="h-[1.6vw] w-[1.6vw]" />{" "}
              {c.final ? (leader?.shared ? "Co-champion" : "Champion") : "Leader"}
            </p>
            {leader ? (
              <div className="mt-[1vw] flex items-center gap-[1.5vw]">
                <BigAvatar name={leader.name} photo={leader.photo} />
                <div className="min-w-0">
                  <p className="truncate text-[3.4em] font-bold leading-tight">{leader.name}</p>
                  <ScoreText
                    value={leader.score}
                    shape={shape}
                    className="text-[6em] leading-none"
                    unitClassName="text-white/60"
                  />
                </div>
              </div>
            ) : (
              <p className="mt-[1vw] text-[2.2em] text-white/50">Waiting for the first score</p>
            )}
          </div>
          {latest ? (
            <div className="rounded-[1.5vw] bg-white/[0.06] p-[2vw]">
              <p className="text-[1.3em] font-bold uppercase tracking-wider text-white/50">
                Just verified
              </p>
              <div className="mt-[0.8vw] flex items-center gap-[1vw]">
                <AthleteAvatar name={latest.name} photo={latest.photo} size={64} />
                <p className="flex-1 truncate text-[2.4em] font-semibold">{latest.name}</p>
                <p className="text-[2.8em] font-display">
                  {latest.valid ? formatScore(latest.value, shape) : "No lift"}
                </p>
              </div>
            </div>
          ) : null}
          {c.sponsors.length ? (
            <div className="flex flex-wrap items-center gap-[1.5vw] opacity-80">
              <span className="text-[1.2em] uppercase tracking-wider text-white/50">
                Supported by
              </span>
              {c.sponsors.map((s) =>
                s.logo_path ? (
                  <img
                    key={s.name}
                    src={mediaUrl(s.logo_path) ?? ""}
                    alt={s.name}
                    className="h-[3vw] w-auto rounded bg-white p-[0.3vw]"
                  />
                ) : (
                  <span key={s.name} className="text-[1.6em] font-semibold">
                    {s.name}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>

        {/* top ten */}
        <ol className="space-y-[0.6vw]">
          {rows.slice(0, 8).map((r) => (
            <li
              key={r.code}
              className={cn(
                "flex items-center gap-[1.2vw] rounded-[1vw] px-[1.5vw] py-[0.45vw]",
                r.place <= 3 ? "bg-white/[0.1]" : "bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "w-[4vw] text-[2.4em] font-black tabular-nums",
                  r.place === 1 ? "text-[#f5b301]" : r.place <= 3 ? "text-white" : "text-white/50",
                )}
              >
                {rankBadge(r.place, r.shared)}
              </span>
              <AthleteAvatar name={r.name} photo={r.photo} size={56} />
              <span className="min-w-0 flex-1 truncate text-[2.2em] font-semibold">{r.name}</span>
              <ScoreText
                value={r.score}
                shape={shape}
                className="text-[3em]"
                unitClassName="text-white/50"
              />
            </li>
          ))}
          {!rows.length ? (
            <li className="rounded-[1vw] bg-white/[0.04] p-[2vw] text-[2em] text-white/50">
              The board fills in as judges record scores.
            </li>
          ) : null}
          {rows.length > 8 ? (
            <li className="px-[1.5vw] text-[1.6em] text-white/50">
              + {rows.length - 8} more on the board · {board.data?.registered ?? 0} registered
            </li>
          ) : null}
        </ol>
      </div>
    </div>
  );
}

function BigAvatar({ name, photo }: { name: string; photo: string | null }) {
  const url = mediaUrl(photo);
  return (
    <span className="flex h-[9vw] w-[9vw] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 font-display text-[3.6em] text-white/70 ring-[0.35vw] ring-[#f5b301]">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
}
