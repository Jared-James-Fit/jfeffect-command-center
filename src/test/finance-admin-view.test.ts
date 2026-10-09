import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { viewOnlyFetch, setAdminView } from "@/lib/admin-view";
import { ADMIN_VIEW_HEADER, VIEW_ONLY_MESSAGE, RECORDABLE_PAYMENT_STATUSES } from "@/lib/permissions";
import { assertAdminOr, withoutCredentials } from "@/lib/permissions.server";

const read = (p: string) => readFileSync(p, "utf8");
const API = "https://x.supabase.co/rest/v1";
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

function recorder(respond: (url: string, init: RequestInit) => Response = () => json([])) {
  const calls: Array<{ url: string; init: RequestInit; headers: Headers }> = [];
  const base = (async (input: any, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init, headers: new Headers(init.headers) });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, fetch: viewOnlyFetch(base) };
}

describe("finance login in the browser (admin view)", () => {
  it("asks for the admin view on reads only", async () => {
    const r = recorder();
    await r.fetch(`${API}/clients?select=*`, { method: "GET", headers: { apikey: "k" } });
    expect(r.calls[0].headers.get(ADMIN_VIEW_HEADER)).toBe("1");
    expect(r.calls[0].headers.get("apikey")).toBe("k");

    await r.fetch(`${API}/clients`, { method: "POST", body: JSON.stringify({ full_name: "x" }) });
    expect(r.calls[1].headers.get(ADMIN_VIEW_HEADER)).toBeNull();
  });

  it("leaves storage, auth and functions alone", async () => {
    const r = recorder();
    await r.fetch("https://x.supabase.co/storage/v1/object/sign/progress-media/a.jpg", { method: "POST" });
    await r.fetch("https://x.supabase.co/auth/v1/user", { method: "GET" });
    expect(r.calls.every((c) => c.headers.get(ADMIN_VIEW_HEADER) === null)).toBe(true);
  });

  it("sends a database function with simple arguments as a read", async () => {
    const r = recorder();
    await r.fetch(`${API}/rpc/session_balance`, {
      method: "POST",
      body: JSON.stringify({ _client_id: "c1" }),
      headers: { "Content-Type": "application/json", "Content-Profile": "public" },
    });
    const c = r.calls[0];
    expect(c.init.method).toBe("GET");
    expect(c.init.body).toBeUndefined();
    expect(new URL(c.url).searchParams.get("_client_id")).toBe("c1");
    expect(c.headers.get(ADMIN_VIEW_HEADER)).toBe("1");
    expect(c.headers.get("Accept-Profile")).toBe("public");
    expect(c.headers.get("Content-Profile")).toBeNull();
  });

  it("keeps a function with list or null arguments as sent (no admin view)", async () => {
    const r = recorder();
    await r.fetch(`${API}/rpc/books_labels`, { method: "POST", body: JSON.stringify({ a: ["1", "2"] }) });
    await r.fetch(`${API}/rpc/thing`, { method: "POST", body: JSON.stringify({ a: null }) });
    expect(r.calls.map((c) => c.init.method)).toEqual(["POST", "POST"]);
    expect(r.calls.every((c) => c.headers.get(ADMIN_VIEW_HEADER) === null)).toBe(true);
  });

  it("turns a refused change into one plain message", async () => {
    const r = recorder(() => json({ code: "42501", message: 'new row violates row-level security policy for table "clients"' }, { status: 403 }));
    const res = await r.fetch(`${API}/clients`, { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe(VIEW_ONLY_MESSAGE);

    const ro = recorder(() => json({ code: "25006", message: "cannot execute UPDATE in a read-only transaction" }, { status: 400 }));
    expect((await (await ro.fetch(`${API}/rpc/mark_seen`, { method: "POST", body: "{}" })).json()).message).toBe(VIEW_ONLY_MESSAGE);
  });

  it("reports an update that matched nothing instead of a silent success", async () => {
    const r = recorder(() => new Response(null, { status: 204, headers: { "Content-Range": "*/0" } }));
    const res = await r.fetch(`${API}/clients?id=eq.1`, { method: "PATCH", body: "{}", headers: { Prefer: "return=minimal" } });
    expect(r.calls[0].headers.get("Prefer")).toBe("return=minimal,count=exact");
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe(VIEW_ONLY_MESSAGE);

    const ok = recorder(() => new Response(null, { status: 204, headers: { "Content-Range": "0-0/1" } }));
    expect((await ok.fetch(`${API}/business_expenses?id=eq.1`, { method: "PATCH", body: "{}" })).status).toBe(204);
  });

  it("passes other errors through untouched", async () => {
    const r = recorder(() => json({ code: "PGRST301", message: "JWT expired" }, { status: 401 }));
    expect((await (await r.fetch(`${API}/clients`, { method: "POST", body: "{}" })).json()).message).toBe("JWT expired");
  });

  it("switches on and off on the API client", () => {
    const original = (async () => json([])) as typeof fetch;
    const client: any = { rest: { fetch: original } };
    setAdminView(client, true);
    expect(client.rest.fetch).not.toBe(original);
    setAdminView(client, true);
    setAdminView(client, false);
    expect(client.rest.fetch).toBe(original);
  });
});

describe("finance login on the server", () => {
  const ctx = (roles: string[], opts: { aal?: string; allowed?: boolean } = {}) => {
    const rpc: string[] = [];
    return {
      rpc,
      userId: "u1",
      claims: { aal: opts.aal ?? "aal2" },
      supabase: {
        from: () => ({ select: () => ({ eq: async () => ({ data: roles.map((role) => ({ role })), error: null }) }) }),
        rpc: async (fn: string, args: any) => { rpc.push(`${fn}:${args._perm}`); return { data: !!opts.allowed, error: null }; },
      },
    };
  };

  it("lets the admin through without asking about permissions", async () => {
    const c = ctx(["admin"]);
    expect(await assertAdminOr(c, "payments.record")).toEqual({ viewOnly: false });
    expect(c.rpc).toEqual([]);
  });

  it("lets a finance login through only with the permission and MFA", async () => {
    const ok = ctx(["finance"], { allowed: true });
    expect(await assertAdminOr(ok, "discounts.manage")).toEqual({ viewOnly: true });
    expect(ok.rpc).toEqual(["has_permission:discounts.manage"]);
    await expect(assertAdminOr(ctx(["finance"], { allowed: false }), "payments.record")).rejects.toThrow(/Forbidden: missing payments.record/);
    await expect(assertAdminOr(ctx(["finance"], { aal: "aal1", allowed: true }), "payments.record")).rejects.toThrow(/MFA_REQUIRED/);
  });

  it("gives coaches and clients the usual admin-only error, without asking about permissions", async () => {
    for (const roles of [["client"], ["coach"], []]) {
      const c = ctx(roles, { allowed: true, aal: "aal1" });
      await expect(assertAdminOr(c, "payments.request")).rejects.toThrow("Forbidden: admin only");
      expect(c.rpc).toEqual([]);
    }
  });

  it("strips setup tokens for view-only callers", () => {
    expect(withoutCredentials({ id: "m1", email: "a@b.c", setup_token: "secret", setup_token_expires_at: "x" })).toEqual({ id: "m1", email: "a@b.c" });
  });

  it("records money in or owed, never refunds or cancellations", () => {
    expect(RECORDABLE_PAYMENT_STATUSES).toContain("Paid");
    for (const s of ["Refunded", "Cancelled", "Expired", "Draft"]) expect(RECORDABLE_PAYMENT_STATUSES as readonly string[]).not.toContain(s);
  });
});

describe("finance admin-view migration", () => {
  const sql = readFileSync("supabase/migrations/20261020093700_finance_admin_view.sql", "utf8");
  const hasRole = sql.slice(sql.indexOf("FUNCTION public.has_role("), sql.indexOf("$$;", sql.indexOf("FUNCTION public.has_role(")));

  it("only widens has_role for admin, in read-only transactions, on request, for the caller, as a viewer", () => {
    expect(hasRole).toContain("_role = 'admin'");
    expect(hasRole).toContain("current_setting('transaction_read_only') = 'on'");
    expect(hasRole).toContain("->> 'x-jf-admin-view') IS NOT NULL");
    expect(hasRole).toContain("_user_id = auth.uid()");
    expect(hasRole).toContain("public.is_admin_viewer()");
  });

  it("needs MFA and never matches an admin", () => {
    const viewer = sql.slice(sql.indexOf("FUNCTION public.is_admin_viewer()"), sql.indexOf("$$;", sql.indexOf("FUNCTION public.is_admin_viewer()")));
    expect(viewer).toContain("public.session_mfa_verified()");
    expect(viewer).toContain("NOT EXISTS (SELECT 1 FROM public.user_roles ur");
  });

  it("keeps credential tables away from view-only logins", () => {
    for (const t of ["google_calendar_connections", "signnow_settings", "wearable_connection_secrets", "password_recovery_tokens", "na_guest_tokens", "email_unsubscribe_tokens", "coach_invites", "staff_invites"]) {
      expect(sql).toContain(`'${t}'`);
    }
    expect(sql).toMatch(/AS RESTRICTIVE\s+FOR SELECT TO authenticated USING \(NOT public\.is_admin_viewer\(\)\)/);
  });

  it("lets discounts.manage create, edit and pause codes, but not delete them", () => {
    expect(sql).toContain("FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'discounts.manage'))");
    expect(sql).toMatch(/discounts\.manage update[\s\S]*FOR UPDATE/);
    expect(sql).not.toMatch(/ON public\.discount_codes\s+FOR (DELETE|ALL)/);
  });
});

describe("finance login's workspace", () => {
  it("puts its money pages first, in the order it works", async () => {
    const { buildFinanceNav } = await import("@/lib/internal-nav");
    const nav = buildFinanceNav();
    expect(nav.map((i) => i.to)).toEqual([
      "/admin/finance", "/admin/finance/books", "/admin/finance/payments", "/admin/transactions", "/admin/payments",
      "/admin/membership/billing", "/admin/discount-codes", "/admin/payment-links",
    ]);
    expect(nav.every((i) => i.group === "Finance" && !!i.icon)).toBe(true);
    expect(nav.map((i) => i.label)).toEqual(["Home", "Books", "Payments", "Stripe activity", "Revenue", "Subscriptions", "Discount Codes", "Products"]);
    // Real paths, so the sidebar and phone bar can show them as selected.
    expect(nav.some((i) => i.to.includes("?"))).toBe(false);
  });

  it("lands on the books and gets a money-first phone bar", () => {
    const route = readFileSync("src/routes/_authenticated/admin/route.tsx", "utf8");
    expect(route).toMatch(/viewOnly\s*\?\s*\[\.\.\.buildFinanceNav\(\), \.\.\.fullNav\]/);
    expect(route).toContain("const defaultBottom = viewOnly ? FINANCE_BAR : STAFF_BAR;");
    expect(readFileSync("src/routes/_authenticated/finance.tsx", "utf8")).toContain('to: "/admin/finance"');
    expect(readFileSync("src/routes/index.tsx", "utf8")).toContain('viewOnly ? "/finance"');
    expect(readFileSync("src/routes/auth.tsx", "utf8")).toContain('viewOnly ? "/finance"');
    expect(readFileSync("src/components/app-shell.tsx", "utf8")).toMatch(/"Finance", \/\/ the finance login's own section, always first\n\s+"Overview",/);
  });
});

describe("phone bar selected tab", () => {
  it("lights the deepest tab on sub-pages and never a top-level home", async () => {
    const { barPrefixMatch } = await import("@/lib/floating-bar");
    const Icon = (() => null) as any;
    const bar = [
      { to: "/admin/finance", label: "Home", icon: Icon },
      { to: "/admin/finance/books", label: "Books", icon: Icon },
      { to: "/admin/clients", label: "Clients", icon: Icon },
    ];
    expect(barPrefixMatch(bar, "/admin/finance/books")).toBeNull(); // exact match wins
    expect(barPrefixMatch(bar, "/admin/finance/payments")).toBe("/admin/finance");
    expect(barPrefixMatch(bar, "/admin/clients/abc")).toBe("/admin/clients");
    expect(barPrefixMatch([{ to: "/admin", label: "Home", icon: Icon }], "/admin/tasks")).toBeNull();
    expect(barPrefixMatch([{ to: "/admin/sales?tab=taxes", label: "Books", icon: Icon }], "/admin/sales/x")).toBeNull();
  });

  it("Money stays lit on Payments, and Home doesn't light with it", async () => {
    const { barPrefixMatch, onPages } = await import("@/lib/floating-bar");
    const { FINANCE_BAR } = await import("@/lib/internal-nav");
    const money = FINANCE_BAR.find((i) => i.label === "Money")!;
    expect(onPages(money.activeOn, "/admin/finance/payments")).toBe(true);
    expect(onPages(money.activeOn, "/admin/finance")).toBe(false);
    expect(barPrefixMatch(FINANCE_BAR, "/admin/finance/payments")).toBeNull();
    expect(barPrefixMatch(FINANCE_BAR, "/admin/clients/abc")).toBe("/admin/clients");
    expect(read("src/components/app-shell.tsx")).toContain("onPages(item.activeOn, pathname) ||");
  });
});

describe("the finance phone bar: Home, Money, League (raised), Clients, Tasks", () => {
  it("has the same League and Tasks tabs as every staff bar", async () => {
    const { FINANCE_BAR, STAFF_BAR } = await import("@/lib/internal-nav");
    expect(FINANCE_BAR.map((i) => i.label)).toEqual(["Home", "Money", "League", "Clients", "Tasks"]);
    expect(FINANCE_BAR.map((i) => i.to)).toEqual(["/admin/finance", "/admin/finance/books", "/admin/community", "/admin/clients", "/admin/tasks"]);
    expect(FINANCE_BAR.filter((i) => i.featured).map((i) => i.label)).toEqual(["League"]);
    for (const label of ["League", "Clients", "Tasks"]) {
      expect(FINANCE_BAR.find((i) => i.label === label)).toBe(STAFF_BAR.find((i) => i.label === label));
    }
  });

  it("Books and Payments switch at the top of both pages, without stacking history", () => {
    expect(read("src/routes/_authenticated/admin/finance_.books.tsx")).toContain('<MoneySwitcher page="books" />');
    expect(read("src/routes/_authenticated/admin/finance_.payments.tsx")).toContain('<MoneySwitcher page="payments" />');
    expect(read("src/components/admin/finance/money-switcher.tsx")).toContain("navigate({ to: TO[p], replace: true })");
  });

  it("the League is the crew's boards, without the coach's queues and tools", () => {
    const hub = read("src/components/community/admin-community-hub.tsx");
    expect(hub).toContain('const VIEW_TABS: HubTab[] = ["league"];');
    expect(hub).toContain("{tabs.length > 1 && <div");
    expect(hub).toContain('const tab = tabs.some((t) => t.key === picked) ? picked : "league";');
    expect(hub).toContain("{!viewOnly && <button");
    expect(hub).toContain("<StaffLeagueTab tools={!viewOnly} />");
    expect(hub).toContain("{!viewOnly && <PulsePanel onGo={setTab} />}");
    expect(hub).toContain('{tab !== "feed" && !viewOnly && <NeedsYouStrip onGo={setTab} />}');
    expect(read("src/components/community/staff-league-board.tsx")).toContain("{tools && <LeagueTools />}");
    // A count it can never clear would sit on the button for good.
    expect(read("src/hooks/use-client-nav-badges.ts")).toContain('if (!viewOnly && community?.enabled && community.unseen > 0) map["/admin/community"]');
  });
});

describe("reads with no admin check of their own", () => {
  const ctx = (roles: string[], opts: { aal?: string; allowed?: boolean } = {}) => {
    const calls: string[] = [];
    return {
      calls,
      userId: "u1",
      claims: { aal: opts.aal ?? "aal2" },
      supabase: {
        tag: "own",
        from: () => ({ select: () => ({ eq: async () => { calls.push("roles"); return { data: roles.map((role) => ({ role })), error: null }; } }) }),
        rpc: async (fn: string) => { calls.push(fn); return { data: !!opts.allowed, error: null }; },
      },
    };
  };

  it("keeps everyone's own client unless it's an MFA-verified view-only login", async () => {
    const { readClientFor } = await import("@/lib/permissions.server");
    for (const c of [ctx(["coach"], { aal: "aal1" }), ctx(["client"]), ctx(["admin"]), ctx(["finance"], { aal: "aal1", allowed: true }), ctx(["finance"], { allowed: false })]) {
      const r = await readClientFor(c);
      expect(r.viewOnly).toBe(false);
      expect(r.db.tag).toBe("own");
    }
    // aal1 sessions never even look up roles
    const quick = ctx(["coach"], { aal: "aal1" });
    await readClientFor(quick);
    expect(quick.calls).toEqual([]);
  });

  it("calls a database function as a read and leaves null arguments to the defaults", async () => {
    const { rpcRead } = await import("@/lib/permissions.server");
    const seen: any[] = [];
    const db = { rpc: (fn: string, args: any, opts: any) => { seen.push({ fn, args, opts }); return Promise.resolve({ data: null, error: null }); } };
    await rpcRead(db, "admin_clients_directory", { p_search: null, p_sort: "attention", p_coach_id: undefined, p_flags: ["overdue"], p_limit: 15 });
    expect(seen).toEqual([{ fn: "admin_clients_directory", args: { p_sort: "attention", p_flags: ["overdue"], p_limit: 15 }, opts: { get: true } }]);
  });
});
