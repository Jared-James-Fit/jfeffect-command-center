import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PRIMARY_FILTERS, inPrimary, pinnedFirst, chipCount } from "@/lib/inbox-filters";
import { clusterFaces, groupDisplayName, groupPreview } from "@/lib/group-row";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const { messagesBadge, unreadGroupCount } = await import("@/hooks/use-admin-nav-badges");
const { GroupAvatarCluster } = await import("@/components/messages/group-avatar");

const read = (p: string) => readFileSync(p, "utf8");

// Nov 25 2026: one Messages for coaches and clients (iMessage / Instagram DMs):
// All · Unread · Groups · 1:1 Chats, the coach chat a pinned row, the coach's
// narrower views in one Filter menu, group chats read like 1:1 rows.

describe("the four filters", () => {
  it("are the same four for everyone", () => {
    expect(PRIMARY_FILTERS.map((f) => f.label)).toEqual(["All", "Unread", "Groups", "1:1 Chats"]);
  });

  it("sort chats by kind and unread", () => {
    const group = { kind: "group" as const, unread: false };
    const dm = { kind: "direct" as const, unread: true };
    expect(inPrimary(group, "all") && inPrimary(dm, "all")).toBe(true);
    expect(inPrimary(group, "unread")).toBe(false);
    expect(inPrimary(dm, "unread")).toBe(true);
    expect(inPrimary(group, "groups")).toBe(true);
    expect(inPrimary(dm, "groups")).toBe(false);
    expect(inPrimary(dm, "direct")).toBe(true);
    expect(inPrimary(group, "direct")).toBe(false);
  });

  it("pinned chats lead, then the rest in order", () => {
    expect(pinnedFirst([1, 2, 3, 4], (n) => n % 2 === 0)).toEqual([2, 4, 1, 3]);
    expect(chipCount(5)).toBe("5");
    expect(chipCount(140)).toBe("99+");
  });

  it("both inboxes use the one control, and People is 1:1 Chats", () => {
    expect(read("src/components/group-chats-pane.tsx")).toContain("<InboxControls");
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain("<InboxControls");
    expect(read("src/components/group-chats-pane.tsx")).not.toContain('"people"');
  });
});

describe("the coach's inbox", () => {
  const page = read("src/route-pages/_authenticated/admin/messages.tsx");
  const comm = read("src/routes/_authenticated/admin/communication.tsx");

  it("has no tab row: groups are a filter, app alerts and automations are in ⋯", () => {
    expect(comm).not.toContain("tabsRef");
    expect(comm).not.toContain('to="/admin/automations"');
    expect(page).toContain("<InboxMoreMenu");
    expect(page).toContain("New group chat");
    expect(page).toContain("Mass message");
    expect(page).toContain("data-inbox-alerts");
    expect(page).not.toContain("function TabsHeader");
    expect(page).not.toContain("<GroupChatsPane");
  });

  it("puts every narrower view in one Filter menu with counts, Needs reply and Important included", () => {
    expect(page).toContain("<FilterMenu");
    for (const g of ['"Conversations", filters: ["Reply", "Important"]', '"Forms", filters: ["Weekly", "Nutrition", "To Review", "Overdue"]', '"Training", filters: ["Pain", "Media", "Sessions", "Program"]']) {
      expect(page).toContain(g);
    }
    expect(page).toContain("Clear filter");
  });

  it("keeps Cleo and the coaching queues at the top of All only", () => {
    expect(page).toContain('const pinnedSystem = primary === "all" && filter === "Inbox" && !search;');
    expect(page).toContain("{pinnedSystem && <RecoveryInboxRow />}");
    expect(page).toContain("data-cleo-row");
  });

  it("lists group chats with the clients' chats, newest first, and opens them in place", () => {
    expect(page).toContain("<GroupChatRow");
    expect(page).toContain("<GroupThreadPane key={openGroup.id} group={openGroup} canManage onBack={clearSelection} />");
    expect(page).toContain("useGroupListRealtime(\"admin-groups\");");
  });
});

describe("the client's inbox", () => {
  const pane = read("src/components/group-chats-pane.tsx");
  it("shows the coach chat as the first row, pinned, never a big face", () => {
    expect(pane).toContain("data-coach-chat");
    expect(pane).not.toContain("showGrid");
    expect(pane).not.toContain("PinTile");
    expect(pane).toMatch(/<ChatListRow\s+data-coach-chat[\s\S]*?pinned\n/);
  });
  it("the coach chat is a 1:1: in All, Unread when there's something new, and 1:1 Chats; never Groups", () => {
    expect(pane).toContain('inPrimary({ kind: "direct", unread: !!pinned.unread }, filter)');
  });
});

