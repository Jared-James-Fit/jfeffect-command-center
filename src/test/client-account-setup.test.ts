import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { profileChanges, rebaseProfileForm, PROFILE_READ_ONLY_FIELDS } from "@/lib/client-profile-form";
import { assignedCoachOf, isAssignedCoachOf, withAssignedCoach } from "@/lib/sms-identity";
import { cleanInviteEmail, maskEmail, setupInviteState, setupInviteUrl } from "@/lib/setup-invite";

// ---------------------------------------------------------------------------
// The client profile's Save (admin/clients.$id): only what the coach changed.
// ---------------------------------------------------------------------------
describe("client profile Save", () => {
  const server = {
    id: "c1",
    created_at: "2026-11-03T21:32:14Z",
    updated_at: "2026-11-03T21:32:14Z",
    email: "devin@example.com",
    normalized_email: "devin@example.com",
    normalized_phone: "6132049868",
    phone: "+1-613-204-9868",
    status: "Lead",
    assigned_coach_id: null,
    user_id: null,
    invite_sent_at: null,
    committed_training_days: ["Monday"],
    social: { ig: "devin" },
  };

  it("sends nothing when nothing changed, and never the computed columns", () => {
    expect(profileChanges({ ...server }, server)).toEqual({});
    // Even a stale computed value on the copy is never written back.
    expect(profileChanges({ ...server, normalized_email: "old@example.com" }, server)).toEqual({});
    for (const k of ["id", "created_at", "updated_at", "normalized_email", "normalized_phone", "sex", "committed_training_days"]) {
      expect(PROFILE_READ_ONLY_FIELDS.has(k)).toBe(true);
    }
  });

  it("sends only the fields the coach edited", () => {
    const form = { ...server, status: "Active", assigned_coach_id: "coach-1" };
    expect(profileChanges(form, server)).toEqual({ status: "Active", assigned_coach_id: "coach-1" });
  });

  it("treats a cleared box and an empty column as the same", () => {
    expect(profileChanges({ ...server, invite_sent_at: "" }, server)).toEqual({});
    expect(profileChanges({ ...server, phone: "" }, server)).toEqual({ phone: "" });
  });

  it("compares objects by value", () => {
    expect(profileChanges({ ...server, social: { ig: "devin" } }, server)).toEqual({});
    expect(profileChanges({ ...server, social: { ig: "devin.b" } }, server)).toEqual({ social: { ig: "devin.b" } });
  });

  it("follows the server for untouched fields after a setup link links the login (never undoes it)", () => {
    const edited = { ...server, status: "Active" };
    const afterLink = { ...server, user_id: "login-1", invite_sent_at: "2026-11-06T20:30:00Z", updated_at: "2026-11-06T20:30:00Z" };
    const next = rebaseProfileForm(edited, server, afterLink);
    expect(next.user_id).toBe("login-1");
    expect(next.invite_sent_at).toBe("2026-11-06T20:30:00Z");
    expect(next.status).toBe("Active"); // the coach's edit stays
    expect(profileChanges(next, afterLink)).toEqual({ status: "Active" });
  });

  it("shows no unsaved changes when only the server moved", () => {
    const afterLink = { ...server, user_id: "login-1" };
    const next = rebaseProfileForm({ ...server }, server, afterLink);
    expect(profileChanges(next, afterLink)).toEqual({});
  });

  it("seeds from the server on first load", () => {
    expect(rebaseProfileForm(null, null, server)).toEqual(server);
  });
});

// ---------------------------------------------------------------------------
// Texts look the coach up on its own: clients.assigned_coach_id has no FK.
// ---------------------------------------------------------------------------
function fakeDb(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q; },
        in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q; },
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: any) => res({ data: rows, error: null }),
      };
      return q;
    },
  };
}

