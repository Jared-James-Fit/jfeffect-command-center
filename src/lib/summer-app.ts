/**
 * What Cleo knows about the rest of the app (beyond the books): clients,
 * calendar, check-ins waiting, applications, tasks, unread messages, alerts,
 * plus the pages she can link to. Pure: the server loads the rows, this
 * writes them out for the model.
 */

export type AppClient = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string | null;
  plan: string | null;
  startDate: string | null;
  renewalDate: string | null;
  paymentStatus: string | null;
  lastActiveAt: string | null;
  needsHelp: boolean;
  compliance: string | null;
  archived: boolean;
  instagram: string | null;
};

export type AppSnapshot = {
  clients: AppClient[];
  appointments: Array<{ startsAt: string; endsAt: string | null; title: string | null; type: string | null; who: string | null; clientId: string | null; location: string | null; meetLink: string | null; status: string | null }>;
  reviews: Array<{ clientId: string | null; source: string | null; submittedAt: string | null; status: string | null; priority: string | null }>;
  applications: Array<{ name: string | null; email: string | null; phone: string | null; status: string | null; temperature: string | null; submittedAt: string | null; offer: string | null; callStatus: string | null; followUpAt: string | null }>;
  tasks: Array<{ title: string; dueAt: string | null; priority: string | null; status: string | null }>;
  unread: Array<{ clientId: string; count: number; lastAt: string }>;
  alerts: { open: number; latest: Array<{ type: string | null; message: string | null; at: string }> };
};

export type LinkEntry = { label: string; to: string; keywords?: string[] };

export const EMPTY_APP_SNAPSHOT: AppSnapshot = {
  clients: [], appointments: [], reviews: [], applications: [], tasks: [], unread: [], alerts: { open: 0, latest: [] },
};

/** Client profile tabs Cleo can deep link to. */
export const CLIENT_TABS = ["summary", "training", "nutrition", "metrics", "documents", "sessions", "purchases", "info", "goals-setup", "coaching", "notes", "account"];

/** Pages that are not in the route registry but matter for an assistant. */
export const EXTRA_LINKS: LinkEntry[] = [
  { label: "Taxes & Books", to: "/admin/sales?tab=taxes", keywords: ["tax", "gst", "expenses", "receipts", "accountant"] },
  { label: "Transactions", to: "/admin/sales?tab=transactions", keywords: ["payments", "stripe"] },
  { label: "Messages inbox", to: "/admin/communication?tab=messages", keywords: ["chat", "inbox", "dm"] },
  { label: "Check-in reviews", to: "/admin/check-in-reviews", keywords: ["check-ins", "reviews", "submissions"] },
  { label: "Calendar", to: "/admin/calendar", keywords: ["appointments", "sessions", "bookings"] },
];

