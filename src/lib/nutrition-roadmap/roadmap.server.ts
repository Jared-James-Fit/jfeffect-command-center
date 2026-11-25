/**
 * The roadmap screens' data, assembled from the loader and the engine, and
 * the writes behind every button. Callers (roadmap.functions.ts) check who's
 * asking before anything here runs with the service role.
 */
import { buildRoadmap } from "@/lib/nutrition-roadmap/build";
import { loadRoadmap, REVISION_SELECT, type LoadedRoadmap, type RevisionRow } from "@/lib/nutrition-roadmap/load.server";
import { activateRevision, evaluateRoadmap, writeMemberTargets } from "@/lib/nutrition-roadmap/evaluate.server";
import { explainRead } from "@/lib/nutrition-roadmap/explain.server";
import { athleteSees, planChangeInstruction, sortBoard, type BoardRow, type CoachRoadmapView, type PendingRevision, type RevisionSummary, type RoadmapView } from "@/lib/nutrition-roadmap/view";
import { compareRoadmaps } from "@/lib/nutrition-roadmap/build";
import type { CheckinAsk, Decision } from "@/lib/nutrition-roadmap/types";
import { addDays } from "@/lib/weight-management/units";

const summaryOf = (r: RevisionRow): RevisionSummary => ({
  id: r.id,
  createdAt: r.created_at,
  trigger: r.trigger,
  status: r.status,
  summary: r.summary,
  changes: Array.isArray(r.changes) ? r.changes.map(String) : [],
  autoApplied: !!r.auto_applied,
  decidedAt: r.decided_at,
  note: r.decision_note,
});

const pendingOf = (r: RevisionRow | null): PendingRevision | null =>
  r ? { ...summaryOf(r), decider: r.decider, plan: r.plan, proposal: (r.proposal as Decision | null) ?? null } : null;

async function history(sb: any, clientId: string, forAthlete: boolean): Promise<RevisionSummary[]> {
  try {
    const { data } = await sb.from("nutrition_roadmap_revisions").select(REVISION_SELECT).eq("client_id", clientId).order("created_at", { ascending: false }).limit(forAthlete ? 40 : 20);
    const rows = (data ?? []) as RevisionRow[];
    return (forAthlete ? rows.filter(athleteSees).slice(0, 20) : rows).map(summaryOf);
  } catch {
    return [];
  }
}

export function assemble(loaded: LoadedRoadmap, hist: RevisionSummary[], opts: { canEdit: boolean; coach: boolean }): RoadmapView {
  const { fresh, read } = buildRoadmap(loaded.ctx);
  const plannable = !!fresh.goal && fresh.startKg != null;
  // a coached athlete sees nothing until their coach approved it; the coach sees the draft; a self-coached athlete their own
  const state: RoadmapView["state"] = loaded.active ? "ready" : !plannable ? "no_goal" : opts.coach || loaded.selfCoached ? "ready" : "waiting_coach";
  const wm = loaded.wm;
  const today = loaded.ctx.today;
  const due = loaded.selfCoached && state === "ready" && (!!loaded.checkinDue || read.checkin.on <= today);
  const ag = loaded.row?.athlete_goal ?? null;
  return {
    state,
    clientId: loaded.clientId,
    selfCoached: loaded.selfCoached,
    firstName: loaded.firstName,
    unit: wm.input.unit,
    sex: wm.input.sex,
    read: state === "ready" ? read : null,
    explanation: loaded.active?.explanation?.summary ? { summary: String(loaded.active.explanation.summary), focus: String(loaded.active.explanation.focus ?? "") } : null,
    activeRevisionId: loaded.active?.id ?? null,
    pending: opts.coach || loaded.pending?.decider === "athlete" ? pendingOf(loaded.pending) : null,
    history: hist,
    checkin: {
      due,
      dueOn: loaded.checkinDue?.due_on ?? (state === "ready" ? read.checkin.on : null),
      asks: ((loaded.checkinDue?.asks ?? read.checkin.asks ?? []) as CheckinAsk[]).filter(Boolean),
      reason: loaded.checkinDue?.reason ?? read.checkin.reason ?? null,
    },
    series: wm.input.weighIns.filter((p) => p.date >= addDays(today, -183)),
    consent: !!loaded.row?.auto_adjust,
    goal: {
      type: wm.client.goal.type,
      value: wm.client.goal.value,
      unit: wm.client.goalUnit ?? wm.client.unit,
      date: wm.client.goal.date,
      meet: ag?.date ? { name: ag.name ?? null, date: ag.date, weightClass: ag.weightClass ?? null, federation: ag.federation ?? null, sport: ag.sport ?? "powerlifting" } : null,
    },
    canEdit: opts.canEdit,
    current: loaded.ctx.current,
    missing: read.plan.missing,
  };
}

