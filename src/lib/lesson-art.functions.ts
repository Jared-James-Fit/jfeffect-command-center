import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canHaveArt, lessonArtPrompt, type LessonExtra } from "@/lib/lessons";

/**
 * Optional cover illustrations for lessons, from an image model
 * (generatePicture: OpenAI's when OPENAI_API_KEY is set, else Google's
 * through the Lovable AI gateway), only when the coach taps for one (nothing
 * here runs on a schedule, so nothing costs anything unasked). The image goes
 * on the planned lesson as its photo, for the coach to look at before he
 * approves it. Technique fixes and anything with a drawn diagram stay native
 * (canHaveArt): exact positions and curves are drawn in the app.
 */
async function assertStaff(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  if (!(roles ?? []).some((r: any) => r.role === "admin" || r.role === "coach")) throw new Error("Not allowed");
  return supabaseAdmin as any;
}

export const lessonArtStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.userId);
    return { enabled: !!(process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY) };
  });

export const makeLessonArt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const admin = await assertStaff(context.userId);
    const key = process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false as const, reason: "Illustrations need an image model key (OPENAI_API_KEY) in the app's settings." };

    const { data: row } = await admin.from("community_lesson_plan").select("id, status, item_id").eq("id", data.planId).maybeSingle();
    if (!row || !row.item_id) return { ok: false as const, reason: "Pick a lesson for this day first." };
    if (row.status === "posted") return { ok: false as const, reason: "That one's already posted." };
    const { data: item } = await admin.from("community_series_items").select("data").eq("id", row.item_id).maybeSingle();
    const lesson = (item?.data ?? {}) as LessonExtra;
    if (!lesson.title) return { ok: false as const, reason: "That lesson has no title." };
    if (!canHaveArt(lesson)) return { ok: false as const, reason: "This one has a drawn diagram (or is a technique fix), so it keeps that." };

    const { generatePicture } = await import("@/lib/post-pictures.server");
    const made = await generatePicture(lessonArtPrompt(lesson));
    if (!made.ok) return { ok: false as const, reason: made.reason };
    const pic = made.picture;
    const ext = pic.mime === "image/jpeg" ? "jpg" : pic.mime === "image/webp" ? "webp" : "png";
    const path = `${context.userId}/lesson-art/${row.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("community-media").upload(path, pic.bytes, { contentType: pic.mime, upsert: false });
    if (upErr) return { ok: false as const, reason: `Couldn't save the image: ${upErr.message}` };
    const media = [{ path, type: "image", width: pic.width, height: pic.height }];
    const { error } = await admin.from("community_lesson_plan").update({ media, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const, path };
  });
