import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { likeStateWords, rolloutStatusWords } from "@/lib/virtual-accounts/rollout";
import { buildInternalNav, buildInternalNavCollapsed } from "@/lib/internal-nav";

const SQL = readFileSync("supabase/migrations/20270602100000_virtual_likes_rollout.sql", "utf8");
const body = (fn: string) => {
  const from = SQL.indexOf(`FUNCTION public.${fn}(`);
  return SQL.slice(from, SQL.indexOf("$$;", from));
};

const accounts = [
  { user_id: "a", first_name: "Hannah", last_name: "Reid" },
  { user_id: "b", first_name: "Kofi", last_name: "Mensah" },
];
const on = { automation_enabled: true, rollout_enabled: true };
const state = (o: Record<string, unknown>) => ({
  enabled: true,
  gap_days: 3,
  next_user_id: "b",
  queued: 10,
  last_started_at: "2026-11-26T02:30:00Z",
  due_after: "2026-11-29T02:30:00Z",
  needs_like: true,
  ...o,
});

describe("gradual start: what the admin page says", () => {
  const now = new Date("2026-11-27T18:00:00Z");
  it("says what's stopping it before anything else", () => {
    expect(
      rolloutStatusWords(
        state({}),
        accounts,
        { automation_enabled: false, rollout_enabled: true },
        now,
      ),
    ).toMatch(/global switch is off/);
    expect(
      rolloutStatusWords(
        state({}),
        accounts,
        { automation_enabled: true, rollout_enabled: false },
        now,
      ),
    ).toMatch(/^Off/);
    expect(rolloutStatusWords(state({ next_user_id: null }), accounts, on, now)).toMatch(
      /Nobody's waiting/,
    );
  });
  it("names who's next and when", () => {
    expect(rolloutStatusWords(state({}), accounts, on, now)).toBe(
      "Kofi Mensah starts next, from Nov 28 between 10 AM and 8 PM, once there's been a like since the last one started.",
    );
    expect(
      rolloutStatusWords(state({ due_after: "2026-11-27T00:00:00Z" }), accounts, on, now),
    ).toMatch(/after the first like/);
    expect(
      rolloutStatusWords(
        state({ due_after: "2026-11-27T00:00:00Z", needs_like: false }),
        accounts,
        on,
        now,
      ),
    ).toMatch(/today or tomorrow/);
    expect(rolloutStatusWords(state({ last_started_at: null }), accounts, on, now)).toBe(
      "Kofi Mensah starts next, between 10 AM and 8 PM.",
    );
  });
  it("each account says whether it likes yet", () => {
    const base = {
      active: true,
      likes_enabled: false,
      likes_started_at: null,
      rollout_position: null,
    };
    expect(
      likeStateWords({ ...base, likes_enabled: true, likes_started_at: "2026-11-26T03:00:00Z" }),
    ).toBe("Liking since Nov 25");
    expect(likeStateWords({ ...base, rollout_position: 2 })).toBe("In the queue · #2");
    expect(likeStateWords(base)).toBe("Not liking");
    expect(likeStateWords({ ...base, active: false, likes_enabled: true })).toBe("Inactive");
  });
});

describe("gradual start: the database's rule", () => {
  it("starts the next one only after the gap, a like since the last start, in the daytime, by chance", () => {
    const step = body("virtual_accounts_rollout_step");
    expect(step).toContain("IF v_hour < 10 OR v_hour >= 20 THEN RETURN NULL");
    expect(step).toContain("IF now() < (st->>'due_after')::timestamptz THEN RETURN NULL");
    expect(step).toContain("IF (st->>'needs_like')::boolean THEN RETURN NULL");
    expect(step).toContain("IF random() > 0.17 THEN RETURN NULL");
    expect(body("virtual_rollout_state")).toContain(
      "(s.v->>'rollout_enabled')::boolean AND (s.v->>'automation_enabled')::boolean",
    );
  });
  it("the tick corrects names first, runs the gradual start only while the global switch is on, and prefers fresh posts", () => {
    const tick = body("virtual_accounts_tick");
    const fix = tick.indexOf("virtual_accounts_fix_placeholder_names");
    const off = tick.indexOf("IF NOT (s->>'automation_enabled')::boolean THEN RETURN 0");
    const step = tick.indexOf("virtual_accounts_rollout_step()");
    expect(fix).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(fix);
    expect(step).toBeGreaterThan(off);
    expect(tick).toContain(
      "ORDER BY -ln(1.0 - random()) / exp(-extract(epoch FROM now() - p.created_at) / 41544.0)",
    );
    // only likes: nothing here posts, comments, follows or messages
    expect(tick).not.toMatch(
      /community_comments|community_follows|INSERT INTO public\.community_posts|messages/,
    );
  });
  it("only admins set or read the rollout; the rest is the server's", () => {
    for (const f of ["admin_virtual_rollout_set", "admin_virtual_rollout_state"])
      expect(body(f), f).toContain("has_role(");
    for (const f of ["virtual_accounts_rollout_step()", "virtual_rollout_state()"]) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
    }
  });
});

describe("the page is in the Crew menu", () => {
  it("Crew → Virtual Accounts, for admins, listed (not search only)", () => {
    const crew = buildInternalNavCollapsed("admin").find((n) => n.label === "Crew");
    const row = crew?.children?.find((c) => c.to === "/admin/virtual-accounts");
    expect(row?.label).toBe("Virtual Accounts");
    expect(row?.searchOnly).toBeFalsy();
  });
  it("never a coach's", () => {
    expect(buildInternalNav("coach").some((n) => n.to === "/admin/virtual-accounts")).toBe(false);
  });
});
