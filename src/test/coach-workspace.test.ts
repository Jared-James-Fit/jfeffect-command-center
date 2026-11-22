import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCEPT_WORDS,
  CLIENT_CONSENT_VERSION,
  INVITE_TOKEN_BYTES,
  PEEK_WORDS,
  TOKEN_RE,
  clientConsentText,
  inviteLink,
  sortRoster,
} from "@/lib/coach-platform/workspace";

const migration = readFileSync("supabase/migrations/20270510090000_coach_workspaces.sql", "utf8");
const fns = readFileSync("src/lib/coach-platform/coach-workspace.functions.ts", "utf8");

describe("the client's consent", () => {
  it("names the business, says what's shared, that they can end it, and that ending deletes nothing", () => {
    const t = clientConsentText("Strong Coaching");
    expect(t).toContain("Strong Coaching");
    expect(t).toMatch(/training, nutrition and progress records/);
    expect(t).toMatch(/including what I logged before today/);
    expect(t).toMatch(/end this any time/);
    expect(t).toMatch(/Nothing I share is deleted/);
    // the database holds it word for word and refuses a shorter one
    expect(t.length).toBeGreaterThanOrEqual(20);
    expect(CLIENT_CONSENT_VERSION.length).toBeGreaterThanOrEqual(3);
  });
});

describe("invitation links", () => {
  it("a 24-byte token is 32 base64url characters, never more", () => {
    expect(Math.ceil((INVITE_TOKEN_BYTES * 4) / 3)).toBe(32);
    expect(TOKEN_RE.test("a".repeat(32))).toBe(true);
    expect(TOKEN_RE.test("a".repeat(31))).toBe(false);
    expect(TOKEN_RE.test("a".repeat(31) + "/")).toBe(false);
    expect(inviteLink("https://jfeffect.com/", "abc")).toBe("https://jfeffect.com/invite/abc");
  });

  it("only the token's SHA-256 reaches the database, never the token", () => {
    expect(fns).toMatch(/_token_hash: await t\.hash/);
    expect(migration).toMatch(/token_hash text NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it("every state a link can be in says something", () => {
    for (const s of ["accepted", "cancelled", "expired", "locked", "unavailable", "invalid"] as const) expect(PEEK_WORDS[s].length).toBeGreaterThan(10);
    for (const r of ["wrong_login", "already_athlete", "on_team"]) expect(ACCEPT_WORDS[r].length).toBeGreaterThan(10);
  });
});

describe("the roster", () => {
  it("active first, newest first, then paused, then ended", () => {
    const r = sortRoster([
      { client_id: "e", full_name: null, email: null, status: "ended", assigned_user_id: null, started_at: "2026-11-01" },
      { client_id: "a1", full_name: null, email: null, status: "active", assigned_user_id: null, started_at: "2026-10-01" },
      { client_id: "p", full_name: null, email: null, status: "paused", assigned_user_id: null, started_at: "2026-11-20" },
      { client_id: "a2", full_name: null, email: null, status: "active", assigned_user_id: null, started_at: "2026-11-10" },
    ]);
    expect(r.map((x) => x.client_id)).toEqual(["a2", "a1", "p", "e"]);
  });
});

describe("the server never trusts the page", () => {
  it("every write is a definer function called through the caller's own login", () => {
    for (const rpc of ["org_invite", "org_invitation_revoke", "org_client_set_status", "org_invitation_accept"]) {
      expect(fns).toContain(`(context as any).supabase.rpc("${rpc}"`);
    }
  });

  it("billing (test mode) and AI state are only reached after the caller's own check", () => {
    const billing = fns.slice(fns.indexOf("export const startWorkspaceBilling"));
    expect(billing.indexOf('assertOrgAccess(context, data.orgId, "billing.manage")')).toBeLessThan(billing.indexOf("startSeatCheckout("));
    const overview = fns.slice(fns.indexOf("export const getWorkspaceOverview"), fns.indexOf("export const inviteToWorkspace"));
    expect(overview.indexOf("isMember(ctx, data.orgId)")).toBeLessThan(overview.indexOf('rpc("org_ai_state"'));
  });

  it("a new login from an invitation is made unconfirmed then confirmed (never linked to a JF record by email)", () => {
    const signup = fns.slice(fns.indexOf("export const finishInviteSignup"));
    expect(signup).toMatch(/email_confirm: false/);
    expect(signup.indexOf("email_confirm: false")).toBeLessThan(signup.indexOf("email_confirm: true"));
  });
});

describe("the database rules the screens rely on", () => {
  it("no function or policy can give a workspace member a JF Effect role or coach record", () => {
    expect(migration).not.toMatch(/INSERT INTO public\.user_roles/i);
    expect(migration).not.toMatch(/INSERT INTO public\.coaches/i);
  });

  it("the pilot can't be switched on while a client table is unfenced", () => {
    expect(migration).toMatch(/FROM public\.tenant_fence_report\(\) WHERE status IN \('unfenced', 'rls_off'\)/);
  });

  it("starts off", () => {
    expect(migration).toContain(`VALUES ('coach_workspaces', '{"pilot": false}')`);
  });
});
