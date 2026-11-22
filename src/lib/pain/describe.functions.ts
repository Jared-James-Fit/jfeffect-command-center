/**
 * "Describe it" in a pain report, the server's two parts: reading a
 * description the app's own reader couldn't place (readPainDescriptionFn) and
 * turning a spoken one into words (transcribePainVoiceFn). Signed in only:
 * the athlete, or their coach previewing them. On the OpenAI key, never
 * Lovable credits.
 *
 * Never metered with AI credits on purpose: reporting pain must never cost
 * anything or stop because credits ran out. Held to 20 a login per 10
 * minutes and 60 a day each (`_challenge_rate_ok`). Nothing is stored here:
 * what they said reaches their review only once they confirm it there.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DescribeResult } from "@/lib/pain/describe";

async function limited(userId: string, kind: string): Promise<boolean> {
  const [{ supabaseAdmin }, { rateOk }] = await Promise.all([import("@/integrations/supabase/client.server"), import("@/lib/public-rate-limit.server")]);
  const short = await rateOk(supabaseAdmin as any, `${kind}:${userId}`, 20, "10 minutes");
  const day = await rateOk(supabaseAdmin as any, `${kind}_day:${userId}`, 60, "1 day");
  return !short || !day;
}

export type ReadDescriptionResponse = ({ ok: true } & DescribeResult) | { ok: false; reason: "busy" | "unavailable" };

export const readPainDescriptionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      text: z.string().trim().min(3).max(600),
      exercises: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string().max(120) })).max(40).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ReadDescriptionResponse> => {
    const { userId } = context as { userId: string };
    if (await limited(userId, "pain_describe")) return { ok: false, reason: "busy" };
    try {
      const { readDescription } = await import("@/lib/pain/describe.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const r = await readDescription(data.text, data.exercises ?? [], supabaseAdmin);
      console.log("[pain-describe]", { model: r.model, places: r.result.places.length });
      return { ok: true, ...r.result };
    } catch (e: any) {
      console.error("[pain-describe] failed", { message: e?.message });
      return { ok: false, reason: "unavailable" };
    }
  });

export const transcribePainVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      audio: z.string().min(16).max(6_000_000),
      mime: z.string().max(80),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
    const { userId } = context as { userId: string };
    if (await limited(userId, "pain_voice")) return { ok: false, reason: "Too many recordings right now. Try again in a few minutes." };
    try {
      const { transcribePainAudio } = await import("@/lib/pain/describe.server");
      return { ok: true, text: await transcribePainAudio(data.audio, data.mime) };
    } catch (e: any) {
      console.error("[pain-voice] failed", { message: e?.message });
      return { ok: false, reason: e?.message ?? "Couldn't hear that." };
    }
  });
