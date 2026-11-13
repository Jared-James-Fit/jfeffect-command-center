/**
 * The coach's program library, read one way (admin/program-library.tsx).
 *
 * One list of programs (pl_templates). Two things a coach needs to see at a
 * glance come from elsewhere and are joined here, once, for every row:
 *   - who is on it now: the clients whose current or upcoming program was
 *     made from it (their own copy, pl_blocks.source_template_id);
 *   - whether members see it: its membership listing (member_plans) is live.
 * Everything else (tags, owner, team sharing, template status) stays out of
 * the list: one admin writes every program, and none of it was ever news.
 */

export type LibraryScope = "all" | "clients" | "membership" | "archived";

export const LIBRARY_SCOPES: { key: LibraryScope; label: string }[] = [
  { key: "all", label: "All" },
  { key: "clients", label: "On clients" },
  { key: "membership", label: "Membership app" },
  { key: "archived", label: "Archived" },
];

export type UsageBlock = {
  source_template_id: string | null;
  client_id: string | null;
  end_date: string | null;
  archived?: boolean | null;
  client_name?: string | null;
  client_archived?: boolean | null;
  client_status?: string | null;
};

export type ListingRow = {
  id: string;
  source_template_id: string | null;
  status: string | null;
  membership_status: string | null;
  last_published_version: number | null;
};

export type ProgramUsage = { clientId: string; name: string };

const GONE_STATUSES = new Set(["deactivated", "archived", "deleted"]);

/**
 * Clients on each template right now: a block from it that isn't archived,
 * on a client who isn't archived or deactivated, that hasn't ended before
 * today (no end date counts as running). One entry per client.
 */
