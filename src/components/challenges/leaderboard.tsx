/**
 * The leaderboard: the heart of a challenge's page. Ranked rows paged from the
 * database (5 athletes or 5,000 cost the same per page), search across the
 * whole event, "find my ranking" with the athletes around you and the score
 * you need for the next place, and live updates. Ranking is the database's.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUp, ChevronRight, Loader2, Search, Trophy, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AthleteAvatar,
  DivisionTabs,
  ScoreText,
  ago,
  useMounted,
  useNow,
} from "@/components/challenges/ui";
import { useAround, useBoardPages, useFindAthletes, useOnPlatform } from "@/lib/challenges/api";
import {
  athletes,
  hasBoard,
  isFresh,
  isProvisional,
  mergePages,
  placeOf,
  sharedOf,
  standingLine,
  type RankRow,
} from "@/lib/challenges/board";
import {
  clockTime,
  defaultDivision,
  formatScore,
  ordinal,
  type ChallengePublic,
  type RecentAttempt,
} from "@/lib/challenges/model";

type Props = {
  c: ChallengePublic;
  slug: string;
  /** This phone's / login's own entry, if any (never inferred from a name). */
  mine: string | null;
  /** Bump to open "find my ranking" from outside (the page's main button). */
  findMineNonce?: number;
};

