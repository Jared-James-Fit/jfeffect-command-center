/**
 * Server functions for pain: what the athlete's review needs (their recent
 * places, for "Same as Nov 16?", and the workout's exercises), the coach's
 * history of a client, the dashboard's list, and the reply the AI drafts for
 * the coach to approve. Nothing here sends anything to a client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPainHistory, areaSummary, type PainEntry } from "@/lib/pain/history";
import type { RecoverySuggestion } from "@/lib/pain/recovery";
import type { PainSession } from "@/lib/pain/sessions";

async function isStaffFor(supabase: any, userId: string, clientId: string): Promise<boolean> {
  const [{ data: isAdmin }, { data: isAssigned }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_assigned_coach_for_client", { _client_id: clientId }),
  ]);
  return !!isAdmin || !!isAssigned;
}

async function assertStaff(supabase: any, userId: string, clientId: string) {
  if (!(await isStaffFor(supabase, userId, clientId))) throw new Error("Only the client's coach or an admin can see this.");
}

/**
 * The review's pain step: the athlete's places from the last six weeks (so a
 * place that came up asks one question, not the whole form) and the workout's
 * exercises (for "which exercise?"). A coach previewing a client passes
 * `actAsClientId` and is checked like the review's own save.
 */
export const getPainReportContextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      dayId: z.string().uuid().nullable().optional(),
      scheduledWorkoutId: z.string().uuid().nullable().optional(),
      actAsClientId: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = context.supabase as any;
    const { loadPainEntries, loadDayExercises, todayIn } = await import("@/lib/pain/load");
    let clientId: string | null = null;
    if (data.actAsClientId) {
      await assertStaff(supabase, userId, data.actAsClientId);
      clientId = data.actAsClientId;
    } else {
      const { data: me } = await supabase.from("clients").select("id").eq("user_id", userId).maybeSingle();
      clientId = me?.id ?? null;
    }
    const empty = { clientId: null as string | null, today: todayIn(null), entries: [] as PainEntry[], exercises: [] as { id: string | null; name: string }[], feedbackId: null as string | null };
    if (!clientId) return empty;
    const { data: client } = await supabase.from("clients").select("timezone").eq("id", clientId).maybeSingle();
    const tz = client?.timezone ?? null;
    // this workout's own review, if there is one: its places are the ones being edited
    let feedbackId: string | null = null;
    if (data.dayId) {
      let q = supabase.from("pl_day_completions").select("id");
      q = data.scheduledWorkoutId ? q.eq("scheduled_workout_id", data.scheduledWorkoutId) : q.eq("client_id", clientId).eq("day_id", data.dayId).is("scheduled_workout_id", null);
      const { data: comp } = await q.maybeSingle();
      if (comp?.id) {
        const { data: fb } = await supabase.from("pl_workout_feedback").select("id").eq("completion_id", comp.id).maybeSingle();
        feedbackId = fb?.id ?? null;
      }
    }
    const [byClient, exercises] = await Promise.all([
      loadPainEntries(supabase, [clientId], { days: 45, tz: new Map([[clientId, tz]]) }),
      data.dayId ? loadDayExercises(supabase, data.dayId) : Promise.resolve([]),
    ]);
    return { clientId, today: todayIn(tz), entries: byClient.get(clientId) ?? [], exercises, feedbackId };
  });

/** Everything the coach's pain sheet shows for one client (the sheet works the history out with the same code). */
export const getClientPainFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = context.supabase as any;
    await assertStaff(supabase, userId, data.clientId);
    const { loadPainEntries, loadPainSessions, loadGivenSuggestions, todayIn } = await import("@/lib/pain/load");
    const { data: client } = await supabase.from("clients").select("id, full_name, preferred_name, timezone").eq("id", data.clientId).maybeSingle();
    if (!client) throw new Error("Client not found.");
    const tz = client.timezone ?? null;
    const [byClient, sessions, given] = await Promise.all([
      loadPainEntries(supabase, [client.id], { tz: new Map([[client.id, tz]]) }),
      loadPainSessions(supabase, client.id, tz).catch(() => [] as PainSession[]),
      loadGivenSuggestions(supabase, client.id),
    ]);
    return {
      clientId: client.id,
      name: (client.full_name ?? "").trim() || "Client",
      firstName: (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them",
      today: todayIn(tz),
      entries: byClient.get(client.id) ?? [],
      sessions,
      given: given.given,
      reviewedAt: given.reviewedAt,
      draft: given.draft,
    };
  });

export type PainWatchItem = {
  clientId: string;
  name: string;
  /** The places that want the coach, most pressing first. */
  areas: { region: string; label: string; summary: string; reasons: string[] }[];
  latestAt: string;
  redFlag: boolean;
};

/**
 * Home's "Pain to look at": coaching clients with a place that wants the coach
 * (history.ts `reasons`: a warning sign, severe, a stopped session, worse,
 * persistent, changing sessions, the same exercise each time) and a report
 * since the coach last looked. One-off and mild reports never make the list.
 */
