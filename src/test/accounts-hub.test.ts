import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { setAdminView, viewOnlyFetch } from "@/lib/admin-view";
import { ADMIN_VIEW_HEADER } from "@/lib/permissions";
import { isPreviewSafeFn, PREVIEW_MESSAGE } from "@/lib/team-preview";

const read = (p: string) => readFileSync(p, "utf8");
const API = "https://x.supabase.co/rest/v1";
const ok = () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });

function recorder(strict: boolean) {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const base = (async (input: any, init: RequestInit = {}) => {
    calls.push({ url: typeof input === "string" ? input : input.url, method: (init.method ?? "GET").toUpperCase(), headers: new Headers(init.headers) });
    return ok();
  }) as typeof fetch;
  return { calls, fetch: viewOnlyFetch(base, strict) };
}

describe("viewing as a team member: the server refuses anything but reads", () => {
  it("lets reads through by name", () => {
    for (const n of ["getBooksData", "listMembers", "listTeam", "listClientsDirectoryFn", "listStripeAccountTransactions", "getSummerProfile"]) {
      expect(isPreviewSafeFn(n), n).toBe(true);
    }
  });

  it("refuses writes, read-sounding writes and anything unnamed", () => {
    for (const n of ["updatePurchasePayment", "saveExpense", "sendPaymentRequest", "scanReceipt", "inviteStaff", "summerChat",
      "getSetupLink", "getMemberInstallLink", "getOrCreateThread", "getUploadUrl", "loadAndSyncFees", "setPovPersona"]) {
      expect(isPreviewSafeFn(n), n).toBe(false);
    }
    expect(isPreviewSafeFn(undefined)).toBe(false);
    expect(isPreviewSafeFn("")).toBe(false);
  });

  it("every server call carries the mark while previewing, and the guard runs on all of them", () => {
    const start = read("src/start.ts");
    expect(start).toContain("functionMiddleware: [attachSupabaseAuth, teamPreviewGuard]");
    expect(start).toContain("getTeamPreview() ? { [PREVIEW_HEADER]: \"1\" } : {}");
    expect(start).toContain("!isPreviewSafeFn(serverFnMeta?.name)");
  });

  it("only the owner (admin) can preview; it turns the finance view on", () => {
    const auth = read("src/lib/auth.tsx");
    expect(auth).toContain('const preview = role === "admin" ? teamPreview : null;');
    expect(auth).toContain('const viewOnly = role === "finance" || !!preview;');
    expect(auth).toContain("setAdminView(supabase, viewOnly, !!preview);");
  });
});

describe("viewing as a team member: the browser sends reads only", () => {
  it("reads go out (with the admin view), changes never leave the browser", async () => {
    const r = recorder(true);
    await r.fetch(`${API}/clients?select=*`, { method: "GET" });
    expect(r.calls[0].headers.get(ADMIN_VIEW_HEADER)).toBe("1");

    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await r.fetch(`${API}/purchase_records?id=eq.1`, { method, body: "{}" });
      expect(res.status).toBe(403);
      expect((await res.json()).message).toBe(PREVIEW_MESSAGE);
    }
    expect(r.calls).toHaveLength(1);
  });

  it("a database function with simple arguments still answers, as a read", async () => {
    const r = recorder(true);
    await r.fetch(`${API}/rpc/admin_dashboard_overview`, { method: "POST", body: JSON.stringify({ p_days: 30 }) });
    expect(r.calls[0].method).toBe("GET");
    const res = await r.fetch(`${API}/rpc/do_something`, { method: "POST", body: JSON.stringify({ ids: [1, 2] }) });
    expect(res.status).toBe(403);
    expect(r.calls).toHaveLength(1);
  });

  it("a finance login (not a preview) still sends its changes for the database to judge", async () => {
    const r = recorder(false);
    await r.fetch(`${API}/business_expenses`, { method: "POST", body: "{}" });
    expect(r.calls).toHaveLength(1);
  });

  it("file uploads are off too; download links still work; switching off restores both", async () => {
    const seen: string[] = [];
    const storageFetch = (async (input: any, init: RequestInit = {}) => {
      seen.push(`${(init.method ?? "GET").toUpperCase()} ${new URL(typeof input === "string" ? input : input.url).pathname}`);
      return ok();
    }) as typeof fetch;
    const restFetch = (async () => ok()) as typeof fetch;
    const client: any = { rest: { fetch: restFetch }, storage: { fetch: storageFetch } };

    setAdminView(client, true, true);
    expect((await client.storage.fetch("https://x.supabase.co/storage/v1/object/receipts/a.jpg", { method: "POST" })).status).toBe(403);
    await client.storage.fetch("https://x.supabase.co/storage/v1/object/sign/receipts/a.jpg", { method: "POST" });
    await client.storage.fetch("https://x.supabase.co/storage/v1/object/receipts/a.jpg", { method: "GET" });
    expect(seen).toEqual(["POST /storage/v1/object/sign/receipts/a.jpg", "GET /storage/v1/object/receipts/a.jpg"]);

    setAdminView(client, true, false); // a finance login: storage is the database's call
    expect(client.storage.fetch).toBe(storageFetch);
    setAdminView(client, false);
    expect(client.rest.fetch).toBe(restFetch);
  });
});

