import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chatMenuItems, personState, type ChatMenuTarget } from "@/components/messages/inbox-parts";
import { deletePatch, isHidden, pinnedKeys, toPrefMap, type ChatPref } from "@/lib/chat-prefs";
import { waitingChatCount } from "@/lib/nav-badge-counts";
import { friendlyError, type DirectThread } from "@/lib/direct-chats";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261121090000_messenger_inbox_controls.sql");

const pref = (key: string, over: Partial<ChatPref> = {}): ChatPref => ({
  thread_key: key, pinned_at: null, muted: false, hidden_at: null, unread_at: null, ...over,
});
const target = (over: Partial<ChatMenuTarget> = {}): ChatMenuTarget => ({
  key: "g1", title: "Dwayne", avatar: null, pinned: false, muted: false, unread: false,
  canPin: true, canMute: true, canDelete: true, ...over,
});
const thread = (over: Partial<DirectThread> = {}): DirectThread => ({
  group_id: "g1", status: "active", incoming: false, outgoing: false,
  other: { user_id: "dwayne", name: "Dwayne", avatar_url: null, is_coach: false },
  last: null, last_at: "2026-10-13T12:00:00Z", read_at: null, left: null, ...over,
});

describe("hold a chat: iMessage's menu", () => {
  it("Pin, Mark as Unread, Hide Alerts, Delete, flipping to the opposite when already on", () => {
    expect(chatMenuItems(target())).toEqual(["pin", "unread", "mute", "delete"]);
    expect(chatMenuItems(target({ pinned: true, unread: true, muted: true }))).toEqual(["unpin", "read", "unmute", "delete"]);
  });
  it("the coach is fixed: only Mark as Unread / Read", () => {
    expect(chatMenuItems(target({ fixed: true, pinned: true }))).toEqual(["unread"]);
    expect(chatMenuItems(target({ fixed: true, unread: true }))).toEqual(["read"]);
  });
  it("staff group lists keep their real delete in Select, so no Delete here", () => {
    expect(chatMenuItems(target({ canDelete: false }))).toEqual(["pin", "unread", "mute"]);
  });
});

describe("your own chat settings", () => {
  it("Delete hides a chat until someone writes again", () => {
    const prefs = toPrefMap([pref("g1", { hidden_at: "2026-10-13T12:00:00Z" })]);
    expect(isHidden(prefs, "g1", "2026-10-13T11:00:00Z")).toBe(true);
    expect(isHidden(prefs, "g1", "2026-10-13T12:00:00Z")).toBe(true);
    expect(isHidden(prefs, "g1", "2026-10-13T12:00:01Z")).toBe(false);
    expect(isHidden(prefs, "other", "2026-10-13T11:00:00Z")).toBe(false);
    // and it unpins and clears Mark as Unread
    expect(deletePatch("t")).toEqual({ hidden_at: "t", pinned_at: null, unread_at: null });
  });
  it("pins keep the order you pinned them in", () => {
    const prefs = toPrefMap([
      pref("b", { pinned_at: "2026-10-13T10:00:00Z" }),
      pref("x"),
      pref("a", { pinned_at: "2026-10-12T10:00:00Z" }),
    ]);
    expect(pinnedKeys(prefs)).toEqual(["a", "b"]);
  });
  it("only you can see or change them, and the coach chat can't be muted, unpinned or deleted", () => {
    expect(sql).toContain('CREATE POLICY "chat_thread_prefs_own" ON public.chat_thread_prefs FOR ALL TO authenticated');
    expect(sql).toContain("USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));");
    expect(sql).toContain("IF NEW.thread_key = 'coach' THEN");
    expect(sql).toContain("RAISE EXCEPTION 'pin_limit';");
    expect(friendlyError("pin_limit")).toBe("You can pin up to 8 chats. Unpin one first.");
  });
  it("Mark as Unread never touches the read marker (their 'Seen' stays)", () => {
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane).toContain('save([{ key: t.key, patch: { unread_at: now } }]);');
    expect(pane).not.toMatch(/unread_at: now[^\n]*markGroupRead/);
  });
  it("the badge skips muted and deleted chats and counts ones marked unread", () => {
    const prefs = toPrefMap([
      pref("muted", { muted: true }),
      pref("deleted", { hidden_at: "2026-10-13T12:00:00Z" }),
      pref("marked", { unread_at: "2026-10-13T12:00:00Z" }),
    ]);
    expect(waitingChatCount([
      { key: "plain", unread: true },
      { key: "quiet", unread: false },
      { key: "muted", unread: true },
      { key: "deleted", unread: true, at: "2026-10-13T11:00:00Z" },
      { key: "marked", unread: false },
    ], prefs)).toBe(2);
  });
  it("Hide Alerts stops pushes for that chat", () => {
    const ev = read("src/lib/push/events.functions.ts");
    expect(ev).toContain('.from("chat_thread_prefs").select("user_id").eq("thread_key", msg.group_id).eq("muted", true)');
    expect(ev).toContain("const members = ((allMembers ?? []) as any[]).filter((m) => !muted.has(m.user_id));");
  });
});

