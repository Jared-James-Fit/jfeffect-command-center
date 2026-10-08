/**
 * Admin dashboard helpers. Pure, so they're easy to test.
 *
 * The dashboard is an overview, not another inbox: the Clients page and Messages already
 * organise the to-do list. Here we only summarise (snapshot tiles that open those pages,
 * already filtered) and show what those pages don't: today's training, this week's records,
 * and the business numbers (admin_dashboard_overview).
 */

export type InboxRow = {
  client_id: string;
  archived: boolean | null;
  unread: boolean | null;
  workflow_status: string | null;
  last_inbound_at: string | null;
  last_inbound_kind: string | null;
};

/** Conversations waiting on staff: same rule as the Messages tab badge. */
export function waitingOnMe(inbox: InboxRow[]): InboxRow[] {
  return inbox.filter((r) => !r.archived && (r.workflow_status === "needs_response" || !!r.unread));
}

export type SnapshotTile = {
  key: "replies" | "checkins" | "payments" | "agreements" | "ending" | "missed";
  label: string;
  value: number;
  hint: string;
  /** Clients-page filter the tile opens (null = Messages). */
  flag: string | null;
  tone: "danger" | "warn" | "info";
};

/** The six numbers worth seeing every morning. Each tile opens the matching filtered list. */
export function buildSnapshot(input: {
  waitingReplies: number;
  counts: Partial<Record<string, number>>;
}): SnapshotTile[] {
  const n = (k: string) => Number(input.counts[k] ?? 0);
  const payIssues = n("payment_issues");
  const noPay = n("no_payment");
  const pending = n("payment_pending");
  return [
    { key: "replies", label: "Replies waiting", value: input.waitingReplies, hint: "Conversations waiting on you", flag: null, tone: "warn" },
    { key: "checkins", label: "Check-ins to review", value: n("needs_review"), hint: "Check-ins and forms nobody has reviewed", flag: "needs_review", tone: "warn" },
    {
      key: "payments", label: "Payments to fix", value: payIssues + noPay + pending,
      hint: [payIssues && `${payIssues} failed`, noPay && `${noPay} not set up`, pending && `${pending} awaiting`].filter(Boolean).join(" · ") || "All set",
      flag: payIssues ? "payment_issues" : noPay ? "no_payment" : pending ? "payment_pending" : "no_payment",
      tone: payIssues ? "danger" : "warn",
    },
    { key: "agreements", label: "Unsigned agreements", value: n("no_contract"), hint: "Coaching agreements not signed", flag: "no_contract", tone: "warn" },
    { key: "ending", label: "Programs ending", value: n("program_ending"), hint: "Programs ending in 14 days with nothing next", flag: "program_ending", tone: "info" },
    { key: "missed", label: "Missed workouts", value: n("missed_workouts"), hint: "2+ missed workouts in 14 days", flag: "missed_workouts", tone: "warn" },
  ];
}

/* ------------------------------------------------------------------ */
/* Overview (admin_dashboard_overview)                                 */
/* ------------------------------------------------------------------ */

export type OverviewSession = {
  client_id: string; name: string | null; avatar: string | null; title: string | null;
  status: "done" | "training" | "pending"; completed_at: string | null;
};
export type OverviewWin = {
  client_id: string; name: string | null; avatar: string | null; exercise: string | null;
  reps: number | null; load_kg: number | null; unit: string | null; tier: "atpr" | "program" | "block"; at: string;
};
export type OverviewMoney = { currency: string; this_month: number; last_month_to_date: number; last_month: number; payments: number };
export type Overview = {
  today: string;
  is_admin: boolean;
  training: { scheduled: OverviewSession[]; unscheduled: Array<Omit<OverviewSession, "status"> & { status?: never }> };
  wins: OverviewWin[];
  money: OverviewMoney[] | null;
  leads: { new_7d: number; new_30d: number; latest: Array<{ id: string; name: string | null; submitted_at: string; temperature: string | null; status: string | null }> } | null;
  roster: { active: number; new_this_month: number };
};

export const TIER_LABEL: Record<OverviewWin["tier"], string> = {
  atpr: "All-time PR",
  program: "Program PR",
  block: "Block PR",
};
const TIER_RANK: Record<OverviewWin["tier"], number> = { atpr: 3, program: 2, block: 1 };

/** 176.9 kg in lb → "390 lb"; kg shown to the nearest 0.5. */
export function formatLoad(kg: number | null | undefined, unit: string | null | undefined): string | null {
  if (kg == null || !(kg > 0)) return null;
  if (unit === "kg") return `${Math.round(kg * 2) / 2} kg`;
  return `${Math.round(kg * 2.2046226)} lb`;
}

/** One line per lift: "Leg Press 390 lb × 15". */
export function winLine(w: OverviewWin): string {
  const load = formatLoad(w.load_kg, w.unit);
  return [w.exercise ?? "Lift", load && w.reps ? `${load} × ${w.reps}` : load].filter(Boolean).join(" ");
}

/** Records grouped by client: best tier first, then most recent. */
export function groupWins(wins: OverviewWin[]): Array<{ client_id: string; name: string; avatar: string | null; best: OverviewWin["tier"]; lifts: OverviewWin[]; at: string }> {
  const by = new Map<string, OverviewWin[]>();
  for (const w of wins) by.set(w.client_id, [...(by.get(w.client_id) ?? []), w]);
  return [...by.entries()]
    .map(([client_id, lifts]) => {
      const sorted = [...lifts].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.at.localeCompare(a.at));
      return {
        client_id,
        name: sorted[0].name?.trim() || "Client",
        avatar: sorted[0].avatar ?? null,
        best: sorted[0].tier,
        lifts: sorted,
        at: lifts.reduce((m, l) => (l.at > m ? l.at : m), lifts[0].at),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** "+117% vs this point last month" (null when last month had nothing to compare). */
export function revenueDelta(m: OverviewMoney): { pct: number; up: boolean } | null {
  if (!(m.last_month_to_date > 0)) return null;
  const pct = Math.round(((m.this_month - m.last_month_to_date) / m.last_month_to_date) * 100);
  return { pct: Math.abs(pct), up: pct >= 0 };
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