export function Leaderboard({ c, slug, mine, findMineNonce = 0 }: Props) {
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  const [division, setDivision] = useState<string | null>(() => defaultDivision(c));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [flashCode, setFlashCode] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const enabled = hasBoard(c);
  const pages = useBoardPages(slug, division, start, c.status, enabled);
  const rows = useMemo(() => mergePages(pages.data?.pages ?? []), [pages.data]);
  const firstPage = pages.data?.pages[0] ?? null;
  const lastPage = pages.data?.pages[pages.data.pages.length - 1] ?? null;
  const total = lastPage?.total ?? firstPage?.total ?? 0;
  const windowStart = firstPage?.offset ?? start;
  const found = useFindAthletes(slug, debounced, division);
  const around = useAround(slug, focus, division);
  const now = useOnPlatform(slug, c.id, c.status);

  // keep the last "latest results" even when the board window isn't at the top
  const recentRef = useRef<RecentAttempt[]>([]);
  const top = pages.data?.pages.find((p) => p?.offset === 0);
  if (top?.recent) recentRef.current = top.recent;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  // the page's "Find my ranking" button
  useEffect(() => {
    if (!findMineNonce || !mine) return;
    setQuery("");
    setFocus(mine);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [findMineNonce, mine]);

  // after a jump, bring the athlete's row on screen once it has loaded
  useEffect(() => {
    if (!flashCode) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-code="${flashCode}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlashCode(null), 2400);
    return () => clearTimeout(t);
  }, [flashCode, rows]);

  const moved = useMovedUp(rows, division);
  const newLeader = useNewLeader(firstPage?.offset === 0 ? firstPage.rows : undefined);

  const searching = query.trim().length > 0;
  const jumpTo = (a: { pos?: number; division_id: string | null }, code: string) => {
    setDivision(a.division_id);
    setStart(Math.max(0, (a.pos ?? 1) - 1 - 8));
    setFlashCode(code);
  };
  const backToTop = () => {
    setStart(0);
    setFocus(null);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!enabled) return null;

  return (
    <section ref={rootRef} id="leaderboard" className="scroll-mt-16" aria-label="Leaderboard">
      <BoardStatus c={c} updatedAt={pages.dataUpdatedAt} total={total} />

      {now.data && isFresh(now.data, Date.now()) ? (
        <OnPlatformStrip n={now.data} c={c} />
      ) : null}

      {newLeader ? (
        <div
          role="status"
          className="jf-moment-in mb-3 flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-2 text-sm font-medium text-warning"
        >
          <Trophy className="h-4 w-4" /> New leader: {newLeader}
        </div>
      ) : null}

      {/* search: the whole event, not just the rows loaded */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search athlete name or bib…"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 rounded-xl pl-9 pr-10 text-base"
            aria-label="Search athlete name or bib number"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {mine && focus !== mine ? (
          <Button
            variant="outline"
            className="h-12 shrink-0 rounded-xl px-3"
            onClick={() => {
              setQuery("");
              setFocus(mine);
            }}
          >
            <UserRound className="mr-1.5 h-4 w-4" /> Me
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        <DivisionTabs
          divisions={c.divisions}
          value={division}
          onChange={(d) => {
            setDivision(d);
            setStart(0);
          }}
          allowAll={!c.separate_divisions}
        />
      </div>

      {searching ? (
        <SearchResults
          division={division}
          q={query}
          debounced={debounced}
          loading={found.isFetching}
          hits={found.data ?? null}
          c={c}
          mine={mine}
          onPick={(code) => {
            setQuery("");
            setFocus(code);
          }}
        />
      ) : (
        <>
          {focus ? (
            <FocusCard
              c={c}
              slug={slug}
              loading={around.isPending}
              data={around.data ?? null}
              isMine={focus === mine}
              onJump={(a, code) => jumpTo(a, code)}
              onClose={() => setFocus(null)}
            />
          ) : null}

          {pages.isPending ? (
            <BoardSkeleton />
          ) : !rows.length && windowStart === 0 ? (
            <EmptyBoard c={c} />
          ) : (
            <div className={cn(pages.isPlaceholderData && "opacity-60 transition-opacity")}>
              {windowStart > 0 ? (
                <div className="mb-2 flex gap-2">
                  <Button
                    variant="outline"
                    className="h-10 flex-1"
                    disabled={pages.isFetchingPreviousPage}
                    onClick={() => void pages.fetchPreviousPage()}
                  >
                    {pages.isFetchingPreviousPage ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Show places above
                  </Button>
                  <Button variant="ghost" className="h-10" onClick={backToTop}>
                    <ArrowUp className="mr-1.5 h-4 w-4" /> Top
                  </Button>
                </div>
              ) : null}
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div
                  className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-3 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground"
                  aria-hidden
                >
                  <span>Rank</span>
                  <span>Athlete</span>
                  <span>Result</span>
                </div>
                <ol ref={listRef} aria-label={c.final ? "Final results" : "Leaderboard"}>
                  {rows.map((r) => (
                    <BoardRowItem
                      key={r.code}
                      r={r}
                      slug={slug}
                      division={division}
                      shape={shape}
                      mine={r.code === mine}
                      focused={r.code === focus || r.code === flashCode}
                      moved={moved.has(r.code)}
                      divisionName={
                        division
                          ? null
                          : (c.divisions.find((d) => d.id === r.division_id)?.name ?? null)
                      }
                    />
                  ))}
                </ol>
              </div>
              <LoadMore
                hasMore={!!pages.hasNextPage}
                loading={pages.isFetchingNextPage}
                error={pages.isError}
                onMore={() => void pages.fetchNextPage()}
              />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {total
                  ? `Showing ${windowStart + 1}–${windowStart + rows.length} of ${athletes(total)} with a score`
                  : null}
              </p>
            </div>
          )}
        </>
      )}

      {!c.final && recentRef.current.length && !searching ? (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">Latest results</h3>
          <RecentResults recent={recentRef.current} c={c} division={division} slug={slug} />
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function BoardStatus({
  c,
  updatedAt,
  total,
}: {
  c: ChallengePublic;
  updatedAt: number;
  total: number;
}) {
  const mounted = useMounted();
  useNow(15_000);
  const provisional = isProvisional(c);
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">{c.final ? "Final results" : "Leaderboard"}</h2>
        <p className="text-xs text-muted-foreground">
          {c.final
            ? `Confirmed${mounted && c.results_final_at ? ` ${clockDate(c.results_final_at, c.timezone)}` : ""}`
            : provisional
              ? "Provisional until results are confirmed"
              : c.status === "draft"
                ? "Practice board: only staff see this"
                : `${athletes(total)} ranked`}
        </p>
      </div>
      {mounted && provisional ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {c.status === "live" ? (
            <>
              <span className="jf-live-dot h-2 w-2 rounded-full bg-primary" />
              <span className="text-foreground">Live</span>
            </>
          ) : c.status === "paused" ? (
            <span className="text-warning">Paused</span>
          ) : (
            <span className="text-warning">Checking scores</span>
          )}
          {updatedAt ? ` · ${clockTime(new Date(updatedAt).toISOString(), c.timezone)}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function clockDate(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: tz }).format(
      new Date(iso),
    );
  } catch {
    return "";
  }
}

/** "On the platform: Jared M. · 12 reps so far" while a judge is counting. */
function OnPlatformStrip({
  n,
  c,
}: {
  n: NonNullable<ReturnType<typeof useOnPlatform>["data"]>;
  c: ChallengePublic;
}) {
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5">
      <AthleteAvatar name={n.name} photo={n.photo} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">On the platform now</p>
        <p className="truncate text-sm font-semibold">
          {n.name} <span className="font-normal text-muted-foreground">#{n.bib}</span>
        </p>
      </div>
      {n.live_value != null ? (
        <div className="text-right">
          <ScoreText value={n.live_value} shape={shape} className="text-2xl" />
          <p className="text-[11px] text-muted-foreground">so far</p>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Attempt {n.attempt_no}</span>
      )}
    </div>
  );
}

function BoardRowItem({
  r,
  slug,
  division,
  shape,
  mine,
  focused,
  moved,
  divisionName,
}: {
  r: RankRow;
  slug: string;
  division: string | null;
  shape: { measure: ChallengePublic["measure"]; unit: ChallengePublic["unit"]; relative: boolean };
  mine: boolean;
  focused: boolean;
  moved: boolean;
  divisionName: string | null;
}) {
  const place = placeOf(r, division);
  const shared = sharedOf(r, division);
  return (
    <li
      data-code={r.code}
      className={cn(
        "border-b border-border last:border-b-0",
        moved && "jf-board-flash",
        mine && "bg-muted",
        focused && "bg-muted shadow-[inset_3px_0_0_var(--foreground)]",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 60px" }}
    >
      <Link
        to="/challenges/$slug/r/$code"
        params={{ slug, code: r.code }}
        className="grid min-h-[60px] grid-cols-[2.75rem_1fr_auto] items-center gap-3 px-3 py-2"
      >
        <RankCell place={place} shared={shared} />
        <span className="flex min-w-0 items-center gap-2.5">
          <AthleteAvatar
            name={r.name}
            photo={r.photo}
            size={34}
            medal={place && place <= 3 ? place : null}
          />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium leading-tight">
              {r.name}
              {mine ? (
                <span className="ml-1.5 rounded bg-foreground px-1 py-0.5 align-middle text-[10px] font-semibold text-background">
                  You
                </span>
              ) : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              #{r.bib}
              {divisionName ? ` · ${divisionName}` : ""}
            </span>
          </span>
        </span>
        <ScoreText value={r.score} shape={shape} className="text-xl" />
      </Link>
    </li>
  );
}

function RankCell({ place, shared }: { place: number | null; shared: boolean }) {
  if (!place) return <span className="text-sm text-muted-foreground">–</span>;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 font-display text-lg tabular-nums leading-none",
        place === 1 ? "text-warning" : place <= 3 ? "text-foreground" : "text-muted-foreground",
      )}
      aria-label={`${shared ? "Tied for " : ""}${ordinal(place)}`}
    >
      {shared ? <span className="font-sans text-[10px] font-semibold">T</span> : null}
      {place}
      {place === 1 ? <Trophy className="ml-0.5 h-3.5 w-3.5" /> : null}
    </span>
  );
}

function SearchResults({
  division,
  q,
  debounced,
  loading,
  hits,
  c,
  mine,
  onPick,
}: {
  division: string | null;
  q: string;
  debounced: string;
  loading: boolean;
  hits: RankRow[] | null;
  c: ChallengePublic;
  mine: string | null;
  onPick: (code: string) => void;
}) {
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  const tooShort = q.trim().length < 2 && !/^#?\d+$/.test(q.trim());
  const settled = debounced === q && !loading;
  if (tooShort) {
    return <p className="mt-3 px-1 text-sm text-muted-foreground">Keep typing…</p>;
  }
  if (!hits || (!settled && !hits.length)) {
    return (
      <div className="mt-3 flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Searching everyone in this event…
      </div>
    );
  }
  if (!hits.length) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nobody called “{q.trim()}” is in this event. Check the spelling, or try a bib number.
      </div>
    );
  }
  const names = new Map<string, number>();
  for (const h of hits) names.set(h.name.toLowerCase(), (names.get(h.name.toLowerCase()) ?? 0) + 1);
  return (
    <div className="mt-3">
      <p className="mb-2 px-1 text-xs text-muted-foreground">
        {hits.length === 20 ? "Top 20 matches" : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`}
        {[...names.values()].some((n) => n > 1) ? " · same name? Check the bib number" : ""}
      </p>
      <ul className="overflow-hidden rounded-2xl border border-border bg-card">
        {hits.map((h) => {
          const byDivision = !!division || c.separate_divisions;
          const place = byDivision ? h.rank_div : h.rank;
          const shared = byDivision ? h.tied_div : h.tied;
          return (
            <li key={h.code} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(h.code)}
                className="grid min-h-[60px] w-full grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-left active:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <AthleteAvatar name={h.name} photo={h.photo} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">
                      {h.name}
                      {h.code === mine ? (
                        <span className="ml-1.5 rounded bg-foreground px-1 py-0.5 align-middle text-[10px] font-semibold text-background">
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      #{h.bib}
                      {h.division ? ` · ${h.division}` : ""}
                    </span>
                  </span>
                </span>
                {h.score != null && place ? (
                  <span className="text-right">
                    <ScoreText value={h.score} shape={shape} className="text-lg" />
                    <span className="block text-xs text-muted-foreground">
                      {shared ? "T-" : ""}
                      {ordinal(place)}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">No score yet</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FocusCard({
  c,
  slug,
  loading,
  data,
  isMine,
  onJump,
  onClose,
}: {
  c: ChallengePublic;
  slug: string;
  loading: boolean;
  data: ReturnType<typeof useAround>["data"] | null;
  isMine: boolean;
  onJump: (a: { pos?: number; division_id: string | null }, code: string) => void;
  onClose: () => void;
}) {
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  if (loading) return <Skeleton className="mb-4 h-48 w-full rounded-2xl" />;
  if (!data) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-border p-4 text-sm text-muted-foreground">
        That athlete isn't on this board.
        <Button variant="ghost" className="h-10" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  const me = data.me;
  const place = me.place ?? null;
  const line = standingLine(me, place, !!me.shared, data.next, { ...shape, direction: c.direction });
  const divisionName = data.division_id
    ? c.divisions.find((d) => d.id === data.division_id)?.name
    : null;
  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4" aria-live="polite">
      <div className="flex items-start gap-3">
        <AthleteAvatar name={me.name} photo={me.photo} size={52} medal={place && place <= 3 ? place : null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold leading-tight">
            {me.name}
            {isMine ? <span className="ml-2 text-xs font-medium text-muted-foreground">You</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            #{me.bib}
            {divisionName ? ` · ${divisionName}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-2 -mt-2 flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground"
          aria-label="Back to the full leaderboard"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {me.score != null && place ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="font-display text-4xl leading-none tabular-nums">
                {me.shared ? "T-" : ""}
                {ordinal(place)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">of {athletes(data.total)}</p>
            </div>
            <ScoreText value={me.score} shape={shape} className="text-4xl" />
          </div>
          {line ? <p className="mt-2 text-sm">{line}</p> : null}
          <ol className="mt-3 overflow-hidden rounded-xl border border-border">
            {data.rows.map((r) => (
              <li
                key={r.code}
                className={cn(
                  "grid min-h-[44px] grid-cols-[2.5rem_1fr_auto] items-center gap-2 border-b border-border px-3 text-sm last:border-b-0",
                  r.code === me.code && "bg-muted font-semibold",
                )}
              >
                <span className="tabular-nums text-muted-foreground">
                  {r.shared ? "T-" : ""}
                  {r.place}
                </span>
                <span className="truncate">{r.name}</span>
                <span className="tabular-nums">{formatScore(r.score, shape)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => onJump({ pos: me.pos, division_id: data.division_id }, me.code)}
            >
              Show on board
            </Button>
            <Button asChild variant="outline" className="h-11">
              <Link to="/challenges/$slug/r/$code" params={{ slug, code: me.code }}>
                Result page <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-xl bg-muted px-3 py-3 text-sm">
          Registered. No score yet:{" "}
          {c.status === "live" ? "they'll appear here the moment a judge records it." : "scores open when the event starts."}
          <Link
            to="/challenges/$slug/r/$code"
            params={{ slug, code: me.code }}
            className="mt-2 flex items-center font-medium"
          >
            Entry page <ChevronRight className="ml-0.5 h-4 w-4" />
          </Link>
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-3 h-10 w-full rounded-lg text-sm text-muted-foreground hover:text-foreground"
      >
        Back to full leaderboard
      </button>
    </div>
  );
}

function EmptyBoard({ c }: { c: ChallengePublic }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <Trophy className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">No scores yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {c.status === "live" || c.status === "draft"
          ? "The board fills in the moment a judge records the first score."
          : `${athletes(c.registered)} registered so far.`}
      </p>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex h-[60px] items-center gap-3 border-b border-border px-3 last:border-b-0">
          <Skeleton className="h-5 w-6" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Loads the next page as the end of the board comes near; a button only after a failure. */
function LoadMore({
  hasMore,
  loading,
  error,
  onMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error: boolean;
  onMore: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const more = useRef(onMore);
  more.current = onMore;
  // Re-armed whenever a load ends: a live refresh can cancel a page load while
  // the end of the board stays on screen, and an observer only speaks on change.
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || error || loading || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) more.current();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, error, loading]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="flex justify-center py-3">
      {error ? (
        <Button variant="outline" className="h-10" onClick={onMore}>
          Couldn't load more. Try again
        </Button>
      ) : loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading more" />
      ) : (
        <Button variant="ghost" className="h-10 text-muted-foreground" onClick={onMore}>
          Show more
        </Button>
      )}
    </div>
  );
}

function RecentResults({
  recent,
  c,
  division,
  slug,
}: {
  recent: RecentAttempt[];
  c: ChallengePublic;
  division: string | null;
  slug: string;
}) {
  const shape = { measure: c.measure, unit: c.unit, relative: c.relative };
  const now = useNow(30_000);
  const mounted = useMounted();
  const list = recent.filter((r) => !r.tiebreak && (!division || r.division_id === division)).slice(0, 5);
  if (!list.length) return null;
  return (
    <ul className="space-y-1">
      {list.map((r) => (
        <li key={r.id}>
          <Link
            to="/challenges/$slug/r/$code"
            params={{ slug, code: r.code }}
            className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-1 text-sm"
          >
            <AthleteAvatar name={r.name} photo={r.photo} size={28} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.name}</span>{" "}
              <span className="text-muted-foreground">
                {r.valid ? formatScore(r.value, shape) : "no valid score"}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{mounted ? ago(r.at, now) : ""}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

/** Rows that moved up since the last refresh flash once. */
function useMovedUp(rows: RankRow[], division: string | null): Set<string> {
  const prev = useRef<{ division: string | null; at: Map<string, number> } | null>(null);
  const moved = useMemo(() => {
    const out = new Set<string>();
    const p = prev.current;
    if (p && p.division === division) {
      for (const r of rows) {
        const was = p.at.get(r.code);
        const place = placeOf(r, division) ?? 0;
        if (was != null && place < was) out.add(r.code);
      }
    }
    return out;
  }, [rows, division]);
  useEffect(() => {
    prev.current = {
      division,
      at: new Map(rows.map((r) => [r.code, placeOf(r, division) ?? 0])),
    };
  }, [rows, division]);
  return moved;
}

/** A new first place gets a moment on screen (not on the first load). */
function useNewLeader(top: RankRow[] | undefined): string | null {
  const prev = useRef<Set<string> | null>(null);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!top) return;
    const leaders = top.filter((r) => r.rank === 1);
    const codes = new Set(leaders.map((r) => r.code));
    if (prev.current) {
      const fresh = leaders.find((r) => !prev.current!.has(r.code));
      if (fresh) {
        setName(fresh.name);
        const t = setTimeout(() => setName(null), 6000);
        prev.current = codes;
        return () => clearTimeout(t);
      }
    }
    prev.current = codes;
  }, [top]);
  return name;
}
