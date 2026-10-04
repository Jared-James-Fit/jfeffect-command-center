/**
 * Client-callable trigger for "important event" pushes whose underlying write
 * happens in the browser (lift videos, comments, reviews, forms, targets).
 * The caller only names the event + the record; the server re-reads the
 * record and checks the caller actually did it before anything is sent.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NUTRITION_REQUEST_FORM_ID } from "@/lib/nutrition-ai-prompts";

const Input = z.object({
  event: z.enum([
    "form_submitted",
    "lift_video_uploaded",
    "client_lift_comment",
    "lift_reviewed",
    "checkin_reviewed",
    "nutrition_targets_updated",
  ]),
  /** Record id (submission / video / comment / review), or client id for targets. */
  id: z.string().uuid(),
});

export const notifyAppEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    const db = sb as any;

    const clientUserId = async (clientId: string) =>
      ((await db.from("clients").select("user_id").eq("id", clientId).maybeSingle()).data?.user_id ?? null) as string | null;
    const isStaff = async () => {
      const [{ data: a }, { data: c }] = await Promise.all([
        (supabase as any).rpc("has_role", { _user_id: userId, _role: "admin" }),
        (supabase as any).rpc("has_role", { _user_id: userId, _role: "coach" }),
      ]);
      return !!a || !!c;
    };

    let clientId: string | null = null;
    let sourceId = data.id;

    switch (data.event) {
      case "form_submitted": {
        const { data: s } = await db.from("nf_submissions").select("client_id, form_id, status").eq("id", data.id).maybeSingle();
        // Nutrition requests get their own "AI plan ready" push instead.
        if (!s || s.status === "in_progress" || s.form_id === NUTRITION_REQUEST_FORM_ID) return { skipped: true };
        if ((await clientUserId(s.client_id)) !== userId) return { skipped: true };
        clientId = s.client_id;
        break;
      }
      case "lift_video_uploaded": {
        const { data: v } = await db.from("lift_videos").select("client_id, batch_id").eq("id", data.id).maybeSingle();
        if (!v || (await clientUserId(v.client_id)) !== userId) return { skipped: true };
        clientId = v.client_id;
        // A batch upload = one push.
        if (v.batch_id) sourceId = v.batch_id;
        break;
      }
      case "client_lift_comment":
      case "lift_reviewed": {
        const { data: c } = await db
          .from("lift_video_comments")
          .select("client_id, author_id, author_role, is_internal_note")
          .eq("id", data.id).maybeSingle();
        if (!c || c.is_internal_note || c.author_id !== userId) return { skipped: true };
        const wantRole = data.event === "lift_reviewed" ? "admin" : "client";
        if (c.author_role !== wantRole) return { skipped: true };
        clientId = c.client_id;
        break;
      }
      case "checkin_reviewed": {
        const { data: r } = await db
          .from("manual_check_in_reviews")
          .select("client_id, coach_user_id, notify_client")
          .eq("id", data.id).maybeSingle();
        if (!r || r.coach_user_id !== userId || r.notify_client === false) return { skipped: true };
        clientId = r.client_id;
        break;
      }
      case "nutrition_targets_updated": {
        if (!(await isStaff())) return { skipped: true };
        clientId = data.id;
        // One per client per day at most (rate limit inside handles bursts).
        sourceId = `${data.id}:${new Date().toISOString().slice(0, 10)}`;
        break;
      }
    }
    if (!clientId) return { skipped: true };
    return notifyAppEvent(sb, data.event, { clientId, sourceId, actorUserId: userId });
  });

/** Fire-and-forget helper for client code — a push must never block the UI. */
export function fireAppEvent(event: z.infer<typeof Input>["event"], id: string | null | undefined) {
  if (!id) return;
  void notifyAppEventFn({ data: { event, id } }).catch(() => {});
}
