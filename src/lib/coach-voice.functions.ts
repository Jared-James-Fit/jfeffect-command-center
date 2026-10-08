/**
 * Admin → My Voice: read / save the coach voice profile, per-client voice
 * settings, and a "Try it" sample. Also the server helper every generator
 * that writes as the coach uses to load the voice for a client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_VOICE,
  VOICE_LIST_KEYS,
  buildVoicePrompt,
  casualize,
  normalizeVoiceProfile,
  type VoiceAudience,
  type VoiceProfile,
} from "@/lib/coach-voice";

async function adminClient(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function isStaff(sb: any, userId: string): Promise<boolean> {
  const [{ data: a }, { data: c }] = await Promise.all([
    sb.rpc("has_role", { _user_id: userId, _role: "admin" }),
    sb.rpc("has_role", { _user_id: userId, _role: "coach" }),
  ]);
  return !!a || !!c;
}

/** Admin, or the coach assigned to this client. */
async function isStaffFor(sb: any, userId: string, clientId: string): Promise<boolean> {
  const [{ data: a }, { data: c }] = await Promise.all([
    sb.rpc("has_role", { _user_id: userId, _role: "admin" }),
    sb.rpc("is_assigned_coach", { _client_id: clientId }),
  ]);
  return !!a || !!c;
}

/** Server helper: the saved voice profile (defaults when none is saved). */
export async function loadCoachVoice(sb: any): Promise<VoiceProfile> {
  try {
    const { data } = await sb.from("coach_voice").select("profile").eq("id", true).maybeSingle();
    return normalizeVoiceProfile(data?.profile ?? {});
  } catch {
    return DEFAULT_VOICE;
  }
}

/** Server helper: who the reply is for (guy / girl, nickname, edgy OK). */
export async function loadVoiceAudience(sb: any, clientId: string | null | undefined): Promise<VoiceAudience | null> {
  if (!clientId) return null;
  try {
    const { data } = await sb
      .from("clients")
      .select("sex, voice_nickname, voice_edgy_ok")
      .eq("id", clientId)
      .maybeSingle();
    if (!data) return null;
    return { sex: data.sex ?? null, nickname: data.voice_nickname ?? null, edgyOk: !!data.voice_edgy_ok };
  } catch {
    return null;
  }
}

/** Server helper: the full voice block for a prompt about one client. */
export async function voicePromptForClient(sb: any, clientId: string | null | undefined): Promise<string> {
  const [profile, audience] = await Promise.all([loadCoachVoice(sb), loadVoiceAudience(sb, clientId)]);
  return buildVoicePrompt(profile, audience);
}

const listSchema = z.array(z.string().max(120)).max(200);
const profileSchema = z.object({
  rules: z.string().max(6000),
  examples: z.array(z.string().max(2000)).max(20),
  ...Object.fromEntries(VOICE_LIST_KEYS.map((k) => [k, listSchema])),
});

export type ClientVoiceRow = {
  id: string;
  full_name: string;
  sex: string | null;
  voice_nickname: string | null;
  voice_edgy_ok: boolean;
};

export const getCoachVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await adminClient();
    const [{ data: row }, { data: clients }] = await Promise.all([
      sb.from("coach_voice").select("profile, updated_at").eq("id", true).maybeSingle(),
      sb
        .from("clients")
        .select("id, full_name, sex, voice_nickname, voice_edgy_ok")
        .eq("archived", false)
        .order("full_name", { ascending: true })
        .limit(500),
    ]);
    return {
      profile: normalizeVoiceProfile(row?.profile ?? {}),
      defaults: DEFAULT_VOICE,
      updatedAt: (row?.updated_at as string | null) ?? null,
      clients: (clients ?? []) as ClientVoiceRow[],
    };
  });

export const saveCoachVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ profile: profileSchema }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    const sb = await adminClient();
    const profile = normalizeVoiceProfile(data.profile);
    const { error } = await sb
      .from("coach_voice")
      .upsert({ id: true, profile, updated_at: new Date().toISOString(), updated_by: context.userId }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { profile };
  });

export const saveClientVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        sex: z.enum(["male", "female", "unspecified"]).nullable().optional(),
        nickname: z.string().max(40).nullable().optional(),
        edgyOk: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaffFor(context.supabase, context.userId, data.clientId))) throw new Error("Coach access required");
    const sb = await adminClient();
    const patch: Record<string, unknown> = {};
    if (data.sex !== undefined) patch.sex = data.sex;
    if (data.nickname !== undefined) patch.voice_nickname = data.nickname?.trim() || null;
    if (data.edgyOk !== undefined) patch.voice_edgy_ok = data.edgyOk;
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await sb.from("clients").update(patch).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const VOICE_SCENARIOS = {
  great_week: "Weekly check-in: overall week 5/5, training 5/5, nutrition 5/5, all 4 planned workouts done, bench top set moved fast, sleep good, no issues. Goal next week: keep it rolling.",
  pr_week: "Weekly check-in: hit a 15lb squat PR (new top set 405 x 2), all 4 workouts done, nutrition 4/5, sleep 7–8 hrs. Biggest win: the squat PR.",
  rough_week: "Weekly check-in: overall week 2/5, 2 of 4 workouts done, nutrition 2/5, stress high from work, sleep 5–6 hrs, hunger high at night. Asked for help with evening snacking.",
  pain: "Weekly check-in: 3 of 4 workouts done, training 3/5, flagged pain: left knee hurts on squats below parallel and on lunges, fine on deadlifts. Nutrition 4/5.",
} as const;
export type VoiceScenario = keyof typeof VOICE_SCENARIOS;

/** "Try it": write one sample reply with the (unsaved) profile, for tuning. */
export const tryCoachVoiceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        profile: profileSchema,
        scenario: z.enum(Object.keys(VOICE_SCENARIOS) as [VoiceScenario, ...VoiceScenario[]]),
        clientId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isStaff(context.supabase, context.userId))) throw new Error("Coach access required");
    if (data.clientId && !(await isStaffFor(context.supabase, context.userId, data.clientId))) {
      throw new Error("Coach access required");
    }
    const sb = await adminClient();
    const profile = normalizeVoiceProfile(data.profile);
    const audience = await loadVoiceAudience(sb, data.clientId ?? null);
    const { createLovableAiGateway, DEFAULT_AI_MODEL } = await import("@/lib/ai-gateway.server");
    const { generateText } = await import("ai");
    const { data: g } = await sb.from("global_ai_config").select("default_model").limit(1).maybeSingle();
    const result = await generateText({
      model: createLovableAiGateway()(g?.default_model || DEFAULT_AI_MODEL),
      system: [
        "You write the coach's reply to a client check-in. Reply with the message text only, nothing else.",
        buildVoicePrompt(profile, audience),
      ].join("\n\n"),
      prompt: `CHECK-IN:\n${VOICE_SCENARIOS[data.scenario as VoiceScenario]}\n\nWrite the reply.`,
    });
    return { text: casualize(result.text ?? "") };
  });
