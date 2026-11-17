/**
 * The weight-management audit trail and the writes a coach approves. A review
 * is the engine's read as it was (weight_management_reviews, staff only);
 * after a weekly check-in the server records one (deduped by the read's hash,
 * so the same records never make two), supersedes the open one before it,
 * and pushes the coach only when it needs them. Approving writes exactly what
 * the coach saw, with the before and after kept on the review: the cardio
 * plan (cardio_targets, which the program's cardio sync follows) and water
 * (progress_water_targets). A nutrition change is never written here: it goes
 * through Change it with AI, the plan's own reviewed, undoable path.
 */
import type { Assessment } from "@/lib/weight-management/assessment";
import { loadWeightManagement, type LoadedWeightManagement } from "@/lib/weight-management/load.server";
import type { TreadmillSession } from "@/lib/weight-management/treadmill";

/** A review the coach should look at: a change to approve, or something to look into. */
export function needsCoach(a: Assessment): boolean {
  const r = a.recommendation;
  // a weight-class meet within 4 weeks with no usable weigh-ins: the coach hears it now, not at the meet
  const classMeetBlind = r.verdict === "need_data" && a.goal?.source === "meet" && a.meetWeeksOut != null && a.meetWeeksOut <= 4;
  return r.material || r.verdict === "investigate" || r.verdict === "reconsider_target" || classMeetBlind;
}

/** The read as stored: everything but the weekly path (it's rebuilt on screen). */
export function storedAssessment(a: Assessment): Assessment {
  return { ...a, trajectory: { ...a.trajectory, path: [] } };
}

/**
 * After a weekly check-in (service role): record the read once, supersede the
 * one before, and push the coach when it needs them. Never throws.
 */
