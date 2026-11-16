/**
 * Loads every client's billing the way their Billing tab reads it and sums
 * what's owed (receivables.ts). Runs with the service role, and only after
 * the caller passed the books' own check (the business owner, or a finance
 * login with finance.read: `assertBooksAccess`), because the finance login
 * can't read clients or sales under RLS. Nothing here writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduleSale } from "@/lib/payment-schedule";
import { receivablesFrom, type ClientBillingRead, type Receivables } from "@/lib/books/receivables";

type Db = SupabaseClient<any, any, any>;

const PAGE = 1000;

async function readAll(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function loadReceivables(admin: Db, today: string): Promise<Receivables> {
  const { buildClientPayments } = await import("@/lib/payment-schedule");
  const sales = (await readAll((a, b) => admin.from("purchase_records").select("*").not("client_id", "is", null).order("created_at").range(a, b))) as any[];
  const ids = [...new Set(sales.map((s) => s.client_id as string))];
  if (!ids.length) return receivablesFrom([], today);

  const clients: any[] = [];
  const ledger: any[] = [];
  const events: any[] = [];
  for (const part of chunks(ids, 150)) {
    const [c, l, e] = await Promise.all([
      readAll((a, b) => admin.from("clients").select("id, full_name, status, archived").in("id", part).range(a, b)),
      readAll((a, b) => admin.from("payment_ledger").select("*").in("client_id", part).order("transaction_date").range(a, b)),
      readAll((a, b) => admin.from("session_ledger_events").select("*").in("client_id", part).order("created_at").range(a, b)),
    ]);
    clients.push(...c);
    ledger.push(...l);
    events.push(...e);
  }
  // session_balance() answers only a signed-in person; its rows function is the same reading for the server.
  const balances = new Map<string, any[]>();
  for (const part of chunks(ids, 10)) {
    const rows = await Promise.all(part.map((id) => admin.rpc("_session_balance_rows", { _client_id: id })));
    part.forEach((id, i) => balances.set(id, (rows[i].data ?? []) as any[]));
  }

  const byId = new Map(clients.map((c) => [c.id, c]));
  const reads: ClientBillingRead[] = ids.map((id) => {
    const own = sales.filter((s) => s.client_id === id) as ScheduleSale[];
    const c = byId.get(id);
    const p = buildClientPayments({
      sales: own,
      ledger: ledger.filter((l) => l.client_id === id),
      events: events.filter((e) => e.client_id === id),
      balance: balances.get(id) ?? [],
      today,
    });
    const status = String(c?.status ?? "");
    return { clientId: id, client: c?.full_name ?? "Client", archived: !!c?.archived || status === "Archived" || status === "Deactivated", p, sales: own };
  });
  return receivablesFrom(reads, today);
}
