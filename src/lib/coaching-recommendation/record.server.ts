/**
 * The coordinated recommendation behind a weekly check-in (Nov 23 2026):
 * recorded once when the check-in's recap is written (service role, the same
 * pass that records the weight-management read), shown privately on the
 * check-in card in the coach's chat, and acted on only by the coach: Apply to
 * draft (a cardio change becomes Cleo's proposal on the cardio draft; a
 * nutrition change goes to Change it with AI, reviewed before it reaches the
 * plan), Edit (the coach's own words kept with it) or Dismiss. Nothing is ever
 * sent to the client or written to a live plan from here. Server only; never
 * throws while recording (a check-in recap never waits on it).
 */
import { consolidate, recommendationHash, type CoachingRecommendation, type RecItem } from "@/lib/coaching-recommendation/consolidate";
import { loadCardioWorkspace } from "@/lib/cardio/workspace.server";
import type { LoadedWeightManagement } from "@/lib/weight-management/load.server";
import type { RecommendationRow } from "@/lib/cardio/types";
export type { RecommendationRow } from "@/lib/cardio/types";


async function tableExists(sb: any): Promise<boolean> {
  const { error } = await sb.from("client_coaching_recommendations").select("id").limit(1);
  return !error;
}

/** Work out the coordinated read for a client now (weight management + cardio). */
export async function buildRecommendation(sb: any, clientId: string, loaded?: LoadedWeightManagement): Promise<CoachingRecommendation> {
  const { loadWeightManagement } = await import("@/lib/weight-management/load.server");
  const l = loaded ?? (await loadWeightManagement(sb, clientId));
  const view = await loadCardioWorkspace(sb, clientId, { loaded: l });
  return consolidate(l.assessment.recommendation, view.read);
}

/** After a weekly check-in: record it once, and put the older open ones away. */
export async function recordCheckinRecommendation(sb: any, clientId: string, checkinId: string, loaded?: LoadedWeightManagement | null): Promise<void> {
  try {
    if (!(await tableExists(sb))) return;
    const rec = await buildRecommendation(sb, clientId, loaded ?? undefined);
    const { data: inserted } = await sb
      .from("client_coaching_recommendations")
      .upsert(
        { client_id: clientId, checkin_id: checkinId, source: "checkin", hash: recommendationHash(rec), headline: rec.headline.slice(0, 300), hold: rec.hold, items: rec.items, status: "open" },
        { onConflict: "checkin_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (inserted?.id) {
      await sb.from("client_coaching_recommendations").update({ status: "superseded" }).eq("client_id", clientId).eq("status", "open").neq("id", inserted.id);
    }
  } catch (e) {
    console.warn("[coaching-recommendation] not recorded", e);
  }
}

/** The recommendation for a check-in: recorded, or (an older check-in from before this existed) worked out now and recorded. */
export async function recommendationForCheckin(sb: any, checkinId: string): Promise<RecommendationRow | null> {
  if (!(await tableExists(sb))) return null;
  const { data: row } = await sb.from("client_coaching_recommendations").select("*").eq("checkin_id", checkinId).maybeSingle();
  if (row) return row as RecommendationRow;
  const { data: c } = await sb.from("messenger_checkins").select("id, client_id, task_type, status").eq("id", checkinId).maybeSingle();
  if (!c || c.task_type !== "weekly_checkin" || c.status !== "completed") return null;
  // only the latest check-in gets a read worked out late (an old one would read today's records)
  const { data: newer } = await sb
    .from("messenger_checkins")
    .select("id")
    .eq("client_id", c.client_id)
    .eq("task_type", "weekly_checkin")
    .eq("status", "completed")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newer?.id !== checkinId) return null;
  await recordCheckinRecommendation(sb, c.client_id, checkinId);
  const { data: made } = await sb.from("client_coaching_recommendations").select("*").eq("checkin_id", checkinId).maybeSingle();
  return (made as RecommendationRow) ?? null;
}

export async function decideRecommendation(sb: any, x: { id: string; userId: string; status: "applied" | "edited" | "dismissed" | "open"; note?: string | null }) {
  const patch: Record<string, unknown> =
    x.status === "open"
      ? { status: "open", decided_by: null, decided_at: null }
      : { status: x.status, decided_by: x.userId, decided_at: new Date().toISOString() };
  if (x.note !== undefined) patch.coach_note = x.note?.trim().slice(0, 2000) || null;
  const { error } = await sb.from("client_coaching_recommendations").update(patch).eq("id", x.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Apply one item to a draft: a cardio change becomes Cleo's proposal on the cardio draft (saved as
 * the draft, for the coach to review and publish); a nutrition change goes to Change it with AI on
 * their current plan (written in the background, reviewed before it reaches the plan).
 */
export async function applyRecommendationItem(sb: any, x: { id: string; index: number; userId: string }) {
  const { data: row } = await sb.from("client_coaching_recommendations").select("*").eq("id", x.id).maybeSingle();
  if (!row) throw new Error("That recommendation wasn't found.");
  const item = ((row.items ?? []) as RecItem[])[x.index];
  if (!item) throw new Error("That part of the recommendation wasn't found.");
  const words = (row.coach_note as string | null)?.trim() || null;
  if (item.action.kind === "cardio_draft") {
    const { askCardioCleo } = await import("@/lib/cardio/cleo.server");
    const { loadCardioWorkspace: load } = await import("@/lib/cardio/workspace.server");
    const { saveCardioDraft } = await import("@/lib/cardio/publish.server");
    const view = await load(sb, row.client_id);
    const base = view.draft?.plan ?? (view.pending?.plan ?? view.live);
    const proposal = await askCardioCleo(sb, {
      clientId: row.client_id,
      userId: x.userId,
      instructions: `${words ? `${words}\n\n` : ""}From the weekly check-in: ${item.recommendation} (${item.observation})`,
      draft: base.sessions,
      scope: "the whole cardio plan",
    });
    if (proposal.plan) {
      await saveCardioDraft(sb, { clientId: row.client_id, userId: x.userId, sessions: proposal.plan.sessions, effectiveDate: null, note: `From the check-in recommendation: ${item.title}`, baseHash: view.baseHash });
      if (proposal.id) await sb.from("cardio_cleo_proposals").update({ status: "applied", decided_by: x.userId, decided_at: new Date().toISOString() }).eq("id", proposal.id);
    }
    await decideRecommendation(sb, { id: x.id, userId: x.userId, status: "applied" });
    return { kind: "cardio" as const, clientId: row.client_id as string, drafted: !!proposal.plan, answer: proposal.answer, changeLines: proposal.changeLines };
  }
  if (item.action.kind === "nutrition_change") {
    const { data: plan } = await sb.from("nutrition_targets").select("id").eq("client_id", row.client_id).neq("status", "Archived").order("start_date", { ascending: false }).limit(1).maybeSingle();
    if (!plan) throw new Error("They have no nutrition plan to change yet.");
    const { queuePlanEdit } = await import("@/lib/nutrition-plan-edits.server");
    const q = await queuePlanEdit(sb, { clientId: row.client_id, targetId: plan.id, instructions: words ? `${item.action.instruction}\n\nCoach: ${words}` : item.action.instruction, userId: x.userId });
    await decideRecommendation(sb, { id: x.id, userId: x.userId, status: "applied" });
    return { kind: "nutrition" as const, clientId: row.client_id as string, editId: q.id };
  }
  throw new Error("This one is for you to look at, not something to put on a draft.");
}
