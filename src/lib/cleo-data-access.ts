/**
 * Cleo's view of the whole database: find where something lives
 * (`find_data`) and read it (`read_data`), for anything the person asking can
 * see in the app. Reads go through their own login, so the database's own
 * rules (RLS) decide what comes back, exactly as in the app; this file only
 * keeps out what must never reach the model:
 *
 *  - credentials (OAuth / push / invite / recovery tokens, signing links,
 *    calendar feed tokens, signature images, hashes): hidden tables and
 *    credential-looking columns are never listed or read;
 *  - members' own chats (`chat_groups.kind` 'direct' / 'crew', AGENTS.md):
 *    their block / request / preference tables are hidden, and the group chat
 *    tables are only read for coach-run groups (`MEMBER_CHAT_SCOPED`);
 *  - the books for anyone but the owner and the finance login (Cleo's
 *    "PRIVATE" rule): the ledgers and books tables are hidden from them.
 */

export type CatalogTable = {
  /** Table (or view) name. */
  t: string;
  /** A view. */
  v?: boolean;
  /** Rows, roughly (-1 = not counted yet). */
  n?: number | null;
  /** The table's comment, if it has one. */
  d?: string | null;
  /** Columns: [name, type]. */
  c: Array<[string, string]>;
};

/** Never listed or read: what they hold is credentials, or members' private chat state. */
export const CLEO_HIDDEN_TABLES = new Set([
  "client_google_calendars",
  "google_calendar_connections",
  "wearable_connection_secrets",
  "push_subscriptions",
  "password_recovery_tokens",
  "email_unsubscribe_tokens",
  "coach_invites",
  "staff_invites",
  "na_guest_tokens",
  "signnow_settings",
  "chat_user_blocks",
  "chat_thread_prefs",
  "chat_direct_closed",
  "chat_request_reads",
  "group_message_reactions",
  "summer_messages",
]);

/** The books and revenue: only the owner's and the finance login's. */
export const CLEO_BOOKS_TABLES = new Set([
  "business_expenses",
  "business_tax_payments",
  "business_tax_settings",
  "payment_ledger",
  "member_payment_ledger",
]);

/** Group chat tables, read only for coach-run groups (never members' own 1:1s and crews): table → its group id column. */
export const MEMBER_CHAT_SCOPED: Record<string, string> = { chat_groups: "id", chat_group_members: "group_id", group_messages: "group_id" };

const CREDENTIAL = /(token|secret|password|passcode|api_?key|private_?key|p256dh|auth_key|signing_link|signature_image|verifier|nonce|_hash$|^hash$)/i;

/** A column that holds a credential (or a hash of one): never read. */
export function isCredentialColumn(name: string): boolean {
  return CREDENTIAL.test(name);
}

export function shortType(t: string): string {
  return t
    .replace("timestamp with time zone", "timestamptz")
    .replace("timestamp without time zone", "timestamp")
    .replace("character varying", "varchar")
    .replace(/^double precision$/, "float")
    .replace(/\(\d+(,\d+)?\)/, "");
}

/** The tables this person's Cleo may see, without credential columns. */
export function visibleCatalog(raw: CatalogTable[], opts: { books: boolean }): CatalogTable[] {
  return (raw ?? [])
    .filter((t) => t?.t && !CLEO_HIDDEN_TABLES.has(t.t) && (opts.books || !CLEO_BOOKS_TABLES.has(t.t)))
    .map((t) => ({ ...t, c: (t.c ?? []).filter(([name]) => !isCredentialColumn(name)) }))
    .filter((t) => t.c.length > 0);
}

