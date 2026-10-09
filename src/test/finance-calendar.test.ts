import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { isPreviewSafeFn } from "@/lib/team-preview";

const read = (p: string) => readFileSync(p, "utf8");

// A tiny stand-in for the service-role client: clients and community_profiles rows.
const db = vi.hoisted(() => ({
  clients: [] as Array<{ id: string; user_id: string; full_name: string | null; first_name: string | null }>,
  community_profiles: [] as Array<{ user_id: string; same_person_as: string | null }>,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: "clients" | "community_profiles") => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => ({ data: (db[table] as any[]).find((r) => r[col] === val) ?? null, error: null }),
        }),
      }),
    }),
  },
}));

describe("a staff login's own client account", () => {
  beforeEach(() => {
    db.clients = [{ id: "c-fionna", user_id: "u-fionna-client", full_name: "Fionna Faye Gaburno", first_name: "Fionna" }];
    db.community_profiles = [];
  });

  it("is nobody's until the owner links it", async () => {
    const { ownOrLinkedClient } = await import("@/lib/linked-client.server");
    expect(await ownOrLinkedClient("u-fionna-finance")).toBeNull();
  });

  it("follows the same-person link to the client account", async () => {
    db.community_profiles = [{ user_id: "u-fionna-finance", same_person_as: "u-fionna-client" }];
    const { ownOrLinkedClient } = await import("@/lib/linked-client.server");
    expect(await ownOrLinkedClient("u-fionna-finance")).toEqual({ id: "c-fionna", name: "Fionna Faye Gaburno" });
  });

  it("a client's own login is still their own account", async () => {
    const { ownOrLinkedClient } = await import("@/lib/linked-client.server");
    expect(await ownOrLinkedClient("u-fionna-client")).toEqual({ id: "c-fionna", name: "Fionna Faye Gaburno" });
  });
});

describe("her calendar on the finance home", () => {
  it("shows her week from her client account, and the Google subscription", () => {
    const home = read("src/components/admin/finance/finance-home.tsx");
    expect(home).toContain("<MyCalendarCard />");
    const card = read("src/components/admin/finance/my-calendar-card.tsx");
    expect(card).toContain("<UpcomingScheduleCard clientId={mine.id} links={false} />");
    expect(card).toContain("{!preview && <CalendarSyncCard />}");
    expect(card).toContain("fn({ data: { userId: preview?.userId ?? null } })");
  });

  it("the schedule card drops Book and the portal links on a staff home", () => {
    const c = read("src/components/home/upcoming-schedule-card.tsx");
    expect(c).toContain("enabled: !!clientId && links,");
    expect(c).toContain("{links && <div");
    expect(c).toContain("const href = !links ? null :");
  });

  it("the subscribe link and its status follow the link; a coach's client view never does", () => {
    const fns = read("src/lib/schedule.functions.ts");
    expect(fns).toContain("const mine = await ownOrLinkedClient(userId);");
    expect(fns).toContain("?? (isPovRequest(userId, data) ? null : (await ownOrLinkedClient(userId))?.id ?? null);");
    // Only the owner may ask for someone else's.
    expect(fns).toMatch(/if \(data\.userId && data\.userId !== userId\) \{\n\s+const \{ data: isAdmin \}[^\n]+eq\("role", "admin"\)/);
  });

  it("previewing a team member can read whose calendar it is, never mint a subscribe link", () => {
    expect(isPreviewSafeFn("getMyClientAccount")).toBe(true);
    expect(isPreviewSafeFn("getMyCalendarFeed")).toBe(false);
    expect(isPreviewSafeFn("linkTeamMemberClient")).toBe(false);
  });
});

describe("the owner links a team member to their client account", () => {
  const fns = read("src/lib/staff-invites.functions.ts");
  const page = read("src/route-pages/_authenticated/admin/staff.tsx");

  it("admin only, team members only, one hop, and it can be undone", () => {
    const body = fns.slice(fns.indexOf("export const linkTeamMemberClient"), fns.indexOf("/* ---------- Public: the setup link"));
    expect(body).toContain("await assertAdmin(context);");
    expect(body).toContain('if (!roles?.length) throw new Error("Not a team member.");');
    expect(body).toContain("if (main?.same_person_as) throw new Error");
    expect(body).toContain("same_person_as: null");
    expect(body).toContain('{ onConflict: "user_id" }');
  });

  it("the Team card shows the link, and only the owner can change it", () => {
    expect(fns).toContain("client: clientFor(id)");
    expect(page).toContain("<ClientAccountLine m={m} onChanged={onChanged} />");
    expect(page).toContain('const canLink = role === "admin" && !viewOnly;');
    expect(page).toContain('suggestedLabel="Same name"');
  });
});
