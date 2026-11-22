/**
 * Reads one athlete's roadmap against today and keeps what it decided: the
 * status and the next check-in on nutrition_roadmaps, a new revision only
 * when the journey really changed, a due check-in reminded once, the coach
 * told only when they're needed. Runs with the service role (the daily hook,
 * a submitted check-in, a saved goal, a coach's refresh), after the caller's
 * own checks.
 *
 * What it never does: change a coached athlete's targets (the coach approves,
 * and the change goes through the plan's own reviewed path), change a
 * self-coached athlete's targets without their yes (or, for small routine
 * steps, their standing consent), push a draft a coach hasn't approved to the
 * athlete, or tell anyone about the same thing twice.
 */
import { hashOf } from "@/lib/weight-management/assessment";
import { daysBetween } from "@/lib/weight-management/units";
import { buildRoadmap, compareRoadmaps } from "@/lib/nutrition-roadmap/build";
import { loadRoadmap, REVISION_SELECT, type LoadedRoadmap, type RevisionRow } from "@/lib/nutrition-roadmap/load.server";
import { ROADMAP_VERSION, type Decision, type Macros, type RoadmapPlan, type RoadmapRead } from "@/lib/nutrition-roadmap/types";

export type EvaluateTrigger = "tick" | "checkin" | "goal_change" | "coach" | "open";

export type Evaluation = {
  loaded: LoadedRoadmap;
  fresh: RoadmapPlan;
  read: RoadmapRead;
  created: RevisionRow | null;
  /** A self-coached athlete's targets changed by themselves (their consent). */
  autoApplied: boolean;
};

const goalChanged = (changes: string[]) => changes.some((c) => /^(Goal|Target|Date|Weight class)/.test(c));

/** The decision as the row keeps it. */
const decisionSummary = (d: Decision) => ({ action: d.action, headline: d.headline, approval: d.approval, kcalChange: d.kcalChange, next: d.next, other: d.other.slice(0, 3), reasons: d.reasons.slice(0, 3) });