const words = (s: string) => (String(s ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3);
const stem = (w: string) => (w.length > 4 ? w.replace(/(ies|ings|ing|es|s)$/, "") : w);

/** Tables that match what's being looked for, best first: names count most, then columns, then comments. */
export function findTables(catalog: CatalogTable[], query: string, limit = 10): CatalogTable[] {
  const terms = [...new Set(words(query).map(stem))];
  if (!terms.length) return [];
  // "discount codes" → discount_codes, "recipes" → recipes: the words are its name
  const phrase = words(query).join("_");
  const named = (n: string) => n === phrase || n === `${phrase}s` || `${n}s` === phrase || n === phrase.replace(/s$/, "");
  return catalog
    .map((t) => {
      const name = t.t.toLowerCase();
      const cols = t.c.map(([c]) => c.toLowerCase());
      const about = String(t.d ?? "").toLowerCase();
      let score = named(name) ? 20 : 0;
      for (const w of terms) {
        if (name === w || name === `${w}s`) score += 12;
        else if (name.split("_").some((p) => p.startsWith(w))) score += 7;
        else if (name.includes(w)) score += 4;
        const inCols = cols.filter((c) => c.includes(w)).length;
        score += Math.min(3, inCols) * 1.5;
        if (about.includes(w)) score += 2;
      }
      // a populated table is the likelier answer
      if (score > 0 && (t.n ?? 0) > 0) score += 0.5;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.t.localeCompare(b.t.t))
    .slice(0, limit)
    .map((x) => x.t);
}

export function describeTable(t: CatalogTable): string {
  const rows = t.n == null || t.n < 0 ? "" : ` | ~${t.n} rows`;
  return `${t.t}${t.v ? " (view)" : ""}${rows}${t.d ? ` | ${String(t.d).slice(0, 160)}` : ""}\n  ${t.c.map(([n, ty]) => `${n} ${shortType(ty)}`).join(", ")}`;
}

export const READ_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "ilike", "in", "is_null", "not_null"] as const;
export type ReadOp = (typeof READ_OPS)[number];
export type ReadFilter = { column: string; op: ReadOp; value?: string | number | boolean | null; values?: Array<string | number> | null };
export type ReadRequest = {
  table: string;
  columns?: string[] | null;
  filters?: ReadFilter[] | null;
  order?: { column: string; ascending?: boolean } | null;
  limit?: number | null;
};

export const READ_MAX_ROWS = 200;

/** Checks a read against the catalog: the table and every column must be ones this person's Cleo may see. */
export function checkRead(catalog: CatalogTable[], req: ReadRequest): { table: CatalogTable; columns: string[]; limit: number } {
  const table = catalog.find((t) => t.t === req.table);
  if (!table) {
    const near = findTables(catalog, req.table.replace(/_/g, " "), 5).map((t) => t.t);
    throw new Error(`There's no table "${req.table}" you can read.${near.length ? ` Closest: ${near.join(", ")}.` : ""} Use find_data.`);
  }
  const known = new Set(table.c.map(([n]) => n));
  const columns = req.columns?.length ? [...new Set(req.columns)] : table.c.map(([n]) => n);
  const bad = [
    ...columns,
    ...(req.filters ?? []).map((f) => f.column),
    ...(req.order ? [req.order.column] : []),
  ].filter((c) => !known.has(c));
  if (bad.length) throw new Error(`${table.t} has no readable column ${[...new Set(bad)].join(", ")}. Its columns: ${[...known].join(", ")}.`);
  for (const f of req.filters ?? []) {
    if (!READ_OPS.includes(f.op)) throw new Error(`Unknown filter "${f.op}".`);
    if (f.op === "in" && !f.values?.length) throw new Error(`"in" on ${f.column} needs \`values\`.`);
    if (!["is_null", "not_null", "in"].includes(f.op) && (f.value == null || f.value === "")) {
      throw new Error(`"${f.op}" on ${f.column} needs a \`value\`.`);
    }
  }
  const limit = Math.max(1, Math.min(READ_MAX_ROWS, Math.round(req.limit ?? 25)));
  return { table, columns, limit };
}

const CELL_MAX = 600;

function cell(v: unknown): string {
  if (v == null) return "null";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX)}…` : s;
}

/** Rows as compact lines (credential-looking keys dropped again, in case a view renames one). */
export function formatRows(rows: Array<Record<string, unknown>>, opts: { table: string; total: number | null; limit: number }): string {
  const head = `${opts.table}: ${rows.length} row${rows.length === 1 ? "" : "s"}${opts.total != null ? ` of ${opts.total} matching` : ""}${
    opts.total != null && opts.total > rows.length ? ` (showing the first ${rows.length}; narrow the filters or raise limit up to ${READ_MAX_ROWS})` : ""
  }`;
  if (!rows.length) return `${head}.`;
  return [
    head,
    ...rows.map(
      (r) =>
        `- ${Object.entries(r)
          .filter(([k, v]) => !isCredentialColumn(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
          .map(([k, v]) => `${k}: ${cell(v)}`)
          .join(" | ")}`,
    ),
  ].join("\n");
}
