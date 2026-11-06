import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatScore, rankLabel, scoreParts } from "@/lib/challenges/format";
import type { BoardData, BoardRow, Division, ScoreSpec } from "@/lib/challenges/types";
import { AthleteAvatar } from "./ui";

/** Remembers each bib's last rank and marks who moved up, for a few seconds. */
function useMovers(rows: BoardRow[], live: boolean) {
  const prev = useRef<Map<number, number> | null>(null);
  const [moved, setMoved] = useState<Map<number, number>>(new Map());
  const [leaderFlash, setLeaderFlash] = useState(false);
  useEffect(() => {
    const now = new Map(rows.map((r) => [r.bib, r.rank]));
    const before = prev.current;
    prev.current = now;
    if (!before || !live) return;
    const ups = new Map<number, number>();
    for (const r of rows) {
      const was = before.get(r.bib);
      if (was == null) ups.set(r.bib, 0); // new on the board
      else if (r.rank < was) ups.set(r.bib, was - r.rank);
    }
    if (!ups.size) return;
    setMoved(ups);
    const leader = rows.find((r) => r.rank === 1);
    if (leader && before.get(leader.bib) !== 1) {
      setLeaderFlash(true);
      toast(`New leader: ${leader.name}`, { icon: "👑" });
    } else {
      const podium = rows.find((r) => r.rank <= 3 && ups.has(r.bib));
      if (podium) toast(`${podium.name} moves into ${podium.rank === 2 ? "2nd" : "3rd"}`, { icon: "🔥" });
    }
    const t = setTimeout(() => {
      setMoved(new Map());
      setLeaderFlash(false);
    }, 6000);
    return () => clearTimeout(t);
  }, [rows, live]);
  return { moved, leaderFlash };
}

