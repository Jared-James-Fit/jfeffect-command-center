/**
 * Reading what Edit with AI works on: a client's current and upcoming program
 * (every workout with its lock: trained, started or in the past), or a
 * library template; the exercise catalog it may use; and the coach's rules.
 * Every read is chunked and paged, so a long program is read whole.
 * Server-only. `db` is the caller's session (RLS) or, in the background
 * worker, the service role after the coach's access was checked.
 */
import { filterPrimaryProgramBlocks } from "@/lib/at-home-backup";
import { todayInTimeZone } from "@/lib/committed-schedule-realign";
import { defaultRestSeconds } from "@/lib/exercise-metadata";
import { lowValueReason } from "@/lib/program-intel/exercise-standard";
import { WEEKDAYS } from "./ops";
import type { RuleLine } from "./prompts";
import type { BlockSnap, CatalogExercise, DaySnap, Lock, ProgramSnapshot, RowSnap, WeekSnap } from "./types";

type Db = any;
const CHUNK = 150;
const FULL_DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** Above this many exercise rows the program text says how long it is (trained workouts are always one line each). */
const MAX_ROWS_IN_TEXT = 1400;

export function toShortDays(days: readonly string[] | null | undefined): string[] {
  const set = new Set((days ?? []).map((d) => d.slice(0, 3).toLowerCase()));
  return WEEKDAYS.filter((d) => set.has(d));
}

export function toFullDays(days: readonly string[]): string[] {
  return WEEKDAYS.map((d, i) => (days.includes(d) ? FULL_DAY[i] : null)).filter(Boolean) as string[];
}

async function all(q: () => any, what: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function inChunks(ids: string[], what: string, q: (chunk: string[]) => any): Promise<any[]> {
  const out: any[] = [];
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += CHUNK) out.push(...(await all(() => q(uniq.slice(i, i + CHUNK)), what)));
  return out;
}

export type ExerciseMetaRow = { id: string; name: string; primary_muscle_group: string | null; muscle_group: string | null; equipment: string | null; movement_family: string | null; video_url: string | null; category: string | null; exercise_category: string | null; archived: boolean };

