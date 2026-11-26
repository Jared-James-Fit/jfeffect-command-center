import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notificationDeepLink } from "@/lib/push/notification-payload";

const read = (path: string) => readFileSync(path, "utf8");
describe("staff personal messaging", () => {
  it("limits new chats to an admin or assigned coach and preserves private membership", () => {
    const sql = read("supabase/migrations/20271201090000_staff_personal_messaging.sql");
    expect(sql).toContain("public.is_group_member(g.id, _uid)");
    expect(sql).toContain("public.is_assigned_coach_for_client(_client_id)");
    expect(sql).toContain("public.chat_user_blocks");
    expect(sql).toContain("public.chat_direct_closed");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.chat_staff_direct_start(uuid, text) FROM PUBLIC, anon;");
    expect(sql).toContain("'direct', v_key, 'active', uid, uid");
    expect(sql).not.toContain("INSERT INTO public.member_support");
  });
  it("uses the regular direct-chat view and does not start support on account selection", () => {
    const admin = read("src/route-pages/_authenticated/admin/messages.tsx");
    expect(admin).toContain("const supportOpen = !!supportId;");
    expect(admin).toContain("<DirectRow");
    expect(admin).toContain("<DirectChatView");
    expect(admin).toContain("staffClientId={selected.id}");
    expect(admin).toContain("personalUnread");
    expect(read("src/lib/direct-chats.ts")).toContain('db.rpc("chat_staff_direct_start"');
  });
  it("routes personal notifications to the recipient's actual inbox", () => {
    const groupId = "a493f2a4-2461-4204-a621-bf62c2a6d01b";
    expect(notificationDeepLink("direct_message", "admin", { groupId })).toBe(`/admin/communication?tab=messages&direct=${groupId}`);
    expect(notificationDeepLink("direct_message", "coach", { groupId })).toBe(`/admin/communication?tab=messages&direct=${groupId}`);
    expect(notificationDeepLink("direct_message", "client", { groupId })).toBe(`/portal/messages?tab=groups#group=${groupId}`);
  });
});
