import { findTables, visibleCatalog, formatRows, MEMBER_CHAT_SCOPED, type CatalogTable } from "@/lib/cleo-data-access";
import { loadCatalog } from "@/lib/cleo-tools.server";

// Only use the existing administrator-visible catalog, and only tables that
// can be constrained to the selected coaching client at the database layer.
const STOP = new Set(["what","which","where","when","does","did","show","tell","about","client","account","their","they","have","has","with","from","please","could","would","information","details","data","record","records","this","that","there","been","current","latest","find","get","for","the","her","his","any","all","me"]);
const tokens = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length >= 3 && !STOP.has(w));
const restricted = /(?:chat|message|auth|credential|consent|private|secret|token|invite|session_ledger|payment_share|audit|access_log)/i;
const unsafeColumn = /(?:url|path|payload|metadata|json|signature|address|email|phone|birth|emergency|health|medical|injur|password|token|secret|key|hash)/i;

export function adminEvidenceCandidates(catalog: CatalogTable[], question: string) {
  const terms = tokens(question);
  if (!terms.length) return [];
  const visible = visibleCatalog(catalog, { books: false, money: true }).filter(t =>
    !t.v && !MEMBER_CHAT_SCOPED[t.t] && !restricted.test(t.t) &&
    t.c.some(([n]) => n === "client_id") &&
    terms.some(term => t.t.split("_").some(w => w.startsWith(term) || term.startsWith(w) && w.length >= 4))
  );
  return findTables(visible, terms.join(" "), 3).map(table => {
    const allowed = table.c.filter(([name, type]) => !unsafeColumn.test(name) &&
      !/json|bytea|array|\[\]/i.test(type) && (name === "id" || name === "client_id" || /(?:^|_)(?:date|at|status|name|title|type|value|unit|count|completed|enabled|active|version|amount|total)(?:_|$)/i.test(name) ||
        terms.some(term => name.toLowerCase().includes(term))));
    const columns = allowed.slice(0, 18).map(([name]) => name);
    const order = ["updated_at", "created_at", "date", "start_date"].find(n => table.c.some(([c]) => c === n));
    return { table: table.t, columns, order };
  }).filter(t => t.columns.some(n => n !== "id" && n !== "client_id"));
}

/** Caller must have passed the server-side staff/client check and be an admin.
 * Never accepts a client ID from the user's prompt; never sends data externally.
 */
export async function readAdminEvidence(db: any, requester: string, clientId: string, question: string): Promise<string | null> {
  const candidates = adminEvidenceCandidates(await loadCatalog(db, requester), question);
  if (!candidates.length) return null;
  const results = await Promise.all(candidates.map(async candidate => {
    try {
      let q = db.from(candidate.table).select(candidate.columns.join(","), { count: "exact" }).eq("client_id", clientId);
      if (candidate.order) q = q.order(candidate.order, { ascending: false });
      const { data, error, count } = await q.limit(12);
      if (error) return "Source: " + candidate.table + " — could not verify records.";
      return "Source: " + candidate.table + "\n" + formatRows(data ?? [], { table: candidate.table, total: count ?? null, limit: 12 });
    } catch { return "Source: " + candidate.table + " — could not verify records."; }
  }));
  return results.join("\n\n");
}
