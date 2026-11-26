/**
 * Athlete Intelligence on the server (server only; callers check who's
 * asking first): sources and their files, the fact store (deduped, every
 * slot worked out again whenever a source changes), the competition
 * re-evaluation after new information, the rare question and its answer, the
 * gameplan recommendations, and the athlete-specific contributor links.
 *
 * Writes keep the rules the pure modules state: a prescribed set is never
 * made completed except by an answer, a correction never overwrites what was
 * read (the original is kept and can be restored), an approved gameplan
 * never changes (a recommendation is a new draft version for the coach to
 * approve), and nothing contacts anyone by itself.
 */
import { buildFindings, buildRecommendations, type Recommendation } from "./findings";
import { correctedFrom, dedupeKey, resolveFacts } from "./facts";
import { gameplanIntel } from "./engine-input";
import { decideQuestions, questionsToShow, requestMessage, type Question } from "./questions";
import type { Fact, FactData, Lift, Provider, RawFact, SourceRow, TrainingData } from "./types";
import { toKg } from "./types";
import { fileKindOf, MAX_FILE_BYTES, MAX_VIDEO_BYTES, RIGHTS_TEXT, safeName } from "./uploads";
import { loadFacts, rowToFact } from "./fact-store.server";

type Db = any;

export const INTEL_BUCKET = "athlete-intel";
export const SITE = "https://jfeffect.com";
/** A deleted source waits this long in Recently deleted. */
export const DELETED_DAYS = 30;
export const LINK_DAYS = 30;

export const SOURCE_COLS =
  "id, client_id, competition_id, kind, file_name, file_path, mime, bytes, content_hash, provider, provider_name, purposes, detected_purposes, context, status, status_before_delete, error, attempts, retry_at, summary, method, replaces_id, replaced_by, uploaded_by, via_link_id, start_date, unit_answer, completion_answer, deleted_at, analyzed_at, created_at, updated_at";

