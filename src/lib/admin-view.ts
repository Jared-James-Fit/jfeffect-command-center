/**
 * The finance login's view of the admin app, in the browser.
 *
 * The database treats a view-only login as the admin only for reads that ask
 * for it (the x-jf-admin-view header) inside a read-only transaction; see
 * supabase/migrations/20261020093700_finance_admin_view.sql. Every write still
 * goes through as the finance login, where the database refuses anything
 * outside its role. This module, switched on for that login only:
 *
 *   - adds the header to API reads (GET / HEAD);
 *   - sends database function calls with simple arguments as reads (GET), so
 *     the admin's read-only functions (dashboards, balances) answer, and any
 *     function that would write is refused by the database;
 *   - turns a refused change into one plain message, including an update or
 *     delete that matched nothing (which the API otherwise reports as success).
 *
 * Nothing here is a security boundary; the database is.
 */
import { ADMIN_VIEW_HEADER, VIEW_ONLY_MESSAGE } from "@/lib/permissions";
import { PREVIEW_MESSAGE } from "@/lib/team-preview";

type Fetch = typeof fetch;

const REFUSED_CODES = new Set(["42501", "25006"]); // insufficient_privilege, read_only_sql_transaction

// A read can't carry null or a list in its URL, so those calls stay as sent.
function isScalar(v: unknown): v is string | number | boolean {
  return ["string", "number", "boolean"].includes(typeof v);
}

function viewOnlyResponse(status: number, details?: string, message = VIEW_ONLY_MESSAGE): Response {
  return new Response(JSON.stringify({ code: "42501", message, details: details ?? null, hint: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function plainRefusal(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body: any = await res.clone().json().catch(() => null);
  if (!body || !REFUSED_CODES.has(String(body.code ?? ""))) return res;
  return viewOnlyResponse(res.status === 401 ? 403 : res.status, body.message);
}

/**
 * Wraps the API fetch for a view-only login. Exported for tests.
 * `strict` (an owner previewing a team member's view): nothing but reads leaves
 * the browser, since the owner's own rights would otherwise let a change through.
 */
export function viewOnlyFetch(base: Fetch, strict = false): Fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.includes("/rest/v1/")) return base(input, init);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));

    if (method === "GET" || method === "HEAD") {
      headers.set(ADMIN_VIEW_HEADER, "1");
      return base(url.href, { ...init, method, headers });
    }

    if (method === "POST" && url.pathname.includes("/rest/v1/rpc/")) {
      let args: Record<string, unknown> | null = {};
      try {
        args = init.body ? JSON.parse(String(init.body)) : {};
      } catch {
        args = null;
      }
      if (args && typeof args === "object" && !Array.isArray(args) && Object.values(args).every(isScalar)) {
        for (const [k, v] of Object.entries(args)) url.searchParams.set(k, String(v));
        headers.delete("Content-Type");
        const profile = headers.get("Content-Profile");
        if (profile) {
          headers.delete("Content-Profile");
          headers.set("Accept-Profile", profile);
        }
        headers.set(ADMIN_VIEW_HEADER, "1");
        const { body: _body, ...rest } = init;
        return plainRefusal(await base(url.href, { ...rest, method: "GET", headers }));
      }
      if (strict) return viewOnlyResponse(403, "preview", PREVIEW_MESSAGE);
      return plainRefusal(await base(input, init));
    }

    if (strict) return viewOnlyResponse(403, "preview", PREVIEW_MESSAGE);

    if (method === "PATCH" || method === "DELETE") {
      const prefer = headers.get("Prefer");
      if (!prefer?.includes("count=")) headers.set("Prefer", prefer ? `${prefer},count=exact` : "count=exact");
      const res = await base(url.href, { ...init, method, headers });
      if (res.ok && /\/0$/.test(res.headers.get("Content-Range") ?? "")) return viewOnlyResponse(403, "matched no rows it may change");
      return plainRefusal(res);
    }

    return plainRefusal(await base(input, init));
  };
}

const originals = new WeakMap<object, Fetch>();

/** File storage while previewing: downloads and signed links only. */
function readOnlyStorageFetch(base: Fetch): Fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    // Signing a download link is a POST that changes nothing.
    if (method === "GET" || method === "HEAD" || /\/object\/sign\//.test(path)) return base(input, init);
    return viewOnlyResponse(403, "preview", PREVIEW_MESSAGE);
  };
}

function swap(target: any, on: boolean, wrap: (f: Fetch) => Fetch) {
  if (!target || typeof target.fetch !== "function") return;
  if (on && !originals.has(target)) {
    originals.set(target, target.fetch);
    target.fetch = wrap(target.fetch);
  } else if (!on && originals.has(target)) {
    target.fetch = originals.get(target)!;
    originals.delete(target);
  }
}

/**
 * Turn the admin view on or off for this browser's API client. `preview` is
 * the owner viewing as a team member: reads only, files included.
 */
export function setAdminView(client: unknown, on: boolean, preview = false): void {
  const c = client as any;
  // Re-wrap when switching between a view-only login and a preview.
  swap(c?.rest, false, (f) => f);
  swap(c?.storage, false, (f) => f);
  swap(c?.rest, on, (f) => viewOnlyFetch(f, preview));
  swap(c?.storage, on && preview, readOnlyStorageFetch);
}