describe("New message: a request first, never a cold DM", () => {
  it("opens the chat you have, or starts a request", () => {
    const none = new Set<string>();
    expect(personState("dwayne", [], none).state).toBe("new");
    expect(personState("dwayne", [thread()], none).state).toBe("chat");
    expect(personState("dwayne", [thread({ status: "request", outgoing: true })], none).state).toBe("sent");
    expect(personState("dwayne", [thread({ status: "request", incoming: true })], none).state).toBe("incoming");
    expect(personState("dwayne", [thread()], new Set(["dwayne"])).state).toBe("blocked");
  });
  it("strangers are found by name, never listed", () => {
    const ui = read("src/components/messages/inbox-parts.tsx");
    expect(ui).toContain("const shown = term ? everyone.filter((a) => a.name.toLowerCase().includes(term)).slice(0, 40) : suggested;");
    expect(ui).toContain("This goes to {to.name} as a message request.");
  });
  it("same rules as replying to a post: text only, 3 lines until they answer, 10 new people a day", () => {
    expect(sql).toContain("g := public.chat_direct_open(uid, _user_id);");
    expect(sql).toContain("g := public.chat_direct_open(uid, p.author_user_id);");
    expect(sql).toContain("VALUES (g.id, uid, 'member', v_body, '[]'::jsonb)");
    expect(sql).toContain("RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;");
    expect(sql).toContain("RAISE EXCEPTION 'request_daily_limit';");
    expect(sql).toContain("RAISE EXCEPTION 'request_limit';");
    expect(sql).toContain("RAISE EXCEPTION 'Message your coach in your coach chat';");
    expect(friendlyError("request_daily_limit")).toContain("tomorrow");
  });
});

describe("Block is about the person, and silent", () => {
  it("blocking from a request, a chat, a report or an invite blocks them everywhere", () => {
    expect(sql).toContain("PERFORM public.chat_set_person_block(uid, v_other, true);");
    expect(sql).toContain("IF _action = 'block' THEN");
    expect(sql).toContain("PERFORM public.chat_set_person_block(uid, v_inviter, true);");
    // their invites never reach you (checked when they invite)
    expect(sql).toContain("SELECT EXISTS (SELECT 1 FROM public.chat_user_blocks b WHERE b.user_id = _blocker AND b.blocked_user_id = _other)");
  });
  it("they're never told: their request just looks unanswered", () => {
    expect(sql).toContain("-- They blocked you: it never reaches them, and looks like any unanswered request.");
    expect(sql).toContain("INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, _other, 'blocked')");
    expect(sql).toContain('CREATE POLICY "chat_user_blocks_own" ON public.chat_user_blocks FOR SELECT TO authenticated');
  });
  it("existing 1:1 blocks carry over, and you can unblock from Messages › Edit › Blocked", () => {
    expect(sql).toContain("INSERT INTO public.chat_user_blocks (user_id, blocked_user_id, created_at)");
    expect(read("src/components/group-chats-pane.tsx")).toContain("<BlockedPeopleSheet open={blockedOpen} onOpenChange={setBlockedOpen} />");
  });
  it("the request screen says nothing is shown to them, and leaving it is fine", () => {
    const ui = read("src/components/direct-chat.tsx");
    expect(ui).toContain("They won't know you've seen this unless you accept. Delete and Block are never shown to them.");
    expect(ui).toContain("Leave it for now");
    expect(read("src/components/crew-chat.tsx")).toContain("Block {thread.invited_by}");
  });
});

describe("the list", () => {
  it("going back from the coach chat shows the list (compose, New group) instead of bouncing", () => {
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane).toContain("autoOpened.current = true;");
    expect(pane).toContain("pinned.renderThread({ onBack: closeChat })");
    expect(read("src/routes/_authenticated/portal/messages.tsx")).not.toContain("{onBack && (");
  });
  it("a hold that never produced a click can't swallow the next tap", () => {
    const hook = read("src/hooks/use-long-press.ts");
    expect(hook).toContain("onPointerDown: (e: PointerEvent) => {\n      fired.current = false;");
  });
  it("AGENTS.md lists the new request and block paths", () => {
    const rules = read("AGENTS.md");
    expect(rules).toContain("`chat_direct_start` / `chat_block_person`");
    expect(rules).toContain("`chat_thread_prefs` (own rows only)");
  });
});

describe("live in chat means in the conversation", () => {
  it("only tracks presence while the chat is open and the app is on screen", () => {
    const hook = read("src/hooks/use-chat-presence.tsx");
    expect(hook).toContain("const here = inConversation && visible;");
    expect(hook).toContain("if (hereRef.current) void channel.track(");
    expect(hook).toContain("else void ch.untrack();");
    expect(read("src/route-pages/_authenticated/admin/messages.tsx")).toContain('useChatPresence(selectedId, "admin", tab !== "groups" && !!selected)');
    expect(read("src/routes/_authenticated/portal/messages.tsx")).toContain('"client", coachChatOpen)');
    expect(read("src/components/group-chats-pane.tsx")).toContain("onPinnedOpenChange?.(pinnedOpen);");
  });
});
