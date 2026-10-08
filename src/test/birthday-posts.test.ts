import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runBirthdayPosts } from "@/lib/birthday-posts.server";
import { APP_EVENTS } from "@/lib/push/app-events.server";
import { messageAction } from "@/lib/push/notification-payload";

const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/migrations/20261014120000_community_birthday_posts.sql");

/** A tiny stand-in for the Supabase admin client: rows per table, filters ignored except status. */
function fakeAdmin(rows: Record<string, any[]>) {
  const updates: { table: string; patch: any }[] = [];
  const rpc = vi.fn(async (name: string) => ({ data: name === "community_birthdays_prepare" ? 1 : 1 }));
  const from = (table: string) => {
    let status: string | null = null;
    let notNullMsg = false;
    const chain: any = {
      select: () => chain,
      eq: (col: string, v: any) => {
        if (col === "status") status = v;
        return chain;
      },
      is: () => chain,
      not: () => ((notNullMsg = true), chain),
      lte: () => chain,
      gte: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null }),
      update: (patch: any) => ({ eq: async () => (updates.push({ table, patch }), { error: null }) }),
      then: (res: any) => res({ data: (rows[table] ?? []).filter((r) => !status || r.status === status).filter((r) => !notNullMsg || r.message_id) }),
    };
    return chain;
  };
  return { admin: { rpc, from }, updates, rpc };
}

