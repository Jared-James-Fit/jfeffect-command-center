/**
 * Test doubles for plan switching (plan-lifecycle.test.ts): an in-memory
 * database with the rules the migration puts on the tables
 * (20270522090000_plan_switching.sql: one change in flight per client, one
 * active enrollment, the touch trigger, plan_apply_tier), and a fake Stripe
 * that prorates, charges or declines a card, keeps idempotency keys, runs
 * checkouts and rolls billing periods. Nothing here reaches a network.
 */
type Row = Record<string, any>;

const OPEN = new Set(["checkout", "processing", "awaiting_payment", "scheduled"]);
let seq = 0;
const nid = (p: string) => `${p}-${(++seq).toString(36)}`;
const iso = () => new Date().toISOString();

function subset(have: any, want: any): boolean {
  if (want === null || typeof want !== "object") return have === want || String(have) === String(want);
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w) => have.some((h: any) => subset(h, w)));
  if (!have || typeof have !== "object") return false;
  return Object.entries(want).every(([k, v]) => subset(have[k], v));
}

export class FakeDb {
  t: Record<string, Row[]>;
  rpcs: Array<{ fn: string; args: any }> = [];
  constructor(seed: Record<string, Row[]>) {
    this.t = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  }
  rows(table: string): Row[] {
    return (this.t[table] ??= []);
  }
  from(table: string) {
    return new FakeQuery(this, table);
  }
  async rpc(fn: string, args: any) {
    this.rpcs.push({ fn, args });
    if (fn === "plan_apply_tier") return { data: planApplyTier(this, args._client_id, args._family, args._coach_id ?? null), error: null };
    if (fn === "has_role") return { data: false, error: null };
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }

  /** The migration's rules on a row about to be written (null = fine, else a unique violation). */
  violates(table: string, row: Row, selfId?: string): string | null {
    const others = this.rows(table).filter((r) => r.id !== selfId);
    if (table === "plan_changes" && OPEN.has(row.status) && others.some((r) => r.client_id === row.client_id && OPEN.has(r.status))) return "plan_changes_one_open";
    if (table === "plan_changes" && row.status === "offered" && others.some((r) => r.client_id === row.client_id && r.status === "offered")) return "plan_changes_one_offer";
    if (table === "plan_changes" && row.status === "requested" && row.kind === "reactivate" && others.some((r) => r.client_id === row.client_id && r.status === "requested" && r.kind === "reactivate")) return "plan_changes_one_reactivation";
    if (table === "coaching_purchase_approvals" && !row.used_at && !row.revoked_at && others.some((r) => r.client_id === row.client_id && !r.used_at && !r.revoked_at)) return "coaching_purchase_approvals_one_live";
    if (table === "coaching_package_enrollments" && row.status === "active" && others.some((r) => r.client_id === row.client_id && r.status === "active")) return "coaching_package_enrollments_one_active";
    if (table === "app_members" && row.user_id && others.some((r) => r.user_id === row.user_id)) return "app_members_user_id_key";
    if (table === "client_crm_activities" && row.dedupe_key && others.some((r) => r.dedupe_key === row.dedupe_key)) return "uq_client_crm_activities_dedupe";
    return null;
  }

  /** Defaults and BEFORE triggers. */
  shape(table: string, row: Row, before?: Row): Row {
    const r = { ...row };
    if (table === "plan_changes") {
      r.updated_at = iso();
      r.warnings ??= [];
      r.attempts ??= 0;
      r.source ??= "client";
      if (r.status === "applied" && !r.applied_at) r.applied_at = iso();
      if (r.status === "cancelled" && !r.cancelled_at) r.cancelled_at = iso();
    }
    if (table === "coaching_package_enrollments") {
      r.status ??= "active";
      if (r.status === "ended" && before?.status !== "ended") {
        r.ended_at = iso();
        r.ends_on ??= iso().slice(0, 10);
      }
    }
    return r;
  }

  /** AFTER triggers (the enrollment mirror). */
  after(table: string, row: Row, before?: Row) {
    if (table === "coaching_package_enrollments" && row.status === "active" && before?.status !== "active") {
      const pkg = this.rows("coaching_packages").find((p) => p.id === row.package_id);
      const c = this.rows("clients").find((x) => x.id === row.client_id);
      if (pkg && c) c.coaching_package = pkg.name;
    }
  }
}

