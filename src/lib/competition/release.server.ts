/**
 * Reviewing, approving and releasing assessments, and the record of each
 * (server only, after the caller's own staff check or from the worker).
 *
 * Release posts one message in the athlete's coach chat with the update as a
 * card (`kind: "competition_update"`), from their coach, automated so it never
 * closes a check-in waiting for review, and pushes them once. A message says
 * the coach completed or approved something only when the coach did: an
 * automatically released routine update says it's an automated preparation
 * update. Releasing the same assessment twice posts once. A newer released
 * version of a game plan marks the older one superseded for the athlete, who
 * is then asked to acknowledge the new one.
 */
import { MILESTONE_BY_KIND } from "./milestones";
import { needsAcknowledgment } from "./lifecycle";

type Db = any;

export async function logEvent(
  sb: Db,
  e: {
    competitionId: string;
    clientId: string;
    assessmentId?: string | null;
    actorId?: string | null;
    actor: "coach" | "athlete" | "system" | "cleo";
    action: string;
    detail?: Record<string, unknown>;
  },
) {
  try {
    await sb.from("competition_events").insert({
      competition_id: e.competitionId,
      client_id: e.clientId,
      assessment_id: e.assessmentId ?? null,
      actor_id: e.actorId ?? null,
      actor: e.actor,
      action: e.action.slice(0, 60),
      detail: e.detail ?? {},
    });
  } catch (err) {
    console.warn("[competition] event not recorded", (err as Error)?.message);
  }
}

async function getAssessment(sb: Db, id: string) {
  const { data, error } = await sb
    .from("competition_assessments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Assessment not found");
  return data;
}

export async function markOpened(sb: Db, id: string, userId: string) {
  const a = await getAssessment(sb, id);
  if (a.coach_opened_at) return a;
  const now = new Date().toISOString();
  const { data } = await sb
    .from("competition_assessments")
    .update({ coach_opened_at: now, coach_opened_by: userId })
    .eq("id", id)
    .is("coach_opened_at", null)
    .select("*")
    .maybeSingle();
  await logEvent(sb, {
    competitionId: a.competition_id,
    clientId: a.client_id,
    assessmentId: id,
    actorId: userId,
    actor: "coach",
    action: "opened",
  });
  return data ?? a;
}

export async function markReviewed(sb: Db, id: string, userId: string) {
  const a = await getAssessment(sb, id);
  if (!["ready", "changes_requested"].includes(a.status)) return a;
  const now = new Date().toISOString();
  await sb
    .from("competition_assessments")
    .update({
      status: "reviewed",
      reviewed_at: now,
      reviewed_by: userId,
      coach_opened_at: a.coach_opened_at ?? now,
      coach_opened_by: a.coach_opened_by ?? userId,
    })
    .eq("id", id);
  await logEvent(sb, {
    competitionId: a.competition_id,
    clientId: a.client_id,
    assessmentId: id,
    actorId: userId,
    actor: "coach",
    action: "reviewed",
  });
  return getAssessment(sb, id);
}

/** The coach asked for changes: the milestone is written again today with their words; this version stays as history. */
export async function requestChanges(sb: Db, id: string, userId: string, note: string | null) {
  const a = await getAssessment(sb, id);
  if (a.status === "released" || a.status === "superseded")
    throw new Error("This version is already released: changes are made on a new version");
  const now = new Date().toISOString();
  await sb
    .from("competition_assessments")
    .update({
      status: "changes_requested",
      changes_requested_at: now,
      changes_requested_by: userId,
      changes_note: note,
    })
    .eq("id", id);
  if (a.milestone_id) {
    const { todayWinnipeg } = await import("./load.server");
    await sb
      .from("competition_milestones")
      .update({
        status: "scheduled",
        due_on: todayWinnipeg(),
        instructions: note,
        attempts: 0,
        progress: null,
        last_error: null,
        why: "Changes requested",
      })
      .eq("id", a.milestone_id);
  }
  await logEvent(sb, {
    competitionId: a.competition_id,
    clientId: a.client_id,
    assessmentId: id,
    actorId: userId,
    actor: "coach",
    action: "changes_requested",
    detail: { note },
  });
}

