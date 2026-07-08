/**
 * Shared block metadata + resolver utilities for the analytics filter and
 * BlockPickerSheet. Route-level queries fetch pl_blocks with the pl_preps
 * relationship once; every consumer normalizes and picks from that single
 * source of truth. No component in the analytics tree should issue a
 * second pl_blocks query.
 */
import { supabase } from "@/integrations/supabase/client";

export type AnalyticsBlock = {
  id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  weeks: number | null;
  sort_order: number;
  training_focus: string | null;
  prep_id: string | null;
  pl_preps: {
    id: string;
    title: string;
    event_name: string | null;
    event_date: string | null;
  } | null;
};

/**
 * Normalize a raw pl_blocks row (with pl_preps joined) into AnalyticsBlock.
 * Supabase returns embedded singletons as either an array or object depending
 * on generated types — normalize once here so downstream code never repeats
 * the check.
 */
export function normalizeAnalyticsBlock(raw: any): AnalyticsBlock {
  const prep = Array.isArray(raw?.pl_preps) ? (raw.pl_preps[0] ?? null) : (raw?.pl_preps ?? null);
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    status: raw?.status ?? null,
    start_date: raw?.start_date ?? null,
    end_date: raw?.end_date ?? null,
    weeks: raw?.weeks == null ? null : Number(raw.weeks),
    sort_order: Number(raw?.sort_order ?? 0),
    training_focus: raw?.training_focus ?? null,
    prep_id: raw?.prep_id ?? null,
    pl_preps: prep
      ? {
          id: String(prep.id ?? ""),
          title: String(prep.title ?? ""),
          event_name: prep.event_name ?? null,
          event_date: prep.event_date ?? null,
        }
      : null,
  };
}

/** Local-calendar YYYY-MM-DD (not UTC). */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function statusIs(block: AnalyticsBlock, target: string): boolean {
  return (block.status ?? "").trim().toLowerCase() === target.toLowerCase();
}

/** Local Date at 00:00 for a YYYY-MM-DD string, avoiding UTC drift. */
export function parseLocalDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const [_, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
}

function endOfDayLocal(iso: string | null | undefined): Date | null {
  const d = parseLocalDate(iso);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Deterministic tie-break comparator: higher sort_order, then later start_date, then id. */
function tieBreak(a: AnalyticsBlock, b: AnalyticsBlock): number {
  if (b.sort_order !== a.sort_order) return b.sort_order - a.sort_order;
  const as = a.start_date ?? "";
  const bs = b.start_date ?? "";
  if (bs !== as) return bs.localeCompare(as);
  return a.id.localeCompare(b.id);
}

/**
 * Resolve the block that best represents "today" using local calendar dates,
 * case-insensitive status matching, and the precedence documented in the
 * analytics spec. Future-only blocks (start > today) can never resolve as
 * current.
 */
export function resolveCurrentBlock(
  blocks: AnalyticsBlock[],
  now: Date = new Date(),
): AnalyticsBlock | null {
  if (!blocks.length) return null;
  const today = localTodayIso(now);

  const containsToday = (b: AnalyticsBlock) => {
    if (!b.start_date) return false;
    if (b.start_date > today) return false;
    if (b.end_date && b.end_date < today) return false;
    return true;
  };

  // 1. Active-status AND date range contains today
  const activeContaining = blocks
    .filter((b) => statusIs(b, "active") && containsToday(b))
    .sort(tieBreak);
  if (activeContaining[0]) return activeContaining[0];

  // 2. Any block whose date range contains today
  const anyContaining = blocks.filter(containsToday).sort(tieBreak);
  if (anyContaining[0]) return anyContaining[0];

  // 3. Most recently ended scheduled block (end_date < today)
  const recentlyEnded = blocks
    .filter((b) => b.end_date && b.end_date < today)
    .sort((a, b) => {
      const cmp = (b.end_date ?? "").localeCompare(a.end_date ?? "");
      if (cmp !== 0) return cmp;
      return tieBreak(a, b);
    });
  if (recentlyEnded[0]) return recentlyEnded[0];

  // 4. Legacy fallback: first Active block, whatever its dates
  const legacyActive = blocks.filter((b) => statusIs(b, "active")).sort(tieBreak);
  if (legacyActive[0]) return legacyActive[0];

  return null;
}

/**
 * Immediately preceding scheduled block relative to `currentBlock`.
 * Excludes: the current block, future blocks, undated drafts.
 */
export function resolvePreviousBlock(
  blocks: AnalyticsBlock[],
  currentBlock: AnalyticsBlock | null,
  now: Date = new Date(),
): AnalyticsBlock | null {
  const today = localTodayIso(now);
  const currentStart = currentBlock?.start_date ?? today;
  const currentId = currentBlock?.id ?? null;

  const candidates = blocks
    .filter((b) => b.id !== currentId)
    .filter((b) => b.start_date && b.start_date < currentStart)
    .filter((b) => (b.start_date ?? "") <= today);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const cmp = (b.start_date ?? "").localeCompare(a.start_date ?? "");
    if (cmp !== 0) return cmp;
    return tieBreak(a, b);
  });
  return candidates[0];
}