function Podium({ rows, spec, slug, mine }: { rows: BoardRow[]; spec: ScoreSpec; slug: string; mine?: string | null }) {
  const top = rows.slice(0, 3);
  if (top.length < 2) return null;
  // 2nd, 1st, 3rd
  const order = [top[1], top[0], top[2]].filter(Boolean) as BoardRow[];
  return (
    <div className="grid grid-cols-3 items-end gap-2 pt-2">
      {order.map((r) => {
        const first = r === top[0];
        const s = scoreParts(r.score, spec);
        const inner = (
          <div className={cn("flex flex-col items-center gap-1.5 text-center", mine && r.handle === mine && "rounded-xl ring-2 ring-primary/40")}>
            <div className="relative">
              {first && <Crown className="absolute -top-5 left-1/2 h-5 w-5 -translate-x-1/2 text-warning" aria-hidden />}
              <AthleteAvatar name={r.name} photo={r.photo} size={first ? 76 : 58} ring={first} />
            </div>
            <div className="w-full truncate text-sm font-semibold">{r.name}</div>
            <div className="font-display text-3xl leading-none tabular-nums">
              {s.value}
              {s.unit && <span className="ml-1 font-sans text-xs font-semibold uppercase text-muted-foreground">{s.unit}</span>}
            </div>
            <div
              className={cn(
                "mt-1 flex w-full items-center justify-center rounded-t-xl font-display text-xl",
                first ? "h-16 bg-foreground text-background" : "h-11 bg-muted text-foreground",
              )}
            >
              {rankLabel(r.rank, r.tied)}
            </div>
          </div>
        );
        return r.handle ? (
          <Link key={r.bib} to="/challenges/$slug/$handle" params={{ slug, handle: r.handle }} className="min-w-0">
            {inner}
          </Link>
        ) : (
          <div key={r.bib} className="min-w-0">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export function Leaderboard({
  board,
  spec,
  divisions,
  slug,
  live,
  mine,
}: {
  board: BoardData;
  spec: ScoreSpec;
  divisions: Division[];
  slug: string;
  live: boolean;
  mine?: string | null;
}) {
  const [division, setDivision] = useState<string | "all">("all");
  const [q, setQ] = useState("");
  const { moved, leaderFlash } = useMovers(board.rows, live);
  const multi = divisions.length > 1;

  const rows = useMemo(() => {
    let r = board.rows;
    if (division !== "all") {
      r = r
        .filter((x) => x.division_id === division)
        .map((x) => ({ ...x, rank: x.division_rank, tied: x.division_tied }))
        .sort((a, b) => a.rank - b.rank || a.bib - b.bib);
    }
    return r;
  }, [board.rows, division]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(t) || String(r.bib) === t.replace(/^#/, ""));
  }, [rows, q]);

  const divName = (id: string | null) => divisions.find((d) => d.id === id)?.name ?? null;

  return (
    <div className="space-y-4">
      {multi && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist" aria-label="Division">
          {[{ id: "all", name: "Overall" }, ...divisions].map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={division === d.id}
              onClick={() => setDivision(d.id)}
              className={cn(
                "h-10 shrink-0 rounded-full border px-4 text-sm font-semibold",
                division === d.id ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-secondary",
              )}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {board.status === "live" ? "No verified scores yet. The board fills in as the judges save results." : "No results here yet."}
        </div>
      ) : (
        <>
          {!q && <div className={cn(leaderFlash && "animate-[jf-leader-pop_900ms_ease-out]")}><Podium rows={rows} spec={spec} slug={slug} mine={mine} /></div>}

          {rows.length > 8 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name or bib" className="h-11 pl-9 text-base" aria-label="Find an athlete" />
            </div>
          )}

          <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {shown.map((r) => {
              const up = moved.get(r.bib);
              const isMine = !!mine && r.handle === mine;
              const row = (
                <div
                  className={cn(
                    "flex min-h-[60px] items-center gap-3 px-3 py-2.5",
                    up != null && "animate-[jf-row-flash_2.4s_ease-out]",
                    isMine && "bg-primary/[0.06]",
                  )}
                >
                  <span
                    className={cn(
                      "w-9 shrink-0 text-center font-display text-xl tabular-nums",
                      r.rank === 1 ? "text-warning" : r.rank <= 3 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {rankLabel(r.rank, r.tied)}
                  </span>
                  <AthleteAvatar name={r.name} photo={r.photo} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{r.name}</span>
                      {isMine && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">You</span>}
                      {up != null && (
                        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-bold text-success">{up === 0 ? "NEW" : `▲${up}`}</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      #{r.bib}
                      {multi && division === "all" && divName(r.division_id) ? ` · ${divName(r.division_id)}` : ""}
                      {r.attempts.length > 1 ? ` · ${r.attempts.map((a) => (a.r === "valid" ? formatScore(a.v, spec).split(" ")[0] : "✗")).join(" / ")}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-right font-display text-2xl tabular-nums leading-none">
                    {scoreParts(r.score, spec).value}
                    <span className="ml-1 font-sans text-[11px] font-semibold uppercase text-muted-foreground">{scoreParts(r.score, spec).unit}</span>
                  </span>
                </div>
              );
              return (
                <li key={r.bib}>
                  {r.handle ? (
                    <Link to="/challenges/$slug/$handle" params={{ slug, handle: r.handle }} className="block hover:bg-secondary/50">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
            {shown.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nobody by that name on the board.</li>}
          </ol>
        </>
      )}
    </div>
  );
}

export function RecentResults({ board, spec, slug }: { board: BoardData; spec: ScoreSpec & { timezone?: string }; slug: string }) {
  if (!board.recent.length) return null;
  return (
    <ul className="space-y-2">
      {board.recent.slice(0, 6).map((r, i) => {
        const body = (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <AthleteAvatar name={r.name} photo={r.photo} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: spec.timezone }).format(new Date(r.at))}
                {r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}
              </div>
            </div>
            {r.result === "valid" ? (
              <span className="font-display text-xl tabular-nums">{formatScore(r.value, spec)}</span>
            ) : (
              <span className="text-sm font-semibold text-muted-foreground">No lift</span>
            )}
          </div>
        );
        return (
          <li key={`${r.bib}-${r.at}-${i}`}>
            {r.handle ? (
              <Link to="/challenges/$slug/$handle" params={{ slug, handle: r.handle }}>
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