class FakeQuery implements PromiseLike<any> {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private lim: number | null = null;
  private one: "maybe" | "single" | null = null;
  private op: { kind: "insert" | "update"; rows: Row[] } | null = null;
  private returning = false;
  private head = false;
  constructor(private db: FakeDb, private table: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op) this.returning = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(r: Row | Row[]) {
    this.op = { kind: "insert", rows: (Array.isArray(r) ? r : [r]).map((x) => ({ id: x.id ?? nid(this.table), created_at: x.created_at ?? iso(), ...x })) };
    return this;
  }
  update(p: Row) {
    this.op = { kind: "update", rows: [p] };
    return this;
  }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v))); return this; }
  neq(c: string, v: any) { this.filters.push((r) => String(r[c]) !== String(v)); return this; }
  in(c: string, vs: any[]) { const s = new Set(vs.map(String)); this.filters.push((r) => s.has(String(r[c]))); return this; }
  is(c: string, v: any) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: any) { if (op === "is" && v === null) this.filters.push((r) => r[c] != null); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) > String(v)); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return this; }
  ilike(c: string, v: any) { this.filters.push((r) => String(r[c] ?? "").toLowerCase() === String(v).toLowerCase()); return this; }
  contains(c: string, v: any) { const want = typeof v === "string" ? JSON.parse(v) : v; this.filters.push((r) => subset(r[c], want)); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }

  private match(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }
  private out(rows: Row[]) {
    const copy = rows.map((r) => ({ ...r }));
    if (this.one === "maybe") return { data: copy[0] ?? null, error: null };
    if (this.one === "single") return copy[0] ? { data: copy[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    return { data: copy, error: null };
  }
  private run(): any {
    const table = this.db.rows(this.table);
    if (this.op?.kind === "insert") {
      const made: Row[] = [];
      for (const raw of this.op.rows) {
        const row = this.db.shape(this.table, raw);
        const bad = this.db.violates(this.table, row);
        if (bad) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${bad}"` } };
        table.push(row);
        this.db.after(this.table, row);
        made.push(row);
      }
      return this.returning ? this.out(made) : { data: null, error: null };
    }
    if (this.op?.kind === "update") {
      const hit = this.match();
      const next = hit.map((r) => this.db.shape(this.table, { ...r, ...this.op!.rows[0] }, r));
      for (const n of next) {
        const bad = this.db.violates(this.table, n, n.id);
        if (bad) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${bad}"` } };
      }
      hit.forEach((r, i) => {
        const before = { ...r };
        Object.assign(r, next[i]);
        this.db.after(this.table, r, before);
      });
      return this.returning ? this.out(hit) : { data: null, error: null };
    }
    let rows = this.match();
    for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (String(a[o.col] ?? "") < String(b[o.col] ?? "") ? -1 : String(a[o.col] ?? "") > String(b[o.col] ?? "") ? 1 : 0) * (o.asc ? 1 : -1));
    if (this.head) return { data: null, count: rows.length, error: null };
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return this.out(rows);
  }
  then<A, B>(ok?: ((v: any) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    try {
      return Promise.resolve(this.run()).then(ok, bad);
    } catch (e) {
      return Promise.reject(e).then(ok, bad);
    }
  }
}

/** plan_apply_tier, as the migration writes it. */
function planApplyTier(db: FakeDb, clientId: string, family: string, coachId: string | null) {
  const c = db.rows("clients").find((x) => x.id === clientId);
  if (!c) return { ok: false, skipped: "no_client" };
  if (c.archived || ["Deactivated", "Deleted", "Archived"].includes(c.status)) return { ok: false, skipped: "inactive" };
  if (family === "coaching") {
    const wasCoached =
      db.rows("coaching_package_enrollments").some((e) => e.client_id === clientId && e.status === "ended" && db.rows("coaching_packages").find((p) => p.id === e.package_id)?.kind === "subscription") ||
      !["Member", "Lead", ""].includes(c.status ?? "");
    c.status = c.service_tier === "coaching" ? c.status : wasCoached ? "Active" : "New Client";
    c.service_tier = "coaching";
    c.assigned_coach_id = coachId ?? c.assigned_coach_id;
    return { ok: true, tier: "coaching", coach: c.assigned_coach_id };
  }
  c.service_tier = "self_serve";
  c.status = "Member";
  c.assigned_coach_id = null;
  if (family === "free") c.coaching_package = null;
  if (!c.user_id) return { ok: true, tier: "self_serve", member: "no_login" };
  const sub = family === "membership" ? "Active" : "Free";
  let m = db.rows("app_members").find((x) => x.user_id === c.user_id) ?? db.rows("app_members").find((x) => !x.user_id && String(x.email).toLowerCase() === String(c.email).toLowerCase());
  if (m) Object.assign(m, { user_id: c.user_id, account_type: "jf_member", status: "Active", subscription_status: sub });
  else {
    m = { id: nid("member"), user_id: c.user_id, email: c.email, full_name: c.full_name, account_type: "jf_member", status: "Active", subscription_status: sub };
    db.rows("app_members").push(m);
  }
  return { ok: true, tier: "self_serve", member: m.id, subscription_status: sub };
}

/* ───────────────────────── Stripe ───────────────────────── */

const DAY = 86_400;

export class FakeStripe {
  prices: Record<string, Row> = {};
  subs: Record<string, Row> = {};
  invoices: Record<string, Row> = {};
  sessions: Record<string, Row> = {};
  /** Customers whose card is declined (an upgrade waits on Stripe's invoice page). */
  declines = new Set<string>();
  calls: Array<{ method: string; path: string; params: Record<string, string> }> = [];
  private idem = new Map<string, any>();
  taxRate = 0.05;

  price(id: string, cents: number, currency = "cad") {
    this.prices[id] = { id, object: "price", unit_amount: cents, currency, active: true, recurring: { interval: "month", interval_count: 1 } };
  }

  /** A live monthly subscription for a customer, `daysIn` days into a 30-day period. */
  subscribe(customer: string, priceId: string, daysIn = 0, extra: Row = {}): Row {
    const now = Math.floor(Date.now() / 1000);
    const start = now - daysIn * DAY;
    const id = nid("sub");
    this.subs[id] = {
      id,
      object: "subscription",
      status: "active",
      customer,
      cancel_at_period_end: false,
      automatic_tax: { enabled: true },
      pending_update: null,
      latest_invoice: null,
      metadata: {},
      items: { data: [{ id: nid("si"), price: { id: priceId }, current_period_start: start, current_period_end: start + 30 * DAY }] },
      ...extra,
    };
    return this.subs[id];
  }

  private item(s: Row) {
    return s.items.data[0];
  }
  private amount(priceId: string) {
    return Number(this.prices[priceId]?.unit_amount ?? 0);
  }
  private withTax(c: number) {
    return Math.round(c * (1 + this.taxRate));
  }
  /** What moving a subscription to a price mid-period costs today (always_invoice). */
  proration(s: Row, newPrice: string, at: number): number {
    const it = this.item(s);
    const span = it.current_period_end - it.current_period_start;
    const left = Math.max(0, it.current_period_end - at) / span;
    return Math.round((this.amount(newPrice) - this.amount(it.price.id)) * left);
  }

  /** The client pays an upgrade's invoice on Stripe's page: the pending change applies. */
  payInvoice(invId: string) {
    const inv = this.invoices[invId];
    inv.status = "paid";
    inv.amount_paid = inv.total;
    const s = this.subs[inv.subscription];
    if (s?.pending_update) {
      this.item(s).price = { id: s.pending_update.price };
      s.pending_update = null;
    }
    return s;
  }

  /** The period ends: renewed (or ended, when set to cancel). */
  rollPeriod(subId: string) {
    const s = this.subs[subId];
    const it = this.item(s);
    if (s.cancel_at_period_end) {
      s.status = "canceled";
      return s;
    }
    it.current_period_start = it.current_period_end;
    it.current_period_end = it.current_period_end + 30 * DAY;
    const inv = { id: nid("in"), object: "invoice", status: "paid", subscription: s.id, total: this.withTax(this.amount(it.price.id)), amount_paid: this.withTax(this.amount(it.price.id)), billing_reason: "subscription_cycle" };
    this.invoices[inv.id] = inv;
    s.latest_invoice = inv.id;
    return s;
  }

  /** The client finishes a checkout: a subscription on that price. */
  completeCheckout(csId: string, customer = "cus_new") {
    const cs = this.sessions[csId];
    const sub = this.subscribe(customer, cs.price, 0, { metadata: cs.subMeta });
    Object.assign(cs, { status: "complete", payment_status: "paid", subscription: sub.id, customer });
    return { session: { ...cs }, sub };
  }

  handler = async (input: any, init: any = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname !== "api.stripe.com") throw new Error(`unexpected fetch ${url}`);
    const method = String(init.method ?? "GET").toUpperCase();
    const params = Object.fromEntries(new URLSearchParams(init.body ?? url.search).entries());
    const path = url.pathname.replace(/^\/v1/, "");
    const key = init.headers?.["Idempotency-Key"];
    if (key && this.idem.has(key)) return json(this.idem.get(key));
    this.calls.push({ method, path, params });
    const res = this.route(method, path, params);
    if (key && res.status < 300) this.idem.set(key, res.body);
    return json(res.body, res.status);
  };

  private route(method: string, path: string, p: Record<string, string>): { status: number; body: any } {
    const now = Math.floor(Date.now() / 1000);
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/prices\/([^/]+)$/))) return this.prices[m[1]] ? ok(this.prices[m[1]]) : err(404, "No such price");
    if (path === "/customers/search") return ok({ data: [] });
    if (path === "/customers" && method === "POST") return ok({ id: nid("cus") });
    if ((m = path.match(/^\/subscriptions\/([^/]+)$/))) {
      const s = this.subs[m[1]];
      if (!s) return err(404, "No such subscription");
      if (method === "GET") return ok(s);
      if (p.cancel_at_period_end) s.cancel_at_period_end = p.cancel_at_period_end === "true";
      if (p["items[0][price]"]) {
        const to = p["items[0][price]"];
        if (p.proration_behavior === "always_invoice") {
          const at = Number(p.proration_date ?? now);
          const total = this.withTax(Math.max(0, this.proration(s, to, at)));
          const declined = this.declines.has(s.customer) && total > 0;
          const inv = { id: nid("in"), object: "invoice", status: declined ? "open" : "paid", subscription: s.id, total, amount_paid: declined ? 0 : total, billing_reason: "subscription_update", hosted_invoice_url: `https://invoice.stripe.com/i/${s.id}` };
          this.invoices[inv.id] = inv;
          if (declined && p.payment_behavior === "pending_if_incomplete") s.pending_update = { price: to };
          else this.item(s).price = { id: to };
          s.latest_invoice = p["expand[0]"] === "latest_invoice" ? inv : inv.id;
          return ok({ ...s, latest_invoice: s.latest_invoice });
        }
        this.item(s).price = { id: to };
      }
      return ok(s);
    }
    if (path === "/invoices/create_preview") {
      const s = this.subs[p.subscription];
      const to = p["subscription_details[items][0][price]"];
      if (p["subscription_details[proration_behavior]"] === "always_invoice") {
        const at = Number(p["subscription_details[proration_date]"] ?? now);
        return ok({ total: this.withTax(this.proration(s, to, at)), total_taxes: [{ amount: Math.round(this.proration(s, to, at) * this.taxRate) }] });
      }
      return ok({ total: this.withTax(this.amount(to)), total_taxes: [{ amount: Math.round(this.amount(to) * this.taxRate) }] });
    }
    if ((m = path.match(/^\/invoices\/([^/]+)\/void$/))) {
      const inv = this.invoices[m[1]];
      inv.status = "void";
      const s = this.subs[inv.subscription];
      if (s) s.pending_update = null;
      return ok(inv);
    }
    if ((m = path.match(/^\/invoices\/([^/]+)$/))) return this.invoices[m[1]] ? ok(this.invoices[m[1]]) : err(404, "No such invoice");
    if (path === "/checkout/sessions" && method === "POST") {
      const id = nid("cs");
      const meta: Row = {};
      const subMeta: Row = {};
      for (const [k, v] of Object.entries(p)) {
        const a = k.match(/^metadata\[(.+)\]$/);
        if (a) meta[a[1]] = v;
        const b = k.match(/^subscription_data\[metadata\]\[(.+)\]$/);
        if (b) subMeta[b[1]] = v;
      }
      this.sessions[id] = { id, object: "checkout.session", status: "open", payment_status: "unpaid", mode: p.mode, price: p["line_items[0][price]"], metadata: meta, subMeta, success_url: p.success_url, customer_text: p["custom_text[submit][message]"] ?? null, url: `https://checkout.stripe.com/c/pay/${id}` };
      return ok(this.sessions[id]);
    }
    if ((m = path.match(/^\/checkout\/sessions\/([^/]+)\/expire$/))) {
      this.sessions[m[1]].status = "expired";
      return ok(this.sessions[m[1]]);
    }
    if ((m = path.match(/^\/checkout\/sessions\/([^/]+)$/))) return this.sessions[m[1]] ? ok(this.sessions[m[1]]) : err(404, "No such session");
    return err(400, `fake stripe: no route for ${method} ${path}`);
  }
}

function ok(body: any) {
  return { status: 200, body };
}
function err(status: number, message: string) {
  return { status, body: { error: { message } } };
}
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
