/**
 * Every account that isn't a team login, as `admin_account_directory()` returns it (one row per
 * person: their login, athlete record and membership row, whichever exist), and how Member
 * Management reads it. Pure: filters, sorting, counts and words, no fetching.
 *
 * Coaching clients are Client Management's; everyone else is here: free members, paid and
 * complimentary members, Premium, program-only accounts, logins that never got an athlete record,
 * accounts a member record was made for before its login, and the disclosed virtual accounts.
 * Real, test, demo and virtual accounts are told apart, never mixed into one count.
 */

export type AccountKind = "coaching" | "member" | "pending";
export type AccountClass = "real" | "test" | "demo" | "sandbox" | "virtual";
export type AccountLifecycle =
  | "active"
  | "archived"
  | "deactivated"
  | "pending_deletion"
  | "not_set_up"
  | "unconfirmed"
  | "paused";
export type AccountIssue =
  | "no_record"
  | "no_member_row"
  | "no_client_row"
  | "member_row_archived"
  | "coaching_package_on_member"
  | "member_package_on_client"
  | "paid_without_subscription"
  | "stripe_ended_package_active"
  | "unconfirmed";

export type MembershipBadge = "coaching" | "premium" | "member" | "free";

export type AccountRow = {
  user_id: string | null;
  client_id: string | null;
  member_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  username: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  last_seen_at: string | null;
  last_workout_at: string | null;
  workouts_30d: number;
  kind: AccountKind;
  plan_key: string;
  plan_label: string;
  badge: MembershipBadge | null;
  account_class: AccountClass;
  lifecycle: AccountLifecycle;
  subscription_status: string | null;
  billing_issue: boolean;
  confirmed: boolean;
  starred: boolean;
  issues: AccountIssue[];
};

/** A stable key for a row: a person may have a login, a record, a membership row, or only some. */
export function accountKey(r: Pick<AccountRow, "user_id" | "client_id" | "member_id">): string {
  return r.user_id ?? (r.client_id ? `c:${r.client_id}` : `m:${r.member_id ?? "?"}`);
}

/** The accounts Member Management lists: everyone but coaching clients (and never a sandbox). */
export function memberAccounts(rows: AccountRow[]): AccountRow[] {
  return rows.filter((r) => r.kind !== "coaching" && r.account_class !== "sandbox");
}

export const MEMBER_FILTERS = [
  "active",
  "free",
  "member",
  "premium",
  "program_only",
  "pending",
  "attention",
  "test",
  "virtual",
  "archived",
  "deactivated",
] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

export const FILTER_LABEL: Record<MemberFilter, string> = {
  active: "Active",
  free: "Free",
  member: "Member",
  premium: "Premium",
  program_only: "Program only",
  pending: "No record",
  attention: "Needs attention",
  test: "Test & demo",
  virtual: "Virtual",
  archived: "Archived",
  deactivated: "Deactivated",
};

const CLOSED: AccountLifecycle[] = ["archived", "deactivated", "pending_deletion"];

/** Real people only: what "how many members" means. */
export function isRealAccount(r: AccountRow): boolean {
  return r.account_class === "real";
}

/** Whether a row is in a filter. Test, demo and virtual accounts only show under their own. */
export function inFilter(r: AccountRow, f: MemberFilter): boolean {
  const real = isRealAccount(r);
  const open = !CLOSED.includes(r.lifecycle);
  switch (f) {
    case "active":
      return real && open;
    case "free":
      return real && open && r.kind === "member" && r.plan_key === "free";
    case "member":
      return real && open && r.kind === "member" && !["free", "premium", "program_only", "none"].includes(r.plan_key);
    case "premium":
      return real && open && r.plan_key === "premium";
    case "program_only":
      return real && open && r.plan_key === "program_only";
    case "pending":
      return real && r.kind === "pending";
    case "attention":
      return real && open && (r.billing_issue || needsAttention(r));
    case "test":
      return r.account_class === "test" || r.account_class === "demo";
    case "virtual":
      return r.account_class === "virtual";
    case "archived":
      return real && (r.lifecycle === "archived" || r.lifecycle === "pending_deletion");
    case "deactivated":
      return real && r.lifecycle === "deactivated";
  }
}

/** Issues that need a decision (an unconfirmed login is only information). */
export function needsAttention(r: AccountRow): boolean {
  return r.issues.some((i) => i !== "unconfirmed");
}

export function filterCounts(rows: AccountRow[]): Record<MemberFilter, number> {
  const out = Object.fromEntries(MEMBER_FILTERS.map((f) => [f, 0])) as Record<MemberFilter, number>;
  for (const r of rows) for (const f of MEMBER_FILTERS) if (inFilter(r, f)) out[f]++;
  return out;
}

export type MemberSort = "activity" | "name" | "newest";
export const SORT_LABEL: Record<MemberSort, string> = {
  activity: "Recent activity",
  name: "Name",
  newest: "Newest",
};

const time = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
export function lastActivity(r: AccountRow): number {
  return Math.max(time(r.last_seen_at), time(r.last_workout_at), time(r.last_sign_in_at));
}

export type ListOptions = {
  filter: MemberFilter;
  query: string;
  sort: MemberSort;
  /** Starred first, or only the starred. */
  starred?: "first" | "only" | null;
};

