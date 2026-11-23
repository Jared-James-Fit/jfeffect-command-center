/**
 * The program editor's Program view: every block of the program on one
 * timeline, coloured by its block type (the same colours as the block tabs,
 * the Training tab and Program Intelligence), each block's purpose in a line,
 * and its weeks a tap away. A template shows its own blocks; a client's block
 * editor shows the client's program (their blocks in order).
 */
import { createContext, useContext, useMemo } from "react";
import { CalendarRange, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorClass, type ResolvedBlockType } from "@/lib/block-types";
import { BlockTypeChip } from "./block-type-picker";

export type OverviewBlock = {
  id: string;
  name: string;
  weeks: number;
  /** Phase or focus per week, when the editor knows them. */
  weekPhases?: Array<string | null>;
  start?: string | null;
  end?: string | null;
  /** "Active", "Upcoming", "Completed", "Draft", "Hidden from client" */
  status?: string | null;
  resolved: ResolvedBlockType;
  current?: boolean;
  /** Opens the block (a week of it, when given). */
  onOpen?: (week?: number) => void;
  onType?: () => void;
};

export type ProgramOverviewValue = { blocks: OverviewBlock[]; title?: string | null };
export const ProgramOverviewContext = createContext<ProgramOverviewValue | null>(null);
export function useProgramOverview() {
  return useContext(ProgramOverviewContext);
}

const fmt = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function ProgramOverview({ value, today }: { value: ProgramOverviewValue; today?: string }) {
  const blocks = value.blocks;
  const total = blocks.reduce((n, b) => n + Math.max(1, b.weeks), 0);
  const first = blocks.find((b) => b.start)?.start ?? null;
  const last = [...blocks].reverse().find((b) => b.end)?.end ?? null;
  const day = today ?? new Date().toISOString().slice(0, 10);
  // where today falls on the timeline, when the blocks are dated
  const nowPct = useMemo(() => {
    let acc = 0;
    for (const b of blocks) {
      const w = Math.max(1, b.weeks);
      if (b.start && b.end && day >= b.start && day <= b.end) {
        const span = Math.max(1, Date.parse(b.end) - Date.parse(b.start));
        return ((acc + (w * (Date.parse(day) - Date.parse(b.start))) / span) / total) * 100;
      }
      acc += w;
    }
    return null;
  }, [blocks, day, total]);

  if (!blocks.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No blocks yet.</p>;

  return (
    <div className="space-y-4" data-program-overview>
      <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold">{value.title || "Program"}</h2>
          <span className="text-xs text-muted-foreground">
            {blocks.length} block{blocks.length === 1 ? "" : "s"} · {total} week{total === 1 ? "" : "s"}
            {first || last ? ` · ${fmt(first) ?? "?"} – ${fmt(last) ?? "?"}` : ""}
          </span>
        </div>
        {/* one bar: a segment per block, sized by its weeks, coloured by its type */}
        <div className="relative">
          <div className="flex h-9 w-full gap-0.5 overflow-hidden rounded-xl" role="list" aria-label="Blocks on the timeline">
            {blocks.map((b) => {
              const c = colorClass(b.resolved.type);
              return (
                <button
                  key={b.id}
                  type="button"
                  role="listitem"
                  onClick={() => b.onOpen?.()}
                  style={{ flexGrow: Math.max(1, b.weeks), flexBasis: 0 }}
                  className={cn("relative min-w-[18px] transition-opacity hover:opacity-90", b.resolved.type ? c.bar : "bg-muted", b.current && "ring-2 ring-inset ring-foreground/70", b.status === "Completed" && "opacity-60")}
                  aria-label={`${b.name}${b.resolved.type ? `, ${b.resolved.type.name}` : ""}, ${b.weeks} weeks`}
                  title={`${b.name} · ${b.weeks} wk`}
                  data-overview-segment={b.resolved.type?.key ?? ""}
                />
              );
            })}
          </div>
          {nowPct != null && (
            <div className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 rounded-full bg-foreground" style={{ left: `${nowPct}%` }} aria-hidden data-overview-today />
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {[...new Map(blocks.filter((b) => b.resolved.type).map((b) => [b.resolved.type!.key, b.resolved.type!])).values()].map((t) => (
            <span key={t.key} className="inline-flex items-center gap-1">
              <span aria-hidden className={cn("h-2 w-2 rounded-full", colorClass(t).dot)} /> {t.name}
            </span>
          ))}
          {nowPct != null && <span className="inline-flex items-center gap-1"><span aria-hidden className="h-2.5 w-0.5 rounded-full bg-foreground" /> Today</span>}
        </div>
      </div>

      <ol className="space-y-2">
        {blocks.map((b, i) => {
          const c = colorClass(b.resolved.type);
          return (
            <li key={b.id} className={cn("overflow-hidden rounded-2xl border bg-card", b.current ? "border-foreground/40" : "border-border")} data-overview-block>
              <div className="flex">
                <div aria-hidden className={cn("w-1.5 shrink-0", b.resolved.type ? c.bar : "bg-muted")} />
                <div className="min-w-0 flex-1 space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs tabular-nums text-muted-foreground">Block {i + 1}</span>
                        {b.status ? <span className="text-xs text-muted-foreground">· {b.status}</span> : null}
                        {b.current ? <span className="rounded-full bg-foreground px-1.5 text-[10px] font-semibold text-background">Editing</span> : null}
                      </div>
                      <div className="truncate text-[15px] font-semibold">{b.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {b.weeks} week{b.weeks === 1 ? "" : "s"}
                        {b.start || b.end ? ` · ${fmt(b.start) ?? "?"} – ${fmt(b.end) ?? "?"}` : ""}
                      </div>
                    </div>
                    <BlockTypeChip resolved={b.resolved} onClick={b.onType} className="shrink-0" />
                  </div>
                  {b.resolved.purpose ? <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{b.resolved.purpose}</p> : null}
                  {b.onOpen && (
                    <div className="flex flex-wrap items-center gap-1">
                      {Array.from({ length: Math.max(1, b.weeks) }, (_, w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => b.onOpen?.(w)}
                          className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-muted px-2 text-xs font-semibold tabular-nums hover:bg-secondary"
                          title={b.weekPhases?.[w] ? `Week ${w + 1} · ${b.weekPhases[w]}` : `Week ${w + 1}`}
                          aria-label={`Open week ${w + 1} of ${b.name}`}
                        >
                          {w + 1}
                        </button>
                      ))}
                      <button type="button" onClick={() => b.onOpen?.()} className="ml-auto inline-flex h-9 items-center gap-0.5 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                        <CalendarRange className="mr-1 h-3.5 w-3.5" /> Open <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
