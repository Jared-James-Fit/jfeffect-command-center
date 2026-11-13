import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHARE_SEND_MAX,
  filterTargets,
  mergeTargets,
  opensInNewTab,
  postLink,
  postLinkTarget,
  postShareText,
  sendLabel,
  shareAppHref,
  shareAppsFor,
  shareErrorText,
  shareOutcome,
  targetSubtitle,
  toggleTarget,
  type ShareTarget,
} from "@/lib/post-share";
import { previewLine, type DirectThread } from "@/lib/direct-chats";
import { messagePreviewText } from "@/lib/message-preview";
import { postReplyCard } from "@/components/community/post-chat-card";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20270312090000_share_sheet.sql");
const t = (key: string, name: string, kind: ShareTarget["kind"] = "person", username: string | null = null): ShareTarget => ({ key, kind, name, avatar_url: null, username });
const POST = "0f1e2d3c-4b5a-4968-8776-655443322110";

describe("a post's link and the apps it goes out to", () => {
  it("one link for every way out, opening the post for the crew and nobody else", () => {
    expect(postLink(POST)).toBe(`https://jfeffect.com/p/${POST}`);
    expect(postShareText({ author: { name: "Dwayne Gordon" } })).toBe("Dwayne's post on JF Effect");
    expect(postShareText({ is_mine: true, author: { name: "Jared" } })).toBe("My post on JF Effect");
    expect(postShareText({ story: true, author: { name: "Fionna" } })).toBe("Fionna's story on JF Effect");
  });

  it("signed in, the link opens the post on your own Crew page; signed out it never shows it", () => {
    expect(postLinkTarget(POST, "client", null)).toEqual({ to: "/portal/community", hash: `post=${POST}` });
    expect(postLinkTarget(POST, "member", null)).toEqual({ to: "/portal/community", hash: `post=${POST}` });
    expect(postLinkTarget(POST, "admin", null)).toEqual({ to: "/admin/community", hash: `post=${POST}` });
    // a dual account in its client view
    expect(postLinkTarget(POST, "coach", "client")).toEqual({ to: "/portal/community", hash: `post=${POST}` });
    // not a post id: just Crew
    expect(postLinkTarget("not-a-post", "client", null)).toEqual({ to: "/portal/community" });
    const page = read("src/routes/p.$postId.tsx");
    expect(page).toContain("This post is in the JF Effect crew");
    expect(page).toContain('search={{ next: `/p/${postId}` } as any}');
    expect(page).toContain('{ name: "robots", content: "noindex" }');
    expect(page).not.toMatch(/community_post|useQuery|signCommunity/);
  });

  it("Instagram's row: Messages on a phone, Messenger where something can open it", () => {
    expect(shareAppsFor("ios", true)).toEqual(["messages", "whatsapp", "snapchat", "messenger", "facebook", "x", "threads", "email"]);
    expect(shareAppsFor("android", false)).toEqual(["messages", "whatsapp", "snapchat", "messenger", "facebook", "x", "threads", "email"]);
    expect(shareAppsFor("desktop", false)).toEqual(["whatsapp", "snapchat", "facebook", "x", "threads", "email"]);
    expect(shareAppsFor("desktop", true)).toContain("messenger");
  });

  it("each app's own share link, every value encoded", () => {
    const link = postLink(POST);
    const text = "Dwayne's post on JF Effect";
    const enc = encodeURIComponent;
    expect(shareAppHref("messages", link, text, "ios")).toBe(`sms:?&body=${enc(`${text} ${link}`)}`);
    expect(shareAppHref("whatsapp", link, text, "ios")).toBe(`https://wa.me/?text=${enc(`${text} ${link}`)}`);
    expect(shareAppHref("snapchat", link, text, "ios")).toBe(`https://www.snapchat.com/share?link=${enc(link)}`);
    expect(shareAppHref("facebook", link, text, "ios")).toBe(`https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`);
    expect(shareAppHref("x", link, text, "ios")).toBe(`https://x.com/intent/post?text=${enc(text)}&url=${enc(link)}`);
    expect(shareAppHref("threads", link, text, "ios")).toBe(`https://www.threads.com/intent/post?text=${enc(text)}&url=${enc(link)}`);
    expect(shareAppHref("email", link, text, "ios")).toBe(`mailto:?subject=${enc(text)}&body=${enc(`${text}\n\n${link}`)}`);
    // Messenger: Android's own scheme; an iPhone goes through the phone's share sheet
    expect(shareAppHref("messenger", link, text, "android")).toBe(`fb-messenger://share/?link=${enc(link)}`);
    expect(shareAppHref("messenger", link, text, "ios")).toBeNull();
    expect(opensInNewTab("https://wa.me/?text=x")).toBe(true);
    expect(opensInNewTab("sms:?&body=x")).toBe(false);
  });
});