/** Search on name, email, phone or @username, accents and case folded. */
export function matchesQuery(r: AccountRow, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return [r.name, r.email, r.phone, r.username ? `@${r.username}` : null].some((v) => v && fold(v).includes(q));
}
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function listMembers(rows: AccountRow[], o: ListOptions): AccountRow[] {
  const list = memberAccounts(rows).filter((r) => inFilter(r, o.filter) && matchesQuery(r, o.query));
  const cmp = (a: AccountRow, b: AccountRow): number => {
    if (o.sort === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (o.sort === "newest") return time(b.created_at) - time(a.created_at);
    return lastActivity(b) - lastActivity(a) || a.name.localeCompare(b.name);
  };
  const sorted = [...list].sort(cmp);
  if (o.starred === "only") return sorted.filter((r) => r.starred);
  if (o.starred === "first") return [...sorted.filter((r) => r.starred), ...sorted.filter((r) => !r.starred)];
  return sorted;
}

/** "Free", "Premium", "Member (complimentary)", "No plan yet": the plan in the row's words. */
export function planWords(r: AccountRow): string {
  if (r.account_class === "virtual") return "Virtual · Free";
  return r.plan_label || "Free";
}

const LIFECYCLE_WORD: Record<AccountLifecycle, string | null> = {
  active: null,
  archived: "Archived",
  deactivated: "Deactivated",
  pending_deletion: "Being deleted",
  not_set_up: "Not set up",
  unconfirmed: "Email not confirmed",
  paused: "Paused",
};

/** One status chip: the most important thing about the account, or nothing when all is well. */
export function statusChip(r: AccountRow): { label: string; tone: "warn" | "danger" | "muted" } | null {
  if (r.billing_issue) return { label: "Payment failing", tone: "danger" };
  if (r.issues.includes("no_record")) return { label: "No athlete record", tone: "warn" };
  if (r.issues.includes("no_member_row") || r.issues.includes("no_client_row")) return { label: "Out of sync", tone: "warn" };
  if (r.issues.includes("member_row_archived")) return { label: "Membership archived", tone: "warn" };
  if (r.issues.includes("paid_without_subscription")) return { label: "No subscription on file", tone: "warn" };
  const word = LIFECYCLE_WORD[r.lifecycle];
  return word ? { label: word, tone: "muted" } : null;
}

/** Plain-words for the sync status card. */
export const ISSUE_WORDS: Record<AccountIssue, { title: string; body: string; fixable: boolean }> = {
  no_record: {
    title: "Login with no athlete record",
    body: "They can sign in but have no member or client record, so they were in neither list. Make them a free member, or mark the login as a test.",
    fixable: false,
  },
  no_member_row: {
    title: "Member record with no membership",
    body: "Their athlete record is self-serve but there's no membership row, so library access can't be granted. Reconcile adds a free membership.",
    fixable: true,
  },
  no_client_row: {
    title: "Membership with no athlete record",
    body: "There's a membership row but no athlete record. Reconcile makes the record, so their training has a home.",
    fixable: true,
  },
  member_row_archived: {
    title: "Membership archived, record active",
    body: "Their athlete record is active while the membership row says archived or cancelled. Decide which is right.",
    fixable: false,
  },
  coaching_package_on_member: {
    title: "Coaching package on a member",
    body: "An active coaching package while the account is self-serve. Move them to coaching, or end the package.",
    fixable: false,
  },
  member_package_on_client: {
    title: "Member package on a coaching client",
    body: "An active membership package while the account is coaching. Check their plan.",
    fixable: false,
  },
  paid_without_subscription: {
    title: "Paid with no subscription",
    body: "Their membership says paid but no Stripe subscription is linked. Check their billing.",
    fixable: false,
  },
  stripe_ended_package_active: {
    title: "Stripe ended, package still on",
    body: "Stripe says their subscription ended while their coaching package is still active. End coaching from their plan card, or check Stripe.",
    fixable: false,
  },
  unconfirmed: {
    title: "Email not confirmed",
    body: "The login was made but the email was never confirmed, so it can't sign in.",
    fixable: false,
  },
};

export type SyncIssueRow = {
  user_id: string | null;
  client_id: string | null;
  member_id: string | null;
  name: string;
  account_class: AccountClass;
  kind: AccountKind;
  issues: AccountIssue[];
};

/** What the sync status says at the top: in sync, or how many need a look and how many fix themselves. */
export function syncSummary(issues: SyncIssueRow[]): { state: "ok" | "attention"; decisions: number; fixable: number } {
  const real = issues.filter((i) => i.account_class === "real");
  const meaningful = real.filter((i) => i.issues.some((x) => x !== "unconfirmed"));
  const fixable = real.filter((i) => i.issues.some((x) => ISSUE_WORDS[x]?.fixable)).length;
  return { state: meaningful.length ? "attention" : "ok", decisions: meaningful.length - fixable, fixable };
}

/** Relative time in a row: "Today", "3d", "5w", "Never". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = time(iso);
  if (!t) return "Never";
  const d = Math.floor((now - t) / 86_400_000);
  if (d <= 0) return "Today";
  if (d < 7) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
