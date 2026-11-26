/**
 * A small in-memory Supabase for server tests: tables of plain rows and the
 * query-builder calls the athlete-intel server uses (select / insert / upsert
 * with onConflict / update / delete, eq neq in is not gt gte lt lte contains,
 * PostgREST `or(...)` with and(...) groups and `cs` array containment, order,
 * limit, range, maybeSingle / single). Unique keys are declared per table so
 * an upsert's ignoreDuplicates and a 23505 behave like the database.
 */
type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

let seq = 0;
const nextId = (t: string) => `${t.slice(0, 3)}-${++seq}`;

function cmp(a: any, b: any) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function orFilter(expr: string): Filter {
  const parts = splitTop(expr).map((p): Filter => {
    const m = p.match(/^and\((.*)\)$/);
    if (m) {
      const inner = splitTop(m[1]).map(orFilter);
      return (r) => inner.every((f) => f(r));
    }
    const [col, op, ...rest] = p.split(".");
    const v = rest.join(".");
    switch (op) {
      case "eq":
        return (r) => String(r[col]) === v;
      case "neq":
        return (r) => String(r[col]) !== v;
      case "lt":
        return (r) => r[col] != null && String(r[col]) < v;
      case "lte":
        return (r) => r[col] != null && String(r[col]) <= v;
      case "gt":
        return (r) => r[col] != null && String(r[col]) > v;
      case "gte":
        return (r) => r[col] != null && String(r[col]) >= v;
      case "is":
        return (r) => (v === "null" ? r[col] == null : String(r[col]) === v);
      case "cs": {
        const items = v.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
        return (r) => Array.isArray(r[col]) && items.every((i) => r[col].map(String).includes(i));
      }
      default:
        throw new Error(`fake-supabase: or op ${op}`);
    }
  });
  return (r) => parts.some((f) => f(r));
}

export class FakeDb {
  tables = new Map<string, Row[]>();
  unique = new Map<string, string[][]>();
  storage = {
    from: (_b: string) => ({
      remove: async (_p: string[]) => ({ error: null }),
      download: async (_p: string) => ({ data: null, error: { message: "no file" } }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://example.test/file" }, error: null }),
    }),
  };

  constructor(seed: Record<string, Row[]> = {}, unique: Record<string, string[][]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables.set(t, rows.map((r) => ({ ...r })));
    for (const [t, u] of Object.entries(unique)) this.unique.set(t, u);
  }
  rows(t: string): Row[] {
    if (!this.tables.has(t)) this.tables.set(t, []);
    return this.tables.get(t)!;
  }
  from(t: string) {
    return new Query(this, t);
  }
  async rpc() {
    return { data: null, error: null };
  }
  clash(t: string, row: Row, except?: Row): Row | null {
    for (const cols of this.unique.get(t) ?? []) {
      const hit = this.rows(t).find((r) => r !== except && cols.every((c) => r[c] != null && String(r[c]) === String(row[c])));
      if (hit) return hit;
    }
    return null;
  }
}

class Query {
  private filters: Filter[] = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private lim: number | null = null;
  private from_ = 0;
  private to_: number | null = null;
  private one: "maybe" | "single" | null = null;
  private op: { kind: "select" | "insert" | "upsert" | "update" | "delete"; rows?: Row[]; patch?: Row; opts?: any } = { kind: "select" };
  private returning = false;
  private head = false;