export function todayWinnipeg(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export { rowToFact, loadFacts };

/** Every slot's current fact worked out again; statuses written where they changed. */
export async function recompute(sb: Db, clientId: string) {
  const facts = await loadFacts(sb, clientId, ["active", "superseded"]);
  const res = resolveFacts(facts);
  const changes = facts.filter((f) => res.status.get(f.id) !== f.status);
  for (const f of changes) {
    await sb
      .from("athlete_intel_facts")
      .update({ status: res.status.get(f.id), status_reason: res.status.get(f.id) === "superseded" ? res.why.get(f.id) ?? null : null })
      .eq("id", f.id)
      .neq("status", "dismissed");
  }
  const active = facts.filter((f) => res.status.get(f.id) === "active").map((f) => ({ ...f, status: "active" as const }));
  return { active, conflicts: res.conflicts, changed: changes.length };
}

export async function logIntel(
  sb: Db,
  e: { clientId: string; competitionId?: string | null; sourceId?: string | null; factId?: string | null; questionId?: string | null; actorId?: string | null; actor: "coach" | "athlete" | "contributor" | "system" | "cleo"; action: string; detail?: Record<string, unknown> },
) {
  try {
    await sb.from("athlete_intel_events").insert({
      client_id: e.clientId,
      competition_id: e.competitionId ?? null,
      source_id: e.sourceId ?? null,
      fact_id: e.factId ?? null,
      question_id: e.questionId ?? null,
      actor_id: e.actorId ?? null,
      actor: e.actor,
      action: e.action.slice(0, 60),
      detail: e.detail ?? {},
    });
  } catch (err) {
    console.warn("[athlete-intel] event not recorded", (err as Error)?.message);
  }
}

/* ------------------------------------------------------------------ */
/* Storing facts                                                      */

/** A source's settled answers applied to what was read from it (so a re-read keeps them). */
export function applySourceAnswers(raws: RawFact[], src: { unit_answer?: string | null; completion_answer?: string | null; start_date?: string | null }): RawFact[] {
  return raws.map((f) => {
    if (f.kind !== "training") return f;
    const t = { ...(f.data as TrainingData) };
    let date = f.date;
    if (src.unit_answer && t.load != null && !t.unit) {
      t.unit = src.unit_answer as "kg" | "lb";
      t.loadKg = toKg(t.load, t.unit);
    }
    if (src.completion_answer && t.completion === "unknown") t.completion = src.completion_answer as TrainingData["completion"];
    if (!date && src.start_date && t.week != null) {
      const d = new Date(`${src.start_date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + (t.week - 1) * 7 + Math.min(6, Math.max(0, ((t.day ?? 1) - 1) * 2)));
      date = d.toISOString().slice(0, 10);
    }
    return { ...f, date, data: t };
  });
}

/** What was read from a source, stored: duplicates of a fact already on file are merged into it, never stored twice. */
export async function storeFacts(sb: Db, src: any, raws: RawFact[], actorId: string | null): Promise<{ added: number; merged: number }> {
  const byKey = new Map<string, any>();
  for (const raw of raws) {
    // a hint read from the file names who wrote a note; it never makes an attempt plan or warm-ups "their coach's"
    // (that would confirm them on the gameplan), which only the person uploading can say
    const hinted = src.provider === "unknown" && raw.providerHint && raw.kind !== "attempt_plan" && raw.kind !== "warmup";
    const provider: Provider = hinted ? raw.providerHint! : src.provider;
    const scope = raw.scope ?? "athlete";
    if ((raw.data as any)?.meetLogistics && !src.competition_id) continue;
    const competition_id = scope === "meet" ? src.competition_id ?? null : null;
    const key = dedupeKey({ kind: raw.kind, lift: raw.lift, date: raw.date, data: raw.data, scope }, competition_id);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      client_id: src.client_id,
      competition_id,
      source_id: src.id,
      kind: raw.kind,
      lift: raw.lift,
      date: raw.date,
      data: raw.data,
      quote: raw.quote?.slice(0, 400) ?? null,
      location: raw.location?.slice(0, 120) ?? null,
      confidence: raw.confidence,
      scope,
      provider,
      provider_name: provider === src.provider ? src.provider_name ?? null : null,
      basis: "source",
      status: "active",
      dedupe_key: key.slice(0, 600),
      received_at: src.created_at,
      created_by: actorId,
    });
  }
  const keys = [...byKey.keys()];
  const existing = new Map<string, any>();
  for (let i = 0; i < keys.length; i += 150) {
    const { data } = await sb
      .from("athlete_intel_facts")
      .select("id, dedupe_key, source_id, also_sources")
      .eq("client_id", src.client_id)
      .in("dedupe_key", keys.slice(i, i + 150));
    for (const r of data ?? []) existing.set(r.dedupe_key, r);
  }
  const fresh = keys.filter((k) => !existing.has(k)).map((k) => byKey.get(k));
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await sb.from("athlete_intel_facts").upsert(fresh.slice(i, i + 200), { onConflict: "client_id,dedupe_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  let merged = 0;
  for (const [, r] of existing) {
    if (r.source_id === src.id || (r.also_sources ?? []).includes(src.id)) continue;
    await sb.from("athlete_intel_facts").update({ also_sources: [...(r.also_sources ?? []), src.id] }).eq("id", r.id);
    merged++;
  }
  return { added: fresh.length, merged };
}

/** A source's own read facts taken off (before it's read again); facts others also said move to them. */
export async function clearSourceFacts(sb: Db, sourceId: string, clientId: string) {
  const { data } = await sb
    .from("athlete_intel_facts")
    .select("id, source_id, also_sources, basis")
    .eq("client_id", clientId)
    .or(`source_id.eq.${sourceId},also_sources.cs.{${sourceId}}`);
  for (const r of (data ?? []) as any[]) {
    const others = ((r.also_sources ?? []) as string[]).filter((x) => x !== sourceId);
    if (r.source_id !== sourceId) {
      await sb.from("athlete_intel_facts").update({ also_sources: others }).eq("id", r.id);
    } else if (r.basis !== "source") {
      continue; // the coach's own corrections and answers stay
    } else if (others.length) {
      await sb.from("athlete_intel_facts").update({ source_id: others[0], also_sources: others.slice(1) }).eq("id", r.id);
    } else {
      await sb.from("athlete_intel_facts").delete().eq("id", r.id).eq("basis", "source");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Who to tell                                                        */

/** The handler (for a handled meet) else the athlete's assigned coach: whose phone hears about it. */
export async function staffFor(sb: Db, clientId: string, competitionId: string | null): Promise<string | null> {
  if (competitionId) {
    const { data: h } = await sb.from("competition_handling").select("handler_user_id, status").eq("competition_id", competitionId).maybeSingle();
    if (h?.handler_user_id && h.status !== "cancelled") return h.handler_user_id;
  }
  const { data: c } = await sb.from("clients").select("assigned_coach_id").eq("id", clientId).maybeSingle();
  if (!c?.assigned_coach_id) return null;
  const { data: co } = await sb.from("coaches").select("user_id").eq("id", c.assigned_coach_id).maybeSingle();
  return co?.user_id ?? null;
}

async function push(sb: Db, userId: string | null, payload: { title: string; body: string; url: string; tag: string }, key: string, urgent = false) {
  if (!userId) return;
  try {
    const { sendWebPushToUser } = await import("@/lib/push/push.server");
    await sendWebPushToUser(sb, userId, payload, { eventKey: key, ...(urgent ? { priority: "urgent" as const } : {}) });
  } catch (e: any) {
    console.warn("[athlete-intel] push failed", e?.message);
  }
}

export const intelUrl = (clientId: string, competitionId: string | null) =>
  `/admin/clients/${clientId}?tab=competition${competitionId ? `&competition=${competitionId}` : ""}&intel=1`;

/* ------------------------------------------------------------------ */
/* Re-evaluating after new information                                */

/** Every upcoming competition's live read worked out again (best effort); the expected total before and after for each. */
export async function reevaluate(sb: Db, clientId: string): Promise<Array<{ competitionId: string; before: number | null; after: number | null; queued: boolean }>> {
  const { data: comps } = await sb.from("competitions").select("*").eq("client_id", clientId).eq("status", "upcoming").order("meet_date").limit(6);
  const out = [];
  const { refreshLive } = await import("@/lib/competition/worker.server");
  for (const c of (comps ?? []) as any[]) {
    try {
      out.push({ competitionId: c.id, ...(await refreshLive(sb, c)) });
    } catch (e: any) {
      console.warn("[athlete-intel] re-evaluation failed", c.id, e?.message);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Questions                                                          */

async function questionInputBase(sb: Db, clientId: string, today: string) {
  const [facts, { data: srcs }, { data: settled }, { data: meets }, { data: client }] = await Promise.all([
    loadFacts(sb, clientId),
    sb.from("athlete_intel_sources").select("id, file_name, kind, provider, provider_name, created_at, status, summary, start_date, unit_answer").eq("client_id", clientId).limit(500),
    sb.from("athlete_intel_questions").select("key, fingerprint, status, competition_id").eq("client_id", clientId).in("status", ["answered", "dismissed"]).limit(1000),
    sb
      .from("athlete_powerlifting_results")
      .select("meet_date, squat_kg, bench_kg, deadlift_kg")
      .eq("client_id", clientId)
      .gte("meet_date", (() => {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        return d.toISOString().slice(0, 10);
      })())
      .limit(40),
    sb.from("clients").select("id, user_id").eq("id", clientId).maybeSingle(),
  ]);
  const { loadLiftEvidence } = await import("@/lib/competition/load.server");
  const appEvidence = await loadLiftEvidence(sb, clientId, today).catch(() => null);
  const meetBestKg: Partial<Record<Lift, number>> = {};
  for (const m of (meets ?? []) as any[])
    for (const [lift, col] of [["squat", "squat_kg"], ["bench", "bench_kg"], ["deadlift", "deadlift_kg"]] as const) {
      const v = Number(m[col]);
      if (v > 0) meetBestKg[lift] = Math.max(meetBestKg[lift] ?? 0, v);
    }
  // uploaded meets in the last year count as well
  for (const f of facts) {
    if (f.kind !== "meet" || !f.date) continue;
    const d: any = f.data;
    for (const lift of ["squat", "bench", "deadlift"] as const) if (d[lift] > 0) meetBestKg[lift] = Math.max(meetBestKg[lift] ?? 0, d[lift]);
  }
  const app: Partial<Record<Lift, { nowKg: number | null; hardSessions6w: number }>> = {};
  for (const lift of ["squat", "bench", "deadlift"] as const)
    if (appEvidence?.[lift]) app[lift] = { nowKg: appEvidence[lift].nowKg, hardSessions6w: appEvidence[lift].hardSessions6w };
  return { facts, srcs: (srcs ?? []) as any[], settled: (settled ?? []) as any[], meetBestKg, app, client };
}

/**
 * The questions worth asking now for each of the athlete's upcoming meets:
 * stored once (so asking, answering and not asking twice can be tracked),
 * open ones nothing raises any more resolved by themselves, and the handler
 * told only about a time-sensitive one (the meet within a week).
 */
export async function syncQuestions(sb: Db, clientId: string, o: { today?: string; notify?: boolean } = {}) {
  const today = o.today ?? todayWinnipeg();
  const base = await questionInputBase(sb, clientId, today);
  const { data: comps } = await sb
    .from("competitions")
    .select("id, meet_date, rules, federation, status, athlete_info")
    .eq("client_id", clientId)
    .eq("status", "upcoming")
    .limit(6);
  const { readRules } = await import("@/lib/competition/rules");
  const { readAthleteInfo } = await import("@/lib/competition/athlete-info");
  const res = resolveFacts(base.facts);
  const { data: open } = await sb.from("athlete_intel_questions").select("id, key, competition_id, fingerprint").eq("client_id", clientId).eq("status", "open");
  const raised = new Set<string>();
  const fresh: Array<{ q: Question; competitionId: string; meetDate: string }> = [];
  for (const c of (comps ?? []) as any[]) {
    const info = readAthleteInfo(c.athlete_info);
    const { data: h } = await sb.from("competition_handling").select("share_with_coach, status").eq("competition_id", c.id).maybeSingle();
    const attemptsSetBy: Record<string, any> = {};
    if (info.attemptsBy === "me" || info.attemptsBy === "my_coach")
      for (const lift of ["squat", "bench", "deadlift"] as const) {
        const a = info.attempts?.[lift];
        if (a?.[0] != null) attemptsSetBy[lift] = { opener: a[0], by: info.attemptsBy };
      }
    for (const f of base.facts)
      if (f.kind === "attempt_plan" && f.lift && f.provider === "primary_coach" && !attemptsSetBy[f.lift] && (f.competition_id === c.id || f.competition_id == null))
        attemptsSetBy[f.lift] = { opener: (f.data as any).opener, by: "my_coach" };
    const facts = base.facts.filter((f) => f.competition_id == null || f.competition_id === c.id);
    const qs = decideQuestions({
      today,
      meet: { id: c.id, date: String(c.meet_date).slice(0, 10), incrementKg: readRules(c.rules, c.federation).incrementKg },
      facts,
      conflicts: res.conflicts.filter((x) => x.facts.every((f) => f.competition_id == null || f.competition_id === c.id)),
      sources: base.srcs.map((s) => ({ ...s, unitUnknown: !!s.summary?.unitUnknown && !s.unit_answer, startDate: s.start_date })),
      app: base.app,
      meetBestKg: base.meetBestKg,
      attemptsSetBy,
      coachContactOk: !h || h.status === "cancelled" ? false : h.share_with_coach === "yes",
      athleteReachable: !!base.client?.user_id,
      settled: base.settled.filter((s) => s.competition_id === c.id).map((s) => ({ key: s.key, fingerprint: s.fingerprint, status: s.status })),
    });
    for (const q of qs) {
      raised.add(`${c.id}|${q.key}`);
      const row = (open ?? []).find((x: any) => x.key === q.key && x.competition_id === c.id);
      const fields = {
        fingerprint: q.fingerprint,
        area: q.area,
        text: q.text.slice(0, 600),
        why: q.why.slice(0, 400),
        answer_spec: q.answer,
        ask_who: q.askWho,
        priority: q.priority,
        visible_from: q.visibleFrom,
        source_id: q.sourceId,
        fact_ids: q.factIds,
        lift: q.lift,
      };
      if (row) {
        if (row.fingerprint !== q.fingerprint) await sb.from("athlete_intel_questions").update(fields).eq("id", row.id);
      } else {
        const { data: ins } = await sb
          .from("athlete_intel_questions")
          .upsert({ client_id: clientId, competition_id: c.id, key: q.key, status: "open", ...fields }, { onConflict: "client_id,competition_id,key", ignoreDuplicates: true })
          .select("id")
          .maybeSingle();
        if (ins?.id) {
          fresh.push({ q, competitionId: c.id, meetDate: String(c.meet_date).slice(0, 10) });
          await logIntel(sb, { clientId, competitionId: c.id, questionId: ins.id, actor: "cleo", action: "question_raised", detail: { key: q.key, area: q.area } });
        }
      }
    }
  }
  // what nothing raises any more was settled by new information
  for (const r of (open ?? []) as any[]) {
    if (raised.has(`${r.competition_id}|${r.key}`)) continue;
    await sb.from("athlete_intel_questions").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", r.id).eq("status", "open");
    await logIntel(sb, { clientId, competitionId: r.competition_id, questionId: r.id, actor: "system", action: "question_resolved", detail: { key: r.key, by: "new_information" } });
  }
  // only a time-sensitive one interrupts anyone
  if (o.notify !== false)
    for (const f of fresh) {
      const days = Math.round((Date.parse(`${f.meetDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
      if (days > 7 || f.q.visibleFrom > today) continue;
      const to = await staffFor(sb, clientId, f.competitionId);
      await push(sb, to, { title: "One thing to confirm before the meet", body: f.q.text.slice(0, 160), url: intelUrl(clientId, f.competitionId), tag: `intel-q-${clientId}` }, `intel_q:${clientId}:${f.q.key}`, days <= 2);
    }
  return { raised: raised.size };
}

/* ------------------------------------------------------------------ */
/* Answers                                                            */

export type AnswerInput = { value: string; number?: number | null; date?: string | null; note?: string | null };

/** An answer applied as facts, so whatever raised the question is settled; the question never comes back. */
export async function answerQuestion(sb: Db, q: any, a: AnswerInput, by: { userId: string | null; role: "handler" | "athlete" | "primary_coach" | "other_coach" }) {
  const now = new Date().toISOString();
  const key = String(q.key);
  const provider: Provider = by.role === "handler" ? "handler" : by.role;
  const dismissedStatus = a.value === "unknown";
  if (key.startsWith("conflict:attempts:") || key.startsWith("conflict:rack:")) {
    if (!dismissedStatus) {
      const others = ((q.fact_ids ?? []) as string[]).filter((id) => id !== a.value);
      if (others.length)
        await sb.from("athlete_intel_facts").update({ status: "dismissed", status_reason: "Not current (answered)" }).in("id", others).eq("client_id", q.client_id);
    }
  } else if (key.startsWith("conflict:onboarding:")) {
    if (!dismissedStatus) {
      const { data: coachFact } = await sb.from("athlete_intel_facts").select("*").eq("id", q.fact_ids?.[0]).maybeSingle();
      if (coachFact) {
        const f = rowToFact(coachFact);
        const { data: comp } = await sb.from("competitions").select("athlete_info").eq("id", q.competition_id).maybeSingle();
        const own = (comp?.athlete_info?.attempts ?? {})[f.lift as string] as Array<number | null> | undefined;
        const data: FactData =
          a.value === "coach" ? f.data : { opener: own?.[0] ?? null, second: own?.[1] ?? null, third: own?.[2] ?? null };
        await insertAnswerFact(sb, { ...f, provider: a.value === "coach" ? f.provider : "athlete" }, data, by.userId);
      }
    }
  } else if (key.startsWith("risk:")) {
    const { data: rf } = await sb.from("athlete_intel_facts").select("*").eq("id", q.fact_ids?.[0]).maybeSingle();
    if (rf && !dismissedStatus) {
      const f = rowToFact(rf);
      const label = a.value === "resolved" ? "No longer an issue" : a.value === "limiting" ? "Still limiting" : "Still there, manageable";
      await insertAnswerFact(
        sb,
        { ...f, date: todayWinnipeg(), provider },
        { text: `${label}${a.note ? `: ${a.note.slice(0, 200)}` : ""}`, place: (f.data as any).place ?? null, status: a.value === "resolved" ? "resolved" : "current" },
        by.userId,
      );
    }
  } else if (key.startsWith("completion:") || key.startsWith("unit:") || key.startsWith("start_date:")) {
    const sourceId = key.split(":")[1];
    const patch: Record<string, unknown> = {};
    if (key.startsWith("completion:") && (a.value === "completed" || a.value === "prescribed")) patch.completion_answer = a.value;
    if (key.startsWith("unit:") && (a.value === "kg" || a.value === "lb")) patch.unit_answer = a.value;
    if (key.startsWith("start_date:") && a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date)) patch.start_date = a.date;
    if (Object.keys(patch).length) {
      await sb.from("athlete_intel_sources").update(patch).eq("id", sourceId).eq("client_id", q.client_id);
      await reapplySourceAnswers(sb, sourceId, q.client_id);
    }
  } else if (key.startsWith("single:")) {
    const { data: sf } = await sb.from("athlete_intel_facts").select("*").eq("id", q.fact_ids?.[0]).maybeSingle();
    if (sf && (a.value === "yes" || (a.value === "other" && a.number && a.number > 0))) {
      const f = rowToFact(sf);
      const t = f.data as TrainingData;
      const kg = a.value === "other" ? a.number! : t.loadKg!;
      await insertAnswerFact(sb, { ...f, provider }, { ...t, load: kg, unit: "kg", loadKg: kg, rpe: null, completion: "completed" }, by.userId);
    }
  }
  await sb
    .from("athlete_intel_questions")
    .update({ status: dismissedStatus ? "dismissed" : "answered", answer: a, answered_by: by.userId, answered_role: by.role, answered_at: now })
    .eq("id", q.id);
  await logIntel(sb, {
    clientId: q.client_id,
    competitionId: q.competition_id,
    questionId: q.id,
    actorId: by.userId,
    actor: by.role === "handler" ? "coach" : by.role === "athlete" ? "athlete" : "contributor",
    action: dismissedStatus ? "question_skipped" : "question_answered",
    detail: { key, value: a.value },
  });
  await afterChange(sb, q.client_id);
}

async function insertAnswerFact(sb: Db, f: Fact, data: FactData, userId: string | null) {
  const row = correctedFrom(f, data);
  const { id: _id, ...rest } = { ...row, id: undefined } as any;
  await sb.from("athlete_intel_facts").upsert(
    {
      client_id: rest.client_id,
      competition_id: rest.competition_id,
      source_id: rest.source_id,
      kind: rest.kind,
      lift: rest.lift,
      date: rest.date,
      data: rest.data,
      quote: rest.quote,
      location: rest.location,
      confidence: "high",
      scope: rest.scope,
      provider: rest.provider,
      provider_name: rest.provider_name,
      basis: "answer",
      status: "active",
      dedupe_key: `${rest.dedupe_key}|answer`.slice(0, 600),
      received_at: new Date().toISOString(),
      corrects_id: f.id,
      created_by: userId,
    },
    { onConflict: "client_id,dedupe_key" },
  );
}

/** A source's facts brought in line with its answers (unit, completion, start date), in place. */
export async function reapplySourceAnswers(sb: Db, sourceId: string, clientId: string) {
  const { data: src } = await sb.from("athlete_intel_sources").select("unit_answer, completion_answer, start_date, competition_id").eq("id", sourceId).maybeSingle();
  if (!src) return;
  const { data: rows } = await sb.from("athlete_intel_facts").select("*").eq("source_id", sourceId).eq("basis", "source").eq("kind", "training");
  for (const r of (rows ?? []) as any[]) {
    const f = rowToFact(r);
    const [next] = applySourceAnswers([f], src);
    if (JSON.stringify(next.data) === JSON.stringify(f.data) && next.date === f.date) continue;
    const key = dedupeKey({ kind: f.kind, lift: f.lift, date: next.date, data: next.data, scope: f.scope }, f.competition_id);
    const { error } = await sb.from("athlete_intel_facts").update({ data: next.data, date: next.date, dedupe_key: key }).eq("id", f.id);
    // the corrected version already exists (another file said it): this one merges into it
    if (error?.code === "23505") await sb.from("athlete_intel_facts").delete().eq("id", f.id);
  }
}

/** After any change: slots worked out again, the meets re-read, questions settled. */
export async function afterChange(sb: Db, clientId: string) {
  await recompute(sb, clientId);
  const impacts = await reevaluate(sb, clientId);
  await syncQuestions(sb, clientId).catch((e) => console.warn("[athlete-intel] questions failed", e?.message));
  return impacts;
}

/* ------------------------------------------------------------------ */
/* Corrections                                                        */

/** The coach corrects a fact: the original is kept (dismissed, restorable) and the correction is current. */
export async function correctFact(sb: Db, factId: string, data: FactData, patch: { date?: string | null; lift?: Lift | null }, userId: string) {
  const { data: r } = await sb.from("athlete_intel_facts").select("*").eq("id", factId).maybeSingle();
  if (!r) throw new Error("That fact isn't there any more");
  const f = rowToFact(r);
  const row = correctedFrom(f, data, patch);
  if (row.dedupe_key === f.dedupe_key) return { id: f.id, unchanged: true };
  const { data: ins, error } = await sb
    .from("athlete_intel_facts")
    .insert({
      client_id: f.client_id,
      competition_id: f.competition_id,
      source_id: f.source_id,
      kind: f.kind,
      lift: row.lift,
      date: row.date,
      data: row.data,
      quote: f.quote,
      location: f.location,
      confidence: "high",
      scope: f.scope,
      provider: f.provider,
      provider_name: f.provider_name,
      basis: "coach",
      status: "active",
      dedupe_key: `${row.dedupe_key}|coach`.slice(0, 600),
      received_at: new Date().toISOString(),
      corrects_id: f.id,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.code === "23505" ? "That's already on file" : error.message);
  await sb.from("athlete_intel_facts").update({ status: "dismissed", status_reason: "Corrected by the coach" }).eq("id", f.id);
  await logIntel(sb, { clientId: f.client_id, competitionId: f.competition_id, factId: ins.id, actorId: userId, actor: "coach", action: "fact_corrected", detail: { from: f.id } });
  await afterChange(sb, f.client_id);
  return { id: ins.id, unchanged: false };
}

/** Dismiss a fact (it stops counting), or bring a dismissed one back (a correction undone restores what it replaced). */
export async function setFactDismissed(sb: Db, factId: string, dismissed: boolean, userId: string) {
  const { data: r } = await sb.from("athlete_intel_facts").select("id, client_id, competition_id, corrects_id, basis, status").eq("id", factId).maybeSingle();
  if (!r) throw new Error("That fact isn't there any more");
  await sb.from("athlete_intel_facts").update({ status: dismissed ? "dismissed" : "active", status_reason: dismissed ? "Dismissed by the coach" : null }).eq("id", factId);
  // undoing a correction or an answer puts the original back
  if (dismissed && r.corrects_id && r.basis !== "source")
    await sb.from("athlete_intel_facts").update({ status: "active", status_reason: null }).eq("id", r.corrects_id).eq("status", "dismissed");
  await logIntel(sb, { clientId: r.client_id, competitionId: r.competition_id, factId, actorId: userId, actor: "coach", action: dismissed ? "fact_dismissed" : "fact_restored" });
  await afterChange(sb, r.client_id);
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                    */

/** The chosen recommendations as a new draft gameplan version (the approved one never changes). */
export async function applyRecommendations(sb: Db, competitionId: string, keys: string[], userId: string) {
  const { loadPrep, insertVersion } = await import("@/lib/competition/prep.server");
  const { readGameplan } = await import("@/lib/competition/gameplan");
  const prep = await loadPrep(sb, competitionId, { coach: true });
  const approved = prep.plans.approved;
  if (!approved) throw new Error("There's no approved gameplan: the draft already reads this information");
  const facts = await loadFacts(sb, prep.competition.client_id);
  const intel = gameplanIntel(facts, competitionId);
  const recs = buildRecommendations(intel, approved.plan as any).filter((r) => keys.includes(r.key));
  if (!recs.length) return null;
  const plan = readGameplan(JSON.parse(JSON.stringify(approved.plan)));
  const SRC: Record<string, any> = { primary_coach: "existing_coach", athlete: "athlete" };
  for (const r of recs) {
    const l = r.lift as Lift | null;
    if (r.area === "attempts" && l && intel.attempts[l]) {
      const c = intel.attempts[l]!;
      plan.attempts[l] = { opener: c.opener, second: c.second, third: c.third, status: "confirmed", source: SRC[c.by] ?? "coach", note: c.by === "primary_coach" ? `Set by their coach (${c.label})` : "Their own plan" };
    }
    if (r.area === "warmups" && l && intel.warmups[l]) {
      const rows = intel.warmups[l]!.rows.filter((x) => x.kg != null) as Array<{ kg: number; reps: number }>;
      plan.warmups[l] = { rows: rows.map((x, i) => ({ kg: x.kg, reps: x.reps, minutesBefore: null, note: i === rows.length - 1 ? "Last warm-up" : null })), status: "confirmed", source: SRC[intel.warmups[l]!.by] ?? "coach" };
    }
    if (r.area === "equipment" && (l === "squat" || l === "bench")) {
      const rk = intel.racks[l];
      if (rk) plan.equipment.racks[l] = { ...plan.equipment.racks[l], ...rk } as any;
    }
    if (r.area === "cues" && l) plan.cues[l] = [...new Set([...(plan.cues[l] ?? []), ...(intel.cues[l] ?? [])])].slice(0, 4);
    if (r.area === "instructions") plan.instructions = [...new Set([...plan.instructions, ...intel.instructions])].slice(0, 8);
  }
  const v = await insertVersion(sb, prep.competition, plan, {
    source: "cleo",
    status: "draft",
    actorUserId: userId,
    basedOn: approved.id,
    summary: `From uploaded information: ${recs.map((r) => r.text).join("; ")}`.slice(0, 600),
  });
  await logIntel(sb, { clientId: prep.competition.client_id, competitionId, actorId: userId, actor: "coach", action: "recommendations_drafted", detail: { keys } });
  return v;
}

/* ------------------------------------------------------------------ */
/* The read for the screens                                           */

export async function loadIntel(sb: Db, clientId: string, competitionId: string | null, o: { staffView?: boolean } = {}) {
  const today = todayWinnipeg();
  const [{ data: srcRows }, facts, { data: qRows }, { data: links }, comp] = await Promise.all([
    sb.from("athlete_intel_sources").select(SOURCE_COLS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(200),
    loadFacts(sb, clientId, ["active", "superseded", "dismissed"]),
    sb.from("athlete_intel_questions").select("*").eq("client_id", clientId).order("priority", { ascending: false }).limit(200),
    sb.from("athlete_intel_links").select("id, role, name, expires_at, revoked_at, opened_at, last_used_at, uploads, competition_id, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(20),
    competitionId ? sb.from("competitions").select("id, name, meet_date, status, session_label, flight, weigh_in_at, lifting_start, location, division, equipment_event, weight_class").eq("id", competitionId).eq("client_id", clientId).maybeSingle().then((r: any) => r.data) : Promise.resolve(null),
  ]);
  const active = facts.filter((f) => f.status === "active" && (f.competition_id == null || f.competition_id === competitionId));
  const sources = ((srcRows ?? []) as any[]).filter((s) => s.status !== "deleted" && (!competitionId || !s.competition_id || s.competition_id === competitionId));
  const deleted = ((srcRows ?? []) as any[]).filter((s) => s.status === "deleted" && (!competitionId || !s.competition_id || s.competition_id === competitionId));
  const findings = buildFindings(active, today, { meetDate: comp?.status === "upcoming" ? String(comp.meet_date).slice(0, 10) : null });
  let recommendations: Recommendation[] = [];
  if (competitionId) {
    try {
      const { data: approved } = await sb.from("competition_gameplans").select("plan").eq("competition_id", competitionId).eq("status", "approved").maybeSingle();
      if (approved) {
        const { readGameplan } = await import("@/lib/competition/gameplan");
        recommendations = buildRecommendations(gameplanIntel(active, competitionId), readGameplan(approved.plan) as any);
      }
    } catch {
      recommendations = [];
    }
  }
  const qs = ((qRows ?? []) as any[]).filter((q) => q.competition_id === competitionId || competitionId == null);
  const openQs = qs
    .filter((q) => q.status === "open")
    .map((q) => ({ id: q.id, key: q.key, text: q.text, why: q.why, answer: q.answer_spec, askWho: q.ask_who, priority: q.priority, visibleFrom: q.visible_from, askedVia: q.asked_via, askedAt: q.asked_at, lift: q.lift }));
  const shown = questionsToShow(openQs as any, today);
  let consent: { ok: boolean; name: string | null } = { ok: true, name: null };
  if (sources.some((s) => s.status === "waiting_consent")) {
    const { clientAllowsAi } = await import("@/lib/ai-consent/consent.server");
    consent = await clientAllowsAi(clientId).catch(() => ({ ok: false, name: null }));
  }
  return {
    today,
    sources,
    deleted,
    facts: facts.filter((f) => f.competition_id == null || f.competition_id === competitionId).slice(-600),
    findings,
    recommendations,
    meetLogistics: o.staffView && comp ? (await import("./meet-files")).meetFileProposals(active, sources, comp) : [],
    questions: { now: shown.now, later: shown.later, deferred: shown.deferred },
    answered: qs.filter((q) => q.status === "answered").slice(0, 20).map((q) => ({ id: q.id, text: q.text, answer: q.answer, answered_at: q.answered_at, answered_role: q.answered_role })),
    links: o.staffView ? ((links ?? []) as any[]).filter((l) => !l.revoked_at && Date.parse(l.expires_at) > Date.now()) : [],
    pending: sources.filter((s) => ["uploading", "queued", "reading", "waiting_ai"].includes(s.status)).length,
    consent,
  };
}

/* ------------------------------------------------------------------ */
/* Contributor links                                                  */

function linkSecret(): string {
  const s = process.env.INTEL_LINK_SECRET || process.env.HANDLING_INVITE_SECRET || process.env.SETUP_INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Links can't be made: no server secret configured.");
  return s;
}
// Web Crypto (not Node's "crypto"): this module is reachable from lazily loaded browser chunks through
// the client brief, and a Node built-in there breaks the web build. Same HMAC-SHA256 / SHA-256 either way.
const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export async function linkToken(id: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(linkSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`athlete-intel-link:v1:${id}:${nonce}`));
  return b64url(new Uint8Array(sig)).slice(0, 32);
}
export async function hashToken(t: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createLink(sb: Db, o: { clientId: string; competitionId: string | null; role: "primary_coach" | "athlete" | "other_coach"; name: string | null; userId: string }) {
  const id = crypto.randomUUID();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const token = await linkToken(id, nonce);
  const expires = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
  const { error } = await sb.from("athlete_intel_links").insert({
    id,
    client_id: o.clientId,
    competition_id: o.competitionId,
    role: o.role,
    name: o.name?.slice(0, 120) ?? null,
    token_hash: await hashToken(token),
    nonce,
    expires_at: expires,
    created_by: o.userId,
  });
  if (error) throw new Error(error.message);
  await logIntel(sb, { clientId: o.clientId, competitionId: o.competitionId, actorId: o.userId, actor: "coach", action: "link_created", detail: { role: o.role } });
  return { id, url: `${SITE}/share/${token}`, expiresAt: expires };
}

export async function resolveLink(sb: Db, token: string): Promise<{ state: "ok" | "expired" | "revoked" | "invalid"; row: any | null }> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return { state: "invalid", row: null };
  const { data: row } = await sb.from("athlete_intel_links").select("*").eq("token_hash", await hashToken(token)).maybeSingle();
  if (!row) return { state: "invalid", row: null };
  if (row.revoked_at) return { state: "revoked", row };
  if (Date.parse(row.expires_at) <= Date.now()) return { state: "expired", row };
  return { state: "ok", row };
}

/** The questions a contributor in this role can answer (open, visible, asked of them). */
export async function questionsForRole(sb: Db, clientId: string, competitionId: string | null, role: string) {
  const today = todayWinnipeg();
  // ask_who is a text[]; filtered here (a handful of open questions per athlete) rather than with a containment filter
  let q = sb.from("athlete_intel_questions").select("id, text, why, answer_spec, visible_from, ask_who, competition_id, priority").eq("client_id", clientId).eq("status", "open");
  if (competitionId) q = q.eq("competition_id", competitionId);
  const { data } = await q.order("priority", { ascending: false }).limit(100);
  return ((data ?? []) as any[])
    .filter((x) => ((x.ask_who ?? []) as string[]).includes(role) && (!x.visible_from || x.visible_from <= today))
    .slice(0, 5)
    .map((x) => ({ id: x.id, text: x.text, why: x.why, answer: x.answer_spec }));
}

/** A request for one answer, ready for the handler to send (never sent by itself). */
export function draftRequest(q: { text: string }, o: { athleteFirst: string; coachName?: string | null; to: "athlete" | "primary_coach"; handlerFirst?: string | null; link?: string | null }) {
  const base = requestMessage(q as any, { athleteFirst: o.athleteFirst, coachName: o.coachName, to: o.to, handlerFirst: o.handlerFirst });
  return o.link ? `${base}\n\nYou can answer here: ${o.link}` : base;
}

/* ------------------------------------------------------------------ */
/* Uploads and share links (called only from intel.functions.ts handlers) */

/** Sources made for files about to be uploaded, each with a signed upload link (duplicates and what can't be read said instead). */
export async function startUploads(
  sb: any,
  o: {
    clientId: string;
    competitionId: string | null;
    provider: string;
    providerName: string | null;
    purposes: string[];
    context: string | null;
    files: Array<{ name: string; size: number; type: string; hash?: string | null }>;
    uploadedBy: string | null;
    viaLinkId: string | null;
    replacesId: string | null;
  },
) {
  const out: Array<{ name: string; sourceId: string | null; path: string | null; token: string | null; signedUrl?: string | null; duplicateOf: string | null; problem: string | null; kind: string | null }> = [];
  for (const f of o.files) {
    const kind = fileKindOf(f.name, f.type);
    if (kind === "xls") {
      out.push({ name: f.name, sourceId: null, path: null, token: null, duplicateOf: null, problem: "Old Excel (.xls): save it as .xlsx and add it again", kind: null });
      continue;
    }
    if (kind === "unsupported") {
      out.push({ name: f.name, sourceId: null, path: null, token: null, duplicateOf: null, problem: "This kind of file can't be read: use a spreadsheet, CSV, PDF, Word, a photo, a video or text", kind: null });
      continue;
    }
    if (f.size > (kind === "video" ? MAX_VIDEO_BYTES : MAX_FILE_BYTES)) {
      out.push({ name: f.name, sourceId: null, path: null, token: null, duplicateOf: null, problem: kind === "video" ? "Videos up to 200 MB: trim it or add a link instead" : "Files up to 25 MB", kind });
      continue;
    }
    if (f.hash && !o.replacesId) {
      const dupQuery = sb
        .from("athlete_intel_sources")
        .select("id, file_name")
        .eq("client_id", o.clientId)
        .eq("content_hash", f.hash)
        .not("status", "in", "(deleted,replaced)");
      const { data: dup } = await (o.competitionId ? dupQuery.eq("competition_id", o.competitionId) : dupQuery.is("competition_id", null)).limit(1);
      if (dup?.[0]) {
        out.push({ name: f.name, sourceId: null, path: null, token: null, duplicateOf: dup[0].file_name ?? "a file already added", problem: null, kind });
        continue;
      }
    }
    const id = crypto.randomUUID();
    const path = `${o.clientId}/${id}/${safeName(f.name)}`;
    const { error } = await sb.from("athlete_intel_sources").insert({
      id,
      client_id: o.clientId,
      competition_id: o.competitionId,
      kind,
      file_name: f.name.slice(0, 200),
      file_path: path,
      mime: f.type || null,
      bytes: f.size,
      content_hash: f.hash ?? null,
      provider: o.provider,
      provider_name: o.providerName,
      purposes: o.purposes,
      context: o.context,
      status: "uploading",
      uploaded_by: o.uploadedBy,
      via_link_id: o.viaLinkId,
      replaces_id: o.replacesId,
      rights_text: RIGHTS_TEXT,
      rights_confirmed_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    const { data: signed, error: sErr } = await sb.storage.from(INTEL_BUCKET).createSignedUploadUrl(path);
    if (sErr || !signed) {
      await sb.from("athlete_intel_sources").delete().eq("id", id);
      throw new Error(`The upload couldn't start: ${sErr?.message ?? "no link"}`);
    }
    out.push({ name: f.name, sourceId: id, path, token: signed.token, signedUrl: signed.signedUrl, duplicateOf: null, problem: null, kind });
  }
  return { files: out };
}

/** The file is up: what the phone read from it (spreadsheets, Word, text) goes with it, and it's queued. */
export async function finishUpload(sb: any, src: any, data: { extracted?: { text: string; sheets?: any[] | null } | null; failed?: boolean }) {
  if (src.status !== "uploading") return { status: src.status };
  if (data.failed) {
    await sb.from("athlete_intel_sources").delete().eq("id", src.id).eq("status", "uploading");
    return { status: "cancelled" };
  }
  const folder = String(src.file_path).split("/").slice(0, -1).join("/");
  const name = String(src.file_path).split("/").pop();
  const { data: list } = await sb.storage.from(INTEL_BUCKET).list(folder, { search: name });
  if (!(list ?? []).some((f: any) => f.name === name)) throw new Error("The file didn't arrive. Try adding it again.");
  await sb
    .from("athlete_intel_sources")
    .update({
      status: "queued",
      source_text: data.extracted?.text ?? null,
      sheets: data.extracted?.sheets ?? null,
    })
    .eq("id", src.id)
    .eq("status", "uploading");
  await logIntel(sb, { clientId: src.client_id, competitionId: src.competition_id, sourceId: src.id, actor: "coach", action: "source_added", detail: { kind: src.kind } });
  return { status: "queued" };
}

/** A share link opened from the public page: rate limited per connection, then resolved. */
export async function openLink(token: string, write: boolean) {
  const { supabaseAdmin: sb } = (await import("@/integrations/supabase/client.server")) as { supabaseAdmin: any };
  const { rateOk, callerIp } = await import("@/lib/public-rate-limit.server");
  const ip = callerIp();
  if (ip && !(await rateOk(sb, `intel_share:${ip}`, write ? 60 : 120, "1 hour"))) throw new Error("Too many tries: wait a few minutes");
  const { state, row } = await resolveLink(sb, token);
  return { sb, state, row };
}