/** A self-coached athlete's new targets, the old ones kept as history (member_nutrition_targets). */
export async function writeMemberTargets(admin: any, memberId: string, next: Macros, note: { revisionId: string; block: string | null }): Promise<{ before: Macros | null; after: Macros }> {
  const { data: prev } = await admin.from("member_nutrition_targets").select("id, calories, protein_g, carbs_g, fat_g, water_ml, goal").eq("member_id", memberId).eq("active", true).maybeSingle();
  const before = prev ? { kcal: Number(prev.calories), proteinG: Number(prev.protein_g), carbsG: Number(prev.carbs_g), fatG: Number(prev.fat_g) } : null;
  const goal = before && next.kcal < before.kcal - 50 ? "lose" : before && next.kcal > before.kcal + 50 ? "gain" : (prev?.goal ?? "maintain");
  if (prev?.id) {
    const { error } = await admin.from("member_nutrition_targets").update({ active: false }).eq("id", prev.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await admin.from("member_nutrition_targets").insert({
    member_id: memberId,
    // the table's own source (no schema change); the snapshot says it came from the roadmap
    source: "calculated",
    goal,
    calories: next.kcal,
    protein_g: next.proteinG,
    carbs_g: next.carbsG,
    fat_g: next.fatG,
    water_ml: prev?.water_ml ?? null,
    input_snapshot: { source: "roadmap", roadmap_revision_id: note.revisionId, block: note.block },
    active: true,
    pending_review: false,
  });
  if (error) {
    // put the old ones back rather than leave them with none
    if (prev?.id) await admin.from("member_nutrition_targets").update({ active: true }).eq("id", prev.id);
    throw new Error(error.message);
  }
  return { before, after: next };
}

async function insertRevision(admin: any, row: Record<string, unknown>): Promise<RevisionRow | null> {
  const { data, error } = await admin.from("nutrition_roadmap_revisions").insert({ engine_version: ROADMAP_VERSION, ...row }).select(REVISION_SELECT).maybeSingle();
  if (error) {
    // the same plan already waiting or in effect (the unique live hash): nothing new to say
    if (/duplicate|unique/i.test(String(error.message))) return null;
    throw new Error(error.message);
  }
  return data as RevisionRow;
}

/** Make a revision the one in effect: the one before is superseded. */
export async function activateRevision(admin: any, clientId: string, revisionId: string, decidedBy: string | null) {
  await admin.from("nutrition_roadmap_revisions").update({ status: "superseded" }).eq("client_id", clientId).eq("status", "active").neq("id", revisionId);
  const { error } = await admin.from("nutrition_roadmap_revisions").update({ status: "active", decided_by: decidedBy, decided_at: new Date().toISOString() }).eq("id", revisionId);
  if (error) throw new Error(error.message);
  await admin.from("nutrition_roadmaps").upsert({ client_id: clientId, active_revision_id: revisionId }, { onConflict: "client_id" });
}

export async function evaluateRoadmap(admin: any, clientId: string, opts: { trigger: EvaluateTrigger; actorUserId?: string | null; today?: string }): Promise<Evaluation> {
  const loaded = await loadRoadmap(admin, clientId, { today: opts.today });
  const { ctx } = loaded;
  const today = ctx.today;
  const { fresh, read } = buildRoadmap(ctx);
  const plannable = !!fresh.goal && fresh.startKg != null;
  const decider = loaded.selfCoached ? "athlete" : "coach";
  let created: RevisionRow | null = null;
  let autoApplied = false;
  let pending = loaded.pending;

  const supersedePending = async () => {
    if (pending) {
      await admin.from("nutrition_roadmap_revisions").update({ status: "superseded" }).eq("id", pending.id).eq("status", "proposed");
      pending = null;
    }
  };

  if (plannable && !loaded.archived) {
    if (!loaded.active) {
      // a first roadmap: a self-coached athlete's own plan is in effect at once (its targets still wait on their yes);
      // a coached athlete's waits on the coach, and nothing reaches the athlete until then
      if (!pending || pending.hash !== fresh.hash) {
        await supersedePending();
        created = await insertRevision(admin, {
          client_id: clientId,
          trigger: opts.trigger === "goal_change" ? "goal_change" : "initial",
          status: "proposed",
          decider,
          plan: fresh,
          hash: fresh.hash,
          summary: fresh.feasibility.headline,
          changes: ["A first roadmap."],
          proposal: !loaded.selfCoached && read.decision.kcalChange != null ? read.decision : null,
        });
        if (created && loaded.selfCoached) {
          await activateRevision(admin, clientId, created.id, loaded.userId);
          created = { ...created, status: "active" };
        }
      }
    } else {
      const diff = compareRoadmaps(loaded.active.plan, fresh, today);
      const sustainedOff = (loaded.row?.off_plan_days ?? 0) >= 14;
      // the daily read only reforecasts for a changed goal, a sustained drift or missed check-ins; a check-in, a coach or a goal save always may
      const allowed = opts.trigger !== "tick" || goalChanged(diff.changes) || sustainedOff || ctx.missedCheckins >= 2;
      if (diff.meaningful && allowed && (!pending || pending.hash !== fresh.hash)) {
        const goalChange = goalChanged(diff.changes);
        const curA = loaded.active.plan.blocks.find((b) => b.start <= today && b.end >= today);
        const curF = fresh.blocks.find((b) => b.start <= today && b.end >= today);
        const currentMoves = !curA || !curF || curA.kind !== curF.kind || Math.abs(curA.energy.engine.kcal - curF.energy.engine.kcal) >= 150;
        // a forecast refresh a self-coached athlete let apply by itself: only when nothing they eat now changes
        const auto = loaded.selfCoached && ctx.consent && !goalChange && !currentMoves && !fresh.safety.flags.length;
        await supersedePending();
        created = await insertRevision(admin, {
          client_id: clientId,
          trigger: goalChange ? "goal_change" : opts.trigger === "checkin" ? "checkin" : opts.trigger === "coach" ? "coach" : "reforecast",
          status: "proposed",
          decider,
          plan: fresh,
          hash: fresh.hash,
          summary: diff.changes.join(" ").slice(0, 1500),
          changes: diff.changes,
          proposal: read.decision.kcalChange != null ? read.decision : null,
          auto_applied: auto,
        });
        if (created && auto) {
          await activateRevision(admin, clientId, created.id, null);
          created = { ...created, status: "active" };
          autoApplied = true;
        }
      }
    }

    // a target change with no change to the plan: an adjustment, approved like any other
    // (and a self-coached athlete's brand-new roadmap offers its first targets the same way)
    const d = read.decision;
    const inEffect = created?.status === "active" ? created : loaded.active;
    const fresh1st = !!created && created.status === "active" && created.trigger !== "adjustment";
    // the change the coach already approved, still being carried into the plan: never asked again
    const approved = inEffect?.proposal as Decision | null | undefined;
    const sameAsApproved = !!approved?.next && !!d.next && Math.abs(approved.next.kcal - d.next.kcal) <= 50 && !!inEffect?.decided_at && daysBetween(String(inEffect.decided_at).slice(0, 10), today) <= 21;
    if ((!created || fresh1st) && inEffect && !sameAsApproved && d.kcalChange != null && d.next && d.action !== "hold" && (d.kcalChange !== 0 || !ctx.current)) {
      const hash = hashOf(["adjust", inEffect.hash, d.kcalChange, d.next.kcal, d.next.proteinG]);
      if (!pending || pending.hash !== hash) {
        await supersedePending();
        const apply = loaded.selfCoached && d.autoEligible && !!loaded.memberId;
        const made = await insertRevision(admin, {
          client_id: clientId,
          trigger: "adjustment",
          status: "proposed",
          decider,
          plan: inEffect.plan,
          hash,
          summary: d.headline,
          changes: [d.headline, ...d.reasons.slice(0, 2)],
          proposal: d,
          auto_applied: apply,
        });
        if (made) created = made;
        if (made && apply) {
          const res = await writeMemberTargets(admin, loaded.memberId!, d.next, { revisionId: made.id, block: read.currentBlock?.kind ?? null });
          await admin.from("nutrition_roadmap_revisions").update({ applied: { targets: res } }).eq("id", made.id);
          await activateRevision(admin, clientId, made.id, null);
          created = { ...made, status: "active" };
          autoApplied = true;
        }
      }
    }
  }

  // the row: today's status, the next check-in, what the coach needs
  const off = ["behind", "ahead", "needs_attention"].includes(read.progress.status);
  const offDays = off ? (opts.trigger === "tick" ? (loaded.row?.off_plan_days ?? 0) + 1 : (loaded.row?.off_plan_days ?? 0)) : 0;
  const waiting = !!created ? created.status === "proposed" : !!pending;
  const needsCoach = !loaded.selfCoached && (waiting || read.progress.status === "needs_attention" || ["investigate", "escalate", "reconsider"].includes(read.decision.action));
  const hasRoadmap = !!loaded.active || !!created || !!pending;
  if (hasRoadmap || loaded.row) {
    await admin.from("nutrition_roadmaps").upsert(
      {
        client_id: clientId,
        status: read.progress.status,
        status_headline: read.progress.headline.slice(0, 300),
        status_detail: read.progress.detail.slice(0, 1500),
        decision: decisionSummary(read.decision),
        needs_coach: needsCoach,
        next_checkin_on: read.checkin.on,
        next_checkin_kind: read.checkin.kind,
        next_checkin_reason: read.checkin.reason.slice(0, 400),
        asks: read.checkin.asks,
        last_evaluated_at: new Date().toISOString(),
        off_plan_days: offDays,
        engine_version: ROADMAP_VERSION,
      },
      { onConflict: "client_id" },
    );
  }

  if (opts.trigger === "tick" && hasRoadmap && !loaded.archived) await remindAndFlag(admin, loaded, read, created, needsCoach, today);
  else if (created && loaded.selfCoached && created.status === "proposed") await notify(admin, "roadmap_update_ready", clientId, created.id);

  return { loaded, fresh, read, created, autoApplied };
}

async function notify(admin: any, event: "roadmap_review_ready" | "roadmap_checkin_due" | "roadmap_update_ready", clientId: string, sourceId: string) {
  try {
    const { notifyAppEvent } = await import("@/lib/push/app-events.server");
    return await notifyAppEvent(admin, event, { clientId, sourceId });
  } catch (e) {
    console.warn("[roadmap] push failed", event, e);
    return { sent: 0 };
  }
}

/** The daily read's reminders: one push for a due check-in, the coach only for what needs them, never twice. */
async function remindAndFlag(admin: any, loaded: LoadedRoadmap, read: RoadmapRead, created: RevisionRow | null, needsCoach: boolean, today: string) {
  const clientId = loaded.clientId;
  const row = loaded.row;
  if (loaded.selfCoached) {
    const reminders = row?.prefs?.reminders !== false;
    if (read.checkin.on <= today) {
      // one open check-in at a time; one left far past its date counts as missed and a new one opens
      const open = loaded.checkinDue;
      const stale = open && daysBetween(open.due_on, today) >= Math.max(7, read.checkin.cadenceDays);
      if (!open || stale) {
        await admin.from("nutrition_roadmap_checkins").upsert(
          { client_id: clientId, due_on: today, kind: read.checkin.kind, reason: read.checkin.reason.slice(0, 400), asks: read.checkin.asks },
          { onConflict: "client_id,due_on", ignoreDuplicates: true },
        );
      }
      const last = row?.last_reminded_on ?? null;
      if (reminders && (!last || daysBetween(last, today) >= 2)) {
        const r = await notify(admin, "roadmap_checkin_due", clientId, `${clientId}:${today}`);
        if (r.sent > 0) await admin.from("nutrition_roadmaps").update({ last_reminded_on: today }).eq("client_id", clientId);
      }
    }
    if (created && created.status === "proposed") await notify(admin, "roadmap_update_ready", clientId, created.id);
    return;
  }
  // coached: the coach hears about a change to approve or a real risk, at most every 3 days, and never for a first draft
  const worth = (created && created.trigger !== "initial" && created.status === "proposed") || read.progress.status === "needs_attention" || read.decision.action === "escalate";
  const lastFlag = row?.last_flagged_on ?? null;
  if (needsCoach && worth && (!lastFlag || daysBetween(lastFlag, today) >= 3)) {
    const r = await notify(admin, "roadmap_review_ready", clientId, created?.id ?? `${clientId}:${today}`);
    if (r.sent > 0) await admin.from("nutrition_roadmaps").update({ last_flagged_on: today }).eq("client_id", clientId);
  }
}

/** Every athlete the daily read covers: coaching clients with a goal or a plan, and anyone with a roadmap. */
export async function roadmapClientIds(admin: any): Promise<string[]> {
  const [coaching, withRow] = await Promise.all([
    admin.from("clients").select("id, archived, status, bodyweight_goal_type").eq("service_tier", "coaching").eq("archived", false),
    admin.from("nutrition_roadmaps").select("client_id"),
  ]);
  const ids = new Set<string>();
  const coached = (coaching.data ?? []).filter((c: any) => !/deactivated|deleted/i.test(String(c.status ?? "")));
  const coachedIds = coached.map((c: any) => c.id as string);
  if (coachedIds.length) {
    const { data: plans } = await admin.from("nutrition_targets").select("client_id").in("client_id", coachedIds).neq("status", "Archived");
    const withPlan = new Set((plans ?? []).map((p: any) => p.client_id as string));
    for (const c of coached) if (c.bodyweight_goal_type || withPlan.has(c.id)) ids.add(c.id);
  }
  for (const r of withRow.data ?? []) ids.add(r.client_id as string);
  return [...ids];
}

export async function runRoadmapTick(admin: any): Promise<{ clients: number; created: number; failed: number }> {
  const ids = await roadmapClientIds(admin);
  let created = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const e = await evaluateRoadmap(admin, id, { trigger: "tick" });
      if (e.created) created++;
    } catch (err) {
      failed++;
      console.error("[roadmap] tick failed", id, (err as Error)?.message);
    }
  }
  return { clients: ids.length, created, failed };
}