export const listPainWatchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainWatchItem[]> => {
    const { userId } = context;
    const supabase = context.supabase as any;
    const [{ data: isAdmin }, { data: coached }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("coached_client_ids"),
    ]);
    let q = supabase.from("clients").select("id, full_name, timezone").eq("service_tier", "coaching").eq("archived", false).limit(500);
    if (!isAdmin) {
      const ids = ((coached ?? []) as any[]).map((r) => (typeof r === "string" ? r : r?.coached_client_ids ?? r?.id)).filter(Boolean);
      if (!ids.length) return [];
      q = q.in("id", ids);
    }
    const { data: clients } = await q;
    const list = (clients ?? []) as { id: string; full_name: string | null; timezone: string | null }[];
    if (!list.length) return [];
    const { loadPainEntries, todayIn } = await import("@/lib/pain/load");
    const tz = new Map(list.map((c) => [c.id, c.timezone]));
    const byClient = await loadPainEntries(supabase, list.map((c) => c.id), { tz });
    const withPain = list.filter((c) => (byClient.get(c.id) ?? []).length > 0);
    if (!withPain.length) return [];
    const { data: reviews } = await supabase
      .from("pain_coach_reviews")
      .select("client_id, kind, through_at, created_at")
      .in("client_id", withPain.map((c) => c.id))
      .in("kind", ["reviewed", "used"])
      .order("created_at", { ascending: false })
      .limit(1000);
    const reviewed = new Map<string, string>();
    for (const r of (reviews ?? []) as any[]) if (!reviewed.has(r.client_id)) reviewed.set(r.client_id, r.through_at ?? r.created_at);

    const out: PainWatchItem[] = [];
    for (const c of withPain) {
      const h = buildPainHistory(byClient.get(c.id) ?? [], todayIn(c.timezone));
      if (!h.flagged.length || !h.latestAt) continue;
      // looked at since the latest report: wait for something new
      const seen = reviewed.get(c.id);
      if (seen && seen >= h.latestAt) continue;
      out.push({
        clientId: c.id,
        name: (c.full_name ?? "").trim() || "Client",
        areas: h.flagged.slice(0, 3).map((a) => ({ region: a.region, label: a.label, summary: areaSummary(a), reasons: a.reasons })),
        latestAt: h.latestAt,
        redFlag: h.flagged.some((a) => a.reasons.includes("red_flag")),
      });
    }
    return out.sort((a, b) => Number(b.redFlag) - Number(a.redFlag) || b.latestAt.localeCompare(a.latestAt));
  });

function suggestionKey(s: RecoverySuggestion): string {
  return `${s.key}:${s.region ?? ""}`;
}

/**
 * A reply in the coach's voice about the client's pain, with a few
 * coach-facing insights, for the coach to edit and send himself. Written on
 * the coach_write route (OpenAI key); kept as a draft so opening the sheet
 * again doesn't ask again until a new report comes in.
 */
