import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  mergeByRecency, sortSupportChats, supportChat, supportInFilter, supportMatches, supportNewChats, supportPreview,
  type SupportThreadRow,
} from "@/lib/member-support";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { messagesBadge } = await import("@/hooks/use-admin-nav-badges");
const { APP_EVENTS } = await import("@/lib/push/app-events.server");

const read = (p: string) => readFileSync(p, "utf8");
const row = (o: Partial<SupportThreadRow>): SupportThreadRow => ({
  thread_id: "t1", member_id: "m1", client_id: "c1", user_id: "u1", name: "Fionna", email: "f@x.com", avatar: null,
  service_tier: "self_serve", status: "open", unread_count: 0, last_body: "hi", last_sender_role: "member",
  last_at: "2026-11-14T10:00:00Z", ticket_number: 1000, ...o,
});

describe("a member's Support chat is a row in the coach's 1:1 Chats", () => {
  it("reads like a chat row: their last message, or yours after You:", () => {
    expect(supportChat(row({ last_body: "  App  froze\nagain " })).preview).toBe("App froze again");
    expect(supportChat(row({ last_body: "Fixed it", last_sender_role: "team" })).preview).toBe("You: Fixed it");
    expect(supportPreview(null, "member")).toBe("");
    expect(supportChat(row({ name: "  ", email: "only@x.com" })).name).toBe("only@x.com");
  });

  it("sits in the Inbox while open, under Archived once Done, never in a form filter", () => {
    const open = supportChat(row({}));
    const done = supportChat(row({ status: "closed" }));
    expect(supportInFilter(open, "Inbox")).toBe(true);
    expect(supportInFilter(open, "Archived")).toBe(false);
    expect(supportInFilter(done, "Inbox")).toBe(false);
    expect(supportInFilter(done, "Archived")).toBe(true);
    for (const f of ["Weekly", "Nutrition", "To Review", "Overdue", "Pain", "Media", "Sessions"]) expect(supportInFilter(open, f)).toBe(false);
  });

  it("is found by name or email", () => {
    const c = supportChat(row({}));
    expect(supportMatches(c, "fio")).toBe(true);
    expect(supportMatches(c, "F@X")).toBe(true);
    expect(supportMatches(c, "marc")).toBe(false);
    expect(supportMatches(c, "")).toBe(true);
  });

  it("one inbox, newest first: support rows land between coach chats by time", () => {
    const chats = [{ id: "a", at: "2026-11-14T12:00:00Z" }, { id: "b", at: "2026-11-14T08:00:00Z" }];
    const support = sortSupportChats([
      supportChat(row({ thread_id: "s-old", last_at: "2026-11-13T09:00:00Z" })),
      supportChat(row({ thread_id: "s-new", last_at: "2026-11-14 10:00:00.123456+00" })),
    ]);
    const merged = mergeByRecency(chats, (c) => c.at, support, (s) => s.at);
    expect(merged.map((m) => (m.kind === "chat" ? m.item.id : m.item.threadId))).toEqual(["a", "s-new", "b", "s-old"]);
  });

  it("a new message from a member counts on the Messages badge and the Inbox chip, once, never when Done", () => {
    expect(supportNewChats([supportChat(row({ unread_count: 3 })), supportChat(row({ thread_id: "t2", unread_count: 0 }))])).toBe(1);
    expect(supportNewChats([supportChat(row({ unread_count: 2, status: "closed" }))])).toBe(0);
    expect(messagesBadge(
      [{ client_id: "a", unread: true, archived: false }],
      [{ id: "t1", unread_for_team: 2, status: "open" }, { id: "t2", unread_for_team: 0, status: "open" }, { id: "t3", unread_for_team: 1, status: "closed" }],
    )).toBe(2);
  });
});

describe("each side hears when the other writes", () => {
  it("a member's message pushes the team and opens their chat in Messages", () => {
    const e = APP_EVENTS.support_message;
    expect(e.to).toBe("staff");
    expect(e.category).toBe("messages");
    expect(e.title("Fionna Smith")).toBe("💬 Fionna Smith wrote to Support");
    expect(e.url("c1", "m1", "t1")).toBe("/admin/communication?tab=messages&support=t1");
    // content-free on the lockscreen
    expect(e.body("x")).not.toMatch(/froze|bug/i);
  });

  it("the team's reply pushes the member to Support", () => {
    const e = APP_EVENTS.support_reply;
    expect(e.to).toBe("client");
    expect(e.url("c1", "m1")).toBe("/portal/support");
    expect(e.body("Coach Jared")).toBe("Coach Jared replied to your message. Tap to read it.");
  });

  it("the server pushes after the message is saved, and a push can't fail the send", () => {
    const fns = read("src/lib/member-support.functions.ts");
    expect(fns).toContain('notifyAppEvent(supabaseAdmin as any, "support_message"');
    expect(fns).toContain('notifyAppEvent(admin, "support_reply"');
    expect(fns).toContain('console.warn("[support] push to team failed"');
  });

  it("opening Support never makes an empty chat (the old list filled with them)", () => {
    const fns = read("src/lib/member-support.functions.ts");
    const getMine = fns.slice(fns.indexOf("export const getMySupportThread"), fns.indexOf("export const sendSupportMessage"));
    expect(getMine).not.toContain(".insert(");
    const sql = read("supabase/migrations/20270320090000_member_support_in_messages.sql");
    // a thread shows only with a message in it, and only to an admin or the member's coach
    expect(sql).toContain("JOIN LATERAL (");
    expect(sql).toContain("WHERE is_admin OR public.is_assigned_coach_for_member(t.member_id)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.staff_support_threads() FROM PUBLIC, anon;");
  });
});

describe("Messages wiring", () => {
  const page = read("src/route-pages/_authenticated/admin/messages.tsx");
  const comm = read("src/routes/_authenticated/admin/communication.tsx");

  it("a member never gets a coach-chat row: their row is their Support chat, and Message on their profile opens it", () => {
    expect(page).toContain('clients.filter((c) => (c as any).service_tier !== "self_serve")');
    expect(page).toContain('const selectedIsMember = (selected as any)?.service_tier === "self_serve";');
    expect(page).toContain("<MemberSupportPane");
    expect(page).toContain('rpc("staff_support_threads")');
  });

  it("a push or an old Support-tab ticket link opens the chat in 1:1 Chats", () => {
    expect(comm).toContain('if (support) return { tab: "messages", support };');
    expect(comm).toContain("const ticket = /^t:(.+)$/.exec(sub ?? \"\")?.[1];");
    expect(comm).toContain('{ value: "support", label: "Alerts" }');
  });

  it("the member's Support tab shows a count when the team replies", () => {
    const hook = read("src/hooks/use-client-nav-badges.ts");
    expect(hook).toContain('result["/portal/support"] = { count: data.supportUnread }');
  });

  it("a coach previewing a member reads their chat and can't send as them", () => {
    const support = read("src/routes/_authenticated/portal/support.tsx");
    expect(support).toContain("fetchAsCoach({ data: { clientId: povClient.id } })");
    expect(support).toContain("toast(PREVIEW_ONLY_MESSAGE)");
    expect(support).toContain("if (previewing || !thread?.id");
  });
});
