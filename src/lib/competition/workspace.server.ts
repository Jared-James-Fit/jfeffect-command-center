/**
 * What the Competition tab reads (server only, the service role after the
 * caller's staff check): the athlete's competitions, suggestions from what's
 * already on file (a dated meet prep, their approved competition plan), and
 * for the competition on screen the live brief (computed now from the
 * records, no AI), its schedule, assessments, field, resources, record and
 * meet-day log.
 */
import { buildBrief, type Brief } from "./brief";
import { loadCompetitionContext, readMeets, readObservations, todayWinnipeg } from "./load.server";
import { readRules, rulesFor } from "./rules";
import { readDebrief } from "./debrief";
import type { MeetLevel } from "./types";

type Db = any;

export type Suggestion = {
  key: string;
  source: "prep" | "plan";
  prepId: string | null;
  name: string;
  date: string;
  federation: string | null;
  weightClass: string | null;
  division: string | null;
  level: MeetLevel | null;
  registered: boolean | null;
};

/** The meet's level from its name and federation (the same reading as the careers' SQL). */
export function levelFromName(
  name: string | null | undefined,
  federation?: string | null,
): MeetLevel {
  const n = String(name ?? "");
  const f = String(federation ?? "");
  if (
    /^(ipf|napf|commonwealthpf|epf)$/i.test(f) ||
    /\b(worlds?|commonwealth|north american|pan ?am(erican)?|arnold|asian|european|oceania|african)\b/i.test(
      n,
    )
  )
    return "international";
  if (
    /\bnationals\b/i.test(n) ||
    /\bnational (raw |classic |open )*championships?\b/i.test(n) ||
    (/\bcanadian (powerlifting |classic |open |raw )*championships?\b/i.test(n) &&
      !/\b(western|eastern|central|atlantic) canadian\b/i.test(n))
  )
    return "national";
  if (
    /\b(western|eastern|central|atlantic) canadian\b/i.test(n) ||
    /\b(easterns|westerns|regionals?|prairies?)\b/i.test(n)
  )
    return "regional";
  if (
    /\bprovincials?\b/i.test(n) ||
    /\bstate (powerlifting |raw |classic )*championships?\b/i.test(n)
  )
    return "provincial";
  return "local";
}