describe("picking who it goes to", () => {
  it("tap in, tap out, never past 20; one is Send, several go to each on their own", () => {
    expect(toggleTarget([], "p:a")).toEqual(["p:a"]);
    expect(toggleTarget(["p:a", "coach"], "p:a")).toEqual(["coach"]);
    const full = Array.from({ length: SHARE_SEND_MAX }, (_, i) => `p:${i}`);
    expect(toggleTarget(full, "p:new")).toEqual(full);
    expect(sendLabel(1)).toBe("Send");
    expect(sendLabel(3)).toBe("Send separately");
    expect(targetSubtitle({ kind: "coach" })).toBe("Coach chat");
    expect(targetSubtitle({ kind: "group" })).toBe("Group");
    expect(targetSubtitle({ kind: "person" })).toBeNull();
  });

  it("typing narrows the faces at once (@username or a name's start first), the server's search adds the rest once", () => {
    const list = [t("p:1", "Dwayne Gordon", "person", "dgordon"), t("p:2", "Colten Murray"), t("g:1", "Leg day crew", "group"), t("p:3", "Shaina", "person", "shaina_lifts")];
    expect(filterTargets(list, "sh").map((x) => x.key)).toEqual(["p:3"]);
    expect(filterTargets(list, "@dg").map((x) => x.key)).toEqual(["p:1"]);
    expect(filterTargets(list, "murray").map((x) => x.key)).toEqual(["p:2"]);
    expect(filterTargets(list, "").length).toBe(4);
    expect(mergeTargets([list[0]], [list[0], list[1]]).map((x) => x.key)).toEqual(["p:1", "p:2"]);
  });

  it("says how it went, by first name, and why any didn't go", () => {
    const targets = [t("p:1", "Dwayne Gordon"), t("p:2", "Shaina"), t("coach", "Jared", "coach"), t("p:3", "Dave"), t("g:1", "Leg day crew", "group")];
    expect(shareOutcome([{ key: "p:1", ok: true, route: "direct", status: "active" }], targets).message).toBe("Sent to Dwayne");
    expect(shareOutcome([{ key: "p:2", ok: true, route: "direct", status: "request" }], targets).message).toBe("Request sent to Shaina");
    expect(
      shareOutcome(
        [
          { key: "p:1", ok: true, route: "direct" },
          { key: "coach", ok: true, route: "coach" },
          { key: "g:1", ok: true, route: "group" },
          { key: "p:2", ok: true, route: "direct" },
        ],
        targets,
      ).message,
    ).toBe("Sent to Dwayne, Jared and 2 more");
    const o = shareOutcome([{ key: "p:1", ok: true, route: "direct" }, { key: "p:3", ok: false, error: "They can't see this post" }], targets);
    expect(o.message).toBe("Sent to Dwayne");
    expect(o.error).toBe("Couldn't send to Dave: They can't see this post");
    expect(shareErrorText("request_daily_limit")).toBe("That's a lot of new people for one day. You can message more tomorrow.");
    expect(shareErrorText("new row violates row-level security policy")).toBe("That didn't send. Try again in a moment.");
  });
});