/** The athlete's own view. A self-coached athlete with a goal and no roadmap gets one built now. */
export async function myRoadmapView(_sb: any, admin: any, clientId: string, opts: { canEdit: boolean }): Promise<RoadmapView> {
  // read on the server: the caller is already checked to be this athlete (or staff previewing them), and
  // `assemble` only hands out what an athlete may see; a coached athlete can't read the roadmap tables
  // directly (the coach's draft and decision stay the coach's until approved)
  const sb = admin;
  let loaded = await loadRoadmap(sb, clientId);
  if (opts.canEdit && loaded.selfCoached && !loaded.active) {
    const { fresh } = buildRoadmap(loaded.ctx);
    if (fresh.goal && fresh.startKg != null) {
      await evaluateRoadmap(admin, clientId, { trigger: "open" });
      loaded = await loadRoadmap(sb, clientId);
    }
  }
  return assemble(loaded, await history(sb, clientId, true), { canEdit: opts.canEdit, coach: false });
}

/** The coach's view: a first draft is made the first time there's something to plan. */
export async function coachRoadmapView(sb: any, admin: any, clientId: string): Promise<CoachRoadmapView> {
  let loaded = await loadRoadmap(sb, clientId);
  const first = buildRoadmap(loaded.ctx);
  if (!loaded.active && !loaded.pending && first.fresh.goal && first.fresh.startKg != null && !loaded.archived) {
    await evaluateRoadmap(admin, clientId, { trigger: "coach" });
    loaded = await loadRoadmap(sb, clientId);
  }
  const view = assemble(loaded, await history(sb, clientId, false), { canEdit: true, coach: true });
  const { fresh } = buildRoadmap(loaded.ctx);
  const diff = loaded.active ? compareRoadmaps(loaded.active.plan, fresh, loaded.ctx.today) : null;
  const p = loaded.row?.prefs ?? {};
  return {
    ...view,
    prefs: { everyDays: p.everyDays ?? null, lockCompetition: !!p.lockCompetition, reminders: p.reminders !== false },
    draft: diff?.meaningful && (!loaded.pending || loaded.pending.hash !== fresh.hash) ? { plan: fresh, changes: diff.changes } : null,
  };
}