export async function suggestionsFor(
  sb: Db,
  clientId: string,
  existing: Array<{ prep_id: string | null; meet_date: string }>,
  today = todayWinnipeg(),
): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  const linked = new Set(existing.map((c) => c.prep_id).filter(Boolean));
  const dates = new Set(existing.map((c) => String(c.meet_date)));
  const { data: preps } = await sb
    .from("pl_preps")
    .select(
      "id, title, event_name, event_date, federation, division, weight_class, status, archived",
    )
    .eq("client_id", clientId)
    .eq("archived", false)
    .gte("event_date", today)
    .limit(20);
  for (const p of preps ?? []) {
    if (!p.event_date || linked.has(p.id) || dates.has(String(p.event_date))) continue;
    if (p.status && !["Active", "Planned"].includes(p.status)) continue;
    const name = p.event_name || p.title;
    out.push({
      key: `prep:${p.id}`,
      source: "prep",
      prepId: p.id,
      name,
      date: String(p.event_date),
      federation: p.federation ?? null,
      weightClass: p.weight_class ?? null,
      division: p.division ?? null,
      level: levelFromName(name, p.federation),
      registered: null,
    });
    dates.add(String(p.event_date));
  }
  const { data: plans } = await sb
    .from("athlete_competition_plans")
    .select("plan, status, created_at")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);
  const plan = plans?.[0]?.plan;
  const { data: profile } = await sb
    .from("athlete_competition_profiles")
    .select("weight_class")
    .eq("client_id", clientId)
    .maybeSingle();
  for (const m of [plan?.primary, ...((plan?.meets ?? []) as any[])]) {
    if (!m?.date || m.date < today || dates.has(String(m.date))) continue;
    const name = m.name || m.level || "Meet";
    out.push({
      key: `plan:${m.date}:${name}`,
      source: "plan",
      prepId: null,
      name,
      date: String(m.date),
      federation: m.federation ?? null,
      weightClass: profile?.weight_class ?? null,
      division: null,
      level: levelFromName(name, m.federation),
      registered: typeof m.registered === "boolean" ? m.registered : null,
    });
    dates.add(String(m.date));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const ASSESSMENT_LIST_COLS =
  "id, kind, version, status, urgency, needs_approval, headline, coach_message, call, created_at, coach_opened_at, reviewed_at, approved_at, released_at, release_kind, athlete_opened_at, athlete_acknowledged_at, athlete_delivered_at, superseded_at, changes_note, model";

export async function loadWorkspace(sb: Db, clientId: string, competitionId: string | null) {
  const { data: comps, error } = await sb
    .from("competitions")
    .select(
      "id, name, meet_date, meet_end_date, status, is_primary, level, federation, weight_class, live, prep_id",
    )
    .eq("client_id", clientId)
    .order("meet_date", { ascending: false });
  if (error) throw new Error(error.message);
  const list = (comps ?? []) as any[];
  const suggestions = await suggestionsFor(sb, clientId, list);
  const today = todayWinnipeg();
  const pick =
    (competitionId && list.find((c) => c.id === competitionId)) ||
    list.find((c) => c.is_primary && c.status === "upcoming") ||
    [...list]
      .filter((c) => c.status === "upcoming")
      .sort((a, b) => String(a.meet_date).localeCompare(String(b.meet_date)))[0] ||
    list[0] ||
    null;
  if (!pick) return { today, competitions: list, suggestions, selected: null };

  const [
    { data: comp },
    { data: milestones },
    { data: assessments },
    { data: competitors },
    { data: resources },
    { data: events },
    { data: meetLog },
  ] = await Promise.all([
    sb.from("competitions").select("*").eq("id", pick.id).maybeSingle(),
    sb
      .from("competition_milestones")
      .select("id, kind, seq, due_on, status, attempts, last_error, why, assessment_id, done_at")
      .eq("competition_id", pick.id)
      .order("due_on"),
    sb
      .from("competition_assessments")
      .select(ASSESSMENT_LIST_COLS)
      .eq("competition_id", pick.id)
      .order("created_at", { ascending: false })
      .limit(80),
    sb
      .from("competition_competitors")
      .select(
        "id, name, sex, weight_class, federation, country, opl_slug, instagram, identity, contenders, meets, meets_fetched_at, fetch_error, observations, notes, bodyweight_kg, source, field_status",
      )
      .eq("competition_id", pick.id)
      .eq("archived", false)
      .order("created_at"),
    sb
      .from("competition_resources")
      .select("id, kind, title, url, body, document_id, extracted, created_at")
      .eq("competition_id", pick.id)
      .order("created_at", { ascending: false })
      .limit(100),
    sb
      .from("competition_events")
      .select("id, actor, action, detail, at, assessment_id")
      .eq("competition_id", pick.id)
      .order("at", { ascending: false })
      .limit(60),
    sb
      .from("competition_meet_log")
      .select(
        "id, entrant, lift, attempt, kg, result, rpe, velocity, note, source, logged_at, client_key",
      )
      .eq("competition_id", pick.id)
      .order("logged_at"),
  ]);
  let brief: Brief | null = null;
  let briefError: string | null = null;
  try {
    const { ctx } = await loadCompetitionContext(sb, pick.id, { today });
    brief = buildBrief(ctx);
  } catch (e: any) {
    briefError = String(e?.message ?? e);
  }
  // a finished meet's debrief against the plan the coach confirmed
  let debrief = null;
  if (comp?.results) {
    const confirmed = (assessments ?? []).find(
      (a: any) =>
        (a.kind === "confirm" || a.kind === "game_plan") &&
        (a.status === "approved" || a.status === "released"),
    );
    let plan = null;
    if (confirmed) {
      const { data: full } = await sb
        .from("competition_assessments")
        .select("internal")
        .eq("id", confirmed.id)
        .maybeSingle();
      const { confirmedPlan } = await import("./proposals");
      plan = confirmedPlan(full?.internal) as any;
    }
    debrief = readDebrief(plan, comp.results);
  }
  // preparation and handling: the gameplan, the timeline, the checklist (prep.server.ts)
  let prep = null;
  let prepError: string | null = null;
  try {
    const { loadPrep } = await import("./prep.server");
    prep = await loadPrep(sb, pick.id, { brief, coach: true });
  } catch (e: any) {
    prepError = String(e?.message ?? e);
  }
  return {
    today,
    competitions: list,
    suggestions,
    selected: {
      competition: {
        ...comp,
        rules: readRules(comp?.rules, comp?.federation),
        defaultRules: rulesFor(comp?.federation),
      },
      brief,
      briefError,
      milestones: milestones ?? [],
      assessments: assessments ?? [],
      competitors: (competitors ?? []).map((c: any) => ({
        ...c,
        meets: readMeets(c.meets),
        observations: readObservations(c.observations),
      })),
      resources: resources ?? [],
      events: events ?? [],
      meetLog: meetLog ?? [],
      debrief,
      prep,
      prepError,
    },
  };
}

/** Every coaching client's competitions that need the coach, for the dashboard and Messages. */
export async function loadOverview(sb: Db, clientIds: string[] | null) {
  const today = todayWinnipeg();
  let q = sb
    .from("competitions")
    .select("id, client_id, name, meet_date, meet_end_date, status, is_primary, level, live, watch")
    .in("status", ["upcoming", "completed"])
    .gte("meet_date", today.slice(0, 4) + "-01-01")
    .order("meet_date")
    .limit(300);
  if (clientIds)
    q = q.in("client_id", clientIds.length ? clientIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: comps, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (comps ?? []).map((c: any) => c.id);
  const [{ data: open }, { data: clients }, { data: due }] = await Promise.all([
    ids.length
      ? sb
          .from("competition_assessments")
          .select(
            "id, competition_id, client_id, kind, version, status, urgency, needs_approval, headline, coach_message, created_at, coach_opened_at, released_at, athlete_acknowledged_at, superseded_at, call",
          )
          .in("competition_id", ids)
          .neq("status", "superseded")
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
    sb
      .from("clients")
      .select("id, full_name, first_name, preferred_name, archived")
      .in(
        "id",
        [...new Set((comps ?? []).map((c: any) => c.client_id))].concat([
          "00000000-0000-0000-0000-000000000000",
        ]),
      ),
    ids.length
      ? sb
          .from("competition_milestones")
          .select("competition_id, kind, due_on, status, last_error")
          .in("competition_id", ids)
          .in("status", ["scheduled", "generating", "waiting_ai", "failed"])
          .order("due_on")
      : Promise.resolve({ data: [] }),
  ]);
  const name = new Map(
    (clients ?? [])
      .filter((c: any) => !c.archived)
      .map((c: any) => [c.id, c.full_name || c.preferred_name || c.first_name || "Athlete"]),
  );
  return {
    today,
    competitions: (comps ?? [])
      .filter((c: any) => name.has(c.client_id))
      .map((c: any) => ({ ...c, athlete: name.get(c.client_id) })),
    assessments: (open ?? []).filter((a: any) => name.has(a.client_id)),
    nextMilestones: due ?? [],
  };
}