export function usageByTemplate(blocks: UsageBlock[], todayISO: string): Map<string, ProgramUsage[]> {
  const out = new Map<string, ProgramUsage[]>();
  for (const b of blocks) {
    const tid = b.source_template_id;
    if (!tid || !b.client_id || b.archived) continue;
    if (b.client_archived) continue;
    if (GONE_STATUSES.has(String(b.client_status ?? "").trim().toLowerCase())) continue;
    if (b.end_date && b.end_date < todayISO) continue;
    const list = out.get(tid) ?? [];
    if (!list.some((u) => u.clientId === b.client_id)) {
      list.push({ clientId: b.client_id, name: firstName(b.client_name) });
    }
    out.set(tid, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function firstName(full: string | null | undefined): string {
  const s = String(full ?? "").trim();
  if (!s) return "A client";
  return s.split(/\s+/)[0];
}

/** "Ashley", "Ashley and Dwayne", "Ashley, Dwayne and 2 more". */
export function clientsLabel(users: ProgramUsage[]): string {
  const names = users.map((u) => u.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

export type MembershipState =
  /** not in the membership app */
  | { kind: "off"; planId: string | null }
  /** members see it, and it's the program as it is now */
  | { kind: "live"; planId: string }
  /** members see an older version: the program changed since it was listed */
  | { kind: "behind"; planId: string };

/** A live listing is status Published + membership_status live (listMembershipLibrary's own read). */
export function isLiveListing(p: Pick<ListingRow, "status" | "membership_status">): boolean {
  return p.status === "Published" && p.membership_status === "live";
}

export function membershipByTemplate(
  listings: ListingRow[],
  revisions: Map<string, number | null>,
): Map<string, MembershipState> {
  const out = new Map<string, MembershipState>();
  for (const p of listings) {
    const tid = p.source_template_id;
    if (!tid) continue;
    const prev = out.get(tid);
    // a live listing wins over a draft / unpublished one for the same program
    if (prev && prev.kind !== "off") continue;
    if (!isLiveListing(p)) {
      if (!prev) out.set(tid, { kind: "off", planId: p.id });
      continue;
    }
    const rev = revisions.get(tid) ?? null;
    const behind = rev != null && p.last_published_version != null && rev > p.last_published_version;
    out.set(tid, { kind: behind ? "behind" : "live", planId: p.id });
  }
  return out;
}

export type LibraryProgram = {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
  line: string;
  styleLabel: string;
  clients: ProgramUsage[];
  membership: MembershipState;
  /** what search reads: name, style, focus, tags, description, client names */
  haystack: string;
};

const STYLE_LABELS: Record<string, string> = {
  powerlifting: "Powerlifting",
  bodybuilding: "Bodybuilding",
  strength: "Strength",
  lifestyle: "Lifestyle",
  hybrid: "Hybrid",
  rehab: "Rehab / Pivot",
  conditioning: "Conditioning",
  powerbuilding: "Powerbuilding",
  custom: "",
};

export function styleLabel(style: string | null | undefined): string {
  const key = String(style ?? "").trim().toLowerCase();
  if (key in STYLE_LABELS) return STYLE_LABELS[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "";
}

export type PayloadShape = { weeks?: number | null; blocks?: number | null };

/**
 * "3 blocks · 12 weeks · 4 days a week · Bodybuilding": what the program is, in
 * one quiet line. Weeks are counted from the program itself when it has them
 * (a multi-block template's own `weeks` is per block), else the stored number.
 */
export function programLine(
  t: { weeks?: number | null; days_per_week?: number | null; training_style?: string | null },
  shape: PayloadShape = {},
): string {
  const parts: string[] = [];
  const blocks = shape.blocks ?? 0;
  if (blocks > 1) parts.push(`${blocks} blocks`);
  const weeks = shape.weeks && shape.weeks > 0 ? shape.weeks : t.weeks ?? null;
  if (weeks && weeks > 0) parts.push(`${weeks} week${weeks === 1 ? "" : "s"}`);
  const days = t.days_per_week ?? null;
  if (days && days > 0) parts.push(`${days} day${days === 1 ? "" : "s"} a week`);
  const style = styleLabel(t.training_style);
  if (style) parts.push(style);
  return parts.join(" · ");
}

export function toLibraryPrograms(
  templates: Array<{
    id: string; name?: string | null; archived?: boolean | null; updated_at?: string | null;
    weeks?: number | null; days_per_week?: number | null; training_style?: string | null;
    training_focus?: string | null; tags?: string[] | null; description?: string | null;
  }>,
  usage: Map<string, ProgramUsage[]>,
  membership: Map<string, MembershipState>,
  shapeOf: (id: string) => PayloadShape = () => ({}),
): LibraryProgram[] {
  return templates
    .map((t) => {
      const clients = usage.get(t.id) ?? [];
      const name = String(t.name ?? "").trim() || "Untitled program";
      return {
        id: t.id,
        name,
        archived: !!t.archived,
        updatedAt: t.updated_at ?? "",
        line: programLine(t, shapeOf(t.id)),
        styleLabel: styleLabel(t.training_style),
        clients,
        membership: membership.get(t.id) ?? { kind: "off", planId: null },
        haystack: [
          name, t.training_style, t.training_focus, t.description, ...(t.tags ?? []),
          ...clients.map((c) => c.name),
        ].filter(Boolean).join(" ").toLowerCase(),
      } satisfies LibraryProgram;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function inScope(p: LibraryProgram, scope: LibraryScope): boolean {
  if (scope === "archived") return p.archived;
  if (p.archived) return false;
  if (scope === "clients") return p.clients.length > 0;
  if (scope === "membership") return p.membership.kind !== "off";
  return true;
}

export function matchesSearch(p: LibraryProgram, q: string): boolean {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => p.haystack.includes(term));
}

export function scopeCounts(programs: LibraryProgram[]): Record<LibraryScope, number> {
  const counts: Record<LibraryScope, number> = { all: 0, clients: 0, membership: 0, archived: 0 };
  for (const p of programs) {
    for (const s of LIBRARY_SCOPES) if (inScope(p, s.key)) counts[s.key] += 1;
  }
  return counts;
}

/**
 * Which scope chips show: All always; Membership app for whoever can list
 * programs there (admins), even at 0, since that's where members' programs
 * live; the rest only when something's in them, or while picked.
 */
export function visibleScopes(
  counts: Record<LibraryScope, number>,
  current: LibraryScope,
  canListForMembers: boolean,
): LibraryScope[] {
  return LIBRARY_SCOPES.map((s) => s.key).filter((key) => {
    if (key === "all" || key === current) return true;
    if (key === "membership") return canListForMembers;
    return counts[key] > 0;
  });
}

/** What the empty list says, by scope. */
export function emptyLibraryCopy(scope: LibraryScope, searching: boolean): { title: string; body: string } {
  if (searching) return { title: "No programs match", body: "Try another word, or clear the search." };
  if (scope === "membership") {
    return {
      title: "Nothing in the membership app yet",
      body: "Open a program's ⋯ and pick Add to membership app. Members see it in their JF Effect library.",
    };
  }
  if (scope === "clients") return { title: "No client is on a library program", body: "Assign one from its ⋯." };
  if (scope === "archived") return { title: "Nothing archived", body: "" };
  return { title: "No programs yet", body: "Tap New program to build your first one." };
}
