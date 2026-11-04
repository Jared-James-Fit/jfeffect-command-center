/**
 * Admin dashboard helpers. Pure, so they're easy to test.
 *
 * The dashboard is an overview, not another inbox: the Clients page and Messages already
 * organise the to-do list. Here we only summarise (snapshot tiles that open those pages,
 * already filtered) and show what those pages don't: today's training
 * (admin_dashboard_overview). This week's records live in Crew (props, Wednesday Wins)
 * and adherence in Training Intel, so neither is repeated here.
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
export type Overview = {
  today: string;
  is_admin: boolean;
  training: { scheduled: OverviewSession[]; unscheduled: Array<Omit<OverviewSession, "status"> & { status?: never }> };
};

/** Training today as one line: "3 of 8 done · 1 training now · 2 more trained". */
export function trainingSummary(scheduled: Pick<OverviewSession, "status">[], extra: number): { total: number; line: string } {
  const done = scheduled.filter((s) => s.status === "done").length;
  const now = scheduled.filter((s) => s.status === "training").length;
  const parts = [
    scheduled.length ? `${done} of ${scheduled.length} done` : null,
    now ? `${now} training now` : null,
    extra ? `${extra} ${scheduled.length ? "more " : ""}trained` : null,
  ].filter(Boolean);
  return { total: scheduled.length + extra, line: parts.join(" · ") };
}
