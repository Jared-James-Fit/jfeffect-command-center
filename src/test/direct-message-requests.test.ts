import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildNotificationPayload } from "@/lib/push/notification-payload";
import { APP_EVENTS } from "@/lib/push/app-events.server";
import { friendlyError, isUnread, previewLine, type DirectThread } from "@/lib/direct-chats";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261015090000_direct_message_requests.sql");

const thread = (over: Partial<DirectThread> = {}): DirectThread => ({
  group_id: "g1",
  status: "request",
  incoming: true,
  outgoing: false,
  other: { user_id: "dwayne", name: "Dwayne", avatar_url: null, is_coach: false },
  last: { body: "That squat was moving", created_at: "2026-10-08T20:00:00Z", sender_id: "dwayne", card: true, media: true },
  last_at: "2026-10-08T20:00:00Z",
  read_at: null,
  left: null,
  ...over,
});

describe("replying to a post in Messenger: a message request first", () => {
  it("routes by who posted: coach post → your coach chat, coach replying → the client's chat, members → a request", () => {
    expect(sql).toContain("-- A coach's post: it goes to your own chat with your coach.");
    expect(sql).toContain("VALUES (v_client, uid, 'client', v_body, jsonb_build_array(v_card), 'General', now())");
    expect(sql).toContain("VALUES (v_client, v_staff, 'admin', v_body, jsonb_build_array(v_card), 'General', now())");
    expect(sql).toContain("VALUES ('Direct message', 'direct', v_key, 'request', uid, uid)");
    // one chat per pair, whoever started it
    expect(sql).toContain("v_key := least(uid::text, p.author_user_id::text) || ':' || greatest(uid::text, p.author_user_id::text);");
    expect(sql).toContain("RAISE EXCEPTION 'That''s your own post'");
  });

  it("the post rides along as a card that opens it", () => {
    expect(sql).toContain("'type', 'link', 'kind', 'community_post', 'post_id', p.id, 'reply', true");
    expect(sql).toContain("'thumb_path', coalesce(p.media_thumb_path, CASE WHEN p.media_type = 'image' THEN p.media_path END)");
  });

  it("until they answer: text only, 3 messages, no hearts", () => {
    expect(sql).toContain("RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;");
    expect(sql).toContain("RETURN (jsonb_typeof(_attachments) = 'array' AND jsonb_array_length(_attachments) = 0)");
    expect(sql).toContain("RAISE EXCEPTION 'request_limit';");
    expect(sql).toContain("SELECT public.chat_can_see(m.group_id, _uid) AND (g.kind <> 'direct' OR g.direct_status = 'active')");
    // and the cap can't be dodged by hard-deleting
    expect(sql).toContain("USING ((sender_id = auth.uid() AND NOT public.chat_is_direct(group_id))");
  });

  it("previewing never shows as Seen: the reader's read time goes somewhere only they can read", () => {
    expect(sql).toContain("IF g.kind = 'direct' AND g.direct_status <> 'active' AND OLD.user_id IS DISTINCT FROM g.requested_by");
    expect(sql).toContain("INSERT INTO public.chat_request_reads (group_id, user_id, read_at)");
    expect(sql).toContain("NEW.last_read_at := OLD.last_read_at;");
    expect(sql).toContain('CREATE POLICY "chat_request_reads_own" ON public.chat_request_reads FOR SELECT TO authenticated USING (user_id = auth.uid());');
    // the preview screen doesn't announce "active now" either
    expect(read("src/components/group-message-thread.tsx")).toContain("useGroupPresence(viewingAsClient || hidePresence ? null : groupId, myPresenceRole)");
    expect(read("src/components/direct-chat.tsx")).toContain("hidePresence={!active}");
  });

  it("Delete and Block are silent: only you can see you did it, and their side doesn't change", () => {
    expect(sql).toContain('CREATE POLICY "chat_direct_closed_own" ON public.chat_direct_closed FOR SELECT TO authenticated USING (user_id = auth.uid());');
    // a closed chat is hidden from the person who closed it, nobody else
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.chat_direct_closed x WHERE x.group_id = g.id AND x.user_id = _uid)");
    // declining leaves the chat a 'request' (what the sender already sees)
    expect(sql).toContain("INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'declined')");
    // writing to them yourself later undoes it
    expect(sql).toContain("DELETE FROM public.chat_direct_closed WHERE group_id = g.id AND user_id = uid;");
  });

  it("replying (or Accept) turns a request into a chat", () => {
    expect(sql).toContain("AND NEW.sender_id IS DISTINCT FROM g.requested_by THEN 'active' ELSE g.direct_status END");
    expect(sql).toContain("UPDATE public.chat_groups SET direct_status = 'active', accepted_at = now() WHERE id = g.id;");
  });

  it("private: coaches don't see members' DMs, and can't post or manage in them", () => {
    expect(sql).toContain(`    SELECT CASE WHEN g.kind = 'direct'
      THEN public.is_group_member(g.id, _uid)`);
    expect(sql).toContain("SELECT NOT public.chat_is_direct(_group_id) AND (");
    expect(sql).toContain("WITH CHECK (kind = 'group' AND public.is_coach_or_admin(auth.uid()) AND created_by = auth.uid());");
    expect(read("src/lib/group-chats.ts")).toContain('.from("chat_groups").select("*").eq("kind", "group").order("updated_at"');
    // members can't make themselves group admins any more
    expect(sql).toContain("NEW.role := OLD.role;");
  });

  it("Report: blocks, keeps the chat, and drops it in the reporter's coach chat as a staff-only note", () => {
    expect(sql).toContain("INSERT INTO public.chat_reports (group_id, reporter_id, reported_id, reporter_client_id, reason, snapshot)");
    expect(sql).toContain("INSERT INTO public.messages (client_id, sender_id, sender_role, body, attachments, message_type, is_internal_note)");
    expect(sql).toContain("' wasn''t told.'");
    expect(APP_EVENTS.chat_reported.to).toBe("staff");
    expect(APP_EVENTS.chat_reported.title("Alyssa Amanda Burg")).toBe("🚩 Alyssa Amanda Burg reported a chat");
    expect(APP_EVENTS.chat_reported.url("c1")).toBe("/admin/messages?client=c1");
  });
});