export async function exerciseMeta(db: Db, ids: string[]): Promise<Map<string, ExerciseMetaRow>> {
  const rows = await inChunks(ids, "exercises", (c) =>
    db.from("exercises").select("id, name, primary_muscle_group, muscle_group, equipment, movement_family, video_url, category, exercise_category, archived").in("id", c).order("id"),
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function rowSnap(r: any, ref: string, name: string): RowSnap {
  return {
    id: r.id,
    ref,
    dayId: r.day_id,
    sortOrder: r.sort_order ?? 0,
    exerciseId: r.exercise_id ?? null,
    name,
    nameOverride: r.exercise_name_override ?? null,
    sets: r.sets ?? null,
    reps: r.reps_text ?? null,
    rpe: r.rpe ?? null,
    rir: r.rir ?? null,
    percentage: r.percentage != null ? Number(r.percentage) : null,
    percentageBasis: r.percentage_basis ?? null,
    loadKg: r.load_kg != null ? Number(r.load_kg) : null,
    loadLb: r.load_lb != null ? Number(r.load_lb) : null,
    loadUnit: r.load_unit ?? null,
    manualOverride: !!r.manual_override,
    restSeconds: r.rest_seconds ?? null,
    restOverride: r.rest_seconds_override ?? null,
    tempo: r.tempo ?? null,
    notes: r.notes ?? null,
    timeProfile: r.time_profile ?? "accessory_compound",
    purposeLabel: r.purpose_label ?? null,
    measurementType: r.measurement_type ?? "reps",
    trackingType: r.tracking_type ?? "reps_weight",
    durationSeconds: r.duration_seconds ?? null,
    cardio: !!r.cardio_target_id,
    updatedAt: r.updated_at ?? null,
  };
}

/** A client's current and upcoming primary blocks, every workout with its lock. */
export async function loadClientSnapshot(db: Db, clientId: string, opts: { focusBlockId?: string | null } = {}): Promise<{ snap: ProgramSnapshot; meta: Map<string, ExerciseMetaRow>; client: any }> {
  const { data: client, error: ce } = await db
    .from("clients")
    .select("id, full_name, preferred_name, first_name, last_name, committed_training_days, preferred_weight_unit, timezone")
    .eq("id", clientId)
    .maybeSingle();
  if (ce) throw new Error(`client: ${ce.message}`);
  if (!client) throw new Error("That client wasn't found.");
  const today = todayInTimeZone(client.timezone ?? "America/Winnipeg");
  const blocks = filterPrimaryProgramBlocks(
    await all(() => db.from("pl_blocks").select("id, name, status, client_visible, start_date, end_date, archived, source_template_block_key, created_at").eq("client_id", clientId).eq("archived", false).order("id"), "blocks"),
  ).filter((b: any) => b.status !== "Archived" && (!b.end_date || b.end_date >= today || b.id === opts.focusBlockId));
  blocks.sort((a: any, b: any) => (a.start_date ?? "9999") .localeCompare(b.start_date ?? "9999") || String(a.created_at).localeCompare(String(b.created_at)));

  const weeks = await inChunks(blocks.map((b: any) => b.id), "weeks", (c) => db.from("pl_weeks").select("id, block_id, week_index, start_date, end_date, phase, archived, deleted_at").in("block_id", c).order("id"));
  const liveWeeks = weeks.filter((w) => !w.archived && !w.deleted_at);
  const days = await inChunks(liveWeeks.map((w) => w.id), "workouts", (c) =>
    db.from("pl_days").select("id, week_id, day_index, title, subtitle, focus, scheduled_date, is_custom, archived, deleted_at, at_home_backup_session_key, updated_at").in("week_id", c).order("id"),
  );
  const liveDays = days.filter((d) => !d.archived && !d.deleted_at && !d.at_home_backup_session_key);
  const dayIds = liveDays.map((d) => d.id);
  const [rows, completions, instances] = await Promise.all([
    inChunks(dayIds, "exercises", (c) => db.from("pl_exercise_rows").select("*").in("day_id", c).order("id")),
    inChunks(dayIds, "completions", (c) => db.from("pl_day_completions").select("day_id, completed_at, started_at, in_progress_at, training_started_at").in("day_id", c).order("day_id")),
    inChunks(dayIds, "calendar", (c) => db.from("pl_scheduled_workouts").select("source_day_id, scheduled_date").eq("client_id", clientId).in("source_day_id", c).order("source_day_id")),
  ]);
  const rowIds = rows.map((r) => r.id);
  const [logged, warmups] = await Promise.all([
    inChunks(rowIds, "logged sets", (c) => db.from("pl_row_results").select("row_id").in("row_id", c).order("row_id")),
    inChunks(rowIds, "warm-ups", (c) => db.from("pl_warmup_sets").select("row_id").in("row_id", c).order("row_id")),
  ]);
  const meta = await exerciseMeta(db, rows.map((r) => r.exercise_id).filter(Boolean));

  const dayOfRow = new Map(rows.map((r) => [r.id, r.day_id]));
  const lock = new Map<string, Lock>();
  for (const c of completions) {
    if (c.completed_at) lock.set(c.day_id, "trained");
    else if ((c.started_at || c.in_progress_at || c.training_started_at) && lock.get(c.day_id) !== "trained") lock.set(c.day_id, "started");
  }
  for (const l of [...logged, ...warmups]) {
    const d = dayOfRow.get(l.row_id);
    if (d && !lock.has(d)) lock.set(d, "started");
  }
  const dateOf = new Map<string, string>();
  for (const i of instances) {
    const prev = dateOf.get(i.source_day_id);
    if (!prev || i.scheduled_date < prev) dateOf.set(i.source_day_id, i.scheduled_date);
  }

  const out: BlockSnap[] = [];
  let totalRows = 0;
  blocks.forEach((b: any, bi: number) => {
    const bref = `B${bi + 1}`;
    const ws = liveWeeks.filter((w) => w.block_id === b.id).sort((x, y) => x.week_index - y.week_index);
    const weekSnaps: WeekSnap[] = ws.map((w, wi) => {
      const wref = `${bref}W${wi + 1}`;
      const ds = liveDays.filter((d) => d.week_id === w.id).sort((x, y) => x.day_index - y.day_index || String(x.id).localeCompare(String(y.id)));
      const daySnaps: DaySnap[] = ds.map((d, di) => {
        const dref = `${wref}D${di + 1}`;
        const date = dateOf.get(d.id) ?? d.scheduled_date ?? null;
        const l: Lock = lock.get(d.id) ?? (date && date < today ? "past" : null);
        const rs = rows.filter((r) => r.day_id === d.id).sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || String(x.id).localeCompare(String(y.id)));
        totalRows += rs.length;
        return {
          id: d.id,
          ref: dref,
          weekId: w.id,
          dayIndex: d.day_index,
          title: d.title ?? null,
          subtitle: d.subtitle ?? null,
          focus: d.focus ?? null,
          date,
          lock: l,
          isCustom: !!d.is_custom,
          updatedAt: d.updated_at ?? null,
          rows: rs.map((r, ri) => rowSnap(r, `${dref}E${ri + 1}`, (r.exercise_id && meta.get(r.exercise_id)?.name) || r.exercise_name_override || "Exercise")),
        };
      });
      return { id: w.id, ref: wref, blockId: b.id, weekIndex: w.week_index, start: w.start_date ?? null, end: w.end_date ?? null, phase: w.phase ?? null, days: daySnaps };
    });
    out.push({
      id: b.id,
      ref: bref,
      name: b.name,
      status: b.status,
      visible: !!b.client_visible,
      start: b.start_date ?? null,
      end: b.end_date ?? null,
      current: !!b.start_date && b.start_date <= today,
      weeks: weekSnaps,
    });
  });

  const label = client.preferred_name?.trim() || client.full_name?.trim() || [client.first_name, client.last_name].filter(Boolean).join(" ") || "Client";
  const snap: ProgramSnapshot = {
    kind: "client",
    clientId,
    templateId: null,
    title: label,
    unit: client.preferred_weight_unit === "kg" ? "kg" : "lb",
    today,
    trainingDays: toShortDays(client.committed_training_days),
    blocks: out,
    omittedNote: null,
  };
  if (totalRows > MAX_ROWS_IN_TEXT) snap.omittedNote = `(A long program: ${totalRows} exercise rows. Trained weeks are one line per workout; their logs are in the athlete section.)`;
  return { snap, meta, client };
}

/** A library template as the editor sees it (its active blocks), from its v2 payload. */
export async function loadTemplateSnapshot(db: Db, templateId: string): Promise<{ snap: ProgramSnapshot; v2: any; meta: Map<string, ExerciseMetaRow>; template: any }> {
  const { data: t, error } = await db.from("pl_templates").select("id, name, template_type, payload, payload_revision, archived, weeks, days_per_week").eq("id", templateId).maybeSingle();
  if (error) throw new Error(`template: ${error.message}`);
  if (!t) throw new Error("That template wasn't found (or only an admin can edit it).");
  if (!["block", "full_prep", "program"].includes(t.template_type)) throw new Error("Edit with AI works on block and program templates.");
  const { normalizeTemplatePayload, isPayloadInRecovery, getActiveTemplateBlocks } = await import("@/lib/pl-template-blocks");
  const v2 = normalizeTemplatePayload(t.payload, { templateType: t.template_type, templateId: t.id });
  if (isPayloadInRecovery(v2)) throw new Error("This template's saved data is damaged; fix it in the template editor first.");
  const active = getActiveTemplateBlocks(v2);
  const ids: string[] = [];
  for (const b of active) for (const w of b.weeks ?? []) for (const d of w.days ?? []) for (const r of d.rows ?? []) if (r?.exercise_id) ids.push(r.exercise_id);
  const meta = await exerciseMeta(db, ids);
  const blocks: BlockSnap[] = active.map((b, bi) => {
    const bref = `B${bi + 1}`;
    const { weeks: _w, ...braw } = b as any;
    return {
      id: b.id,
      ref: bref,
      name: b.name,
      status: "Template",
      visible: true,
      start: null,
      end: null,
      current: bi === 0,
      raw: braw,
      weeks: (b.weeks ?? []).map((w: any, wi: number) => {
        const wid = `${b.id}:w${wi + 1}`;
        const wref = `${bref}W${wi + 1}`;
        const { days: _d, ...wraw } = w ?? {};
        return {
          id: wid,
          ref: wref,
          blockId: b.id,
          weekIndex: w?.week_index ?? wi + 1,
          start: null,
          end: null,
          phase: w?.phase ?? null,
          raw: wraw,
          days: (w?.days ?? []).map((d: any, di: number) => {
            const did = `${wid}:d${di + 1}`;
            const dref = `${wref}D${di + 1}`;
            const { rows: _r, ...draw } = d ?? {};
            return {
              id: did,
              ref: dref,
              weekId: wid,
              dayIndex: d?.day_index ?? di + 1,
              title: d?.title || null,
              subtitle: d?.subtitle || null,
              focus: d?.focus || null,
              date: null,
              lock: null,
              isCustom: false,
              updatedAt: null,
              raw: draw,
              rows: (d?.rows ?? []).map((r: any, ri: number) => {
                const s = rowSnap({ ...r, id: `${did}:e${ri + 1}`, day_id: did, sort_order: ri, cardio_target_id: null, updated_at: null }, `${dref}E${ri + 1}`, (r?.exercise_id && meta.get(r.exercise_id)?.name) || r?.exercise_name_override || "Exercise");
                s.raw = r;
                return s;
              }),
            } as DaySnap;
          }),
        } as WeekSnap;
      }),
    };
  });
  const snap: ProgramSnapshot = { kind: "template", clientId: null, templateId: t.id, title: t.name, unit: "lb", today: todayInTimeZone("America/Winnipeg"), trainingDays: [], blocks, revision: Number(t.payload_revision ?? 0) };
  return { snap, v2, meta, template: t };
}

/**
 * The exercises the model may use: the ones the coach's programs already use
 * (the generator's catalog), plus every exercise in this program; the ones
 * below the exercise standard only when the program already has them.
 */
export async function loadCatalog(db: Db, snap: ProgramSnapshot, meta: Map<string, ExerciseMetaRow>): Promise<CatalogExercise[]> {
  const used = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("pl_exercise_rows").select("exercise_id").not("exercise_id", "is", null).order("id").range(from, from + 999);
    if (error) throw new Error(`catalog: ${error.message}`);
    for (const r of data ?? []) used.add(r.exercise_id);
    if (!data || data.length < 1000) break;
  }
  const inProgram = new Set<string>();
  for (const b of snap.blocks) for (const w of b.weeks) for (const d of w.days) for (const r of d.rows) if (r.exerciseId) inProgram.add(r.exerciseId);
  const missing = [...used, ...inProgram].filter((id) => !meta.has(id));
  const more = await exerciseMeta(db, missing);
  const merged = new Map([...meta, ...more]);
  return catalogFrom([...merged.values()], inProgram);
}