export async function approve(sb: Db, id: string, userId: string) {
  const a = await getAssessment(sb, id);
  if (a.status === "released" || a.status === "superseded")
    throw new Error("Already released or replaced");
  const now = new Date().toISOString();
  await sb
    .from("competition_assessments")
    .update({
      status: "approved",
      approved_at: now,
      approved_by: userId,
      reviewed_at: a.reviewed_at ?? now,
      reviewed_by: a.reviewed_by ?? userId,
      coach_opened_at: a.coach_opened_at ?? now,
      coach_opened_by: a.coach_opened_by ?? userId,
    })
    .eq("id", id);
  await logEvent(sb, {
    competitionId: a.competition_id,
    clientId: a.client_id,
    assessmentId: id,
    actorId: userId,
    actor: "coach",
    action: "approved",
  });
}

/** The coach's edits to the athlete version (kept on the record with the version before). */
export async function editAthleteVersion(
  sb: Db,
  id: string,
  userId: string,
  patch: {
    title?: string;
    summary?: string;
    focus?: string[];
    expectations?: string[];
    message?: string;
  },
) {
  const a = await getAssessment(sb, id);
  if (a.status === "superseded") throw new Error("This version was replaced");
  const before = a.athlete ?? {};
  const after = { ...before };
  if (patch.title != null) after.title = patch.title.slice(0, 120);
  if (patch.summary != null) after.summary = patch.summary.slice(0, 2000);
  if (patch.focus) after.focus = patch.focus.map((x) => x.slice(0, 300)).slice(0, 6);
  if (patch.expectations)
    after.expectations = patch.expectations.map((x) => x.slice(0, 300)).slice(0, 6);
  if (patch.message != null) after.message = patch.message.slice(0, 300);
  after.edited = true;
  await sb
    .from("competition_assessments")
    .update({
      athlete: after,
      athlete_edited_at: new Date().toISOString(),
      athlete_edited_by: userId,
    })
    .eq("id", id);
  await logEvent(sb, {
    competitionId: a.competition_id,
    clientId: a.client_id,
    assessmentId: id,
    actorId: userId,
    actor: "coach",
    action: "athlete_edited",
    detail: { before: { title: before.title, summary: before.summary, message: before.message } },
  });
}

/** Who the chat message comes from: the client's coach, else whoever approved, else the first admin. */
async function senderFor(
  sb: Db,
  clientId: string,
  fallback: string | null,
): Promise<string | null> {
  const { data: c } = await sb
    .from("clients")
    .select("assigned_coach_id")
    .eq("id", clientId)
    .maybeSingle();
  if (c?.assigned_coach_id) {
    const { data: coach } = await sb
      .from("coaches")
      .select("user_id")
      .eq("id", c.assigned_coach_id)
      .maybeSingle();
    if (coach?.user_id) return coach.user_id;
  }
  if (fallback) return fallback;
  const { data: admin } = await sb
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return admin?.user_id ?? null;
}

export const COMPETITION_CARD_KIND = "competition_update";

