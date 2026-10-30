import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AGREEMENT_CONTENT } from "@/lib/coaching-agreement/content";
import { coachingAgreementDoc, matchingSections, readDocuments, searchTerms, textSections, type CleoDoc } from "@/lib/cleo-documents";
import {
  CLEO_BOOKS_TABLES, CLEO_HIDDEN_TABLES, MEMBER_CHAT_SCOPED, checkRead, findTables, formatRows, isCredentialColumn, visibleCatalog,
  type CatalogTable,
} from "@/lib/cleo-data-access";

const read = (f: string) => readFileSync(f, "utf8");
const agreement = coachingAgreementDoc(AGREEMENT_CONTENT as any);

describe("Cleo reads the business's documents", () => {
  it("the Coaching Agreement, section by section, as the client reads it", () => {
    expect(agreement.key).toBe("coaching-agreement");
    expect(agreement.version).toBe(`v${AGREEMENT_CONTENT.version}, effective ${AGREEMENT_CONTENT.effectiveDate}`);
    expect(agreement.sections.length).toBe(AGREEMENT_CONTENT.sections.length + 4);
    const all = agreement.sections.map((s) => `${s.title}\n${s.text}`).join("\n");
    expect(all).not.toContain("**");
    expect(all).not.toMatch(/\{\{/);
    expect(all).toContain("[the client's coach]");
    expect(all).toContain("jaredjamesfit@gmail.com");
  });

  it("'what does my coaching policy say about ending coaching?' finds the cancel and termination sections", () => {
    const q = "what does my coaching policy say about ending coaching? does it end when coaching ends or at the end of the month";
    expect(searchTerms(q)).toEqual(expect.arrayContaining(["end", "month"]));
    const hits = matchingSections(agreement, "ending coaching cancel notice billing date month termination");
    const titles = hits.slice(0, 6).map((h) => h.title).join(" | ");
    expect(titles).toMatch(/Billing|Cancel|Termination|Commitment/i);
    const out = readDocuments([agreement], { search: "cancel billing date end month", max: 13_000 });
    expect(out).toContain("Coaching Agreement");
    expect(out).toContain("before your next billing date");
    expect(out.length).toBeLessThanOrEqual(13_000);
  });

  it("legal documents split at their numbered headings", () => {
    const body = [
      "Cancellation & Refund Policy",
      "JF Effect, operated by Jared James McIntyre",
      "This policy explains how to cancel.",
      "1. Cancelling During the Trial",
      "You may cancel anytime before the 3-day trial ends.",
      "2. Cancelling After Billing Starts",
      "Cancellation generally takes effect at the end of your current billing period.",
      "You keep access until that effective date.",
    ].join("\n");
    const s = textSections(body);
    expect(s.map((x) => x.title)).toEqual(["Opening", "1. Cancelling During the Trial", "2. Cancelling After Billing Starts"]);
    expect(s[2]!.text).toContain("end of your current billing period");
    const doc: CleoDoc = { key: "cancellation-and-refund-policy", title: "Cancellation & Refund Policy", version: "v2 published", about: "Admin → Legal", sections: s };
    expect(readDocuments([doc], { search: "cancel end of period", max: 5000 })).toContain("2. Cancelling After Billing Starts");
    // short enough to read whole
    expect(readDocuments([doc], { document: "cancellation-and-refund-policy", max: 5000 })).toContain("3-day trial");
  });

  it("lists everything when nothing's named, and says so when a name doesn't match", () => {
    expect(readDocuments([agreement], { max: 13_000 })).toContain("- coaching-agreement:");
    expect(readDocuments([agreement], { document: "nope", max: 13_000 })).toContain('No document called "nope"');
    // too long to read whole: every section's first line instead
    const long = readDocuments([agreement], { document: "coaching-agreement", max: 4000 });
    expect(long).toContain("Ask again with `search`");
  });

  it("the tool reads the agreement from the code and the rest from Admin → Legal and the FAQs", () => {
    const tools = read("src/lib/cleo-tools.server.ts");
    expect(tools).toContain("business_documents: tool({");
    expect(tools).toContain('await import("@/lib/coaching-agreement/content")');
    expect(tools).toContain('db.from("legal_documents")');
    expect(tools).toContain('db.from("legal_document_versions")');
    expect(tools).toContain('db.from("coach_faqs")');
  });
});

const T = (t: string, cols: string[], extra: Partial<CatalogTable> = {}): CatalogTable => ({ t, n: 10, c: cols.map((c) => [c, "text"]), ...extra });
const raw: CatalogTable[] = [
  T("coaching_applications", ["id", "full_name", "email", "status", "created_at"]),
  T("offers", ["id", "name", "price_cents", "active"]),
  T("discount_codes", ["id", "code", "percent_off"]),
  T("clients", ["id", "full_name", "calendar_feed_token", "status"]),
  T("google_calendar_connections", ["id", "access_token", "refresh_token"]),
  T("payment_ledger", ["id", "amount_cents"]),
  T("business_expenses", ["id", "amount"]),
  T("group_messages", ["id", "group_id", "body"]),
  T("chat_user_blocks", ["user_id", "blocked_user_id"]),
];

describe("Cleo can find and read anything the person can see", () => {
  it("never lists credentials or members' private chat state", () => {
    const cat = visibleCatalog(raw, { books: true });
    const names = cat.map((t) => t.t);
    expect(names).not.toContain("google_calendar_connections");
    expect(names).not.toContain("chat_user_blocks");
    expect(cat.find((t) => t.t === "clients")!.c.map(([c]) => c)).toEqual(["id", "full_name", "status"]);
    for (const c of ["access_token", "refresh_token", "setup_token", "signature_image", "signnow_signing_link", "p256dh_key", "auth_key", "content_hash", "api_basic_auth_token"]) {
      expect(isCredentialColumn(c), c).toBe(true);
    }
    for (const c of ["status", "email", "created_at", "body", "price_cents", "authored_by"]) expect(isCredentialColumn(c), c).toBe(false);
    for (const t of ["client_google_calendars", "wearable_connection_secrets", "push_subscriptions", "password_recovery_tokens", "signnow_settings", "chat_thread_prefs"]) {
      expect(CLEO_HIDDEN_TABLES.has(t), t).toBe(true);
    }
  });

  it("the books and ledgers only for the owner and the finance login", () => {
    expect(visibleCatalog(raw, { books: false }).map((t) => t.t)).not.toEqual(expect.arrayContaining(["payment_ledger"]));
    expect(visibleCatalog(raw, { books: false }).some((t) => CLEO_BOOKS_TABLES.has(t.t))).toBe(false);
    expect(visibleCatalog(raw, { books: true }).map((t) => t.t)).toEqual(expect.arrayContaining(["payment_ledger", "business_expenses"]));
    expect(read("src/lib/summer.server.ts")).toContain("books: owner || finance");
  });

  it("finds tables by what they're called", () => {
    const cat = visibleCatalog(raw, { books: false });
    expect(findTables(cat, "coaching applications")[0]!.t).toBe("coaching_applications");
    expect(findTables(cat, "discount code")[0]!.t).toBe("discount_codes");
    expect(findTables([...cat, T("discount_code_redemptions", ["id", "code"])], "discount codes")[0]!.t).toBe("discount_codes");
    expect(findTables(cat, "offer price")[0]!.t).toBe("offers");
    expect(findTables(cat, "zz")).toEqual([]);
  });

  it("a read must name real, readable columns; limits are capped", () => {
    const cat = visibleCatalog(raw, { books: false });
    expect(() => checkRead(cat, { table: "nope" })).toThrow(/no table "nope"/);
    expect(() => checkRead(cat, { table: "clients", columns: ["calendar_feed_token"] })).toThrow(/no readable column calendar_feed_token/);
    expect(() => checkRead(cat, { table: "clients", filters: [{ column: "status", op: "in" }] })).toThrow(/needs `values`/);
    expect(() => checkRead(cat, { table: "clients", filters: [{ column: "status", op: "eq" }] })).toThrow(/needs a `value`/);
    expect(() => checkRead(cat, { table: "payment_ledger" })).toThrow(/no table/);
    const ok = checkRead(cat, { table: "clients", limit: 5000 });
    expect(ok.columns).toEqual(["id", "full_name", "status"]);
    expect(ok.limit).toBe(200);
  });

  it("rows come back compact, credential-looking keys dropped again", () => {
    const out = formatRows([{ id: "a", status: "Active", refresh_token: "x", notes: null, body: "y".repeat(900) }], { table: "clients", total: 40, limit: 1 });
    expect(out).toContain("clients: 1 row of 40 matching");
    expect(out).not.toContain("refresh_token");
    expect(out).not.toContain("notes:");
    expect(out).toContain("…");
  });

  it("group chats: coach-run groups only, never members' own 1:1s and crews", () => {
    expect(MEMBER_CHAT_SCOPED).toEqual({ chat_groups: "id", chat_group_members: "group_id", group_messages: "group_id" });
    const tools = read("src/lib/cleo-tools.server.ts");
    expect(tools).toContain('.or("kind.is.null,kind.eq.group")');
    // reads go through the caller's own login (RLS), never the service role
    expect(tools).not.toContain("supabaseAdmin");
    expect(tools).not.toContain("client.server");
  });

  it("what exists comes from the database, for admins and the finance login only", () => {
    const sql = read("supabase/migrations/20270109090000_cleo_data_catalog.sql");
    expect(sql).toContain("WHEN (SELECT public.has_role((SELECT auth.uid()), 'admin')) OR (SELECT public.is_admin_viewer()) THEN");
    expect(sql).toContain("has_table_privilege('authenticated', c.oid, 'SELECT')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.cleo_data_catalog() FROM PUBLIC, anon;");
  });

  it("she's told to look before saying she doesn't have it", () => {
    const prompt = read("src/lib/summer-context.ts");
    expect(prompt).toContain("call business_documents with `search` set to the topic");
    expect(prompt).toContain("find_data with a few words to see where it lives, then read_data");
    expect(prompt).toContain("never fill the gap with what's usual");
  });
});
