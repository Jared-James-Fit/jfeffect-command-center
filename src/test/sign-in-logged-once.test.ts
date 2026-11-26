import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { markClientSignedIn } from "@/lib/activity";

describe("a sign-in is recorded once per app open", () => {
  beforeEach(() => rpc.mockClear());

  it("the auth events of one app open make one call per login", async () => {
    await markClientSignedIn("user-a");
    await markClientSignedIn("user-a");
    await markClientSignedIn("user-a");
    expect(rpc).toHaveBeenCalledTimes(1);
    await markClientSignedIn("user-b");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("the database records a sign-in at most every 2 minutes, never skipping a lead's conversion", () => {
    const sql = readFileSync("supabase/migrations/20270602093000_sign_in_logged_once.sql", "utf8");
    expect(sql).toContain("IF NOT v_was_lead AND v_last IS NOT NULL AND v_last > now() - interval '2 minutes' THEN");
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).toContain("jsonb_build_object('became_client', true)");
  });

  it("the auth listener and the session restore pass the login", () => {
    const auth = readFileSync("src/lib/auth.tsx", "utf8");
    expect(auth).toContain("markClientSignedIn(sess.user?.id)");
    expect(auth).toContain("markClientSignedIn(restoredUid)");
  });
});