export function clientLabel(c: { full_name?: string | null; preferred_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const full = (c.full_name ?? "").trim();
  if (full) return full;
  const parts = `${c.preferred_name || c.first_name || ""} ${c.last_name ?? ""}`.trim();
  return parts || c.email || "Client";
}

function fmtWhen(iso: string | null, tz: string): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return d.toLocaleString("en-CA", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDay(iso: string | null, tz: string): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("en-CA", { timeZone: tz, year: "numeric", month: "short", day: "numeric" });
}

export function buildAppContext(s: AppSnapshot, links: LinkEntry[], opts: { tz: string; route?: string | null }): string {
  const { tz } = opts;
  const byId = new Map(s.clients.map((c) => [c.id, c]));
  const who = (id: string | null) => (id ? byId.get(id)?.name ?? "a client" : null);
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);

  if (opts.route) {
    const m = opts.route.match(/^\/admin\/clients\/([0-9a-f-]{36})/i);
    const onClient = m ? byId.get(m[1]) : null;
    push(`OWNER IS LOOKING AT: ${opts.route}${onClient ? ` (client profile of ${onClient.name}, id ${onClient.id})` : ""}. "This client" / "them" means that client.`, "");
  }

  const live = s.clients.filter((c) => !c.archived);
  push(`CLIENTS (${live.length} current, ${s.clients.length - live.length} archived). Columns: name | id | status | plan | email | phone | started | renews | payment | last active | flags`);
  for (const c of [...live, ...s.clients.filter((c) => c.archived)]) {
    const flags = [c.archived ? "archived" : null, c.needsHelp ? "needs admin help" : null, c.compliance && !/on.?track/i.test(c.compliance) ? `compliance: ${c.compliance}` : null].filter(Boolean).join(", ");
    push(
      `- ${c.name} | ${c.id} | ${c.status ?? "?"} | ${c.plan ?? "?"} | ${c.email ?? "-"} | ${c.phone ?? "-"} | ${c.startDate ?? "-"} | ${c.renewalDate ?? "-"} | ${c.paymentStatus ?? "-"} | ${c.lastActiveAt ? fmtDay(c.lastActiveAt, tz) : "never"}${flags ? ` | ${flags}` : ""}${c.instagram ? ` | ig ${c.instagram}` : ""}`,
    );
  }
  push("");

  push(`CALENDAR (yesterday to 14 days out, ${tz})`);
  for (const a of s.appointments) {
    push(`- ${fmtWhen(a.startsAt, tz)} | ${a.title ?? a.type ?? "Appointment"} | ${who(a.clientId) ?? a.who ?? "?"}${a.clientId ? ` (${a.clientId})` : ""} | ${a.location ?? (a.meetLink ? "video call" : "-")} | ${a.status ?? ""}`);
  }
  if (!s.appointments.length) push("- nothing booked");
  push("");

  push("CHECK-INS AND FORMS WAITING FOR REVIEW");
  for (const r of s.reviews) push(`- ${who(r.clientId) ?? "?"}${r.clientId ? ` (${r.clientId})` : ""} | ${r.source ?? "check-in"} | submitted ${fmtDay(r.submittedAt, tz)} | ${r.status ?? ""}${r.priority && r.priority !== "normal" ? ` | ${r.priority}` : ""}`);
  if (!s.reviews.length) push("- none");
  push("");

  push("UNREAD CLIENT MESSAGES");
  for (const u of s.unread) push(`- ${who(u.clientId) ?? "?"} (${u.clientId}) | ${u.count} unread | latest ${fmtWhen(u.lastAt, tz)}`);
  if (!s.unread.length) push("- inbox is clear");
  push("");

  push("COACHING APPLICATIONS (latest)");
  for (const a of s.applications) push(`- ${a.name ?? "?"} | ${a.status ?? "?"}${a.temperature ? ` | ${a.temperature}` : ""} | applied ${fmtDay(a.submittedAt, tz)} | ${a.email ?? "-"} | ${a.phone ?? "-"}${a.offer ? ` | fits ${a.offer}` : ""}${a.followUpAt ? ` | follow up ${fmtDay(a.followUpAt, tz)}` : ""}`);
  if (!s.applications.length) push("- none");
  push("");

  push("OPEN TASKS");
  for (const t of s.tasks) push(`- ${t.title}${t.dueAt ? ` | due ${fmtDay(t.dueAt, tz)}` : ""}${t.priority ? ` | ${t.priority}` : ""}${t.status ? ` | ${t.status}` : ""}`);
  if (!s.tasks.length) push("- none");
  push("");

  push(`SUPPORT ALERTS: ${s.alerts.open} open`);
  for (const a of s.alerts.latest) push(`- ${fmtWhen(a.at, tz)} | ${a.type ?? "alert"} | ${(a.message ?? "").slice(0, 140)}`);
  push("");

  push("LINKS YOU CAN GIVE (use these exact paths; never invent one):");
  push("- A client's profile: /admin/clients/<client id>; a tab of it: /admin/clients/<client id>?tab=<one of " + CLIENT_TABS.join(", ") + ">");
  push("- A client's message thread: /admin/communication?tab=messages&client=<client id>");
  const seen = new Set<string>();
  for (const l of [...EXTRA_LINKS, ...links]) {
    if (seen.has(l.to)) continue;
    seen.add(l.to);
    push(`- ${l.label}: ${l.to}${l.keywords?.length ? ` (${l.keywords.slice(0, 5).join(", ")})` : ""}`);
  }
  return lines.join("\n");
}

/** Who still owes money, for admins who don't see the books. */
export function buildOpenSalesContext(rows: Array<{ client: string | null; offer: string | null; status: string | null; outstandingMinor: number; createdOn: string | null }>): string {
  if (!rows.length) return "- none";
  return rows
    .slice(0, 50)
    .map((o) => `- ${o.client ?? "?"} | ${o.offer ?? "?"} | ${o.status ?? "?"} | outstanding $${(o.outstandingMinor / 100).toFixed(2)} | since ${o.createdOn ?? "?"}`)
    .join("\n");
}
