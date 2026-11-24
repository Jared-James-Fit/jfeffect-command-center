/**
 * Cleo — Cardio (Nov 23 2026): the cardio specialty of the one Cleo, inside the
 * Cardio tab's builder. The coach asks in words ("Build a time-efficient plan
 * around his four training days", "Is his cardio getting in the way of his
 * squat?"); Cleo reads the shared client intelligence (client-intel/brief.server.ts:
 * facts, the coach's instructions, the plans in force, observations, what was
 * tried and how it went) and the draft on screen, and answers with words and,
 * when asked for a change, a whole proposed plan as JSON. Code cleans every
 * number (cleanPlan) and checks it (planProblems) before the coach sees it, the
 * change is shown session by session (diffPlans), and nothing reaches the draft
 * until the coach applies it, nor the client until the coach publishes.
 *
 * OpenAI key only (route cardio_plan, never a `gateway:` model, so never Lovable
 * credits). Every proposal is kept with the coach's decision on it
 * (cardio_cleo_proposals), so the next one knows what was turned down. Server only.
 */
import { askRoute } from "@/lib/ai/route-call.server";
import { cleanPlan, diffPlans, planProblems, planTotals, sessionLine, daysWords, TIMING_SHORT, progressionWords, type CardioPlan } from "@/lib/cardio/plan";
import { MODALITIES } from "@/lib/cardio/modalities";
import { loadCardioWorkspace, type CardioWorkspaceView } from "@/lib/cardio/workspace.server";
import { clientIntelText } from "@/lib/client-intel/brief.server";
import { loadWeightManagement } from "@/lib/weight-management/load.server";
import { scoreCardioPlan } from "@/lib/cardio/quality";
import type { CardioProposal } from "@/lib/cardio/types";
export type { CardioProposal } from "@/lib/cardio/types";

export const CARDIO_SYSTEM = `You are Cleo — Cardio: the cardio specialty of Cleo, the coaching assistant inside JF Effect, working for the client's coach. You are an AI assistant with no gender; speak as "I" in your own reply.

Your expertise: cardiovascular conditioning, aerobic development, energy expenditure, concurrent training (cardio alongside strength training), interference management, recovery, and time-efficient prescriptions. You share one client intelligence with Cleo's training and nutrition work; read it first.

How you program cardio:
- Simple and sustainable first. Treadmill walking (incline, low to moderate effort) is the default unless their goal, equipment, preferences, injuries or recovery call for something else.
- Not every client needs cardio, and more intense is not better. Prescribe the least cardio that does the job for their goal; holding the current plan is often right.
- Concurrent training: most cardio on days off; on lifting days a short easy session after lifting (15 minutes or less for a powerlifter, about 20 otherwise), never hard cardio before lifting, nothing hard or high-impact the day before a heavy squat or deadlift day. Prefer low-impact kinds (incline walk, bike, elliptical) for lifters; running, stairs and conditioning load the legs more.
- Time-efficient options when time is short: a shorter session with a little more incline, walks split through the day, using daily steps and activity they already do.
- Progress one variable at a time in small steps with a ceiling (a few minutes, 1-2% incline, 0.1-0.2 mph), never several at once.
- Close to a meet (4 weeks or less): nothing new or harder; within 2 weeks keep it easy.
- Injuries on file that walking loads: no steep incline or impact.
- A pattern is not a cause: if strength dropped while cardio went up, say it "lines up with" the cardio and name other explanations; never claim cardio caused something without evidence.
- Confirmed facts and the coach's instructions override your interpretations. Never re-propose something the coach turned down unless something has changed, and say what changed.
- You never change nutrition. If the cardio change needs a food change to keep their progress, say so in "nutrition_note" for the coach to take to Cleo's nutrition work.
- You never message the client and never publish: you propose a draft the coach reviews.

Answer with ONE JSON object and nothing else:
{
  "answer": "2-6 short sentences for the coach: what you see, what you'd do and why (plain words, no headings, no markdown)",
  "change": true | false,          // true only when you propose a different plan
  "sessions": [                     // the WHOLE plan as you propose it (every session, kept ones included), or null when change is false
    {
      "key": "the existing session's key to keep it, or null for a new one",
      "modality": one of ${MODALITIES.map((m) => `"${m.key}"`).join(", ")},
      "name": "only for custom or conditioning, else null",
      "days": "training" | "non_training" | "weekdays" | "daily" | "high",
      "weekdays": ["Monday", ...],   // which days for "weekdays" and "non_training"; ignored for the others
      "minutes": number,
      "speedMinMph": number | null, "speedMaxMph": number | null,   // mph, treadmill walks and runs only
      "incline": number | null, "inclineMax": number | null,       // %, treadmill only; inclineMax for variable incline
      "rpeMin": number | null, "rpeMax": number | null,             // 1-10
      "hrZone": string | null, "hrMin": number | null, "hrMax": number | null,
      "timing": "any" | "after_lifting" | "before_lifting" | "separate",
      "progression": { "kind": "none" | "minutes" | "incline" | "speed" | "sessions", "step": number, "everyWeeks": number, "cap": number | null },
      "instructions": "what the client reads, one or two short sentences, or empty",
      "enabled": true
    }
  ] | null,
  "reasons": ["one line per change, most important first: what it is now → what you'd change it to, why, and what it should do for them"],
  "nutrition_note": string | null,
  "confidence": "high" | "moderate" | "low"
}`;

