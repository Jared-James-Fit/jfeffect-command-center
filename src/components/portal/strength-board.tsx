import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronRight, Crown, Dumbbell, Info, Landmark, Loader2, Medal, ShieldCheck, Trophy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { usePortalUserId } from "@/lib/client-impersonation";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CoachTag } from "@/components/portal/coach-tag";
import { ATHLETE_SEX_KEYS, SexChoice } from "@/components/athlete-sex";
import { saveMySexFn } from "@/lib/athlete-sex.functions";
import type { AthleteSex } from "@/lib/athlete-sex";
import { useWeightUnit } from "@/lib/use-weight-unit";
import type { WeightUnit } from "@/lib/weight-lifted";
import {
  BOARD_LIFTS,
  LIFT_NAME,
  TOP,
  formatLoad,
  formatMultiple,
  gapToTop10,
  meStatus,
  meetHistory,
  normalizeMeetRow,
  normalizeAllRow,
  pickBoard,
  rankOf,
  totalClub,
  type BoardLift,
  type BoardMode,
  type BoardSource,
  type Division,
  type StrengthRow,
} from "@/lib/strength-board";

const db = supabase as any;

function useStrengthBoard() {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["strength-board", "all", viewerId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_strength_board_all", viewerId ? { _as_user: viewerId } : {});
      if (error) throw error;
      return ((data ?? []) as any[]).map(normalizeAllRow);
    },
  });
}

function useMeetBoard() {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["strength-board", "meets", viewerId],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_strength_board_meets", viewerId ? { _as_user: viewerId } : {});
      if (error) throw error;
      return ((data ?? []) as any[]).map(normalizeMeetRow);
    },
  });
}

function useIsStaff() {
  const { role } = useAuth();
  return role === "admin" || role === "coach";
}

const MEDAL = ["text-amber-400", "text-slate-300", "text-orange-400"];

function LifterAvatar({ row, size }: { row: StrengthRow; size: string }) {
  return (
    <Avatar className={cn(size, "border border-border")}>
      {row.avatar_url && <AvatarImage src={row.avatar_url} alt={row.display_name} />}
      <AvatarFallback className="text-xs font-bold">{row.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** The number a row is ranked by, big: x bodyweight for pound for pound, the weight (and its reps) for absolute. */
function Headline({ row, mode, unit }: { row: StrengthRow; mode: BoardMode; unit: WeightUnit }) {
  if (mode === "p4p") {
    return (
      <>
        {formatMultiple(row.bw_multiple)}
        <span className="ml-0.5 text-[0.6em] font-black text-muted-foreground">BW</span>
      </>
    );
  }
  return (
    <>
      {formatLoad(row.kg, unit)}
      {row.reps && row.reps > 1 ? <span className="ml-1 text-[0.7em] font-black text-primary">×{row.reps}</span> : null}
    </>
  );
}

function XBadge({ row, className }: { row: StrengthRow; className?: string }) {
  const x = formatMultiple(row.bw_multiple);
  if (!x) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-primary", className)}>
      {x} BW
    </span>
  );
}

function ClubBadge({ row }: { row: StrengthRow }) {
  const club = row.lift === "total" ? totalClub(row.kg) : null;
  if (!club) return null;
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[8px] font-black tracking-wide text-amber-500">
      {club}
    </span>
  );
}

/** All-time board only: where the number was made. */
function SourceTag({ row }: { row: StrengthRow }) {
  return row.source === "meet" ? (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[8px] font-black tracking-wide text-amber-600 dark:text-amber-400">
      <Landmark className="h-2.5 w-2.5" /> MEET
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[8px] font-black tracking-wide text-muted-foreground">
      <Dumbbell className="h-2.5 w-2.5" /> TRAINING
    </span>
  );
}

function AlumniTag({ row }: { row: StrengthRow }) {
  if (!row.is_alumni) return null;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[8px] font-black tracking-wide text-muted-foreground">
      ALUMNI
    </span>
  );
}

