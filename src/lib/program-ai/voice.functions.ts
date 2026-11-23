/**
 * Speak to Cleo (coaches): a spoken instruction turned into words for the coach
 * to read, change and send. The audio goes to OpenAI's transcriber (then
 * Whisper) on the OpenAI key, never Lovable credits, and is never stored.
 * Staff only (admins and coaches), held to 30 a login per 10 minutes and 200
 * a day (`_challenge_rate_ok`, refused when it can't be asked). Nothing here
 * changes a program: the words land in the box and the coach sends them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COACH_HINT =
  "A strength coach giving instructions about a training program: exercises (competition squat, bench press, deadlift, RDL, Romanian deadlift, hack squat, lat pulldown, Larsen press, Spoto press, pin squat), sets, reps, RPE, RIR, percentages, back-off sets, top sets, deload, taper, peaking, accumulation, hypertrophy, block, week, day, Monday to Sunday, minutes.";

async function limited(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  for (const [key, max, window] of [[`coach_voice:${userId}`, 30, "10 minutes"], [`coach_voice_day:${userId}`, 200, "1 day"]] as const) {
    const { data, error } = await db.rpc("_challenge_rate_ok", { p_key: key, p_max: max, p_window: window });
    if (error || data === false) return true;
  }
  return false;
}

export const transcribeCoachVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      audio: z.string().min(16).max(6_000_000),
      mime: z.string().max(80),
      feature: z.enum(["program_edit", "program_notes"]).default("program_edit"),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
    const { userId, supabase } = context as { userId: string; supabase: any };
    const [{ data: admin }, { data: coach }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "coach" }),
    ]);
    if (admin !== true && coach !== true) return { ok: false, reason: "Voice instructions are for coaches." };
    if (await limited(userId)) return { ok: false, reason: "That's a lot of recordings in a few minutes. Type it for now, or try again shortly." };
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, reason: "Voice isn't set up. Type it instead." };
    const started = Date.now();
    const { openAiTranscriber, transcribePainAudio } = await import("@/lib/pain/describe.server");
    const { recordAiCall } = await import("@/lib/ai/ai-health.server");
    try {
      const r = await transcribePainAudio(data.audio, data.mime, [openAiTranscriber(key, "gpt-4o-mini-transcribe", COACH_HINT), openAiTranscriber(key, "whisper-1", COACH_HINT)], 45_000);
      void recordAiCall({ model: r.via, task: "coach_voice", feature: data.feature, ok: true, ms: Date.now() - started });
      return { ok: true, text: r.text };
    } catch (e: any) {
      void recordAiCall({ model: "openai:gpt-4o-mini-transcribe", task: "coach_voice", feature: data.feature, ok: false, error: e, ms: Date.now() - started });
      return { ok: false, reason: e?.message ?? "Couldn't hear that." };
    }
  });
