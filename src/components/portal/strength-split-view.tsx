import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, ChevronRight, Landmark, Search, Swords, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { feedback } from "@/lib/feedback";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UserAvatar } from "@/components/user-avatar";
import { CoachTag } from "@/components/portal/coach-tag";
import type { WeightUnit } from "@/lib/weight-lifted";
import { formatLoad, formatMultiple, type Sex, type StrengthRow } from "@/lib/strength-board";
import {
  LEAN_POINTS,
  SPLIT_LIFTS,
  SPLIT_NAME,
  TYPICAL_SPLIT,
  compareLifters,
  glOf,
  hallSplits,
  heaviestTotal,
  lifterFor,
  liftProfile,
  liftRatios,
  pct,
  points,
  profileLine,
  repsNote,
  splitOf,
  standoutLine,
  standoutShares,
  typicalAround,
  type CompareLifter,
  type Comparison,
  type HallSplits,
  type LiftDuel,
  type SplitLift,
  type TotalSplit,
} from "@/lib/strength-split";

/** Each lift's colour (styles.css --split-*): squat, bench, deadlift, always in that order. */
export const SPLIT_COLOR: Record<SplitLift, string> = {
  squat: "var(--split-squat)",
  bench: "var(--split-bench)",
  deadlift: "var(--split-deadlift)",
};

const sexWord = (s: Sex) => (s === "male" ? "man" : "woman");
const typicalPct = (share: number) => pct(share).replace(".0%", "%");

/**
 * The split as one bar: squat, bench and deadlift in their colours, sized by
 * their share of the total, a 2px gap between them. `mini` is the board's
 * fingerprint under a name; the full one marks where a typical lifter's
 * split would fall (thin ticks over the bar).
 */
export function SplitBar({ split, sex, size = "mini", className }: { split: TotalSplit; sex?: Sex | null; size?: "mini" | "full"; className?: string }) {
  const t = sex ? TYPICAL_SPLIT[sex] : null;
  const label = SPLIT_LIFTS.map((l) => `${SPLIT_NAME[l]} ${pct(split.share[l])}`).join(", ");
  return (
    <div className={cn("relative", className)} role="img" aria-label={`Split: ${label}`} data-split-bar={size}>
      <div className={cn("flex w-full gap-[2px] overflow-hidden", size === "mini" ? "h-1.5 rounded-full" : "h-3.5 rounded-[5px]")}>
        {SPLIT_LIFTS.map((l) => (
          <span key={l} className="h-full first:rounded-l-[inherit] last:rounded-r-[inherit]" style={{ width: `${split.share[l] * 100}%`, background: SPLIT_COLOR[l] }} />
        ))}
      </div>
      {size === "full" && t && (
        <>
          {/* where a typical lifter's squat ends and their deadlift starts */}
          {[t.squat, t.squat + t.bench].map((x, i) => (
            <span key={i} className="pointer-events-none absolute -bottom-1 -top-1 w-[2px] -translate-x-1/2 rounded-full bg-foreground/70" style={{ left: `${x * 100}%` }} aria-hidden />
          ))}
        </>
      )}
    </div>
  );
}

/** The key for the board's mini bars: three dots and the lift names, said once. */
export function SplitLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 text-[11px] text-muted-foreground", className)} data-split-legend>
      {SPLIT_LIFTS.map((l) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: SPLIT_COLOR[l] }} aria-hidden />
          {SPLIT_NAME[l]}
        </span>
      ))}
    </div>
  );
}