describe("pushes say who and why, never what", () => {
  const base = { kind: "direct_message" as const, role: "client" as const, recipientUserId: "amanda", sourceId: "m1", displayName: "Dwayne", ids: { groupId: "g1" } };
  it("a request: 'Message request · Dwayne replied to your post.' and one push per request", () => {
    const n = buildNotificationPayload({ ...base, request: true, attachments: [{ type: "link", kind: "community_post" }] });
    expect(n.title).toBe("Message request");
    expect(n.body).toBe("Dwayne replied to your post.");
    expect(n.url).toBe("/portal/messages?tab=groups#group=g1");
    expect(n.category).toBe("messages");
    expect(read("src/lib/push/events.functions.ts")).toContain("eventKey: request ? `direct_request:${group.id}:${uid}` : n.eventKey");
  });
  it("a chat: like any 1:1 message", () => {
    const n = buildNotificationPayload({ ...base, attachments: [] });
    expect(n.title).toBe("Dwayne");
    expect(n.body).toBe("Sent you a message.");
  });
  it("nobody is pushed for a chat they closed", () => {
    expect(read("src/lib/push/events.functions.ts")).toContain("if (!uid || uid === senderId || shut.has(uid)) continue;");
  });
});

describe("the Chats list", () => {
  it("unread = something new from them since I looked (requests use the private read time)", () => {
    expect(isUnread(thread(), "amanda")).toBe(true);
    expect(isUnread(thread({ read_at: "2026-10-08T20:00:01Z" }), "amanda")).toBe(false);
    expect(isUnread(thread({ last: { ...thread().last!, sender_id: "amanda" } }), "amanda")).toBe(false);
  });
  it("previews: 'You: …' for mine, something for a card with no words", () => {
    expect(previewLine(thread({ last: { ...thread().last!, sender_id: "amanda" } }), "amanda")).toBe("You: That squat was moving");
    expect(previewLine(thread({ last: { ...thread().last!, body: "" } }), "amanda")).toBe("Replied to a post");
  });
  it("the cap reads like a person said it", () => {
    expect(friendlyError("request_limit")).toBe("You can send more once they reply.");
  });
  it("requests sit in their own folder with Accept / Delete / Block / Report", () => {
    const ui = read("src/components/direct-chat.tsx");
    expect(ui).toContain("They won't know you've seen this unless you accept.");
    expect(ui).toContain("Sent as a message request. {name} can reply when they see it.");
    expect(ui).toContain("You can send more once {name} replies.");
    const pane = read("src/components/group-chats-pane.tsx");
    expect(pane).toContain("<RequestsEntry count={requests.length}");
    expect(pane).toContain("useDirectThreads(!asAdmin && !isImpersonating)");
  });
  it("Messenger: 'Chats' tab, and push links open it", () => {
    const page = read("src/routes/_authenticated/portal/messages.tsx");
    expect(page).toContain("              Chats\n");
    expect(page).toContain("/(?:^|[?&])tab=groups\\b/.test(window.location.search)");
  });
  it("posts get a Message button (not on your own, not coach-to-coach)", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain('const canMessage = !post.is_mine && !(post.author.is_coach && (role === "admin" || role === "coach"));');
    expect(card).toContain("<MessageAuthorSheet post={post} open={messaging} onOpenChange={setMessaging} />");
    expect(read("src/components/community/message-author-sheet.tsx")).toContain("gets this as a message request and can reply when they see it.");
  });
});
