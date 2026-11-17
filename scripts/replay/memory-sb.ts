/**
 * An in-memory stand-in for the supabase-js query builder, for
 * replaying a server read (loadWeightManagement) against a snapshot of
 * production rows. Supports the filters the loaders use: eq, neq, gt/gte/lt/lte,
 * in, is, not(col, "is", null), contains, order, limit, range, maybeSingle,
 * single. The select list is ignored (rows hold what the snapshot took),
 * except that a nested relation in the select ("days(a, b)") is read from the
 * row's own key of that name. Writes (insert, upsert, update) are recorded in
 * `writes` and applied to the in-memory rows only: nothing reaches a database.
 */
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

export type Write = { table: string; op: "insert" | "upsert" | "update"; rows: Row[]; where?: string };

class Query implements PromiseLike<{ data: any; error: null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private lim: number | null = null;
  private from_: number | null = null;
  private to_: number | null = null;
  private one: "maybe" | "single" | null = null;
  private write: { op: "insert" | "upsert" | "update"; rows: Row[] } | null = null;
  constructor(private rows: Row[], private table = "", private log: Write[] = []) {}
  select() { return this; }
  insert(r: Row | Row[]) { this.write = { op: "insert", rows: (Array.isArray(r) ? r : [r]).map((x) => ({ id: x.id ?? `mem-${Math.random().toString(16).slice(2, 10)}`, ...x })) }; return this; }
  upsert(r: Row | Row[]) { this.write = { op: "upsert", rows: Array.isArray(r) ? r : [r] }; return this; }
  update(patch: Row) { this.write = { op: "update", rows: [patch] }; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v || String(r[c]) === String(v)); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v && String(r[c]) !== String(v)); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) > String(v)); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]) < String(v)); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && String(r[c]).slice(0, String(v).length) <= String(v)); return this; }
  in(c: string, vs: any[]) { const s = new Set(vs.map(String)); this.filters.push((r) => s.has(String(r[c]))); return this; }
  is(c: string, v: any) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: any) {
    if (op === "is" && v === null) this.filters.push((r) => r[c] != null);
    else if (op === "in") { const s = new Set(String(v).replace(/[()]/g, "").split(",")); this.filters.push((r) => !s.has(String(r[c]))); }
    else this.filters.push((r) => r[c] !== v);
    return this;
  }
  contains(c: string, v: any) { this.filters.push((r) => JSON.stringify(r[c] ?? null).includes(JSON.stringify(v).slice(1, -1))); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(f: number, t: number) { this.from_ = f; this.to_ = t; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  private run() {
    if (this.write) {
      const w = this.write;
      if (w.op === "update") {
        const hit = this.rows.filter((r) => this.filters.every((f) => f(r)));
        for (const r of hit) Object.assign(r, w.rows[0]);
        this.log.push({ table: this.table, op: "update", rows: [w.rows[0]], where: `${hit.length} row(s)` });
        return { data: this.one ? hit[0] ?? null : hit, error: null };
      }
      this.rows.push(...w.rows);
      this.log.push({ table: this.table, op: w.op, rows: w.rows });
      return { data: this.one ? w.rows[0] : w.rows, error: null };
    }
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length) {
      out = [...out].sort((a, b) => {
        for (const o of this.orders) {
          const x = a[o.col], y = b[o.col];
          if (x == y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          return (String(x) < String(y) ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.from_ != null) out = out.slice(this.from_, (this.to_ ?? out.length) + 1);
    if (this.lim != null) out = out.slice(0, this.lim);
    if (this.one) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then<A, B>(ok?: ((v: { data: any; error: null }) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}

export function memorySb(tables: Tables, writes: Write[] = []) {
  return {
    writes,
    from: (t: string) => new Query((tables[t] ??= []), t, writes),
    rpc: async () => ({ data: null, error: null }),
  };
}