describe("Clients page: every account in one place", () => {
  const page = read("src/routes/_authenticated/admin/clients.index.tsx");

  it("admins switch between Clients, Members and Team (in the URL), coaches see clients", () => {
    expect(page).toContain('kind:          fallback(z.enum(["clients","members","team"]),');
    expect(page).toContain('const kind: AccountKind = isAdmin ? search.kind ?? "clients" : "clients";');
    expect(page).toContain("<AccountsSwitcher");
    expect(page).toContain("<MembersDirectory />");
    expect(page).toContain("<StaffPage embedded />");
  });

  it("switching tabs doesn't refetch the client list", () => {
    expect(page).toContain('queryKey: ["clients-directory", clientSearch]');
  });

  it("swiping works, without fighting the app's swipe-back on the first tab", () => {
    expect(page).toContain('data-no-swipe-back={kind === "clients" ? undefined : ""}');
    expect(read("src/components/accounts/accounts-switcher.tsx")).toContain("inSideScroller(el)");
  });

  it("the members list hides admins' test accounts and offers the owner's own on top", () => {
    const dir = read("src/components/members/members-directory.tsx");
    expect(dir).toContain("all.filter((m) => !m.is_admin_sandbox)");
    expect(dir).toContain("m.is_admin_sandbox && m.user_id === user?.id");
    expect(dir).toContain('const canPreview = role === "admin" && !viewOnly;');
    expect(read("src/routes/_authenticated/admin/members.index.tsx")).toContain("<MembersDirectory");
  });

  it("View as on a team card is the owner's, for a finance login only", () => {
    const staff = read("src/route-pages/_authenticated/admin/staff.tsx");
    expect(staff).toContain('const canViewAs = role === "admin" && !viewOnly && m.roles.includes("finance");');
    expect(staff).toContain('startTeamPreview({ role: "finance", name, userId: m.user_id });');
  });

  it("a view-only login (or a preview) gets no client view, which the server would refuse", () => {
    expect(read("src/components/clients/client-row.tsx")).toContain('const canPov = (role === "admin" || role === "coach") && !viewOnly;');
    expect(read("src/components/client-pov-quick-picker.tsx")).toContain('const canPov = (role === "admin" || role === "coach") && !viewOnly;');
  });

  it("member view says who it's showing and Back returns where you started", () => {
    const toggle = read("src/components/pov-quick-toggle.tsx");
    expect(toggle).toContain("`Viewing as ${povLabel(pov.persona)}`");
    expect(toggle).toContain('const back = splitHref(getPovFlag().returnTo ?? "/admin");');
  });
});