/** Everything behind the headline number, smallest first. */
function subline(row: StrengthRow, mode: BoardMode, unit: WeightUnit) {
  const parts: string[] = [];
  if (mode === "p4p") parts.push(`${formatLoad(row.kg, unit)}${row.reps && row.reps > 1 ? ` ×${row.reps}` : ""}`);
  if (row.bw_kg) parts.push(`@ ${formatLoad(row.bw_kg, unit)} BW`);
  if (row.meet) {
    parts.push([row.meet.name, row.meet.federation].filter(Boolean).join(" "));
    parts.push(format(new Date(row.lifted_at), "yyyy"));
    if (row.meet.gl_points) parts.push(`${row.meet.gl_points.toFixed(1)} GL`);
  } else {
    parts.push(format(new Date(row.lifted_at), "MMM yyyy"));
  }
  return parts.join(" · ");
}

// ── Home card ──────────────────────────────────────────────────────────────

export function StrengthBoardCard() {
  const [open, setOpen] = useState(false);
  const { data = [], isPending } = useStrengthBoard();
  const { data: meets = [] } = useMeetBoard();
  const { unit } = useWeightUnit();
  const myP4p = data.find((r) => r.is_me && r.lift === "total" && r.p4p_rank != null)?.p4p_rank ?? null;
  const myAbs = data.find((r) => r.is_me && r.lift === "total" && r.all_rank != null)?.all_rank ?? null;
  const p4pKing = pickBoard(data, "p4p", "total", "all").top[0] ?? null;
  const absKing = pickBoard(data, "absolute", "total", "all").top[0] ?? null;
  const history = meetHistory(meets);

  if (!isPending && data.length === 0 && meets.length === 0) return null;

  const myLine = myP4p || myAbs
    ? `You: ${[myP4p && `#${myP4p} pound for pound`, myAbs && `#${myAbs} total`].filter(Boolean).join(" · ")}`
    : data.some((r) => r.is_me)
      ? "See where you rank"
      : "Get on the board";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-amber-400/15 via-transparent to-transparent px-4 pb-3 pt-4">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">All-time strength board</div>
            <div className="mt-0.5 text-lg font-black leading-tight">Hall of Strength</div>
            <div className="text-[11px] text-muted-foreground">Every JF Effect athlete · gym + meets</div>
          </div>
          <Trophy className="h-7 w-7 shrink-0 text-amber-400" />
        </div>
        <div className="grid grid-cols-2 border-t">
          <KingTile label="Pound for pound #1" row={p4pKing} loading={isPending}
            value={p4pKing ? <>{formatMultiple(p4pKing.bw_multiple)}<span className="ml-0.5 text-[10px] font-black text-muted-foreground">BW</span></> : null} />
          <KingTile label="Heaviest total #1" row={absKing} loading={isPending} className="border-l"
            value={absKing ? formatLoad(absKing.kg, unit) : null} />
        </div>
        {history.athletes > 0 && (
          <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
            <Landmark className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="truncate"><b className="text-foreground">Competition:</b> {history.athletes} athletes · {history.meets} meets{history.since ? ` since ${history.since}` : ""}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs font-bold">
          <span className={cn(myP4p || myAbs ? "text-foreground" : "text-primary")}>{myLine}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl pb-safe-bottom">
          <HallOfStrength />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The Hall of Strength as a slide in Home's standings card: the two #1s and
 * where you stand. Tap for the full board.
 */
export function StrengthBoardSlide() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BoardMode>("p4p");
  const [lift, setLift] = useState<BoardLift>("total");
  const [division, setDivision] = useState<Division>("all");
  const { data = [], isPending } = useStrengthBoard();
  const { unit } = useWeightUnit();
  // The card's Top 5 for the board you pick; Open shows that same board in full.
  const { top: top5, me, count } = pickBoard(data, mode, lift, division, 5);
  const status = meStatus(me, mode, lift, division);
  const myLine =
    status.kind === "ranked" ? `You're #${status.rank} of ${status.count ?? count} on this board`
    : status.kind === "no-bodyweight" ? "Log your bodyweight to rank pound for pound"
    : status.kind === "no-division" ? "Pick Men or Women in your profile to rank here"
    : status.kind === "other-division" ? `${count} on this board`
    : "You're not on this board yet";
  const chip = (on: boolean) => cn("min-h-8 flex-1 rounded-full text-[12px] font-bold transition", on ? "bg-foreground text-background" : "text-muted-foreground active:bg-muted");

  return (
    <>
      <div className="flex h-full flex-col">
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-start justify-between gap-3 px-4 pt-3 text-left active:opacity-70">
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">All-time strength board</span>
            <span className="mt-0.5 block text-lg font-bold tracking-tight">Hall of Strength</span>
            <span className="block text-[11px] text-muted-foreground">Every JF Effect athlete · gym + meets</span>
          </span>
          <Trophy className="h-6 w-6 shrink-0 text-amber-400" />
        </button>
        <div className="mx-3 mt-2.5 space-y-1.5">
          <div className="grid grid-cols-2 rounded-full bg-muted/50 p-1 text-xs font-bold" role="tablist" aria-label="Ranked by">
            {([["p4p", "Pound for pound"], ["absolute", "Heaviest"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={cn("min-h-8 rounded-full transition", mode === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Lift">
            {BOARD_LIFTS.map((l) => (
              <button key={l.key} type="button" role="tab" aria-selected={lift === l.key} onClick={() => setLift(l.key)} className={chip(lift === l.key)}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Division">
            {([["all", "All"], ["male", "Men"], ["female", "Women"]] as const).map(([d, label]) => (
              <button key={d} type="button" role="tab" aria-selected={division === d} onClick={() => setDivision(d)} className={chip(division === d)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {isPending ? (
          <div className="mx-3 mt-2 h-48 animate-pulse rounded-xl bg-muted/40" />
        ) : top5.length === 0 ? (
          <button type="button" onClick={() => setOpen(true)} className="mx-3 mt-2 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
            Nobody's on this board yet. Be the first.
          </button>
        ) : (
          <ol className="mx-3 mt-2 divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/25">
            {top5.map((r) => {
              const rank = rankOf(r, mode, division)!;
              return (
                <li key={r.key}>
                  <button type="button" onClick={() => setOpen(true)} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left active:bg-muted", r.is_me && "bg-primary/10")}>
                    <span className="w-6 shrink-0 text-center text-sm leading-none">
                      {rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : <span className="text-[12px] font-black tabular-nums text-muted-foreground">{rank}</span>}
                    </span>
                    <LifterAvatar row={r} size="h-7 w-7 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{r.display_name}{r.is_me ? " (You)" : ""}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {r.source === "meet" ? "Meet" : "Training"}
                        {mode === "p4p"
                          ? ` · ${formatLoad(r.kg, unit)}${r.reps && r.reps > 1 ? ` ×${r.reps}` : ""}`
                          : r.bw_multiple ? ` · ${formatMultiple(r.bw_multiple)} BW` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-black tabular-nums">
                      {mode === "p4p"
                        ? <>{formatMultiple(r.bw_multiple)}<span className="ml-0.5 text-[9px] text-muted-foreground">BW</span></>
                        : <>{formatLoad(r.kg, unit)}{r.reps && r.reps > 1 ? <span className="ml-0.5 text-[10px] text-primary">×{r.reps}</span> : null}</>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-auto space-y-2 px-3 pb-3 pt-2.5">
          <p className={cn("px-1 text-center text-[13px] font-semibold", status.kind === "ranked" ? "text-foreground" : "text-muted-foreground")}>{myLine}</p>
          {/* Same button as the League card: everyone on this board, the board you picked. */}
          <button type="button" onClick={() => setOpen(true)} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl border bg-background text-sm font-bold text-primary active:bg-muted">
            Full standings{count > 0 ? ` · ${count}` : ""} <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl pb-safe-bottom">
          <HallOfStrength initialMode={mode} initialLift={lift} initialDivision={division} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function KingTile({ label, row, value, loading, className }: {
  label: string; row: StrengthRow | null; value: ReactNode; loading: boolean; className?: string;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-3", className)}>
      <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
        <Crown className="h-3 w-3 text-amber-400" /> {label}
      </div>
      {loading ? (
        <div className="mt-2 h-9 animate-pulse rounded-lg bg-muted" />
      ) : row ? (
        <div className="mt-1.5 flex items-center gap-2">
          <LifterAvatar row={row} size="h-8 w-8" />
          <div className="min-w-0">
            <div className="truncate text-xs font-bold">{row.display_name}</div>
            <div className="text-base font-black tabular-nums leading-tight">{value}</div>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">Open spot. Claim it.</div>
      )}
    </div>
  );
}

// ── The board ──────────────────────────────────────────────────────────────

/** The full Hall of Strength: All-time (training + meets, everyone ever coached) and Competition (sanctioned meets). */
export function HallOfStrength({ initialSource = "all", initialMode = "p4p", initialLift = "total", initialDivision = "all" }: {
  initialSource?: BoardSource; initialMode?: BoardMode; initialLift?: BoardLift; initialDivision?: Division;
}) {
  const { unit, setUnit } = useWeightUnit();
  const isStaff = useIsStaff();
  const allTime = useStrengthBoard();
  const meets = useMeetBoard();
  const [source, setSource] = useState<BoardSource>(initialSource);
  const [mode, setMode] = useState<BoardMode>(initialMode);
  const [lift, setLift] = useState<BoardLift>(initialLift);
  const [division, setDivision] = useState<Division>(initialDivision);
  const [showAll, setShowAll] = useState(false);
  const active = source === "all" ? allTime : meets;
  const rows = active.data ?? [];
  const { top, me, count } = pickBoard(rows, mode, lift, division, showAll ? Infinity : TOP);
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  // The viewer only pins below the list when they're not already in it.
  const meOnBoard = !!me && top.some((r) => r.key === me.key);
  const history = meetHistory(meets.data ?? []);
  const what = lift === "total" ? "squat + bench + deadlift" : LIFT_NAME[lift];
  const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setShowAll(false); };

  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 shrink-0 text-amber-400" /> Hall of Strength</SheetTitle>
        <SheetDescription>
          {source === "all"
            ? "Every athlete JF Effect has ever coached, current and former. Your best lift counts, whether you hit it in training or at a meet."
            : "Official results only: lifts made at sanctioned powerlifting meets, where every lift is judged by referees."}
        </SheetDescription>
      </SheetHeader>

      {/* All-time or Competition */}
      <div className="grid grid-cols-2 gap-2">
        {([
          ["all", "All-time", "Gym + meets", Trophy],
          ["meets", "Competition", "Sanctioned meets only", Landmark],
        ] as const).map(([k, label, sub, Icon]) => (
          <button key={k} type="button" onClick={() => pick(setSource)(k)}
            className={cn("flex min-h-14 items-center gap-2 rounded-xl border px-3 text-left transition",
              source === k ? "border-amber-400/70 bg-amber-400/10 shadow-sm" : "bg-card text-muted-foreground")}>
            <Icon className={cn("h-4 w-4 shrink-0", source === k ? "text-amber-500" : "")} />
            <span className="min-w-0">
              <span className="block text-xs font-black text-foreground">{label}</span>
              <span className="block truncate text-[10px]">{sub}</span>
            </span>
          </button>
        ))}
      </div>

      {source === "meets" && history.athletes > 0 && (
        <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-400/15 via-transparent to-transparent p-3">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">Official competition record</div>
          <div className="mt-1 grid grid-cols-3 text-center">
            {[
              [history.athletes, "athletes"],
              [history.meets, "meets"],
              [history.since ?? "—", "since"],
            ].map(([n, label]) => (
              <div key={label as string}>
                <div className="text-xl font-black tabular-nums leading-none">{n}</div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Real competitions only: official weigh-in, three attempts, every lift passed by the referees. These are the best results from JF Effect athletes, current and alumni. No gym lifts.
          </p>
        </div>
      )}

      {/* Board picker */}
      <div className="grid grid-cols-2 rounded-xl bg-muted/50 p-1 text-xs font-bold">
        {([["p4p", "Pound for pound"], ["absolute", "Heaviest"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => pick(setMode)(k)}
            className={cn("min-h-10 rounded-lg transition", mode === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {BOARD_LIFTS.map((l) => (
          <button key={l.key} type="button" onClick={() => pick(setLift)(l.key)}
            className={cn("min-h-10 rounded-xl border text-xs font-black transition",
              lift === l.key ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        {([["all", "All"], ["male", "Men"], ["female", "Women"]] as const).map(([d, label]) => (
          <button key={d} type="button" onClick={() => pick(setDivision)(d)}
            className={cn("min-h-9 flex-1 rounded-full border text-xs font-bold transition",
              division === d ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-3">
        <p className="flex flex-1 items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {mode === "p4p"
            ? `Ranked by times bodyweight: ${what} ÷ bodyweight.${division === "all" ? " Men and women on one board." : ""}`
            : source === "meets"
              ? `Heaviest ${what} passed by the referees at a meet.`
              : `Heaviest ${what} from training or a meet. ×3 = done for 3 reps.`}
        </p>
        <ToggleGroup type="single" value={unit} onValueChange={(v) => v && setUnit(v as WeightUnit)} className="shrink-0 rounded-lg border bg-card p-0.5">
          {(["lb", "kg"] as const).map((u) => (
            <ToggleGroupItem key={u} value={u} aria-label={`Show weights in ${u}`} className="h-8 px-2.5 text-[11px] font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{u}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Podium */}
      {active.isPending ? (
        <div className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : active.error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-bold text-destructive">The board couldn't load</div>
          <div className="mt-1 text-xs text-muted-foreground">Pull down to refresh or try again in a minute.</div>
        </div>
      ) : top.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nobody's on this board yet. Be the first.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? <PodiumSpot key={r.key} row={r} rank={rankOf(r, mode, division)!} mode={mode} unit={unit} showSource={source === "all"} /> : <div key={i} />,
            )}
          </div>
          {rest.length > 0 && (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {rest.map((r) => <BoardLine key={r.key} row={r} rank={rankOf(r, mode, division)!} mode={mode} unit={unit} showSource={source === "all"} />)}
            </ul>
          )}
          {count > TOP && (
            <button type="button" onClick={() => setShowAll((s) => !s)}
              className="min-h-10 w-full rounded-xl border bg-card text-xs font-black text-primary">
              {showAll ? "Show top 10" : `Show all ${count} athletes`}
            </button>
          )}
        </>
      )}

      {/* You */}
      {!active.isPending && !meOnBoard && (source === "all"
        ? <YouCard me={me} top={top} mode={mode} lift={lift} division={division} unit={unit} />
        : <MeetYouCard me={me} mode={mode} division={division} />)}

      <details className="rounded-2xl border bg-muted/20 p-3 text-xs">
        <summary className="cursor-pointer font-black">How the board works</summary>
        {source === "all" ? (
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            <li><b className="text-foreground">Who's on it:</b> everyone JF Effect has coached. Current clients, former clients (ALUMNI) and athletes who competed with us.</li>
            <li><b className="text-foreground">Your number:</b> your heaviest lift from either place. <b className="text-foreground">TRAINING</b> = logged in the app, any reps (×3 = a set of 3). <b className="text-foreground">MEET</b> = made at a powerlifting meet.</li>
            <li><b className="text-foreground">What counts in training:</b> barbell squat, bench and deadlift, including paused, tempo, touch-and-go, close-grip, high-bar, sumo and deficit. Not partials (pins, boxes, boards), machines, dumbbells, specialty bars or RDLs.</li>
            <li><b className="text-foreground">Total:</b> in training, your best squat + best bench + best deadlift. At a meet, that day's total. Whichever is higher counts.</li>
            <li><b className="text-foreground">Pound for pound:</b> the lift ÷ your bodyweight at the time (closest weigh-in you logged, or the meet's official weigh-in).</li>
            <li><b className="text-foreground">Typos:</b> lifts that look impossible wait for your coach to check them.</li>
          </ul>
        ) : (
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            <li><b className="text-foreground">What counts:</b> only sanctioned powerlifting meets. Official weigh-in, three attempts per lift, and a lift only counts if the referees pass it. Training lifts never count here.</li>
            <li><b className="text-foreground">Whose meets:</b> meets done while coached by JF Effect.</li>
            <li><b className="text-foreground">Total:</b> squat + bench + deadlift made on the same day. A bench-only meet counts for bench.</li>
            <li><b className="text-foreground">Pound for pound:</b> the lift ÷ the official weigh-in bodyweight.</li>
            <li><b className="text-foreground">Alumni:</b> athletes JF Effect coached in the past. Their records stand.</li>
            <li><b className="text-foreground">Missing a meet?</b> Tell your coach and it goes on the record.</li>
          </ul>
        )}
      </details>

      {isStaff && source === "all" && <StrengthBoardCoachTools />}
    </div>
  );
}

function NameLine({ row }: { row: StrengthRow }) {
  return row.meet?.competed_as ? (
    <div className="truncate text-[9px] text-muted-foreground">competed as {row.meet.competed_as}</div>
  ) : null;
}

function PodiumSpot({ row, rank, mode, unit, showSource }: { row: StrengthRow; rank: number; mode: BoardMode; unit: WeightUnit; showSource: boolean }) {
  const first = rank === 1;
  return (
    <div className={cn(
      "flex flex-col items-center rounded-2xl border p-2 text-center shadow-sm",
      first ? "bg-gradient-to-b from-amber-400/20 to-card pb-4 ring-2 ring-amber-400/60" : "bg-card",
      row.is_me && "ring-2 ring-primary",
    )}>
      <Medal className={cn("h-5 w-5", MEDAL[rank - 1])} />
      <div className="text-[10px] font-black">{rank === 1 ? "1ST" : rank === 2 ? "2ND" : "3RD"}</div>
      <LifterAvatar row={row} size={first ? "mt-1 h-14 w-14" : "mt-1 h-11 w-11"} />
      <div className="mt-1 line-clamp-2 w-full break-words text-xs font-bold leading-tight">{row.display_name}</div>
      <NameLine row={row} />
      {row.is_coach && <CoachTag className="mt-0.5" />}
      <div className={cn("mt-0.5 font-black tabular-nums leading-tight", first ? "text-lg" : "text-base")}>
        <Headline row={row} mode={mode} unit={unit} />
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-1">
        {showSource && <SourceTag row={row} />}
        {mode === "absolute" && <XBadge row={row} />}
        <ClubBadge row={row} />
        <AlumniTag row={row} />
      </div>
      {mode === "p4p" && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {formatLoad(row.kg, unit)}{row.reps && row.reps > 1 ? ` ×${row.reps}` : ""}
        </div>
      )}
      {row.meet && <div className="w-full truncate text-[9px] text-muted-foreground">{row.meet.name} · {format(new Date(row.lifted_at), "yyyy")}</div>}
    </div>
  );
}

function BoardLine({ row, rank, mode, unit, showSource }: { row: StrengthRow; rank: number; mode: BoardMode; unit: WeightUnit; showSource: boolean }) {
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", row.is_me && "bg-primary/5")}>
      <span className="w-8 shrink-0 text-center text-sm font-black text-muted-foreground">#{rank}</span>
      <LifterAvatar row={row} size="h-9 w-9 shrink-0" />
      <div className="min-w-0 flex-1">
        {/* The name gets its own line so it's never squeezed by tags. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-bold">{row.display_name}{row.is_me ? " (You)" : ""}</span>
          {row.is_coach && <CoachTag />}
        </div>
        <NameLine row={row} />
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {showSource && <SourceTag row={row} />}
          <AlumniTag row={row} />
        </div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{subline(row, mode, unit)}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <div className="text-sm font-black tabular-nums"><Headline row={row} mode={mode} unit={unit} /></div>
        {mode === "absolute" && <XBadge row={row} />}
        <ClubBadge row={row} />
      </div>
    </li>
  );
}

function YouCard({ me, top, mode, lift, division, unit }: {
  me: StrengthRow | null; top: StrengthRow[]; mode: BoardMode; lift: BoardLift; division: Division; unit: WeightUnit;
}) {
  const status = meStatus(me, mode, lift, division);
  const gap = gapToTop10(me, top, mode, division, unit);
  const qc = useQueryClient();
  const [pending, setPending] = useState<AthleteSex | null>(null);
  const save = useMutation({
    mutationFn: (sex: AthleteSex) => saveMySexFn({ data: { sex } }),
    onMutate: (sex) => setPending(sex),
    onSuccess: async () => {
      toast.success("Division saved");
      await Promise.all(ATHLETE_SEX_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })));
    },
    onError: (e: unknown) => toast.error("Couldn't save", { description: (e as Error)?.message }),
    onSettled: () => setPending(null),
  });

  if (status.kind === "other-division") return null;
  const liftName = LIFT_NAME[lift][0].toUpperCase() + LIFT_NAME[lift].slice(1);

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
      <div className="text-[10px] font-black uppercase tracking-widest text-primary">You</div>
      {status.kind === "ranked" && me && (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div className="text-2xl font-black">#{status.rank}{status.count ? <span className="text-sm font-bold text-muted-foreground"> of {status.count}</span> : null}</div>
            <div className="text-right text-base font-black tabular-nums"><Headline row={me} mode={mode} unit={unit} /></div>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{subline(me, mode, unit)}</div>
          {gap != null && (
            <div className="mt-2 rounded-xl bg-background px-3 py-2 text-sm font-bold">
              +{gap} {unit} on your {LIFT_NAME[lift]} cracks the top 10{mode === "p4p" ? " at your bodyweight" : ""}.
            </div>
          )}
        </>
      )}
      {status.kind === "no-lift" && (
        <p className="mt-1 text-sm font-bold">Log a barbell {liftName} in the app (any reps) or compete at a meet to get on this board.</p>
      )}
      {status.kind === "no-total" && (
        <p className="mt-1 text-sm font-bold">Log a squat, bench and deadlift in the app (any reps) or compete at a meet to post a total.</p>
      )}
      {status.kind === "no-bodyweight" && (
        <p className="mt-1 text-sm font-bold">Log your bodyweight to unlock pound for pound.</p>
      )}
      {status.kind === "no-division" && (
        <div className="mt-1 space-y-2">
          <p className="text-sm font-bold">You're on the All board. Pick your division to rank with the {division === "female" ? "women" : "men"} too.</p>
          <SexChoice value={null} onChange={(v) => save.mutate(v)} disabled={save.isPending} pending={pending} />
        </div>
      )}
    </div>
  );
}

function MeetYouCard({ me, mode, division }: { me: StrengthRow | null; mode: BoardMode; division: Division }) {
  if (me) {
    const rank = rankOf(me, mode, division);
    if (rank == null) return null;
  }
  return (
    <div className="rounded-2xl border-2 border-dashed border-amber-400/50 bg-amber-400/5 p-4">
      <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">You</div>
      {me ? (
        <p className="mt-1 text-sm font-bold">#{rankOf(me, mode, division)} on the official JF Effect competition record. Next meet, move up.</p>
      ) : (
        <p className="mt-1 text-sm font-bold">You're not on the official record yet. Compete at a sanctioned powerlifting meet with JF Effect and your name goes here.</p>
      )}
    </div>
  );
}

// ── Coach tools ────────────────────────────────────────────────────────────

type ReviewRow = {
  result_id: string; client_id: string; display_name: string; lift: string; load_kg: number; reps: number;
  sets: number; lift_day: string; bw_kg: number | null; flag: string | null; review: string | null; counted_best_kg: number | null;
};

/** Coach review for the board; also shown on the admin Athlete Records page. */
export function StrengthBoardCoachTools() {
  const qc = useQueryClient();
  const { unit } = useWeightUnit();
  const { data: review = [], isPending } = useQuery({
    queryKey: ["strength-board", "review"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_strength_board_review");
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });
  const { data: unranked = [] } = useQuery({
    queryKey: ["strength-board", "unranked"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_strength_board_unranked");
      if (error) throw error;
      return (data ?? []) as { client_id: string; display_name: string; missing: string; lifts: number }[];
    },
  });
  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "excluded" | "clear" }) => {
      const { error } = await db.rpc("strength_board_review", { _result_id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: async (_d, v) => {
      toast.success(v.status === "approved" ? "Lift counts now" : v.status === "excluded" ? "Lift removed from the board" : "Back to automatic");
      await qc.invalidateQueries({ queryKey: ["strength-board"] });
    },
    onError: (e: unknown) => toast.error("Couldn't save", { description: (e as Error)?.message }),
  });
  const pending = review.filter((r) => !r.review);
  const decided = review.filter((r) => r.review);

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-3">
      <div className="flex items-center gap-2 text-sm font-black"><ShieldCheck className="h-4 w-4 text-primary" /> Coach tools</div>

      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Held back for review · {pending.length}</div>
        {isPending ? (
          <div className="py-3 text-center text-xs text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
        ) : pending.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Nothing waiting. Every top lift passed the typo check.</p>
        ) : (
          <ul className="mt-1 divide-y">
            {pending.map((r) => (
              <ReviewLine key={r.result_id} r={r} unit={unit} busy={decide.isPending}
                actions={[
                  { label: "Count it", onClick: () => decide.mutate({ id: r.result_id, status: "approved" }) },
                  { label: "Remove", onClick: () => decide.mutate({ id: r.result_id, status: "excluded" }), danger: true },
                ]} />
            ))}
          </ul>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your decisions</div>
          <ul className="mt-1 divide-y">
            {decided.map((r) => (
              <ReviewLine key={r.result_id} r={r} unit={unit} busy={decide.isPending}
                actions={[{ label: "Undo", onClick: () => decide.mutate({ id: r.result_id, status: "clear" }) }]} />
            ))}
          </ul>
        </div>
      )}

      <RemoveFromBoard unit={unit} busy={decide.isPending} onRemove={(id) => decide.mutate({ id, status: "excluded" })} />

      {unranked.length > 0 && (
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Can't rank yet · {unranked.length}</div>
          <ul className="mt-1 space-y-1 text-xs">
            {unranked.map((u) => (
              <li key={u.client_id} className="flex justify-between gap-3">
                <span className="font-bold">{u.display_name}</span>
                <span className="text-muted-foreground">{u.missing === "division" ? "No sex set · All board only" : "No bodyweight logged · not on P4P"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ReviewLine({ r, unit, busy, actions }: {
  r: ReviewRow; unit: WeightUnit; busy: boolean;
  actions: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const verdict = r.review === "approved" ? "Counted" : r.review === "excluded" ? "Removed" : r.flag;
  return (
    <li className="py-2.5">
      <div className="text-xs font-bold">
        {r.display_name} · {r.lift} {formatLoad(Number(r.load_kg), unit)} ×{r.reps}
        {r.sets > 1 ? <span className="font-normal text-muted-foreground"> ({r.sets} sets)</span> : null}
      </div>
      <div className="text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground/80">{verdict}</span> · {format(new Date(r.lift_day + "T12:00:00"), "MMM d")}
        {r.bw_kg ? ` · BW ${formatLoad(Number(r.bw_kg), unit)}` : ""}
        {` · counted best ${r.counted_best_kg ? formatLoad(Number(r.counted_best_kg), unit) : "none yet"}`}
      </div>
      <div className="mt-1.5 flex gap-2">
        {actions.map((a) => (
          <button key={a.label} type="button" disabled={busy} onClick={a.onClick}
            className={cn("min-h-9 flex-1 rounded-lg border px-2.5 text-xs font-black disabled:opacity-50",
              a.danger ? "border-destructive/40 text-destructive" : "")}>
            {a.label}
          </button>
        ))}
      </div>
    </li>
  );
}

/** Remove a lift that passed the typo check but you know is wrong: pick it from the current boards. */
function RemoveFromBoard({ unit, busy, onRemove }: { unit: WeightUnit; busy: boolean; onRemove: (resultId: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: sets = [] } = useQuery({
    queryKey: ["strength-board", "counted-tops"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_strength_board_tops");
      if (error) throw error;
      return (data ?? []) as { result_id: string; display_name: string; lift: string; load_kg: number; reps: number; lift_day: string }[];
    },
  });
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] font-black text-primary">
        {open ? "Hide" : "Remove a lift that's on the board"}
      </button>
      {open && (
        <ul className="mt-1 divide-y">
          {sets.map((s) => (
            <li key={s.result_id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate"><b>{s.display_name}</b> · {s.lift} {formatLoad(Number(s.load_kg), unit)} ×{s.reps} · {format(new Date(s.lift_day + "T12:00:00"), "MMM d")}</span>
              <button type="button" disabled={busy}
                onClick={() => (confirm === s.result_id ? (onRemove(s.result_id), setConfirm(null)) : setConfirm(s.result_id))}
                className="min-h-8 shrink-0 rounded-lg border border-destructive/40 px-2 text-[11px] font-black text-destructive disabled:opacity-50">
                {confirm === s.result_id ? "Tap to confirm" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
