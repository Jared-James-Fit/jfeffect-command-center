import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { communityNoticeText, crowdName, type CommunityNotice } from "@/lib/community-notifications";
import { communityPushCopy, coveredByCoachRecognition, type ClaimedPush } from "@/lib/push/community-push.server";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261030090000_community_notifications.sql");
const vicky = { user_id: "v", name: "Vicky", avatar_url: null, is_coach: false };
const nicole = { user_id: "n", name: "Nicole", avatar_url: null, is_coach: false };
const notice = (n: Partial<CommunityNotice>): CommunityNotice =>
  ({ key: "k", kind: "reaction", anchor: "a", post_id: "p", comment_id: null, count: 1, at: "", actors: [vicky], emojis: [], snippet: null, media_type: null, post_kind: "workout", ...n }) as CommunityNotice;
const push = (n: Partial<ClaimedPush>): ClaimedPush =>
  ({ id: "i", recipient: "r", kind: "reaction", post_id: "p", comment_id: null, emoji: "fire", actor_name: "Vicky", actor_is_staff: false, others: 0, media_type: null, post_kind: "workout", ...n }) as ClaimedPush;

describe("crew activity notifications", () => {
  it("written by triggers on reactions, comments and comment likes; never your own, never from someone you blocked", () => {
    expect(sql).toContain("CREATE TRIGGER trg_community_notify_reaction AFTER INSERT OR UPDATE OF emoji OR DELETE ON public.community_reactions");
    expect(sql).toContain("CREATE TRIGGER trg_community_notify_comment AFTER INSERT ON public.community_comments");
    expect(sql).toContain("CREATE TRIGGER trg_community_notify_comment_like AFTER INSERT OR DELETE ON public.community_comment_likes");
    expect(sql).toContain("IF r IS NULL OR a IS NULL OR r = a THEN RETURN; END IF;");
    expect(sql).toContain("IF public.chat_has_blocked(r, a) OR public.chat_has_blocked(r, _actor) THEN RETURN; END IF;");
  });
  it("no duplicates: one per person per post (reactions) or per comment; taking it back takes it away", () => {
    expect(sql).toContain("(recipient_user_id, post_id, actor_user_id) WHERE kind = 'reaction'");
    expect(sql).toContain("(recipient_user_id, comment_id) WHERE kind IN ('comment', 'reply')");
    expect(sql).toContain("DELETE FROM public.community_notifications n\n       WHERE n.kind = 'reaction'");
    expect(sql).toContain("RAISE WARNING 'community_notify_on_reaction: %', sqlerrm;");
  });
  it("a reply goes to who it answers; the post's author hears once, not twice", () => {
    expect(sql).toContain("IF v_reply IS NULL OR public.community_main_account(v_reply) IS DISTINCT FROM v_author THEN");
  });
  it("the bell only shows posts you can still see and comments still up", () => {
    expect(sql).toContain("AND public.community_post_visible(p.visibility, p.author_user_id, p.client_id)");
    expect(sql).toContain("AND (n.comment_id IS NULL OR c.hidden_at IS NULL)");
    expect(read("src/components/notification-bell.tsx")).toContain('kind: "community", sourceId: n.anchor');
  });
  it("bell lines are grouped and say who", () => {
    expect(crowdName([vicky], 1)).toBe("Vicky");
    expect(crowdName([vicky, nicole], 2)).toBe("Vicky and Nicole");
    expect(crowdName([vicky, nicole], 4)).toBe("Vicky and 3 others");
    expect(communityNoticeText(notice({ count: 3, actors: [vicky, nicole], emojis: ["heart", "fire"] })).title).toBe("Vicky and 2 others reacted ❤️🔥 to your workout");
    expect(communityNoticeText(notice({ kind: "comment", snippet: "Strong!", comment_id: "c" }))).toEqual({ title: "Vicky commented on your workout", body: "“Strong!”" });
    expect(communityNoticeText(notice({ kind: "reply", media_type: "audio", comment_id: "c" }))).toEqual({ title: "Vicky replied to your comment", body: "🎤 Voice memo" });
  });
  it("pushes: once each, claimed by whoever did it, never the comment's words", () => {
    expect(sql).toContain("WHERE n.actor_user_id = v_actor AND n.pushed_at IS NULL AND n.created_at > now() - interval '10 minutes'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.community_claim_pushes(uuid) TO service_role;");
    expect(communityPushCopy(push({}))).toEqual({ title: "Vicky reacted 🔥 to your workout", body: "Tap to see it." });
    expect(communityPushCopy(push({ others: 2 })).title).toBe("Vicky and 2 others reacted to your workout");
    expect(communityPushCopy(push({ kind: "comment", media_type: "audio", post_kind: "lockin" })).title).toBe("Vicky left a voice memo on your lock-in");
    expect(communityPushCopy(push({ kind: "reply" })).title).toBe("Vicky replied to your comment");
  });
  it("grouped and rate limited, with their own switch and a daily cap", () => {
    const srv = read("src/lib/push/community-push.server.ts");
    expect(srv).toContain('const RATE_MINUTES: Record<string, number> = { reaction: 60, comment: 5, reply: 5, comment_like: 180 };');
    expect(srv).toContain("export const COMMUNITY_DAILY_CAP = 5;");
    expect(srv).toContain('category: "community",');
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS community boolean NOT NULL DEFAULT true;");
    expect(read("src/components/push/push-notification-card.tsx")).toContain('{ key: "community", label: "Crew Activity"');
  });
  it("coach props on a workout don't push twice", () => {
    expect(coveredByCoachRecognition(push({ actor_is_staff: true }))).toBe(true);
    expect(coveredByCoachRecognition(push({ actor_is_staff: true, kind: "reply" }))).toBe(false);
    expect(coveredByCoachRecognition(push({ actor_is_staff: false }))).toBe(false);
  });
  it("celebrating someone's PR is one tap", () => {
    const card = read("src/components/community/post-card.tsx");
    expect(card).toContain("const celebrate = !post.is_mine && !post.my_reaction && !post.auto && (post.stats?.pr_count ?? 0) > 0;");
    expect(card).toContain('onClick={() => onReact(post, "fire")}');
  });
});