export function catalogFrom(list: ExerciseMetaRow[], inProgram: Set<string>, startAt = 1): CatalogExercise[] {
  const out: CatalogExercise[] = [];
  const sorted = list
    .filter((e) => !e.archived || inProgram.has(e.id))
    .filter((e) => inProgram.has(e.id) || !lowValueReason(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach((e, i) => out.push(toCatalog(e, `X${startAt + i}`)));
  return out;
}

export function toCatalog(e: ExerciseMetaRow, code: string): CatalogExercise {
  return {
    code,
    id: e.id,
    name: e.name,
    muscle: e.primary_muscle_group ?? e.muscle_group ?? null,
    equipment: e.equipment ?? null,
    family: e.movement_family ?? null,
    video: !!e.video_url,
    timeProfile: timeProfileOf(e),
    defaultRest: timeProfileOf(e) === "warmup_mobility" || timeProfileOf(e) === "conditioning" ? null : defaultRestSeconds(e as any),
    standard: lowValueReason(e.name),
  };
}

/** Same as the builder's inferTimeProfileFromExercise (pl-programs.ts), kept here so this file has no browser client. */
export function timeProfileOf(ex: { name?: string | null; category?: string | null }): string {
  const cat = (ex?.category ?? "").toLowerCase();
  const name = (ex?.name ?? "").toLowerCase();
  if (cat === "warm-ups" || cat === "mobility" || /warm[- ]?up|mobility|activation/.test(name)) return "warmup_mobility";
  if (cat === "cardio" || /cardio|conditioning|sprint|sled|prowler/.test(name)) return "conditioning";
  if (/(^|\s)(comp |competition )?(back |front |high.bar |low.bar )?squat$|^bench press$|^deadlift$|^conventional deadlift$|^sumo deadlift$|^overhead press$|^ohp$/.test(name)) return "main_lift";
  if (/squat|bench press|deadlift|overhead press|press$/.test(name)) return "secondary_lift";
  if (/curl|extension|raise|fly|kickback|pulldown|pushdown|shrug|calf/.test(name)) return "accessory_isolation";
  return "accessory_compound";
}

/** Names the model used that aren't catalog codes, looked up in the library (exact name or alias first). */
export async function resolveLibraryNames(db: Db, names: string[], startCode: number): Promise<{ found: Map<string, CatalogExercise>; missing: Array<{ name: string; candidates: CatalogExercise[] }> }> {
  const found = new Map<string, CatalogExercise>();
  const missing: Array<{ name: string; candidates: CatalogExercise[] }> = [];
  let code = startCode;
  const { normName } = await import("./engine");
  for (const name of names.slice(0, 20)) {
    let id: string | null = null;
    try {
      const { data } = await db.rpc("resolve_exercise_id", { _name: name });
      if (typeof data === "string") id = data;
    } catch {
      /* fall through to a name search */
    }
    if (!id) {
      const { data } = await db.from("exercises").select("id, name").eq("archived", false).ilike("name", name.replace(/[%_]/g, "")).limit(2);
      if (data?.length === 1) id = data[0].id;
    }
    if (id) {
      const meta = await exerciseMeta(db, [id]);
      const m = meta.get(id);
      if (m && !m.archived) {
        found.set(normName(name), toCatalog(m, `X${code++}`));
        continue;
      }
    }
    const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 3);
    let q = db.from("exercises").select("id, name, primary_muscle_group, muscle_group, equipment, movement_family, video_url, category, exercise_category, archived").eq("archived", false);
    for (const w of words) q = q.ilike("name", `%${w.replace(/[%_]/g, "")}%`);
    const { data: cands } = words.length ? await q.limit(6) : { data: [] };
    missing.push({ name, candidates: ((cands ?? []) as ExerciseMetaRow[]).filter((c) => !lowValueReason(c.name)).map((c) => toCatalog(c, `X${code++}`)) });
  }
  return { found, missing };
}

/** The coach's rules in force for this target (an athlete's own and the every-athlete ones). */
export async function loadRules(db: Db, clientId: string | null, today: string): Promise<RuleLine[]> {
  let q = db.from("program_rules").select("kind, rule, expires_on, client_id, active").eq("active", true).order("created_at");
  q = clientId ? q.or(`client_id.eq.${clientId},client_id.is.null`) : q.is("client_id", null);
  const { data, error } = await q;
  if (error) throw new Error(`rules: ${error.message}`);
  return ((data ?? []) as any[])
    .filter((r) => !r.expires_on || r.expires_on >= today)
    .map((r) => ({ kind: r.kind, rule: r.rule, expiresOn: r.expires_on ?? null, scope: r.client_id ? ("athlete" as const) : ("all" as const) }));
}