  constructor(private db: FakeDb, private t: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op.kind !== "select") this.returning = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(r: Row | Row[]) {
    this.op = { kind: "insert", rows: Array.isArray(r) ? r : [r] };
    return this;
  }
  upsert(r: Row | Row[], opts: any = {}) {
    this.op = { kind: "upsert", rows: Array.isArray(r) ? r : [r], opts };
    return this;
  }
  update(patch: Row) {
    this.op = { kind: "update", patch };
    return this;
  }
  delete() {
    this.op = { kind: "delete" };
    return this;
  }
  eq(c: string, v: any) {
    this.filters.push((r) => (v === null ? r[c] == null : String(r[c]) === String(v)));
    return this;
  }
  neq(c: string, v: any) {
    this.filters.push((r) => String(r[c]) !== String(v));
    return this;
  }
  in(c: string, vs: any[]) {
    const s = new Set(vs.map(String));
    this.filters.push((r) => s.has(String(r[c])));
    return this;
  }
  is(c: string, v: any) {
    this.filters.push((r) => (v === null ? r[c] == null : r[c] === v));
    return this;
  }
  not(c: string, op: string, v: any) {
    if (op === "is" && v === null) this.filters.push((r) => r[c] != null);
    else if (op === "in") {
      const s = new Set(String(v).replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, "")));
      this.filters.push((r) => !s.has(String(r[c])));
    } else this.filters.push((r) => String(r[c]) !== String(v));
    return this;
  }
  gt(c: string, v: any) {
    this.filters.push((r) => r[c] != null && String(r[c]) > String(v));
    return this;
  }
  gte(c: string, v: any) {
    this.filters.push((r) => r[c] != null && String(r[c]) >= String(v));
    return this;
  }
  lt(c: string, v: any) {
    this.filters.push((r) => r[c] != null && String(r[c]) < String(v));
    return this;
  }
  lte(c: string, v: any) {
    this.filters.push((r) => r[c] != null && String(r[c]) <= String(v));
    return this;
  }
  contains(c: string, v: any) {
    this.filters.push((r) => {
      if (Array.isArray(v)) return Array.isArray(r[c]) && v.every((x) => r[c].includes(x));
      return Object.entries(v ?? {}).every(([k, x]) => r[c]?.[k] === x);
    });
    return this;
  }
  or(expr: string) {
    this.filters.push(orFilter(expr));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: o.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(f: number, to: number) {
    this.from_ = f;
    this.to_ = to;
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  then(res: (v: any) => any, rej?: (e: any) => any) {
    try {
      return Promise.resolve(this.run()).then(res, rej);
    } catch (e) {
      return Promise.reject(e).then(res, rej);
    }
  }

  private matched(): Row[] {
    return this.db.rows(this.t).filter((r) => this.filters.every((f) => f(r)));
  }

  private shape(rows: Row[]) {
    let out = [...rows];
    for (const o of [...this.orders].reverse()) out.sort((a, b) => (o.asc ? cmp(a[o.col], b[o.col]) : cmp(b[o.col], a[o.col])));
    if (this.to_ != null) out = out.slice(this.from_, this.to_ + 1);
    if (this.lim != null) out = out.slice(0, this.lim);
    const copy = out.map((r) => JSON.parse(JSON.stringify(r)));
    if (this.head) return { data: null, count: copy.length, error: null };
    if (this.one) {
      if (this.one === "single" && copy.length !== 1) return { data: null, error: { message: "not one row", code: "PGRST116" } };
      return { data: copy[0] ?? null, error: null };
    }
    return { data: copy, count: copy.length, error: null };
  }

  private run() {
    const now = new Date().toISOString();
    const table = this.db.rows(this.t);
    switch (this.op.kind) {
      case "select":
        return this.shape(this.matched());
      case "insert": {
        const made: Row[] = [];
        for (const r of this.op.rows!) {
          const row = { id: nextId(this.t), created_at: now, updated_at: now, ...r };
          if (this.db.clash(this.t, row)) return { data: null, error: { message: "duplicate key", code: "23505" } };
          table.push(row);
          made.push(row);
        }
        return this.returning ? this.shape(made) : { data: null, error: null };
      }
      case "upsert": {
        const cols: string[] = String(this.op.opts?.onConflict ?? "id").split(",").map((s: string) => s.trim());
        const made: Row[] = [];
        for (const r of this.op.rows!) {
          const hit = table.find((x) => cols.every((c) => x[c] != null && String(x[c]) === String(r[c])));
          if (hit) {
            if (this.op.opts?.ignoreDuplicates) continue;
            Object.assign(hit, r, { updated_at: now });
            made.push(hit);
          } else {
            const row = { id: nextId(this.t), created_at: now, updated_at: now, ...r };
            table.push(row);
            made.push(row);
          }
        }
        return this.returning ? this.shape(made) : { data: null, error: null };
      }
      case "update": {
        const hits = this.matched();
        for (const h of hits) {
          const next = { ...h, ...this.op.patch };
          const clash = this.db.clash(this.t, next, h);
          if (clash) return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
        for (const h of hits) Object.assign(h, this.op.patch);
        return this.returning ? this.shape(hits) : { data: null, error: null };
      }
      case "delete": {
        const hits = new Set(this.matched());
        const kept = table.filter((r) => !hits.has(r));
        table.length = 0;
        table.push(...kept);
        return this.returning ? this.shape([...hits]) : { data: null, error: null };
      }
    }
  }
}