/** Program bucket for the picker: pl_preps.title, then event_name, then "Unassigned Program". */
export function programKeyForBlock(b: AnalyticsBlock): { key: string; title: string } {
  const prep = b.pl_preps;
  if (prep?.title?.trim()) return { key: `prep:${prep.id}`, title: prep.title };
  if (prep?.event_name?.trim()) return { key: `prep:${prep.id}`, title: prep.event_name! };
  if (b.prep_id) return { key: `prep:${b.prep_id}`, title: "Untitled Program" };
  return { key: "unassigned", title: "Unassigned Program" };
}

/** Year for grouping (from start_date). Undated blocks return null. */
export function blockYear(b: AnalyticsBlock): number | null {
  const d = parseLocalDate(b.start_date);
  return d ? d.getFullYear() : null;
}

/** All distinct years present in blocks (descending). */
export function distinctYears(blocks: AnalyticsBlock[]): number[] {
  const s = new Set<number>();
  for (const b of blocks) {
    const y = blockYear(b);
    if (y != null) s.add(y);
  }
  return [...s].sort((a, b) => b - a);
}

/** Case-insensitive multi-field search across program/block metadata. */
export function matchesQuery(b: AnalyticsBlock, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const parts: (string | null | undefined)[] = [
    b.name,
    b.training_focus,
    b.pl_preps?.title,
    b.pl_preps?.event_name,
  ];
  const d = parseLocalDate(b.start_date);
  if (d) {
    parts.push(String(d.getFullYear()));
    parts.push(d.toLocaleString("en-US", { month: "long" }));
    parts.push(d.toLocaleString("en-US", { month: "short" }));
  }
  return parts.some((p) => p && p.toLowerCase().includes(query));
}

/**
 * Written status label for the picker chip. Priority:
 *   Current (resolvedCurrentBlockId) → Upcoming → Previous/Completed → Draft/Unscheduled.
 */
export function statusLabel(
  b: AnalyticsBlock,
  resolvedCurrentBlockId: string | null | undefined,
  now: Date = new Date(),
): "Current" | "Upcoming" | "Previous" | "Completed" | "Draft" | "Unscheduled" {
  if (resolvedCurrentBlockId && b.id === resolvedCurrentBlockId) return "Current";
  const today = localTodayIso(now);
  if (!b.start_date && !b.end_date) {
    return statusIs(b, "draft") ? "Draft" : "Unscheduled";
  }
  if (b.start_date && b.start_date > today) return "Upcoming";
  if (b.end_date && b.end_date < today) {
    return statusIs(b, "completed") ? "Completed" : "Previous";
  }
  return "Previous";
}

/** Overlap detector — informational only. */
export function hasOverlappingBlocks(blocks: AnalyticsBlock[]): boolean {
  const dated = blocks.filter((b) => b.start_date);
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const c = dated[j];
      const aStart = a.start_date!;
      const aEnd = a.end_date ?? "9999-12-31";
      const cStart = c.start_date!;
      const cEnd = c.end_date ?? "9999-12-31";
      if (aStart <= cEnd && cStart <= aEnd) return true;
    }
  }
  return false;
}

/** All day IDs belonging to a block via pl_weeks. Cached per key by react-query. */
export async function getBlockDayIds(blockId: string): Promise<string[]> {
  const { data: weeks } = await supabase
    .from("pl_weeks")
    .select("id")
    .eq("block_id", blockId);
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  if (weekIds.length === 0) return [];
  const { data: days } = await supabase
    .from("pl_days")
    .select("id")
    .in("week_id", weekIds);
  return (days ?? []).map((d: any) => d.id);
}