export async function release(
  sb: Db,
  id: string,
  opts: { userId: string | null; kind: "approved" | "automated" },
) {
  const a = await getAssessment(sb, id);
  if (a.status === "superseded") throw new Error("This version was replaced by a newer one");
  if (a.needs_approval && opts.kind === "automated")
    throw new Error("This one needs the coach's approval");
  if (a.needs_approval && !a.approved_at && opts.kind === "approved") {
    // releasing an approval-gated assessment is the approval
    await approve(sb, id, opts.userId!);
  }
  const { data: client } = await sb
    .from("clients")
    .select("id, user_id, first_name, preferred_name, full_name")
    .eq("id", a.client_id)
    .maybeSingle();
  const { data: comp } = await sb
    .from("competitions")
    .select("id, name, meet_date")
    .eq("id", a.competition_id)
    .maybeSingle();
  const now = new Date().toISOString();
  const def = MILESTONE_BY_KIND[a.kind as keyof typeof MILESTONE_BY_KIND];
  const plan = a.kind === "game_plan" || a.kind === "confirm";

  // once per assessment
  let messageId: string | null = a.message_id ?? null;
  if (!messageId && client?.user_id) {
    const { data: same } = await sb
      .from("messages")
      .select("id")
      .eq("client_id", a.client_id)
      .contains("attachments", JSON.stringify([{ kind: COMPETITION_CARD_KIND, assessment_id: id }]))
      .limit(1);
    messageId = same?.[0]?.id ?? null;
    if (!messageId) {
      const sender = await senderFor(sb, a.client_id, opts.userId);
      const first =
        client.preferred_name ||
        client.first_name ||
        String(client.full_name ?? "").split(" ")[0] ||
        "there";
      const automated = opts.kind === "automated";
      const body = automated
        ? `Automated preparation update for ${comp?.name ?? "your meet"}: ${a.athlete?.title ?? def.title}.`
        : a.athlete?.message?.trim() ||
          (plan
            ? `Hey ${first}, your game plan for ${comp?.name ?? "the meet"} is ready. Have a read and tap Got it once you've gone through it.`
            : `Hey ${first}, here's your ${def.title.toLowerCase()} for ${comp?.name ?? "the meet"}.`);
      const card = {
        kind: COMPETITION_CARD_KIND,
        assessment_id: id,
        competition_id: a.competition_id,
        milestone: a.kind,
        version: a.version,
        title: a.athlete?.title ?? def.title,
        summary: String(a.athlete?.summary ?? "").slice(0, 400),
        meet: comp?.name ?? null,
        meet_date: comp?.meet_date ?? null,
        automated,
        plan,
        needs_ack: needsAcknowledgment(a.kind),
      };
      const { data: msg, error } = await sb
        .from("messages")
        .insert({
          client_id: a.client_id,
          sender_id: sender,
          sender_role: "admin",
          body,
          attachments: [card],
          message_type: "Competition",
          is_internal_note: false,
          is_automated: true,
          delivery_status: "sent",
          sent_at: now,
          read_by_admin_at: now,
        })
        .select("id")
        .single();
      if (error) throw new Error(`The chat message couldn't be sent: ${error.message}`);
      messageId = msg.id;
    }
  }
  await sb
    .from("competition_assessments")
    .update({
      status: "released",
      released_at: now,
      released_by: opts.userId,
      release_kind: opts.kind,
      message_id: messageId,
      athlete_delivered_at: messageId ? now : null,
    })
    .eq("id", id)
    .neq("status", "released");

  // an older released version of the same plan is now out of date for the athlete
  const kinds = plan ? ["game_plan", "confirm"] : [a.kind];
  await sb
    .from("competition_assessments")
    .update({ superseded_at: now, superseded_by: id })
    .eq("competition_id", a.competition_id)
    .in("kind", kinds)
    .eq("status", "released")
    .neq("id", id)
    .is("superseded_at", null)
    .lt("created_at", a.created_at);

  await logEvent(sb, {
    competitionId: a.competition_id,
    clientId: a.client_id,
    assessmentId: id,
    actorId: opts.userId,
    actor: opts.kind === "automated" ? "system" : "coach",
    action: "released",
    detail: { kind: opts.kind, message_id: messageId },
  });
  if (messageId) {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    await notifyAppEvent(
      sb,
      plan && opts.kind === "approved"
        ? "competition_plan_released"
        : "competition_update_released",
      { clientId: a.client_id, sourceId: id, actorUserId: opts.userId },
    );
  }
  return { messageId };
}

/** The athlete opened or acknowledged a released version (their own login only). */
export async function athleteMark(
  sb: Db,
  id: string,
  clientId: string,
  userId: string,
  what: "opened" | "acknowledged",
) {
  const a = await getAssessment(sb, id);
  if (a.client_id !== clientId || !a.released_at) throw new Error("Not found");
  const now = new Date().toISOString();
  if (what === "opened" && !a.athlete_opened_at) {
    await sb
      .from("competition_assessments")
      .update({ athlete_opened_at: now })
      .eq("id", id)
      .is("athlete_opened_at", null);
    await logEvent(sb, {
      competitionId: a.competition_id,
      clientId,
      assessmentId: id,
      actorId: userId,
      actor: "athlete",
      action: "athlete_opened",
      detail: { version: a.version },
    });
  }
  if (what === "acknowledged" && !a.athlete_acknowledged_at) {
    await sb
      .from("competition_assessments")
      .update({ athlete_acknowledged_at: now, athlete_opened_at: a.athlete_opened_at ?? now })
      .eq("id", id)
      .is("athlete_acknowledged_at", null);
    await logEvent(sb, {
      competitionId: a.competition_id,
      clientId,
      assessmentId: id,
      actorId: userId,
      actor: "athlete",
      action: "athlete_acknowledged",
      detail: { version: a.version },
    });
  }
}