/** The split as a table (the bar's numbers, readable without colour): kg, share, typical, difference. */
function SplitTable({ split, sex, unit }: { split: TotalSplit; sex: Sex | null; unit: WeightUnit }) {
  const t = sex ? TYPICAL_SPLIT[sex] : null;
  return (
    <table className="w-full text-[13px] tabular-nums" data-split-table>
      <thead>
        <tr className="text-[11px] text-muted-foreground">
          <th className="py-1 text-left font-medium">Lift</th>
          <th className="py-1 text-right font-medium">Weight</th>
          <th className="py-1 text-right font-medium">Of total</th>
          {t && <th className="py-1 text-right font-medium">Typical</th>}
        </tr>
      </thead>
      <tbody>
        {SPLIT_LIFTS.map((l) => {
          const d = t ? points(split.share[l], t[l]) : null;
          return (
            <tr key={l} className="border-t border-border/60">
              <td className="py-1.5">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SPLIT_COLOR[l] }} aria-hidden />
                  {SPLIT_NAME[l]}
                </span>
              </td>
              <td className="py-1.5 text-right">
                {formatLoad(split.kg[l], unit)}
                {split.reps[l] > 1 && <span className="text-muted-foreground"> ×{split.reps[l]}</span>}
              </td>
              <td className="py-1.5 text-right font-semibold">{pct(split.share[l])}</td>
              {t && (
                <td className="py-1.5 text-right text-muted-foreground">
                  {typicalPct(t[l])}
                  {d != null && Math.abs(d) >= 0.1 && (
                    <span className={cn("ml-1 text-[11px]", Math.abs(d) >= LEAN_POINTS ? "font-semibold text-foreground" : "")}>
                      {d > 0 ? "+" : "−"}{Math.abs(d).toFixed(1)}
                    </span>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <h4 className="text-[13px] font-semibold text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

const firstName = (r: StrengthRow) => (r.is_me ? "You" : r.display_name.split(" ")[0]);

/**
 * One lifter's total, taken apart: the split against a typical lifter of
 * their sex (and the Hall's own average), what it says about them, the
 * classic ratios, where it stands out on the board, and a way into the
 * head to head (and their meet career, when they have one).
 */
export function LifterSplitSheet({ rows, personKey, sourceLabel, unit, onClose, onCompare, onCareer }: {
  rows: StrengthRow[];
  personKey: string | null;
  sourceLabel: string;
  unit: WeightUnit;
  onClose: () => void;
  onCompare: (key: string) => void;
  onCareer?: (athleteId: string) => void;
}) {
  const hall = useMemo(() => hallSplits(rows), [rows]);
  const total = personKey ? heaviestTotal(rows, personKey) : null;
  // anyone on the board without a total yet: their best single lift
  const anyRow = personKey ? rows.find((r) => r.key === personKey) ?? null : null;
  const row = total ?? anyRow;
  const split = total ? splitOf(total) : null;
  const sex = row?.sex ?? null;
  const profile = split ? liftProfile(split, sex) : null;
  const open = !!personKey && !!row;
  useEffect(() => { if (open) feedback("reveal"); }, [open, personKey]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="flex max-h-[88dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[520px]" data-lifter-split>
        {row && (
          <>
            <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-3 pt-2 text-left">
              <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
              <div className="flex items-center gap-3">
                <UserAvatar src={row.avatar_url} name={row.display_name} size={44} />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="flex items-center gap-1.5 truncate text-[17px] font-semibold">
                    <span className="truncate">{row.is_me ? "You" : row.display_name}</span>
                    {row.is_coach && <CoachTag />}
                  </SheetTitle>
                  <SheetDescription className="text-[12px]">
                    {sourceLabel}{total?.all_rank ? ` · #${total.all_rank} heaviest total` : ""}{row.is_alumni ? " · Alumni" : ""}
                  </SheetDescription>
                </div>
                <SheetClose className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Close">
                  <X className="h-5 w-5" />
                </SheetClose>
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4">
              {!total ? (
                <p className="rounded-xl bg-muted/50 p-3 text-[13px] text-muted-foreground">
                  No total on this board yet: it takes a squat, a bench and a deadlift. Once all three are in, the split shows here.
                </p>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[12px] text-muted-foreground">Total</div>
                      <div className="text-[28px] font-semibold leading-none tabular-nums">{formatLoad(total.kg, unit)}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5 text-[12px] tabular-nums">
                      {formatMultiple(total.bw_multiple) && <span className="rounded-full bg-muted px-2 py-1 font-medium">{formatMultiple(total.bw_multiple)} BW</span>}
                      <GlChip row={total} />
                      {total.source === "meet" && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-medium"><Landmark className="h-3 w-3" /> Meet</span>}
                    </div>
                  </div>

                  {split ? (
                    <Section title="Where the total comes from">
                      <SplitBar split={split} sex={sex} size="full" className="my-1" />
                      {sex && <div className="text-[11px] text-muted-foreground">Ticks: a typical {sexWord(sex)}'s split (raw meet results).</div>}
                      <SplitTable split={split} sex={sex} unit={unit} />
                      {!split.singles && (
                        <p className="text-[12px] text-muted-foreground">
                          Includes {repsNote(split)}: done for reps, so {repsNote(split).includes(",") ? "those lifts read" : "that lift reads"} light next to singles. A heavy single sharpens the split.
                        </p>
                      )}
                    </Section>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">This total came from an older board without its lifts. Pull down to refresh.</p>
                  )}

                  {split && profile && sex && (
                    <Section title="What it says">
                      <div className="rounded-xl bg-muted/50 p-3">
                        <div className="text-[15px] font-semibold">{profile.title}</div>
                        <p className="mt-0.5 text-[13px] leading-snug text-foreground/85">{profileLine(profile, split, sex)}</p>
                        {profile.lag && split.singles && (
                          <p className="mt-2 text-[13px] leading-snug text-foreground/85" data-typical-around>
                            {(() => {
                              const lag = profile.lag!;
                              const others = SPLIT_LIFTS.filter((l) => l !== lag).map((l) => SPLIT_NAME[l].toLowerCase());
                              const at = typicalAround(split, sex, lag);
                              return `With ${row.is_me ? "your" : "their"} ${others[0]} and ${others[1]}, a typical ${sexWord(sex)}'s split has a ${formatLoad(at, unit)} ${SPLIT_NAME[lag].toLowerCase()} (${row.is_me ? "you" : firstName(row)}: ${formatLoad(split.kg[lag], unit)}).`;
                            })()}
                          </p>
                        )}
                      </div>
                    </Section>
                  )}
                  {split && !sex && (
                    <p className="text-[12px] text-muted-foreground">
                      {row.is_me ? "Pick Men or Women in your profile to see your split next to a typical lifter's." : "No division on file, so there's no typical split to read it against."}
                    </p>
                  )}

                  {split && (
                    <Section title="Ratios">
                      <ul className="divide-y divide-border/60 rounded-xl border">
                        {liftRatios(split, sex).map((r) => (
                          <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                            <span>{r.label}</span>
                            <span className="tabular-nums">
                              <b className="font-semibold">{Math.round(r.value * 100)}%</b>
                              {r.typical != null && <span className="text-muted-foreground"> · typical {Math.round(r.typical * 100)}%</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {split && <HallLines hall={hall} personKey={total.key} sex={sex} />}
                </>
              )}

              <div className="grid gap-2 pt-1">
                {total && (
                  <button type="button" onClick={() => onCompare(row.key)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-foreground text-[14px] font-semibold text-background active:opacity-90" data-lifter-compare>
                    <Swords className="h-4 w-4" /> {row.is_me ? "Compare with someone" : `Compare with ${firstName(row)}`}
                  </button>
                )}
                {row.athlete_id && onCareer && (
                  <button type="button" onClick={() => onCareer(row.athlete_id!)} className="flex min-h-11 items-center justify-center gap-1 rounded-xl border text-[14px] font-semibold active:bg-muted">
                    Meet career <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>
              <HowItsRead />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function GlChip({ row }: { row: StrengthRow }) {
  const g = useMemo(() => glOf(row), [row]);
  if (!g) return null;
  return (
    <span className="rounded-full bg-muted px-2 py-1 font-medium" title={g.estimate ? "IPF GL points worked out from a gym total: an estimate, not a meet result" : "Official IPF GL points from the meet"}>
      {g.value.toFixed(1)} GL{g.estimate ? " est." : ""}
    </span>
  );
}

/** Where the split stands on the board: firsts and lasts among their sex, and the Hall's own average. */
function HallLines({ hall, personKey, sex }: { hall: HallSplits; personKey: string; sex: Sex | null }) {
  const standouts = sex ? standoutShares(hall, personKey) : [];
  const avg = sex ? hall.average[sex] : undefined;
  if (!standouts.length && !avg) return null;
  return (
    <Section title="On this board">
      <ul className="space-y-1 text-[13px]">
        {standouts.map((s) => (
          <li key={s.lift} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: SPLIT_COLOR[s.lift] }} aria-hidden />
            {standoutLine(s, sex!)}
          </li>
        ))}
        {avg && avg.count >= 3 && (
          <li className="text-muted-foreground">
            The Hall's {sex === "male" ? "men" : "women"} average {SPLIT_LIFTS.map((l) => pct(avg.share[l])).join(" / ")} ({avg.count} totals of singles).
          </li>
        )}
      </ul>
    </Section>
  );
}

/** Where "typical" comes from, folded: the source, the threshold, and what a split can't say. */
function HowItsRead() {
  return (
    <details className="rounded-xl bg-muted/40 p-3 text-[12px] text-muted-foreground">
      <summary className="cursor-pointer font-semibold text-foreground">How it's read</summary>
      <ul className="mt-2 space-y-1.5 leading-snug">
        <li><b className="text-foreground">The split</b> is each lift's share of the total on this board: a training total's best squat, bench and deadlift, or a meet total's lifts from that day.</li>
        <li><b className="text-foreground">Typical</b> is the average split of raw meet results: men 35 / 24 / 41, women 35.5 / 20.5 / 44 (Stronger By Science's analysis of OpenPowerlifting, which OpenPowerlifting's own medians agree with). Heavier and more elite lifters lean a little more on the squat.</li>
        <li><b className="text-foreground">Leans</b> means {LEAN_POINTS}+ percentage points from typical, about one lifter-to-lifter spread. It describes where a total comes from; it isn't a verdict on what to train.</li>
        <li><b className="text-foreground">GL points</b> are the IPF's formula for comparing across bodyweights and sexes: official from a meet, an estimate from a gym total.</li>
      </ul>
    </details>
  );
}

// ── Head to head ───────────────────────────────────────────────────────────

/** Everyone on the board with a total, heaviest first (who can be compared). */
function totalsOn(rows: StrengthRow[]): StrengthRow[] {
  return rows.filter((r) => r.lift === "total" && r.all_rank != null).sort((a, b) => b.kg - a.kg);
}

/**
 * Two lifters side by side. Pick each with a tap (search by name), swap
 * them, and read: who wins each lift and by how much (and for their size),
 * the two splits, how the gap between their totals breaks down lift by lift,
 * and what sets each one apart.
 */
export function CompareSheet({ rows, open, initial, sourceLabel, unit, onClose }: {
  rows: StrengthRow[];
  open: boolean;
  initial: { a: string | null; b: string | null };
  sourceLabel: string;
  unit: WeightUnit;
  onClose: () => void;
}) {
  const [a, setA] = useState<string | null>(initial.a);
  const [b, setB] = useState<string | null>(initial.b);
  const [picking, setPicking] = useState<"a" | "b" | null>(null);
  useEffect(() => {
    if (!open) return;
    setA(initial.a);
    setB(initial.b);
    setPicking(initial.a && initial.b ? null : initial.a ? "b" : "a");
  }, [open, initial.a, initial.b]);

  const hall = useMemo(() => hallSplits(rows), [rows]);
  const la = a ? lifterFor(rows, a) : null;
  const lb = b ? lifterFor(rows, b) : null;
  const cmp = la && lb && a !== b ? compareLifters(la, lb, unit, hall) : null;
  // two lifters squaring up: the clash, once per pairing (a swap is the same two)
  const pair = cmp ? [a, b].sort().join("|") : null;
  const lastPair = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { lastPair.current = null; return; }
    if (pair && pair !== lastPair.current) feedback("versus");
    lastPair.current = pair;
  }, [open, pair]);

  const pick = (key: string) => {
    if (picking === "a") { setA(key); if (key === b) setB(null); }
    else { setB(key); if (key === a) setA(null); }
    const other = picking === "a" ? b : a;
    setPicking(other && other !== key ? null : picking === "a" ? "b" : "a");
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="flex max-h-[92dvh] flex-col gap-0 rounded-t-[22px] p-0 sm:mx-auto sm:max-w-[560px]" data-compare-sheet>
        <SheetHeader className="shrink-0 space-y-0 border-b border-border/60 px-4 pb-3 pt-2 text-left">
          <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
          <div className="relative flex min-h-9 items-center justify-center">
            <SheetTitle className="text-[16px] font-semibold">Head to head</SheetTitle>
            <SheetDescription className="sr-only">Compare two lifters' totals, lifts and splits</SheetDescription>
            <SheetClose className="absolute -right-1.5 grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted" aria-label="Close">
              <X className="h-5 w-5" />
            </SheetClose>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Slot lifter={la} active={picking === "a"} onTap={() => setPicking(picking === "a" ? null : "a")} />
            <button
              type="button"
              onClick={() => { setA(b); setB(a); }}
              disabled={!a || !b}
              className="grid h-10 w-10 place-items-center rounded-full bg-muted text-[12px] font-bold text-muted-foreground disabled:opacity-60"
              aria-label="Swap sides"
              data-compare-swap
            >
              {a && b ? <ArrowLeftRight className="h-4 w-4" /> : "VS"}
            </button>
            <Slot lifter={lb} active={picking === "b"} onTap={() => setPicking(picking === "b" ? null : "b")} />
          </div>
          <div className="mt-2 text-center text-[11px] text-muted-foreground">{sourceLabel}</div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          {picking ? (
            <Picker rows={rows} exclude={picking === "a" ? b : a} onPick={pick} unit={unit} />
          ) : cmp ? (
            <ComparisonBody cmp={cmp} unit={unit} />
          ) : (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Pick two lifters with a total on this board.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Slot({ lifter, active, onTap }: { lifter: CompareLifter | null; active: boolean; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={active}
      className={cn(
        "flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 transition-colors",
        active ? "border-foreground bg-muted/60" : "border-border active:bg-muted",
      )}
      data-compare-slot
    >
      {lifter ? (
        <>
          <UserAvatar src={lifter.total.avatar_url} name={lifter.total.display_name} size={36} expandable={false} />
          <span className="w-full truncate text-center text-[13px] font-semibold">{lifter.name}</span>
        </>
      ) : (
        <>
          <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed text-muted-foreground"><Search className="h-4 w-4" /></span>
          <span className="text-[12px] text-muted-foreground">Pick a lifter</span>
        </>
      )}
    </button>
  );
}

function Picker({ rows, exclude, onPick, unit }: { rows: StrengthRow[]; exclude: string | null; onPick: (key: string) => void; unit: WeightUnit }) {
  const [q, setQ] = useState("");
  const all = useMemo(() => totalsOn(rows), [rows]);
  const needle = q.trim().toLowerCase();
  const list = all.filter((r) => r.key !== exclude && (!needle || r.display_name.toLowerCase().includes(needle) || (r.is_me && "you".startsWith(needle))));
  return (
    <div className="space-y-2" data-compare-picker>
      <label className="flex h-10 items-center gap-2 rounded-xl bg-muted/60 px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search lifters"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          name="search-lifter"
          enterKeyHint="search"
        />
      </label>
      <ul className="divide-y divide-border/60">
        {list.map((r) => {
          const split = splitOf(r);
          return (
            <li key={r.key}>
              <button type="button" onClick={() => onPick(r.key)} className="flex w-full items-center gap-3 py-2 text-left active:bg-muted">
                <UserAvatar src={r.avatar_url} name={r.display_name} size={36} expandable={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{r.is_me ? "You" : r.display_name}</span>
                  {split && <SplitBar split={split} className="mt-1 w-28" />}
                </span>
                <span className="shrink-0 text-[14px] font-semibold tabular-nums">{formatLoad(r.kg, unit)}</span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="py-6 text-center text-[13px] text-muted-foreground">Nobody by that name with a total on this board.</li>}
      </ul>
    </div>
  );
}

function ComparisonBody({ cmp, unit }: { cmp: Comparison; unit: WeightUnit }) {
  const { a, b } = cmp;
  return (
    <div className="space-y-5 pb-2" data-comparison>
      <div className="text-center text-[17px] font-semibold leading-snug" data-compare-headline>{cmp.headline}</div>

      <ul className="space-y-3" data-compare-duels>
        {cmp.duels.map((d) => <DuelRow key={d.lift} d={d} unit={unit} />)}
      </ul>

      {a.split && b.split && (
        <Section title="Where each total comes from">
          {[a, b].map((s) => (
            <div key={s.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate font-medium">{s.name}{s.profile ? <span className="font-normal text-muted-foreground"> · {s.profile.title}</span> : null}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{SPLIT_LIFTS.map((l) => pct(s.split!.share[l], 1)).join(" / ")}</span>
              </div>
              <SplitBar split={s.split!} sex={s.sex} size="full" />
            </div>
          ))}
          <SplitLegend className="pt-1" />
        </Section>
      )}

      {cmp.lines.length > 0 && (
        <Section title="The breakdown">
          <ul className="space-y-1.5 text-[14px] leading-snug" data-compare-lines>
            {cmp.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </Section>
      )}

      {(cmp.unique.a.length > 0 || cmp.unique.b.length > 0) && (
        <Section title="What sets them apart">
          <div className="space-y-3">
            {(["a", "b"] as const).map((s) => cmp.unique[s].length > 0 && (
              <div key={s} className="rounded-xl bg-muted/50 p-3">
                <div className="text-[14px] font-semibold">{(s === "a" ? a : b).name}</div>
                <ul className="mt-1 space-y-1 text-[13px] leading-snug text-foreground/85">
                  {cmp.unique[s].map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      {cmp.notes.length > 0 && (
        <ul className="space-y-1 text-[12px] leading-snug text-muted-foreground">
          {cmp.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * One lift, both lifters: the weights at the ends, the winner's in bold, and
 * a bar from the middle toward whoever's ahead, as long as the gap is a share
 * of the bigger lift (a 25% gap fills its half). × bodyweight
 * under each, so "more weight" and "more for their size" read apart.
 */
function DuelRow({ d, unit }: { d: LiftDuel; unit: WeightUnit }) {
  const name = d.lift === "total" ? "Total" : SPLIT_NAME[d.lift];
  const color = d.lift === "total" ? "var(--foreground)" : SPLIT_COLOR[d.lift];
  const max = Math.max(d.a ?? 0, d.b ?? 0);
  const frac = d.diff != null && max > 0 ? Math.min(1, Math.abs(d.diff) / max / 0.25) : 0;
  const lead = d.leader;
  return (
    <li data-duel={d.lift}>
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span className="tabular-nums">{d.aBw != null ? `${d.aBw.toFixed(2)}× BW` : ""}</span>
        <span className="font-medium text-foreground">{name}</span>
        <span className="tabular-nums">{d.bBw != null ? `${d.bBw.toFixed(2)}× BW` : ""}</span>
      </div>
      <div className="mt-0.5 grid grid-cols-[minmax(0,5.5rem)_1fr_minmax(0,5.5rem)] items-center gap-2">
        <span className={cn("truncate text-[15px] tabular-nums", lead === "a" ? "font-semibold" : "text-muted-foreground")}>{d.a != null ? formatLoad(d.a, unit) : "—"}</span>
        <span className="relative h-2 rounded-full bg-muted" aria-hidden>
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-border" />
          {lead && lead !== "tie" && (
            <span
              className={cn("absolute inset-y-0 rounded-full", lead === "a" ? "right-1/2" : "left-1/2")}
              style={{ width: `${Math.max(4, frac * 50)}%`, background: color }}
            />
          )}
        </span>
        <span className={cn("truncate text-right text-[15px] tabular-nums", lead === "b" ? "font-semibold" : "text-muted-foreground")}>{d.b != null ? formatLoad(d.b, unit) : "—"}</span>
      </div>
      {d.diff != null && (
        <div className="mt-0.5 text-center text-[11px] text-muted-foreground tabular-nums">
          {lead === "tie" ? "Even" : `+${formatLoad(Math.abs(d.diff), unit)}`}
        </div>
      )}
    </li>
  );
}