describe("assigned coach lookup", () => {
  const db = fakeDb({
    clients: [
      { id: "c1", user_id: "u1", assigned_coach_id: "k1" },
      { id: "c2", user_id: "u2", assigned_coach_id: null },
      { id: "c3", user_id: "u3", assigned_coach_id: "gone" },
    ],
    coaches: [{ id: "k1", user_id: "coach-login", first_name: "Jared", full_name: "Jared F", archived: false, status: "Active" }],
  });

  it("attaches each client's coach, null when none or missing", async () => {
    const rows = await withAssignedCoach(db, [
      { id: "c1", assigned_coach_id: "k1" },
      { id: "c2", assigned_coach_id: null },
      { id: "c3", assigned_coach_id: "gone" },
    ]);
    expect(rows.map((r) => r.coach?.first_name ?? null)).toEqual(["Jared", null, null]);
  });

  it("finds a client's coach by client or by login", async () => {
    expect((await assignedCoachOf(db, { clientId: "c1" }))?.first_name).toBe("Jared");
    expect((await assignedCoachOf(db, { userId: "u1" }))?.first_name).toBe("Jared");
    expect(await assignedCoachOf(db, { clientId: "c2" })).toBeNull();
  });

  it("only the assigned coach's login passes", async () => {
    expect(await isAssignedCoachOf(db, "coach-login", "c1")).toBe(true);
    expect(await isAssignedCoachOf(db, "someone-else", "c1")).toBe(false);
    expect(await isAssignedCoachOf(db, "coach-login", "c2")).toBe(false);
  });

  it("no code embeds the clients → coaches relationship that doesn't exist", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !p.includes(`${join("src", "test")}`)) {
          const src = readFileSync(p, "utf8");
          if (/coaches!clients_assigned_coach_id_fkey/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")) || /CLIENT_COACH_EMBED/.test(src)) hits.push(p);
        }
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A setup link with no email on file.
// ---------------------------------------------------------------------------
describe("setup invite link", () => {
  it("builds a /setup link carrying only the invite", () => {
    expect(setupInviteUrl("https://jfeffect.com/setup?x=1#y", "abc.123.def")).toBe("https://jfeffect.com/setup?invite=abc.123.def");
  });

  it("masks an email enough to recognise it", () => {
    expect(maskEmail("devin@gmail.com")).toBe("d•••n@gmail.com");
    expect(maskEmail("jo@x.co")).toBe("j•••@x.co");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("not-an-email")).toBeNull();
  });

  it("cleans a typed email and refuses anything else", () => {
    expect(cleanInviteEmail("  Devin.B@Gmail.com ")).toBe("devin.b@gmail.com");
    expect(cleanInviteEmail("devin@gmail")).toBeNull();
    expect(cleanInviteEmail("devin gmail.com")).toBeNull();
    expect(cleanInviteEmail("")).toBeNull();
  });

  it("works for a record that hasn't signed in, never for an archived or deactivated one", () => {
    expect(setupInviteState({ first_name: "Devin", full_name: "Devin B" })).toEqual({ state: "ok", firstName: "Devin", emailHint: null });
    expect(setupInviteState({ preferred_name: "Dev", first_name: "Devin", email: "devin@gmail.com" })).toEqual({ state: "ok", firstName: "Dev", emailHint: "d•••n@gmail.com" });
    expect(setupInviteState({ full_name: "Devin B", last_signed_in_at: "2026-11-06T00:00:00Z" })).toEqual({ state: "signed_in_before" });
    expect(setupInviteState({ full_name: "Devin B", archived: true }).state).toBe("invalid");
    expect(setupInviteState({ full_name: "Devin B", status: "Deactivated" }).state).toBe("invalid");
    expect(setupInviteState({ full_name: "Devin B", portal_access_disabled: true }).state).toBe("invalid");
    expect(setupInviteState(null).state).toBe("invalid");
  });

  it("signs a token that names one client and can't be edited or outlive its expiry", async () => {
    process.env.SETUP_INVITE_SECRET = "test-secret";
    const { signSetupInvite, verifySetupInvite } = await import("@/lib/setup-invite.server");
    const id = "11111111-2222-3333-4444-555555555555";
    const now = Date.UTC(2026, 10, 6);
    const token = signSetupInvite(id, 14, now);
    expect(verifySetupInvite(token, now)).toBe(id);
    expect(verifySetupInvite(token, now + 15 * 86_400_000)).toBeNull();
    const [, exp, sig] = token.split(".");
    expect(verifySetupInvite(`99999999-2222-3333-4444-555555555555.${exp}.${sig}`, now)).toBeNull();
    expect(verifySetupInvite(`${id}.${Number(exp) + 86_400}.${sig}`, now)).toBeNull();
    expect(verifySetupInvite("garbage", now)).toBeNull();
  });
});
