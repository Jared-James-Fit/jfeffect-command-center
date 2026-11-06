// The venue's TV: always dark, readable from the back of the room, live.
// Names and scores only; nothing private ever reaches this screen.
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaUrl, track, useBoard, useChallengeLive, usePage } from "@/lib/challenges/api";
import { countdownText, formatScore, objectiveText, rankLabel, scoreParts } from "@/lib/challenges/format";
import { challengeUrl, displayUrl } from "@/lib/challenges/share";
import type { BoardData, ChallengePageData } from "@/lib/challenges/types";
import { initials } from "@/lib/challenges/share";

function Face({ name, photo, size }: { name: string; photo: string | null; size: number }) {
  const url = mediaUrl(photo);
  return (
    <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 font-display text-white/70" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function LiveDisplay({ slug, initialPage, initialBoard }: { slug: string; initialPage: ChallengePageData | null; initialBoard: BoardData | null }) {
  const pageQ = usePage(slug, initialPage);
  const page = pageQ.data ?? initialPage;
  const boardQ = useBoard(slug, true, initialBoard);
  const board = boardQ.data ?? initialBoard;
  const c = page?.challenge;
  const [flash, setFlash] = useState<string | null>(null);
  const lastSeen = useRef<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  useChallengeLive(c?.id);

  useEffect(() => {
    track(slug, "display_open", { source: "display" });
    QRCode.toDataURL(challengeUrl(slug, { src: "qr" }), { margin: 1, width: 360, color: { dark: "#000000", light: "#ffffff" } }).then(setQr, () => undefined);
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [slug]);

  // the newest verified result flashes big for a few seconds
  const latest = board?.recent[0];
  useEffect(() => {
    if (!latest) return;
    const key = `${latest.bib}-${latest.at}`;
    if (lastSeen.current && lastSeen.current !== key) {
      setFlash(key);
      const t = setTimeout(() => setFlash(null), 7000);
      lastSeen.current = key;
      return () => clearTimeout(t);
    }
    lastSeen.current = key;
  }, [latest]);

  const rows = useMemo(() => (board?.rows ?? []).slice(0, 10), [board]);

  if (!page || !c) return <div className="flex h-dvh items-center justify-center bg-black text-white">Challenge not found</div>;

  const target = c.status === "upcoming" ? c.starts_at : c.status === "live" ? c.ends_at : null;
  // clocks only on the screen itself (the server's clock isn't the venue's)
  const left = target && now != null ? new Date(target).getTime() - now : 0;
  const prize = page.prizes.find((p) => p.place === 1)?.title;

  return (
    <div className="dark fixed inset-0 overflow-hidden bg-[#0b0b0d] text-white" style={{ fontSize: "clamp(12px, 1.25vw, 28px)" }}>
      <button
        type="button"
        onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}
        className="absolute right-[1em] top-[1em] z-10 rounded-lg bg-white/10 p-[0.5em] opacity-40 hover:opacity-100"
        aria-label="Full screen"
      >
        <Maximize2 className="h-[1.2em] w-[1.2em]" />
      </button>
      <div className="grid h-full grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-[2em] p-[2.2em]">
        {/* left: the event */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-[0.8em]">
            <img src="/icon-192.png" alt="" className="h-[2.6em] w-[2.6em] rounded-[0.6em]" />
            <span className="font-display text-[1.8em] uppercase tracking-wide">JF Effect</span>
            {c.status === "live" && (
              <span className="ml-auto inline-flex items-center gap-[0.4em] rounded-full bg-[#e0262f] px-[0.9em] py-[0.3em] text-[0.9em] font-bold uppercase tracking-[0.14em]">
                <span className="h-[0.55em] w-[0.55em] animate-pulse rounded-full bg-white" /> Live
              </span>
            )}
          </div>
          <h1 className="mt-[0.8em] font-display text-[4.4em] uppercase leading-[0.92]">{c.title}</h1>
          <p className="mt-[0.5em] text-[1.3em] text-white/70">{objectiveText(c)}</p>
          {prize && <p className="mt-[0.4em] text-[1.3em] font-semibold text-[#f5b301]">Prize: {prize}</p>}

          {left > 0 && (
            <div className="mt-[1.2em]">
              <div className="text-[0.9em] font-bold uppercase tracking-[0.16em] text-white/50">{c.status === "upcoming" ? "Starts in" : "Ends in"}</div>
              <div className="font-display text-[4em] leading-none tabular-nums">{countdownText(left)}</div>
            </div>
          )}

          {board?.now_up && (
            <div className="mt-[1.4em] flex items-center gap-[1em] rounded-[1em] bg-white/[0.06] p-[1em]">
              <Face name={board.now_up.name} photo={board.now_up.photo} size={72} />
              <div className="min-w-0">
                <div className="text-[0.85em] font-bold uppercase tracking-[0.16em] text-[#e0262f]">On the platform</div>
                <div className="truncate font-display text-[2.4em] uppercase leading-none">{board.now_up.name}</div>
              </div>
            </div>
          )}

          <div className="mt-auto flex items-end gap-[1.2em]">
            {qr && <img src={qr} alt="" className="h-[9em] w-[9em] rounded-[0.6em] bg-white p-[0.3em]" />}
            <div>
              <div className="font-display text-[1.8em] uppercase leading-none">Scan to enter & follow live</div>
              <div className="mt-[0.3em] text-[1.2em] text-white/60">{displayUrl(slug)}</div>
              {page.sponsors.length > 0 && (
                <div className="mt-[0.8em] flex flex-wrap items-center gap-[1em]">
                  {page.sponsors.map((s) =>
                    s.logo_path ? (
                      <img key={s.id} src={mediaUrl(s.logo_path)!} alt={s.name} className="h-[2.4em] w-auto rounded bg-white/90 p-[0.2em]" />
                    ) : (
                      <span key={s.id} className="text-[1.1em] font-semibold text-white/70">
                        {s.name}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* right: the board */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-[0.8em] flex items-baseline justify-between">
            <h2 className="font-display text-[2em] uppercase">{board?.final ? "Final standings" : "Leaderboard"}</h2>
            <span className="text-[1em] text-white/50">{board?.registered ?? 0} athletes</span>
          </div>
          {rows.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-[1em] border border-white/10 text-[1.6em] text-white/50">
              {c.status === "upcoming" ? "Scores appear here live" : "Waiting for the first verified score"}
            </div>
          ) : (
            <ol className="flex min-h-0 flex-1 flex-col gap-[0.45em]">
              {rows.map((r) => {
                const s = scoreParts(r.score, c);
                return (
                  <li
                    key={r.bib}
                    className={cn(
                      "flex flex-1 items-center gap-[1em] rounded-[0.8em] px-[1em]",
                      r.rank === 1 ? "bg-[#f5b301] text-black" : "bg-white/[0.06]",
                      flash && latest && latest.bib === r.bib && "animate-[jf-row-flash_2.4s_ease-out] ring-2 ring-[#22c55e]",
                    )}
                    style={{ maxHeight: "4.8em" }}
                  >
                    <span className="w-[2.2em] text-center font-display text-[2em] tabular-nums">{rankLabel(r.rank, r.tied)}</span>
                    <Face name={r.name} photo={r.photo} size={48} />
                    <span className="min-w-0 flex-1 truncate text-[1.6em] font-semibold">{r.name}</span>
                    <span className="font-display text-[2.4em] tabular-nums">{s.value}</span>
                    {s.unit && <span className={cn("w-[3.2em] text-[0.95em] font-bold uppercase", r.rank === 1 ? "text-black/60" : "text-white/50")}>{s.unit}</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {flash && latest && latest.result === "valid" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[2em] flex justify-center">
          <div className="animate-[jf-score-in_500ms_ease-out] rounded-[1em] bg-white px-[2em] py-[1em] text-black">
            <span className="font-display text-[2.6em] uppercase">
              {latest.name} · {formatScore(latest.value, c)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