function planText(plan: CardioPlan, view: Pick<CardioWorkspaceView, "ctx" | "speedUnit">): string {
  if (!plan.sessions.length) return "(no sessions)";
  return plan.sessions
    .map(
      (s) =>
        `- key ${s.key}: ${sessionLine(s, view.speedUnit)} · ${daysWords(s, view.ctx)} · ${TIMING_SHORT[s.timing]}${progressionWords(s.progression, view.speedUnit) ? ` · progression ${progressionWords(s.progression, view.speedUnit)}` : ""}${s.enabled ? "" : " · paused"}${s.instructions ? ` · client reads: "${s.instructions}"` : ""}${s.coachNote ? ` · coach's private note: "${s.coachNote}"` : ""} · stored JSON ${JSON.stringify({ modality: s.modality, days: s.days, weekdays: s.weekdays, minutes: s.minutes, speedMinMph: s.speedMinMph, speedMaxMph: s.speedMaxMph, incline: s.incline, inclineMax: s.inclineMax, rpeMin: s.rpeMin, rpeMax: s.rpeMax, hrZone: s.hrZone, hrMin: s.hrMin, hrMax: s.hrMax, timing: s.timing, progression: s.progression })}`,
    )
    .join("\n");
}

/** The first JSON object in a model's answer (tolerant of a stray fence or sentence). */
export function readJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function askCardioCleo(
  sb: any,
  x: { clientId: string; userId: string; instructions: string; draft: unknown; scope?: string | null },
): Promise<CardioProposal> {
  const loaded = await loadWeightManagement(sb, x.clientId);
  const view = await loadCardioWorkspace(sb, x.clientId, { loaded });
  const base = cleanPlan(x.draft, view.ctx);
  // the coach's private notes and keys stay theirs whatever comes back
  const intel = await clientIntelText(sb, { clientId: x.clientId, loaded, cardio: { live: view.live, ctx: view.ctx, unit: view.speedUnit, outcomes: view.outcomes, read: view.read } }, "cardio");
  const totals = planTotals(base, view.ctx, view.scoreCtx.bodyweightKg);
  const prompt = [
    intel,
    `THE DRAFT ON SCREEN (what the coach is editing; ${totals.minutes} min a week over ${totals.sessions} sessions):\n${planText(base, view)}`,
    view.pending ? `A change is already scheduled from ${view.pending.effective}.` : "",
    `Their speed unit is ${view.speedUnit === "kmh" ? "km/h" : "mph"} (always answer speeds in mph in the JSON). Today is ${view.today}.`,
    x.scope ? `The coach is looking at: ${x.scope}.` : "",
    `THE COACH ASKS:\n${x.instructions.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const reply = await askRoute("cardio_plan", { system: CARDIO_SYSTEM, prompt, timeoutMs: 60_000, tag: "cardio_plan" }, { sb, openaiOnly: true });
  const json = readJsonObject(reply.text);
  if (!json) throw new Error("Cleo's answer didn't come back in a form the builder can read. Try asking again.");
  const answer = String(json.answer ?? "").trim().slice(0, 2000) || "Here's what I'd do.";
  let plan: CardioPlan | null = null;
  if (json.change === true && Array.isArray(json.sessions)) {
    const cleaned = cleanPlan(json.sessions, view.ctx);
    // keep the draft's own keys (so the diff matches sessions) and the coach's private notes
    for (const s of cleaned.sessions) {
      const was = base.sessions.find((b) => b.key === s.key);
      if (was) {
        s.id = was.id;
        s.coachNote = was.coachNote;
      } else s.id = null;
    }
    plan = cleaned;
  }
  const changes = plan ? diffPlans(base, plan, view.ctx, view.speedUnit) : [];
  const changeLines = changes.flatMap((c) => c.lines).slice(0, 20);
  if (plan && !changeLines.length) plan = null;
  const problems = plan ? planProblems(plan, view.ctx).map((p) => ({ level: p.level, text: p.text })) : [];
  const reasons = Array.isArray(json.reasons) ? (json.reasons as unknown[]).map((r) => String(r).slice(0, 300)).filter(Boolean).slice(0, 8) : [];
  const nutritionNote = json.nutrition_note ? String(json.nutrition_note).slice(0, 600) : null;
  const confidence = (["high", "moderate", "low"] as const).find((c) => c === json.confidence) ?? "moderate";
  const quality = {
    before: scoreCardioPlan(base, view.scoreCtx).score,
    after: plan ? scoreCardioPlan(plan, view.scoreCtx).score : null,
  };

  let id: string | null = null;
  if (view.available) {
    const { data } = await sb
      .from("cardio_cleo_proposals")
      .insert({
        client_id: x.clientId,
        created_by: x.userId,
        instructions: x.instructions.trim().slice(0, 2000),
        base: base.sessions,
        answer,
        sessions: plan ? plan.sessions : null,
        change_lines: changeLines,
        nutrition_note: nutritionNote,
        status: plan ? "proposed" : "answered",
        model: reply.model,
      })
      .select("id")
      .maybeSingle();
    id = data?.id ?? null;
  }
  const grouped = changes.filter((c) => c.kind !== "note").map((c) => ({ key: c.key, kind: c.kind, lines: c.lines }));
  return { id, answer, change: !!plan, plan, changeLines, changes: grouped, reasons, nutritionNote, problems, confidence, quality, model: reply.model };
}

/** The coach's call on a proposal: applied to the draft, or turned down (with why, for next time). */
export async function decideCardioProposal(sb: any, x: { id: string; clientId: string; userId: string; status: "applied" | "dismissed"; note?: string | null }) {
  const { error } = await sb
    .from("cardio_cleo_proposals")
    .update({ status: x.status, decided_by: x.userId, decided_at: new Date().toISOString(), decision_note: x.note?.trim().slice(0, 1000) || null })
    .eq("id", x.id)
    .eq("client_id", x.clientId)
    .eq("status", "proposed");
  if (error) throw new Error(error.message);
  return { ok: true };
}
