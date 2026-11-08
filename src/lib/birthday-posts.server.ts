/**
 * birthday-posts.server.ts
 *
 * The hourly side of birthday posts (20261014120000_community_birthday_posts.sql).
 * The database writes the drafts and posts; this sends the pushes:
 *
 *   - "🎂 <name>'s birthday post is ready" to the coach when a draft lands
 *     (the evening before, 5pm Winnipeg), so he can read or edit it
 *   - once the post goes out (8am their time, on its own: Nov 8 2026, no
 *     approval needed; community_birthdays_publish_due), the usual
 *     "Coach Jared · Sent you a post" for the message that links to it
 *
 * Every push is deduped on its event key, and each row is stamped once it's
 * been pushed.
 */
import { buildNotificationPayload, coachLabel } from "@/lib/push/notification-payload";

type Deps = {
  notifyAppEvent: (admin: any, event: "birthday_post_ready", input: { clientId: string; sourceId: string }) => Promise<{ sent: number }>;
  sendWebPushToUser: (
    admin: any,
    userId: string,
    payload: { title: string; body: string; url: string; tag: string; data: any },
    options: { category: any; eventKey: string },
  ) => Promise<{ sent: number; removed: number; skipped: string | null }>;
};

export async function runBirthdayPosts(admin: any, deps: Deps, nowMs: number = Date.now()) {
  const now = new Date(nowMs).toISOString();
  const out = { drafted: 0, ready: 0, published: 0, dms: 0 };

  const prep = await admin.rpc("community_birthdays_prepare", { _now: now });
  out.drafted = Number(prep.data ?? 0);

  // A draft landed: tell the coach it's ready to look at.
  const { data: fresh } = await admin.from("community_birthday_posts").select("id, client_id").eq("status", "ready").is("ready_pushed_at", null).limit(50);
  for (const d of (fresh ?? []) as any[]) {
    await deps.notifyAppEvent(admin, "birthday_post_ready", { clientId: d.client_id, sourceId: d.id });
    await admin.from("community_birthday_posts").update({ ready_pushed_at: now }).eq("id", d.id);
    out.ready++;
  }

  // Drafts whose time has come go out on their own (approved or not).
  const pub = await admin.rpc("community_birthdays_publish_due", { _now: now });
  out.published = Number(pub.data ?? 0);

  // The message that went with each post: push it like any coach message.
  const { data: posted } = await admin
    .from("community_birthday_posts")
    .select("id, client_id, message_id, approved_by")
    .eq("status", "posted")
    .is("dm_pushed_at", null)
    .not("message_id", "is", null)
    .limit(50);
  for (const p of (posted ?? []) as any[]) {
    const { data: client } = await admin.from("clients").select("user_id").eq("id", p.client_id).maybeSingle();
    if (client?.user_id) {
      const [{ data: prof }, { data: coach }] = await Promise.all([
        admin.from("profiles").select("full_name").eq("id", p.approved_by).maybeSingle(),
        admin.from("coaches").select("full_name").eq("user_id", p.approved_by).maybeSingle(),
      ]);
      const n = buildNotificationPayload({
        kind: "message",
        role: "client",
        recipientUserId: client.user_id,
        sourceId: p.message_id,
        displayName: coachLabel(coach?.full_name || prof?.full_name),
        attachments: [{ type: "link", kind: "community_post" }],
        ids: { clientId: p.client_id },
      });
      const r = await deps.sendWebPushToUser(admin, client.user_id, { title: n.title, body: n.body, url: n.url, tag: n.tag, data: n.data }, { category: n.category, eventKey: n.eventKey });
      if (r.sent > 0) out.dms++;
    }
    await admin.from("community_birthday_posts").update({ dm_pushed_at: now }).eq("id", p.id);
  }
  return out;
}
