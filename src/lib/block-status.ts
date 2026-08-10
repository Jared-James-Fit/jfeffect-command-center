/**
 * Canonical client-block status derivation.
 *
 * The `pl_blocks.status` column is maintained by several different flows
 * (auto-scheduling, manual archive, mark-complete, template assignment) and
 * can drift — e.g. multiple blocks claiming "Active", or a stale "Draft" on
 * a block the client is already training from. Rather than trusting the raw
 * column, the editor and client hub derive ONE display status per block from
 * the safest available sources:
 *
 *   1. Explicit terminal states win: Archived flag/status → "Archived",
 *      Completed status/completed_at → "Completed".
 *   2. Exactly one "Active" block: prefer a block flagged Active whose date
 *      range contains today, then any block flagged Active, then any block
 *      whose [start_date, end_date] contains today.
 *   3. Remaining blocks are placed relative to the active block in
 *      sort_order: later blocks with a start_date are "Upcoming", without
 *      dates "Draft"; earlier blocks whose end_date already passed are
 *      "Completed" (they've been trained through), otherwise they keep the
 *      Upcoming/Draft rule.
 *
 * This is display-only — no database writes.
 */
export type CanonicalBlockStatus = "Active" | "Upcoming" | "Draft" | "Completed" | "Archived";

export function todayISOLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function orderOf(block: any, fallback: number): number {
  const so = Number(block?.sort_order);
  return Number.isFinite(so) ? so : fallback;
}

/** Derive one canonical status per block id. Input order does not matter. */
export function deriveBlockStatuses(blocks: any[], today: string = todayISOLocal()): Map<string, CanonicalBlockStatus> {
  const map = new Map<string, CanonicalBlockStatus>();
  const sorted = (blocks ?? [])
    .map((b: any, i: number) => ({ b, i }))
    .sort((a, b2) =>
      (orderOf(a.b, a.i) - orderOf(b2.b, b2.i)) ||
      String(a.b?.created_at ?? "").localeCompare(String(b2.b?.created_at ?? "")),
    );

  const live: { b: any; i: number }[] = [];
  for (const entry of sorted) {
    const b = entry.b;
    if (b?.status === "Archived" || b?.archived) {
      map.set(b.id, "Archived");
    } else if (b?.status === "Completed" || b?.completed_at) {
      map.set(b.id, "Completed");
    } else {
      live.push(entry);
    }
  }
  if (!live.length) return map;

  const inRange = (b: any) => {
    const s: string | null = b?.start_date ?? null;
    if (!s) return false;
    const e: string | null = b?.end_date ?? null;
    return s <= today && (!e || e >= today);
  };

  let activeIdx = live.findIndex(({ b }) => b?.status === "Active" && inRange(b));
  if (activeIdx < 0) activeIdx = live.findIndex(({ b }) => b?.status === "Active");
  if (activeIdx < 0) activeIdx = live.findIndex(({ b }) => inRange(b));

  live.forEach(({ b }, idx) => {
    if (idx === activeIdx) {
      map.set(b.id, "Active");
      return;
    }
    const past = !!b?.end_date && b.end_date < today;
    if (activeIdx >= 0 && idx < activeIdx && past) {
      map.set(b.id, "Completed");
      return;
    }
    map.set(b.id, b?.start_date ? "Upcoming" : "Draft");
  });
  return map;
}

/** The single active block, if any, after derivation. */
export function pickActiveBlock(blocks: any[], today?: string): any | null {
  const statuses = deriveBlockStatuses(blocks, today);
  return (blocks ?? []).find((b: any) => statuses.get(b?.id) === "Active") ?? null;
}

/** Shared badge tone for a canonical status. */
export function blockStatusTone(status?: string | null): string {
  switch (status) {
    case "Active":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "Completed":
      return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "Upcoming":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "Draft":
      return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
    case "Archived":
      return "border-muted-foreground/30 bg-muted/40 text-muted-foreground";
    default:
      return "";
  }
}