describe("birthday posts: reviewed by the coach, then out at 8am their time", () => {
  it("never posts without approval: only 'scheduled' (approved) rows are published", () => {
    expect(sql).toContain("IF NOT FOUND OR b.status <> 'scheduled' OR b.approved_by IS NULL THEN RETURN b; END IF;");
    expect(sql).toContain("WHERE status = 'scheduled' AND post_at <= _now");
  });
  it("drafts the evening before (5pm Winnipeg) or on the day, and posts at 8am their time", () => {
    expect(sql).toContain("WHERE (x.d = l.ld AND l.local_hour < 20) OR (x.d = l.ld + 1 AND v_hour >= 17)");
    expect(sql).toContain("(r.day::timestamp + time '08:00') AT TIME ZONE r.ctz");
  });
  it("skips people already wished, with the card switched off, or without community access", () => {
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM public.client_birthday_wishes w WHERE w.client_id = c.id AND w.birthday_year = b.yr)");
    expect(sql).toContain("bc.enabled = false");
    expect(sql).toContain("coalesce(c.portal_access_disabled, false) = false");
  });
  it("writes from real numbers only, in his voice (no banned words), different per person", () => {
    expect(sql).toContain("public.community_workout_stats(pc.id)");
    expect(sql).toContain("v_slot := abs(hashtext(r.id::text || r.yr)) % 997 + v_rank;");
    for (const banned of ["journey", "momentum", "solid win", "keep it up", "crucial", "optimal"]) expect(sql.toLowerCase()).not.toContain(banned);
  });
  it("posting = the community post as the coach + a message with a card that opens it + 'wished'", () => {
    expect(sql).toContain("'kind', 'community_post', 'post_id', v_post");
    expect(sql).toContain("'url', '/portal/community#post=' || v_post");
    expect(sql).toContain("INSERT INTO public.client_birthday_wishes (client_id, birthday_year, wished_by)");
    expect(sql).toContain("v_author := public.community_main_account(b.approved_by);");
  });
  it("only staff can review or act; the rest is internal", () => {
    expect(sql).toContain("IF NOT public.is_community_staff() THEN RAISE EXCEPTION 'Not allowed'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_birthdays_prepare(timestamptz) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.community_birthday_publish_row(uuid) FROM PUBLIC, anon, authenticated;");
  });
  it("the coach's pushes say what's ready and open the review", () => {
    expect(APP_EVENTS.birthday_post_ready.to).toBe("staff");
    expect(APP_EVENTS.birthday_post_ready.title("Dwayne Gordon")).toBe("🎂 Dwayne Gordon's birthday post is ready");
    expect(APP_EVENTS.birthday_post_ready.url("abc")).toBe("/admin#birthday=abc");
    expect(APP_EVENTS.birthday_post_reminder.title("Amanda")).toBe("🎂 It's Amanda's birthday today");
    // (and the community's own coach push actually has its body now)
    expect(APP_EVENTS.community_coach_recognition.body("Coach Jared")).toBe("Coach Jared saw your training.");
    // their message push reads like any coach message
    expect(messageAction([{ type: "link", kind: "community_post" }], true)).toBe("sent you a post");
  });
  it("hourly run: drafts → 'ready' push, approved ones out, and the message pushed once", async () => {
    const { admin, updates, rpc } = fakeAdmin({
      community_birthday_posts: [
        { id: "d1", client_id: "c1", status: "ready" },
        { id: "d2", client_id: "c2", status: "posted", message_id: "m2", approved_by: "coach" },
      ],
      clients: [{ user_id: "u2" }],
      profiles: [{ full_name: "Jared McIntyre" }],
      coaches: [{ full_name: "Jared McIntyre" }],
    });
    const notifyAppEvent = vi.fn(async () => ({ sent: 1 }));
    const sendWebPushToUser = vi.fn(async () => ({ sent: 1, removed: 0, skipped: null }));
    const out = await runBirthdayPosts(admin, { notifyAppEvent, sendWebPushToUser }, Date.parse("2026-12-21T14:05:00Z"));
    expect(rpc).toHaveBeenCalledWith("community_birthdays_prepare", { _now: "2026-12-21T14:05:00.000Z" });
    expect(rpc).toHaveBeenCalledWith("community_birthdays_publish_due", { _now: "2026-12-21T14:05:00.000Z" });
    expect(notifyAppEvent).toHaveBeenCalledWith(admin, "birthday_post_ready", { clientId: "c1", sourceId: "d1" });
    const [, user, payload, opts] = (sendWebPushToUser.mock.calls as any[])[0];
    expect(user).toBe("u2");
    expect(payload.title).toBe("Coach Jared");
    expect(payload.body).toBe("Sent you a post.");
    expect(opts.eventKey).toBe("message:m2:u2"); // same key as a normal send, so never twice
    expect(updates.some((u) => u.patch.ready_pushed_at)).toBe(true);
    expect(updates.some((u) => u.patch.dm_pushed_at)).toBe(true);
    expect(out.ready).toBe(1);
    expect(out.dms).toBe(1);
  });
  it("the hourly hook runs it, and the coach dashboard shows the review card", () => {
    expect(read("src/routes/api/public/hooks/birthday-notifications.ts")).toContain("runBirthdayPosts(supabaseAdmin, { notifyAppEvent, sendWebPushToUser })");
    expect(read("src/routes/_authenticated/admin/index.tsx")).toContain("<BirthdayPostsCard />");
    const ui = read("src/components/community/birthday-posts.tsx");
    expect(ui).toContain("window.location.hash.match(/birthday=([0-9a-f-]{36})/i)");
    expect(ui).toContain("Nothing goes out until you approve it.");
  });
  it("Messenger shows the post as a card that opens it in the app", () => {
    const thread = read("src/components/message-thread.tsx");
    expect(thread).toContain('if (att.kind === "community_post" && att.post_id) {');
    expect(thread).toContain('to={role === "client" ? "/portal/community" : "/admin/community"}');
  });
  it("the dashboard's own birthday message goes through the normal send (so it pushes)", () => {
    const w = read("src/components/upcoming-birthdays-widget.tsx");
    expect(w).toContain('await sendMessage({ clientId, senderId: u.user.id, senderRole: "admin", body: body.trim(), messageType: "General" });');
    expect(w).not.toContain('supabase.from("messages").insert(');
  });
});