describe("the database decides who it can go to", () => {
  it("ranks from who you actually talk to and send posts to, then likes, comments and follows", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.community_post_sends (");
    // the 1:1s you've talked in lately, weighted most
    expect(sql).toContain("3 * ln(1 + coalesce(dm.n, 0))");
    // who you've sent posts to
    expect(sql).toContain("2.5 * ln(1 + coalesce(s.n, 0)) + CASE WHEN s.last_at > now() - interval '14 days' THEN 2 ELSE 0 END");
    // your likes and comments on theirs, theirs on yours, follows
    expect(sql).toContain("1.2 * ln(1 + coalesce(gave.n, 0)) + 0.8 * ln(1 + coalesce(got.n, 0))");
    expect(sql).toContain("CASE WHEN fol.i_follow AND fol.follows_me THEN 1.5");
    // a coaching client's coach chat is a face of its own
    expect(sql).toContain("SELECT 'coach', 'coach', coach.a->>'name'");
    // never someone blocked either way, a coach as a 1:1, or a test login (community_findable_people)
    expect(sql).toContain("FROM public.community_findable_people(v_me) fp");
    expect(sql).toContain("WHERE fp.user_id NOT IN (SELECT st FROM public.community_staff_people() st WHERE st IS NOT NULL)");
    expect(sql).toContain("AND fp.user_id NOT IN (SELECT public.community_blocked_authors())");
    // a new account still gets faces: the crew's best-followed
    expect(sql).toContain("nobody yet (a new account): the crew's best-followed");
  });

  it("only someone who can see the post gets it", () => {
    expect(sql).toContain("IF p.visibility = 'community' THEN RETURN NULL; END IF;");
    expect(sql).toContain("AND (v_other = v_author OR public.community_follows_user(v_other, p.author_user_id)) THEN");
    expect(sql).toContain("IF p.visibility <> 'community' THEN RETURN 'Only posts shared with the whole crew can go to a group'; END IF;");
    expect(sql).toContain("IF p.visibility = 'private' THEN RETURN 'Only you can see this post'; END IF;");
    // a block between them and the author hides it
    expect(sql).toContain("IF public.chat_has_blocked(v_author, v_other) OR public.chat_has_blocked(v_other, v_author) THEN");
    // a coach sends to a client's coach chat, theirs or (an admin) anyone's
    expect(sql).toContain("AND (public.has_role(_uid, 'admin') OR c.id IN (SELECT public.coached_client_ids()))) THEN");
  });

  it("sends each on its own, a new 1:1 as a request, a double tap once, at most 20 at a time and 200 a day", () => {
    expect(sql).toContain("g := public.chat_direct_open(uid, v_id);");
    expect(sql).toContain("IF cardinality(v_keys) > 20 THEN RAISE EXCEPTION 'Send it to up to 20 at a time'; END IF;");
    expect(sql).toContain("+ cardinality(v_keys) > 200 THEN");
    expect(sql).toContain("AND s.created_at > now() - interval '1 minute'");
    // one that fails never stops the rest
    expect(sql).toContain("v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_key, 'ok', false, 'error', SQLERRM));");
    // the card in the chat
    expect(sql).toContain("'type', 'link', 'kind', 'community_post', 'post_id', p.id, 'shared', true");
    // the tables and helpers are the server's alone
    expect(sql).toContain("REVOKE ALL ON public.community_post_sends FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_share_refusal(uuid, text, uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.community_share_post(uuid, text[], text) TO authenticated, service_role;");
  });
});

describe("a sent post in the chat", () => {
  it("leads its message as Instagram's card, and previews say what it is", () => {
    const card = { type: "link", kind: "community_post", post_id: POST, shared: true, name: "Dwayne" };
    expect(postReplyCard([card])).toEqual(card);
    expect(postReplyCard([{ kind: "community_post", post_id: POST }])).toBeNull();
    expect(read("src/components/community/post-chat-card.tsx")).toContain("data-post-shared-card");
    expect(messagePreviewText("", [card])).toBe("Shared a post");
    expect(messagePreviewText("", [{ ...card, story: true }])).toBe("Shared a story");
    const thread = { last: { body: "", created_at: "2026-11-13T00:00:00Z", sender_id: "x", card: true, media: false } } as DirectThread;
    expect(previewLine(thread, "me")).toBe("Sent a post");
    expect(read("src/lib/push/notification-payload.ts")).toContain("`${who} sent you a post.`");
  });

  it("the ✈️ always opens the sheet, mounted on its first tap; nothing sends in View as client", () => {
    const cardSrc = read("src/components/community/post-card.tsx");
    expect(cardSrc).toContain("{sharing !== null && (");
    expect(cardSrc).not.toContain("MessageAuthorSheet");
    const sheet = read("src/components/community/post-share-sheet.tsx");
    expect(sheet).toContain("const canSend = !isImpersonating;");
    expect(sheet).toContain("Sending is off while you're viewing as a client.");
    expect(sheet).toContain('option="native"');
  });
});
