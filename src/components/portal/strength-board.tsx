import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronRight, Crown, Info, Loader2, Medal, ShieldCheck, Trophy } from "lucide-react";
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
  formatDots,
  formatLoad,
  formatMultiple,
  gapToTop10,
  meStatus,
  normalizeRow,
  pickBoard,
  rankOf,
  totalClub,
  type BoardLift,
  type BoardMode,
  type Division,
  type StrengthRow,
} from "@/lib/strength-board";

const db = supabase as any;

function useStrengthBoard() {
  const viewerId = usePortalUserId() ?? null;
  return useQuery({
    queryKey: ["strength-board", viewerId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc("get_strength_board", viewerId ? { _as_user: viewerId } : {});
      if (error) throw error;
      return ((data ?? []) as any[]).map(normalizeRow);
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

/** The number a row is ranked by, big; everything else is context. */
function headline(row: StrengthRow, mode: BoardMode, unit: WeightUnit) {
  return mode === "p4p" ? formatDots(row.dots) : formatLoad(row.kg, unit);
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
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-amber-500">
      {club}
    </span>
  );
}

function subline(row: StrengthRow, mode: BoardMode, unit: WeightUnit) {
  const parts: string[] = [];
  if (mode === "p4p") parts.push(formatLoad(row.kg, unit));
  if (row.reps && row.reps > 1) parts.push(`×${row.reps} reps`);
  if (row.bw_kg) parts.push(`@ ${formatLoad(row.bw_kg, unit)} BW`);
  parts.push(format(new Date(row.lifted_at), "MMM d, yyyy"));
  return parts.join(" · ");
}

// ── Home card ──────────────────────────────────────────────────────────────

export function StrengthBoardCard() {
  const [open, setOpen] = useState(false);
  const { data = [], isPending } = useStrengthBoard();
  const { unit } = useWeightUnit();
  const myTotal = data.find((r) => r.is_me && r.lift === "total") ?? null;
  const division: Division = data.find((r) => r.is_me)?.sex ?? "male";
  const p4pKing = pickBoard(data, "p4p", "total", division).top[0] ?? null;
  const absKing = pickBoard(data, "absolute", "total", division).top[0] ?? null;

  if (!isPending && data.length === 0) return null; // nobody has logged a competition lift yet

  const myLine = myTotal?.p4p_rank
    ? `You: #${myTotal.p4p_rank} pound for pound${myTotal.abs_rank ? ` · #${myTotal.abs_rank} ${division === "female" ? "women's" : "men's"} total` : ""}`
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
            <div className="text-[11px] text-muted-foreground">Squat · Bench · Deadlift · since day one</div>
          </div>
          <Trophy className="h-7 w-7 shrink-0 text-amber-400" />
        </div>
        <div className="grid grid-cols-2 border-t">
          <KingTile label="Pound for pound #1" row={p4pKing} value={p4pKing ? formatMultiple(p4pKing.bw_multiple) ?? `${formatDots(p4pKing.dots)} DOTS` : null} suffix={p4pKing?.bw_multiple ? "BW" : undefined} loading={isPending} />
          <KingTile label={`${division === "female" ? "Women's" : "Men's"} total #1`} row={absKing} value={absKing ? formatLoad(absKing.kg, unit) : null} loading={isPending} className="border-l" />
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs font-bold">
          <span className={cn(myTotal?.p4p_rank ? "text-foreground" : "text-primary")}>{myLine}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl pb-safe-bottom">
          <StrengthBoardView rows={data} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function KingTile({ label, row, value, suffix, loading, className }: {
  label: string; row: StrengthRow | null; value: string | null; suffix?: string; loading: boolean; className?: string;
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
            <div className="text-base font-black tabular-nums leading-tight">
              {value}
              {suffix && <span className="ml-0.5 text-[10px] font-black text-muted-foreground">{suffix}</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">Open spot. Claim it.</div>
      )}
    </div>
  );
}

// ── The board ──────────────────────────────────────────────────────────────

function StrengthBoardView({ rows }: { rows: StrengthRow[] }) {
  const { unit, setUnit } = useWeightUnit();
  const isStaff = useIsStaff();
  const mine = rows.find((r) => r.is_me);
  const [mode, setMode] = useState<BoardMode>("p4p");
  const [lift, setLift] = useState<BoardLift>("total");
  const [division, setDivision] = useState<Division>(mine?.sex ?? "male");
  const { top, me } = pickBoard(rows, mode, lift, division);
  const podium = top.slice(0, 3);
  const rest = top.slice(3);
  // The viewer only pins below the list when they're not already in it.
  const meOnBoard = !!me && top.some((r) => r.client_id === me.client_id);
  const myDivisionMismatch = mode === "absolute" && !!me?.sex && me.sex !== division;

  return (
    <div className="space-y-4">
      <SheetHeader className="text-left">
        <SheetTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 shrink-0 text-amber-400" /> Hall of Strength</SheetTitle>
        <SheetDescription>The strongest lifts logged in JF Effect since day one.</SheetDescription>
      </SheetHeader>

      {/* Board picker */}
      <div className="grid grid-cols-2 rounded-xl bg-muted/50 p-1 text-xs font-bold">
        {([["p4p", "Pound for pound"], ["absolute", "Absolute"]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={cn("min-h-10 rounded-lg transition", mode === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {BOARD_LIFTS.map((l) => (
          <button key={l.key} type="button" onClick={() => setLift(l.key)}
            className={cn("min-h-10 rounded-xl border text-xs font-black transition",
              lift === l.key ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>
            {l.label}
          </button>
        ))}
      </div>
      {mode === "absolute" && (
        <div className="flex gap-1.5">
          {(["male", "female"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDivision(d)}
              className={cn("min-h-9 flex-1 rounded-full border text-xs font-bold transition",
                division === d ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}>
              {d === "male" ? "Men" : "Women"}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3">
        <p className="flex flex-1 items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {mode === "p4p"
            ? "Ranked by DOTS, powerlifting's score for any bodyweight, men and women. BW = times your bodyweight lifted."
            : `Heaviest ${lift === "total" ? "squat + bench + deadlift" : `${LIFT_NAME[lift]}`} actually lifted. No estimates.`}
        </p>
        <ToggleGroup type="single" value={unit} onValueChange={(v) => v && setUnit(v as WeightUnit)} className="shrink-0 rounded-lg border bg-card p-0.5">
          {(["lb", "kg"] as const).map((u) => (
            <ToggleGroupItem key={u} value={u} aria-label={`Show weights in ${u}`} className="h-8 px-2.5 text-[11px] font-bold uppercase data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{u}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Podium */}
      {top.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nobody's on this board yet. Be the first.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? <PodiumSpot key={r.client_id} row={r} mode={mode} unit={unit} /> : <div key={i} />,
            )}
          </div>
          {rest.length > 0 && (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {rest.map((r) => <BoardLine key={r.client_id} row={r} mode={mode} unit={unit} />)}
            </ul>
          )}
        </>
      )}

      {/* You */}
      {!meOnBoard && !myDivisionMismatch && <YouCard me={me} top={top} mode={mode} lift={lift} unit={unit} />}

      <details className="rounded-2xl border bg-muted/20 p-3 text-xs">
        <summary className="cursor-pointer font-black">How the board works</summary>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          <li><b className="text-foreground">What counts:</b> Competition Squat, Bench and Deadlift logged in the app since launch. Meet results live in Powerlifting Records.</li>
          <li><b className="text-foreground">Your number:</b> the heaviest weight you've completed for at least one rep. No estimated maxes.</li>
          <li><b className="text-foreground">Total:</b> your best squat + best bench + best deadlift.</li>
          <li><b className="text-foreground">Bodyweight:</b> the bodyweight you logged closest to that lift (within 30 days). For a total, the heaviest of the three, so cutting after a PR doesn't help.</li>
          <li><b className="text-foreground">Typos:</b> lifts that look impossible (heavier than world records, or a huge jump over every other session) wait for your coach to check them.</li>
        </ul>
      </details>

      {isStaff && <StrengthBoardCoachTools />}
    </div>
  );
}

function PodiumSpot({ row, mode, unit }: { row: StrengthRow; mode: BoardMode; unit: WeightUnit }) {
  const rank = rankOf(row, mode)!;
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
      <div className="mt-1 w-full truncate text-xs font-bold">{row.display_name}</div>
      {row.is_coach && <CoachTag className="mt-0.5" />}
      <div className={cn("mt-0.5 font-black tabular-nums leading-tight", first ? "text-lg" : "text-base")}>
        {headline(row, mode, unit)}
        {mode === "p4p" && <span className="ml-0.5 text-[9px] font-black text-muted-foreground">DOTS</span>}
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-1">
        <XBadge row={row} />
        <ClubBadge row={row} />
      </div>
      {mode === "p4p" && <div className="mt-0.5 text-[10px] text-muted-foreground">{formatLoad(row.kg, unit)}</div>}
      {row.reps && row.reps > 1 ? <div className="text-[10px] text-muted-foreground">×{row.reps} reps</div> : null}
    </div>
  );
}

function BoardLine({ row, mode, unit }: { row: StrengthRow; mode: BoardMode; unit: WeightUnit }) {
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5", row.is_me && "bg-primary/5")}>
      <span className="w-6 text-center text-sm font-black text-muted-foreground">#{rankOf(row, mode)}</span>
      <LifterAvatar row={row} size="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold">{row.display_name}{row.is_me ? " (You)" : ""}</span>
          {row.is_coach && <CoachTag />}
          <XBadge row={row} />
        </div>
        <div className="truncate text-[10px] text-muted-foreground">{subline(row, mode, unit)}</div>
      </div>
      <div className="text-right">
        <div className="text-sm font-black tabular-nums">{headline(row, mode, unit)}</div>
        {mode === "p4p" && <div className="text-[9px] font-black text-muted-foreground">DOTS</div>}
        <ClubBadge row={row} />
      </div>
    </li>
  );
}

function YouCard({ me, top, mode, lift, unit }: { me: StrengthRow | null; top: StrengthRow[]; mode: BoardMode; lift: BoardLift; unit: WeightUnit }) {
  const status = meStatus(me, mode, lift);
  const gap = gapToTop10(me, top, mode, unit);
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

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
      <div className="text-[10px] font-black uppercase tracking-widest text-primary">You</div>
      {status.kind === "ranked" && me && (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <div className="text-2xl font-black">#{status.rank}{status.count ? <span className="text-sm font-bold text-muted-foreground"> of {status.count}</span> : null}</div>
            <div className="text-right text-base font-black tabular-nums">
              {headline(me, mode, unit)}{mode === "p4p" && <span className="ml-0.5 text-[9px] text-muted-foreground">DOTS</span>}
            </div>
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
        <p className="mt-1 text-sm font-bold">Log a Competition {LIFT_NAME[lift][0].toUpperCase() + LIFT_NAME[lift].slice(1)} to get on this board.</p>
      )}
      {status.kind === "no-total" && (
        <p className="mt-1 text-sm font-bold">Log a Competition Squat, Bench and Deadlift to post a total.</p>
      )}
      {status.kind === "no-bodyweight" && (
        <p className="mt-1 text-sm font-bold">Log your bodyweight in the weeks you lift to unlock pound for pound.</p>
      )}
      {status.kind === "no-division" && (
        <div className="mt-1 space-y-2">
          <p className="text-sm font-bold">Pick your division to get ranked.</p>
          <SexChoice value={null} onChange={(v) => save.mutate(v)} disabled={save.isPending} pending={pending} />
        </div>
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
                <span className="text-muted-foreground">{u.missing === "division" ? "Set sex on their profile" : "Needs a bodyweight log (P4P)"}</span>
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