describe("group chat rows", () => {
  it("are named by their own name, else by who's in them", () => {
    expect(groupDisplayName("Team JF", [{ name: "Marc A" }])).toBe("Team JF");
    expect(groupDisplayName("", [{ name: "Marc Asugui" }])).toBe("Marc");
    expect(groupDisplayName(null, [{ name: "Marc Asugui" }, { name: "Devin Buth" }])).toBe("Marc and Devin");
    expect(groupDisplayName(" ", [{ name: "Marc" }, { name: "Devin" }, { name: "Nicole" }])).toBe("Marc, Devin and Nicole");
    expect(groupDisplayName("", [{ name: "Marc" }, { name: "Devin" }, { name: "Nicole" }], 5)).toBe("Marc, Devin and 3 others");
    expect(groupDisplayName("", [])).toBe("Group chat");
  });

  it("preview the latest message with who sent it, and what it was when there are no words", () => {
    const me = "me";
    const names = (id: string) => ({ u1: "Marc Asugui" } as Record<string, string>)[id];
    expect(groupPreview({ body: "Nice lift", sender_id: "u1" }, me, names)).toBe("Marc: Nice lift");
    expect(groupPreview({ body: "On my way", sender_id: me }, me, names)).toBe("You: On my way");
    expect(groupPreview({ body: "", attachments: [{ type: "image" }], sender_id: "u1" }, me, names)).toBe("Marc: 📷 Photo");
    expect(groupPreview({ body: "", attachments: [{ type: "video" }], sender_id: "u1" }, me, names)).toBe("Marc: 🎥 Video");
    expect(groupPreview({ body: "", attachments: [{ type: "audio" }], sender_id: "u1" }, me, names)).toBe("Marc: 🎤 Voice memo");
    expect(groupPreview({ body: "", attachments: [{ type: "pdf" }], sender_id: "u1" }, me, names)).toBe("Marc: 📄 File");
    expect(groupPreview({ body: "Devin joined", sender_role: "system", sender_id: "u1" }, me, names)).toBe("Devin joined");
    expect(groupPreview({ body: "hi", sender_id: "x", sender_name: "Nicole Smith" }, me)).toBe("Nicole: hi");
    expect(groupPreview(null, me)).toBe("No messages yet");
  });

  it("show 2–4 faces in one avatar's space, +N for the rest", () => {
    const f = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: `u${i}`, name: `P${i}`, avatar_url: null }));
    expect(clusterFaces(f(2))).toEqual({ shown: f(2), more: 0 });
    expect(clusterFaces(f(4))).toEqual({ shown: f(4), more: 0 });
    expect(clusterFaces(f(4), 9)).toEqual({ shown: f(3), more: 6 });
    const html = renderToStaticMarkup(createElement(GroupAvatarCluster, { faces: f(3), total: 7 }));
    expect(html).toContain('data-group-avatar="4"');
    expect(html).toContain(">+4<");
    expect(renderToStaticMarkup(createElement(GroupAvatarCluster, { faces: [] }))).toContain('data-group-avatar="empty"');
    expect(renderToStaticMarkup(createElement(GroupAvatarCluster, { faces: f(3) }))).toContain('data-group-avatar="3"');
  });

  it("crews say what was sent (the list's read returns attachments and up to four faces)", () => {
    const sql = read("supabase/migrations/20270528091000_group_rows_like_chats.sql");
    expect(sql).toContain("'attachments', CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END");
    expect(sql).toContain("ORDER BY m.joined_at NULLS LAST LIMIT 4");
  });
});

describe("the Messages badge counts group chats the Unread chip counts", () => {
  it("adds coach-run groups with something new from someone else", () => {
    const memberships = [
      { group_id: "g1", last_read_at: "2026-11-25T10:00:00Z" },
      { group_id: "g2", last_read_at: "2026-11-25T10:00:00Z" },
      { group_id: "g3", last_read_at: null },
    ];
    const latest = [
      { group_id: "g1", created_at: "2026-11-25T11:00:00Z", sender_id: "other" }, // new
      { group_id: "g1", created_at: "2026-11-25T09:00:00Z", sender_id: "other" },
      { group_id: "g2", created_at: "2026-11-25T11:00:00Z", sender_id: "me" }, // mine
      { group_id: "g3", created_at: "2026-11-24T11:00:00Z", sender_id: "other" }, // never read
      { group_id: "g4", created_at: "2026-11-25T11:00:00Z", sender_id: "other" }, // not mine
    ];
    expect(unreadGroupCount(memberships, latest, "me")).toBe(2);
    expect(messagesBadge([{ client_id: "c1", unread: true, archived: false }], [], 2)).toBe(3);
  });
});
