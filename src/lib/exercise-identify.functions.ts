/**
 * Exercise search's "describe it": the model names what a described exercise
 * most likely is (exercise-identify.server.ts). Signed-in only, on the OpenAI
 * key (route `exercise_identify`), never Lovable credits.
 *
 * Not metered with AI credits on purpose: it's part of searching (a lifter
 * shouldn't pay to find an exercise), it costs a fraction of a cent, and it's
 * held to 30 descriptions per login per 10 minutes and 150 a day
 * (`_challenge_rate_ok`). The same description is answered once per server and
 * then served from memory for a day, whoever asks (it carries nothing personal).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  descriptionKey,
  IDENTIFY_MAX_CHARS,
  IDENTIFY_MIN_CHARS,
  type IdentifyGuess,
} from "@/lib/exercise-identify";

type Answer = { guesses: IdentifyGuess[]; vague: boolean; model: string };
const CACHE = new Map<string, { at: number; answer: Answer }>();
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

export type IdentifyExerciseResponse =
  | ({ ok: true; cached: boolean } & Answer)
  | { ok: false; reason: "busy" | "unavailable" };

export const identifyExerciseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ text: z.string().trim().min(IDENTIFY_MIN_CHARS).max(IDENTIFY_MAX_CHARS) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<IdentifyExerciseResponse> => {
    const { userId } = context as { userId: string };
    const key = descriptionKey(data.text);
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ok: true, cached: true, ...hit.answer };

    const [{ supabaseAdmin }, { rateOk }, { identifyExercise }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/public-rate-limit.server"),
      import("@/lib/exercise-identify.server"),
    ]);
    const okShort = await rateOk(
      supabaseAdmin as any,
      `exercise_identify:${userId}`,
      30,
      "10 minutes",
    );
    const okDay = await rateOk(
      supabaseAdmin as any,
      `exercise_identify_day:${userId}`,
      150,
      "1 day",
    );
    if (!okShort || !okDay) return { ok: false, reason: "busy" };

    try {
      const r = await identifyExercise(data.text, supabaseAdmin);
      const answer: Answer = { guesses: r.reply.guesses, vague: r.reply.vague, model: r.model };
      if (CACHE.size >= CACHE_MAX) {
        const oldest = CACHE.keys().next().value;
        if (oldest !== undefined) CACHE.delete(oldest);
      }
      CACHE.set(key, { at: Date.now(), answer });
      console.log("[exercise-identify]", {
        model: r.model,
        ms: r.ms,
        input: r.usage.input,
        output: r.usage.output,
        guesses: r.reply.guesses.length,
      });
      return { ok: true, cached: false, ...answer };
    } catch (e: any) {
      console.error("[exercise-identify] failed", { message: e?.message });
      return { ok: false, reason: "unavailable" };
    }
  });
