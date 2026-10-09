import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { crewPreview, crewSubtitle, isCrewUnread, type CrewThread } from "@/lib/crew-chats";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261015120000_member_group_chats.sql");
const bday = read("supabase/migrations/20261015110000_birthday_next_up.sql");

const crew = (over: Partial<CrewThread> = {}): CrewThread => ({
  group_id: "g1", name: "Leg day crew", status: "joined", is_owner: false, invited_by: null,
  faces: [], joined: 3, invited: 1,
  last: { body: "leg day thursday?", created_at: "2026-10-08T20:00:00Z", sender_id: "amanda", sender_name: "Amanda", card: false, media: false },
  last_at: "2026-10-08T20:00:00Z", read_at: null, ...over,
});

describe("group chats members start: invites first, everything quiet", () => {
  it("being added is an invite you can read first; you can't post or react until you join", () => {
    expect(sql).toContain("WHEN 'crew' THEN public.chat_community_ok(_uid) AND public.chat_crew_status(g.id, _uid) IS NOT NULL");
    expect(sql).toContain("RETURN public.chat_community_ok(_uid) AND public.chat_crew_status(g.id, _uid) = 'joined';");
    expect(sql).toContain("WHEN 'crew' THEN public.chat_crew_status(g.id, _uid) = 'joined'");
  });

  it("looking at an invite never shows as Seen, and you can't join yourself through the table", () => {
    expect(sql).toContain("OR (g.kind = 'crew' AND NEW.status = 'invited'))");
    expect(sql).toContain("NEW.status := OLD.status;");
    expect(sql).toContain("IF coalesce(current_setting('app.chat_rpc', true), '') <> 'on' THEN");
    expect(read("src/components/group-message-thread.tsx")).toContain('.filter((m: any) => m.status !== "invited")');
  });

  it("declining is silent: you still read 'Invited' to everyone until the invite runs out (14 days)", () => {
    expect(sql).toContain("RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;");
    expect(sql).toContain("INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'declined')");
    // the people list never looks at anyone's own decline
    const people = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.crew_people"), sql.indexOf("CREATE OR REPLACE FUNCTION public.chat_crew_threads"));
    expect(people).not.toContain("chat_direct_closed");
    expect(people).toContain("AND (m.status = 'joined' OR m.invited_at > now() - make_interval(days => public.chat_crew_invite_days()))");
  });

  it("anyone who's joined can invite (members only, up to 30); a blocked inviter never reaches you", () => {
    expect(sql).toContain("public.chat_crew_status(_group_id, uid) IS DISTINCT FROM 'joined'");
    expect(sql).toContain("RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$;");
    expect(sql).toContain("OR coalesce((public.community_author(u)->>'is_coach')::boolean, false);");
    expect(sql).toContain("IF public.chat_has_blocked(u, _by) THEN");
  });

  it("whoever started it removes people silently: their row just goes, no message to anyone", () => {
    const remove = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.crew_remove"), sql.indexOf("CREATE OR REPLACE FUNCTION public.crew_rename"));
    expect(remove).toContain("g.created_by = uid");
    expect(remove).toContain("DELETE FROM public.chat_group_members WHERE group_id = _group_id AND user_id = _user_id;");
    expect(remove).not.toContain("group_messages");
    expect(read("src/components/crew-chat.tsx")).toContain("won't be told. The chat just disappears from their list.");
  });

  it("leaving hands the chat over (or ends it); report keeps you out for good and goes to your coach", () => {
    expect(sql).toContain("UPDATE public.chat_groups SET created_by = v_next WHERE id = _group_id;");
    expect(sql).toContain("DELETE FROM public.chat_groups WHERE id = _group_id;");
    expect(sql).toContain("INSERT INTO public.chat_direct_closed (group_id, user_id, reason) VALUES (g.id, uid, 'blocked')");
    expect(sql).toContain("'🚩 ' || v_me || ' reported ' || _what || E'.\\nNobody in it was told.'");
  });

  it("private like DMs: coaches don't see them, can't manage them, and aren't in the people picker", () => {
    expect(sql).toContain("SELECT coalesce(public.chat_kind(_group_id), 'group') = 'group' AND (");
    expect(read("src/components/crew-chat.tsx")).toContain("members.map((m) => m.author).filter((a) => !a.is_coach && !exclude.has(a.user_id))");
    expect(read("src/components/group-chats-pane.tsx")).toContain("useCrewThreads(!asAdmin && !isImpersonating)");
  });

  it("pushes: invites once each, messages only to people who've joined", () => {
    const ev = read("src/lib/push/events.functions.ts");
    expect(ev).toContain('if (!uid || uid === senderId || m.status !== "joined" || shut.has(uid)) continue;');
    expect(ev).toContain("body: `${who} invited you to ${name}.`");
    expect(ev).toContain("if (r.status !== \"invited\" || r.invited_by !== userId || shut.has(r.user_id)) continue;");
  });
});

describe("the Chats list and Requests", () => {
  it("an unopened invite is new even if nobody's said anything; opened = not", () => {
    expect(isCrewUnread(crew({ status: "invited", last: null }), "me")).toBe(true);
    expect(isCrewUnread(crew({ status: "invited", last: null, read_at: "2026-10-08T21:00:00Z" }), "me")).toBe(false);
    expect(isCrewUnread(crew(), "me")).toBe(true);
    expect(isCrewUnread(crew({ read_at: "2026-10-08T20:00:01Z" }), "me")).toBe(false);
  });
  it("previews never show an invite's messages", () => {
    expect(crewPreview(crew({ status: "invited", invited_by: "Dwayne" }), "me")).toBe("Dwayne invited you");
    expect(crewPreview(crew(), "me")).toBe("Amanda: leg day thursday?");
    expect(crewPreview(crew({ last: { ...crew().last!, sender_id: "me" } }), "me")).toBe("You: leg day thursday?");
    expect(crewSubtitle({ joined: 3, invited: 1 })).toBe("3 people · 1 invited");
  });
  it("invites sit in Requests with Join / Decline and a look at who's in it", () => {
    const ui = read("src/components/crew-chat.tsx");
    expect(ui).toContain("They won't know you've seen this unless you join.");
    expect(ui).toContain("See who's in it");
    expect(read("src/components/direct-chat.tsx")).toContain("crews?: CrewThread[];");
    expect(read("src/components/group-chats-pane.tsx")).toContain("const requestCount = requests.length + crewInvites.length;");
  });
});

describe("birthday posts: the card says who's next", () => {
  it("lists the next birthdays without a draft and when theirs lands", () => {
    expect(bday).toContain("'draft_at', ((b.day - 1)::timestamp + time '17:00') AT TIME ZONE tz");
    expect(bday).toContain("NOT EXISTS (SELECT 1 FROM public.community_birthday_posts p WHERE p.client_id = c.id");
  });
  it("Write it now drafts early through the server (their numbers can outlast a normal request), still review-first", () => {
    expect(bday).toContain("IF NOT (public.is_community_staff() OR coalesce(auth.role(), '') = 'service_role') THEN");
    expect(bday).toContain("ready_pushed_at");
    const fn = read("src/lib/birthday-posts.functions.ts");
    expect(fn).toContain('r.role === "admin" || r.role === "coach"');
    expect(fn).toContain('rpc("community_birthday_draft_now"');
    const card = read("src/components/community/birthday-posts.tsx");
    expect(card).toContain("if (items.length === 0 && (actionableOnly || next.length === 0)) return null;");
    expect(card).toContain("Write now");
  });
});