export const draftPainReplyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = context.supabase as any;
    await assertStaff(supabase, userId, data.clientId);
    const { loadPainEntries, loadPainSessions, loadGivenSuggestions, todayIn } = await import("@/lib/pain/load");
    const { data: client } = await supabase.from("clients").select("id, full_name, preferred_name, timezone").eq("id", data.clientId).maybeSingle();
    if (!client) throw new Error("Client not found.");
    const tz = client.timezone ?? null;
    const today = todayIn(tz);
    const [byClient, sessions, given] = await Promise.all([
      loadPainEntries(supabase, [client.id], { tz: new Map([[client.id, tz]]) }),
      loadPainSessions(supabase, client.id, tz).catch(() => [] as PainSession[]),
      loadGivenSuggestions(supabase, client.id),
    ]);
    // the engine and the prompt rules load only here (the athlete's review imports this file)
    const [{ recoverySuggestions }, { painHistoryForAi, PAIN_RULES, draftProblems, URGENT_LINE }, { redFlags }] = await Promise.all([
      import("@/lib/pain/recovery"),
      import("@/lib/pain/ai"),
      import("@/lib/pain/safety"),
    ]);
    const history = buildPainHistory(byClient.get(client.id) ?? [], today);
    if (!history.areas.length) throw new Error("No pain reported in the last 12 weeks.");
    const suggestions = recoverySuggestions(history, sessions, given.given);
    const painText = painHistoryForAi(history, { sessions })!;
    const first = (client.preferred_name || client.full_name || "").trim().split(/\s+/)[0] || "them";

    const [{ voicePromptForClient }, { casualize }, { askRoute }, { loadProgramContext }, { programContextText }, health] = await Promise.all([
      import("@/lib/coach-voice.functions"),
      import("@/lib/coach-voice"),
      import("@/lib/ai/route-call.server"),
      import("@/lib/program-context.server"),
      import("@/lib/program-context"),
      import("@/lib/health/health-load"),
    ]);
    const [voice, program, records] = await Promise.all([
      voicePromptForClient(supabase, client.id).catch(() => ""),
      loadProgramContext(supabase, client.id).catch(() => null),
      health.loadHealthRecords(supabase, client.id, { today }).catch(() => null),
    ]);
    const { healthProfileForAi } = await import("@/lib/health/health-profile");
    const healthText = records ? healthProfileForAi(health.healthProfileFromRecords(records, today), "training") : null;
    const recent = sessions.slice(-12);
    const trainingLine = recent.length
      ? `RECENT TRAINING: ${recent.length} workouts finished in the last ${Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${recent[0].date}T00:00:00Z`)) / 86_400_000))} days; session effort ${recent.filter((s) => s.sessionRpe != null).map((s) => s.sessionRpe).join(", ") || "not rated"}; sleep under 6h before ${recent.filter((s) => s.sleep === "lt5" || s.sleep === "5_6").length} of them.`
      : "";
    const options = suggestions.map((s) => `- [${suggestionKey(s)}] ${s.area ? `${s.area}: ` : ""}${s.title} (why: ${s.why})`);

    const system = [
      `You draft a short message from a strength coach to his client ${first} about pain they reported. The coach reads it, edits it and sends it himself; it is never sent automatically.`,
      "Sound like an experienced powerlifting and bodybuilding coach texting a client he knows: direct, specific, practical, conversational. No generic motivation, no wellness-app language, no 'listen to your body', no 'you got this', no dashes, at most one emoji and only if his voice uses them.",
      "The message: 2 to 4 short sentences, under 70 words. Lead with what you noticed, specifically (which place, how often, what it came up on). Then the one thing that matters most. Ask one short, useful question only if the answer would change what the coach does (e.g. which part of the lift hurts).",
      "Training changes: say what we'll do in plain coach words ('let's stop forcing the movements that aggravate it', 'I'll look at the pressing'), never claim the program was already changed.",
      "Recovery: only an option from RECOVERY OPTIONS, at most one, and only if it fits. Heat or massage is for comfort, never a fix. If an assessment is listed, say it plainly ('if it's not settling I'd rather you get it assessed than keep guessing').",
      "If WARNING SIGNS are listed, the message asks about them directly and says to get it checked; if one is urgent, it says to get medical help right away if any of those are there.",
      "Never diagnose, never name a condition or injury type, never mention medication, ice protocols or a return date.",
      PAIN_RULES,
      URGENT_LINE,
      voice,
      'Return ONLY JSON: {"insights": string[] (2 to 4 short coach-facing lines: the pattern, and what to consider in his training; facts only from the data), "message": string, "options_used": string[] (the [keys] of RECOVERY OPTIONS the message uses)}',
    ].filter(Boolean).join("\n\n");
    const prompt = [
      `CLIENT: ${first}`,
      `TODAY: ${today}`,
      "",
      painText,
      "",
      options.length ? ["RECOVERY OPTIONS (keys in brackets):", ...options].join("\n") : "RECOVERY OPTIONS: none. Suggest no recovery action.",
      "",
      healthText ?? "",
      program ? `PROGRAM:\n${programContextText(program)}` : "",
      trainingLine,
      "",
      "Write the insights and the message.",
    ].filter((x) => x !== undefined).join("\n");

    const parse = (text: string) => {
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try {
        return JSON.parse(stripped);
      } catch {
        const m = stripped.match(/\{[\s\S]*\}/);
        try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
      }
    };
    let reply = await askRoute("coach_write", { system, prompt, timeoutMs: 45_000 }, { sb: supabase });
    let parsed = parse(reply.text ?? "");
    let message = casualize(String(parsed?.message ?? "").trim());
    const problems = message ? draftProblems(message) : ["empty"];
    if (problems.length) {
      // one more go, told what to leave out
      reply = await askRoute("coach_write", { system, prompt: `${prompt}\n\nYour last draft used words the coach never uses about pain (${problems.join(", ")}). Write it again without them.`, timeoutMs: 45_000 }, { sb: supabase });
      parsed = parse(reply.text ?? "") ?? parsed;
      message = casualize(String(parsed?.message ?? "").trim());
    }
    if (!message) throw new Error("Couldn't write a draft. Try again.");
    const offered = new Set(suggestions.map(suggestionKey));
    const used = (Array.isArray(parsed?.options_used) ? parsed.options_used : []).map(String).map((k: string) => k.replace(/^\[|\]$/g, "")).filter((k: string) => offered.has(k));
    const insights = (Array.isArray(parsed?.insights) ? parsed.insights : []).map(String).filter(Boolean).slice(0, 4);
    const warnings = draftProblems(message);

    const { error } = await supabase.from("pain_coach_reviews").insert({
      client_id: client.id,
      kind: "draft",
      through_at: history.latestAt,
      regions: history.flagged.map((a) => a.region),
      suggestion_keys: used,
      draft: message.slice(0, 2000),
      insights,
      model: reply.model,
      created_by: userId,
    });
    if (error) console.error("[pain] draft not kept", error.message);
    return { message, insights, suggestionKeys: used, model: reply.model, warnings, redFlags: redFlags(history.flagged.flatMap((a) => a.entries)).length };
  });
