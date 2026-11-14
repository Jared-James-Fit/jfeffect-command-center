import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { adminBadgeMap, messagesBadge } = await import("@/hooks/use-admin-nav-badges");
const { FILTER_HELP, filterHelp, inboxHelp } = await import("@/lib/inbox-guide");

const read = (p: string) => readFileSync(p, "utf8");
const MIGRATION = "supabase/migrations/20270319090000_inbox_unread_is_new_messages.sql";

describe("the Messages badge is new messages only", () => {
  it("counts chats with a new message, once each, never an archived one", () => {
    expect(messagesBadge([
      { client_id: "a", unread: true, archived: false },
      { client_id: "a", unread: true, archived: false },
      { client_id: "b", unread: false, archived: false },
      { client_id: "c", unread: true, archived: true },
      { client_id: "d", unread: true, archived: false },
    ])).toBe(2);
    expect(messagesBadge([])).toBe(0);
  });

  it("the tab shows that number and nothing else: no dot for waiting work", () => {
    expect(adminBadgeMap({ messages: 3, checkIns: 0, supportAlerts: 0, supportTickets: 0 })["/admin/messages"]).toEqual({ count: 3 });
    expect(adminBadgeMap({ messages: 0, checkIns: 0, supportAlerts: 0, supportTickets: 0 })["/admin/messages"]).toBeUndefined();
  });

  it("reads staff_inbox_state's unread only: never needs reply or lift uploads", () => {
    const hook = read("src/hooks/use-admin-nav-badges.ts");
    expect(hook).toContain("messages: messagesBadge(");
    expect(hook).not.toContain("needs_response");
    expect(hook).not.toContain("lift_videos");
  });

  it("the database's unread is a new client message: never a check-in card, a note or an unsent message", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.message_is_new_for_staff(_m public.messages)");
    expect(sql).toContain("NOT ('checkin_submission' = ANY (public.message_attachment_kinds(_m.attachments)))");
    expect(sql).toContain("_m.deleted_at IS NULL");
    expect(sql).toContain("NOT coalesce(_m.is_internal_note, false)");
    expect(sql).toContain("cs.manual OR n.new_messages > 0");
    // same columns, so every build keeps reading it
    expect(sql).toContain("my_last_read_at timestamptz, unread boolean, unread_count int, archived boolean)");
  });

  it("a new message brings an archived chat back to the Inbox", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("CREATE TRIGGER trg_messages_reopen_archived_chat AFTER INSERT ON public.messages");
    expect(sql).toMatch(/IF public\.message_is_new_for_staff\(NEW\) THEN\s+UPDATE public\.conversation_state\s+SET status = 'open'/);
  });
});

describe("the inbox explains itself", () => {
  const page = read("src/route-pages/_authenticated/admin/messages.tsx");

  it("every filter has its sentence, and the line under the chips says it", () => {
    const filters = JSON.parse(page.match(/const FILTERS = (\[[^\]]+\]) as const;/)![1]) as string[];
    for (const f of filters) {
      expect(filterHelp(f as any, 0).length, f).toBeGreaterThan(20);
      if (f !== "Inbox") expect(FILTER_HELP[f as keyof typeof FILTER_HELP], f).toBeTruthy();
    }
    expect(page).toContain("data-filter-help={filter}");
    expect(page).toContain("{filterHelp(filter, newChats)}");
  });

  it("the Inbox line and chip carry the badge's number", () => {
    expect(inboxHelp(0)).toBe("No new messages. Every chat is here, newest first.");
    expect(inboxHelp(1)).toBe("1 chat has a new message (the blue dot). Every chat is here, newest first.");
    expect(inboxHelp(3)).toBe("3 chats have new messages (the blue dot). Every chat is here, newest first.");
    expect(page).toContain('const n = f === "Inbox" ? newChats : FILTER_BADGE[f] ? filterCounts[f] ?? 0 : 0;');
    expect(page).toContain('f === "Inbox" ? cn(UNREAD_DOT, "text-white")');
  });

  it("the ? opens How Messages works", () => {
    expect(page).toContain("<InboxGuideButton onClick={() => setGuideOpen(true)} />");
    expect(page).toContain("<InboxGuideSheet open={guideOpen} onOpenChange={setGuideOpen} filters={GUIDE_FILTERS} />");
    const guide = read("src/components/messages/inbox-guide.tsx");
    expect(guide).toContain("How Messages works");
    expect(guide).toContain("hideCloseButton");
  });
});