export async function recordCheckinReview(admin: any, clientId: string, checkinId: string | null): Promise<LoadedWeightManagement | null> {
  try {
    const loaded = await loadWeightManagement(admin, clientId);
    const a = loaded.assessment;
    const status = needsCoach(a) ? "open" : "noted";
    const { data: inserted } = await admin
      .from("weight_management_reviews")
      .upsert(
        {
          client_id: clientId,
          source: "checkin",
          checkin_id: checkinId,
          hash: a.hash,
          engine_version: a.version,
          verdict: a.recommendation.verdict,
          headline: a.recommendation.headline.slice(0, 300),
          material: a.recommendation.material,
          assessment: storedAssessment(a),
          status,
        },
        { onConflict: "client_id,hash", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (!inserted?.id) return loaded; // the same read was already recorded
    await admin.from("weight_management_reviews").update({ status: "superseded" }).eq("client_id", clientId).eq("status", "open").neq("id", inserted.id);
    if (status === "open") {
      const { notifyAppEvent } = await import("@/lib/push/app-events.server");
      const r = await notifyAppEvent(admin, "weight_review_ready", { clientId, sourceId: inserted.id });
      if (r.sent > 0) await admin.from("weight_management_reviews").update({ notified_at: new Date().toISOString() }).eq("id", inserted.id);
    }
    return loaded;
  } catch (e) {
    console.warn("[weight-management] check-in review failed", e);
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* Writes the coach approves                                                 */

type Row = Record<string, any>;
const pickRow = (r: Row | null) =>
  r
    ? {
        id: r.id,
        day_type: r.day_type,
        cardio_type: r.cardio_type,
        duration_minutes: r.duration_minutes,
        frequency_per_week: r.frequency_per_week,
        scheduled_weekdays: r.scheduled_weekdays,
        incline: r.incline,
        speed_min_mph: r.speed_min_mph,
        speed_max_mph: r.speed_max_mph,
        status: r.status,
      }
    : null;

/**
 * Write a treadmill (or the coach's own modality's) plan onto their cardio
 * rows, with the session's caller (RLS: admins and the client's own coach).
 * A non-treadmill row keeps its type and only takes time, frequency and days.
 */
export async function writeCardioPlan(
  sb: any,
  x: { clientId: string; refs: LoadedWeightManagement["refs"]; plan: { trainingDay: TreadmillSession | null; restDay: TreadmillSession | null }; treadmill: boolean; today: string },
): Promise<Array<{ kind: "cardio"; session: "trainingDay" | "restDay"; before: Row | null; after: Row | null }>> {
  const out: Array<{ kind: "cardio"; session: "trainingDay" | "restDay"; before: Row | null; after: Row | null }> = [];
  for (const session of ["trainingDay", "restDay"] as const) {
    const id = session === "trainingDay" ? x.refs.trainingCardioId : x.refs.restCardioId;
    const s = x.plan[session];
    const { data: before } = id ? await sb.from("cardio_targets").select("*").eq("id", id).maybeSingle() : { data: null };
    const now = new Date().toISOString();
    if (!s) {
      if (before && before.status === "Active") {
        const { data: after, error } = await sb.from("cardio_targets").update({ status: "Archived", last_updated_at: now }).eq("id", before.id).select("*").maybeSingle();
        if (error) throw new Error(error.message);
        out.push({ kind: "cardio", session, before: pickRow(before), after: pickRow(after) });
      }
      continue;
    }
    const treadmillFields = x.treadmill
      ? { incline: s.inclinePct, speed_min_mph: Math.round(s.speedMph * 100) / 100, speed_max_mph: Math.round(s.speedMph * 100) / 100, intensity: "Zone 2" }
      : {};
    const fields = {
      duration_minutes: s.minutes,
      frequency_per_week: s.perWeek,
      ...(session === "restDay" ? { scheduled_weekdays: s.weekdays } : {}),
      ...treadmillFields,
      last_updated_at: now,
    };
    if (before) {
      const same =
        before.duration_minutes === fields.duration_minutes &&
        before.frequency_per_week === fields.frequency_per_week &&
        (!x.treadmill || (Number(before.incline) === s.inclinePct && Math.abs(Number(before.speed_min_mph) - s.speedMph) < 0.01)) &&
        (session !== "restDay" || JSON.stringify(before.scheduled_weekdays ?? []) === JSON.stringify(s.weekdays));
      if (same) continue;
      const { data: after, error } = await sb.from("cardio_targets").update(fields).eq("id", before.id).select("*").maybeSingle();
      if (error) throw new Error(error.message);
      out.push({ kind: "cardio", session, before: pickRow(before), after: pickRow(after) });
    } else {
      const { data: after, error } = await sb
        .from("cardio_targets")
        .insert({
          client_id: x.clientId,
          day_type: session === "trainingDay" ? "Training Day" : "Non-Training Day",
          cardio_type: "Incline Treadmill Walk",
          ...fields,
          ...(session === "trainingDay" ? { scheduled_weekdays: s.weekdays } : {}),
          incline: s.inclinePct,
          speed_min_mph: Math.round(s.speedMph * 100) / 100,
          speed_max_mph: Math.round(s.speedMph * 100) / 100,
          intensity: "Zone 2",
          status: "Active",
          enabled: true,
          visible_to_client: true,
          start_date: x.today,
          completion_rule: "any_target",
          source: "coach",
          client_notes: session === "trainingDay" ? "After lifting, never before. Easy: you can talk in full sentences." : "Easy to moderate: breathing harder but you can still talk in full sentences.",
        })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      out.push({ kind: "cardio", session, before: null, after: pickRow(after) });
    }
  }
  return out;
}

/** Water: the day-off target and how much more a training day is, set as the coach's. */
export async function writeWater(sb: any, x: { userId: string; restMl: number; trainingExtraMl: number; setBy: string }): Promise<{ kind: "water"; before: Row | null; after: Row }> {
  const { data: before } = await sb.from("progress_water_targets").select("active_ml, training_extra_ml, target_source, mode").eq("user_id", x.userId).maybeSingle();
  const after = {
    user_id: x.userId,
    active_ml: x.restMl,
    suggested_ml: x.restMl,
    training_extra_ml: x.trainingExtraMl,
    target_source: "coach",
    mode: "custom",
    calc_formula_version: 2,
    last_recalculated_at: new Date().toISOString(),
    set_by_user_id: x.setBy,
  };
  const { error } = await sb.from("progress_water_targets").upsert(after, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { kind: "water", before: before ?? null, after: { active_ml: after.active_ml, training_extra_ml: after.training_extra_ml, target_source: "coach" } };
}