/** Approve or decline a revision. Approving makes it the one in effect; a self-coached athlete's targets are written then. */
export async function decideRevision(admin: any, revision: RevisionRow, decision: "approve" | "reject", by: string, note: string | null): Promise<{ ok: true; instruction: string | null; targetsWritten: boolean }> {
  if (revision.status !== "proposed") throw new Error("This one has already been decided.");
  if (decision === "reject") {
    const { error } = await admin.from("nutrition_roadmap_revisions").update({ status: "rejected", decided_by: by, decided_at: new Date().toISOString(), decision_note: note }).eq("id", revision.id).eq("status", "proposed");
    if (error) throw new Error(error.message);
    await admin.from("nutrition_roadmaps").update({ needs_coach: false }).eq("client_id", revision.client_id);
    return { ok: true, instruction: null, targetsWritten: false };
  }
  const proposal = (revision.proposal as Decision | null) ?? null;
  let targetsWritten = false;
  let instruction: string | null = null;
  if (proposal?.next) {
    if (revision.decider === "athlete") {
      const { data: c } = await admin.from("clients").select("user_id").eq("id", revision.client_id).maybeSingle();
      const { data: m } = c?.user_id ? await admin.from("app_members").select("id").eq("user_id", c.user_id).maybeSingle() : { data: null };
      if (m?.id) {
        const current = revision.plan.blocks.find((b) => b.status === "current") ?? null;
        const res = await writeMemberTargets(admin, m.id, proposal.next, { revisionId: revision.id, block: current?.kind ?? null });
        await admin.from("nutrition_roadmap_revisions").update({ applied: { targets: res } }).eq("id", revision.id);
        targetsWritten = true;
      }
    } else {
      // a coached athlete's plan changes through its own reviewed path (Change it with AI)
      const current = revision.plan.blocks.find((b) => b.start <= new Date().toISOString().slice(0, 10) && b.end >= new Date().toISOString().slice(0, 10)) ?? null;
      instruction = planChangeInstruction(proposal, current?.title ?? null);
    }
  }
  if (note) await admin.from("nutrition_roadmap_revisions").update({ decision_note: note }).eq("id", revision.id);
  await activateRevision(admin, revision.client_id, revision.id, by);
  await admin.from("nutrition_roadmaps").update({ needs_coach: false }).eq("client_id", revision.client_id);
  return { ok: true, instruction, targetsWritten };
}

/** The words for the roadmap in effect, written once and kept. */
export async function explainActive(admin: any, clientId: string): Promise<{ summary: string; focus: string } | null> {
  const loaded = await loadRoadmap(admin, clientId);
  const active = loaded.active;
  if (!active) return null;
  if (active.explanation?.summary) return { summary: String(active.explanation.summary), focus: String(active.explanation.focus ?? "") };
  // the athlete's numbers go to OpenAI only with their permission (5.1.2(i), src/lib/ai-consent); without it
  // (or when it can't be read) nobody is asked and the engine's own words stand
  const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
  if (!(await clientAllowsAi(clientId)).ok) return null;
  const { read } = buildRoadmap(loaded.ctx);
  const words = await explainRead(admin, read, { approved: true, firstName: loaded.firstName });
  if (!words) return null;
  await admin.from("nutrition_roadmap_revisions").update({ explanation: words, explained_at: new Date().toISOString() }).eq("id", active.id);
  return { summary: words.summary, focus: words.focus };
}

/** Every coached athlete with a roadmap, what needs the coach first. */
export async function roadmapBoard(sb: any): Promise<BoardRow[]> {
  const { data: rows } = await sb.from("nutrition_roadmaps").select("client_id, status, status_headline, needs_coach, decision, next_checkin_on, active_revision_id").limit(500);
  const list = (rows ?? []) as any[];
  if (!list.length) return [];
  const ids = list.map((r) => r.client_id);
  const [{ data: clients }, { data: pending }] = await Promise.all([
    sb.from("clients").select("id, first_name, last_name, preferred_name, full_name, service_tier, archived").in("id", ids),
    sb.from("nutrition_roadmap_revisions").select("client_id, trigger").in("client_id", ids).eq("status", "proposed"),
  ]);
  const byId = new Map(((clients ?? []) as any[]).map((c) => [c.id, c]));
  const waiting = new Map(((pending ?? []) as any[]).map((p) => [p.client_id, p.trigger === "initial" ? "first" : "change"] as const));
  const out: BoardRow[] = [];
  for (const r of list) {
    const c = byId.get(r.client_id);
    if (!c || c.archived || c.service_tier !== "coaching") continue;
    const name = c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.preferred_name || "Client";
    const action = r.decision?.action;
    out.push({
      clientId: r.client_id,
      name,
      status: r.status ?? null,
      headline: r.status_headline ?? null,
      needsCoach: !!r.needs_coach,
      decision: action && action !== "hold" ? String(r.decision?.headline ?? "") : null,
      nextCheckinOn: r.next_checkin_on ?? null,
      waiting: (waiting.get(r.client_id) as BoardRow["waiting"]) ?? null,
    });
  }
  return sortBoard(out);
}
