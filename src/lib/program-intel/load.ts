/**
 * Program Intelligence: read every record a report covers. Works with any
 * Supabase client: the coach's own session in the app (RLS decides what they
 * may read) or the service role in the background worker (after the job's
 * coach was checked). Every list is read page by page until it ends, so no
 * record is ever silently cut off; a source that can't be read is named in
 * `unreadable` instead of being dropped quietly.
 */
import type { RawCardioCompletion, RawCardioTarget } from "./cardio";
import { isAtHomeBackupReservedBlock } from "@/lib/at-home-backup";
import { localDate } from "./core";
import { answeredQuestions } from "@/lib/form-answer-text";
import type { IntelRecords, IntelScope, IntelScopeRequest, RawBlock, RawCheckin, RawIntelProfile, RawObservation, RawPtSession } from "./types";

function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

type Db = any;
const PAGE = 1000;
const ID_CHUNK = 150;

/** Read a query page by page (Supabase returns at most 1000 rows per request). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** The same, for an `.in(column, ids)` filter over any number of ids. */
export async function fetchByIds<T>(ids: string[], build: (chunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += ID_CHUNK) {
    const chunk = uniq.slice(i, i + ID_CHUNK);
    out.push(...(await fetchAll<T>((from, to) => build(chunk, from, to))));
  }
  return out;
}

const BLOCK_COLS = "id, prep_id, name, status, start_date, end_date, weeks, training_focus, goal, coach_notes, client_visible, archived, sort_order, created_at, source_template_block_key";

/** Hidden from the client and undated: a coach's draft nobody has been given yet. */
export function isUnassignedDraftBlock(b: Pick<RawBlock, "client_visible" | "start_date">): boolean {
  return b.client_visible === false && !b.start_date;
}

/**
 * The program a client is on now: the blocks of the meet prep / program their current block belongs
 * to (else that block). When two programs overlap today (a replaced one never archived), the one
 * they actually train wins (`lastTrained`: block id → latest finished workout), then the later
 * start, then the newer one; never whichever was created first.
 */
export function currentProgramBlocks(blocks: RawBlock[], today: string, lastTrained?: Map<string, string>): { blocks: RawBlock[]; label: string; prepId: string | null } {
  const live = blocks.filter((b) => !b.archived && b.status !== "Archived" && !isAtHomeBackupReservedBlock(b));
  const running = live.filter((b) => b.start_date && b.start_date <= today && (!b.end_date || b.end_date >= today));
  const started = live.filter((b) => b.start_date && b.start_date <= today);
  const pool = running.length ? running : started.length ? started : live;
  // the latest training anywhere in a block's program (its meet prep), else in the block itself
  const programTrained = (b: RawBlock): string => {
    const sameProgram = b.prep_id ? live.filter((x) => x.prep_id === b.prep_id) : [b];
    return sameProgram.map((x) => lastTrained?.get(x.id) ?? "").sort().pop() ?? "";
  };
  const current =
    [...pool].sort(
      (a, b) =>
        programTrained(b).localeCompare(programTrained(a)) ||
        String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) ||
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )[0] ?? null;
  if (!current) return { blocks: [], label: "Current program", prepId: null };
  if (!current.prep_id) return { blocks: [current], label: current.name ?? "Current block", prepId: null };
  return { blocks: live.filter((b) => b.prep_id === current.prep_id), label: "Current program", prepId: current.prep_id };
}

/** Block id → the date of its latest finished workout, from records already loaded. */
export function lastTrainedByBlock(rec: Pick<IntelRecords, "weeks" | "days" | "completions">): Map<string, string> {
  const blockOfWeek = new Map(rec.weeks.map((w) => [w.id, w.block_id]));
  const blockOfDay = new Map(rec.days.map((d) => [d.id, blockOfWeek.get(d.week_id)]));
  const out = new Map<string, string>();
  for (const c of rec.completions) {
    const block = blockOfDay.get(c.day_id);
    const at = c.completed_at?.slice(0, 10);
    if (!block || !at) continue;
    if (at > (out.get(block) ?? "")) out.set(block, at);
  }
  return out;
}

/** Block id → its latest finished workout's date, read for the given blocks. */
async function latestTrainingFor(sb: Db, blockIds: string[]): Promise<Map<string, string>> {
  const weeks = await fetchByIds<{ id: string; block_id: string }>(blockIds, (chunk, f, t) => sb.from("pl_weeks").select("id, block_id").in("block_id", chunk).range(f, t));
  const days = await fetchByIds<{ id: string; week_id: string }>(weeks.map((w) => w.id), (chunk, f, t) => sb.from("pl_days").select("id, week_id").in("week_id", chunk).range(f, t));
  const completions = await fetchByIds<{ day_id: string; completed_at: string | null }>(days.map((d) => d.id), (chunk, f, t) =>
    sb.from("pl_day_completions").select("day_id, completed_at").in("day_id", chunk).not("completed_at", "is", null).range(f, t),
  );
  return lastTrainedByBlock({ weeks: weeks as any, days: days as any, completions: completions as any });
}

export async function loadIntelRecords(
  sb: Db,
  clientId: string,
  req: IntelScopeRequest,
  opts: { today?: string } = {},
): Promise<IntelRecords> {
  const unreadable: string[] = [];
  const optional = async <T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch {
      unreadable.push(label);
      return fallback;
    }
  };

  const { data: client, error: ce } = await sb
    .from("clients")
    .select(
      "id, user_id, full_name, preferred_weight_unit, timezone, sex, coach_notes, goals, injuries, training_notes, lifestyle_notes, date_of_birth, height_cm, committed_training_days, committed_training_frequency, preferred_training_days, available_training_days, schedule_notes, schedule_updated_at, preferred_training_time, is_powerlifter, intake_training_experience, intake_injuries, bodyweight_goal_type, bodyweight_goal_value, bodyweight_goal_unit, program_phase",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (ce) throw new Error(ce.message);
  if (!client) throw new Error("You don't have access to this client.");
  const today = opts.today ?? localDate(new Date().toISOString(), client.timezone) ?? new Date().toISOString().slice(0, 10);

  // A coach's unassigned draft (hidden and undated, e.g. a generated program waiting for review) isn't training the athlete did.
  const allBlocks: RawBlock[] = (await fetchAll<RawBlock>((f, t) => sb.from("pl_blocks").select(BLOCK_COLS).eq("client_id", clientId).order("created_at").range(f, t))).filter((b) => !isUnassignedDraftBlock(b));
  const preps = await optional(
    "meet preps / programs",
    () => fetchAll<any>((f, t) => sb.from("pl_preps").select("id, title, goal_type, event_name, event_date, federation, weight_class, division, status, coach_notes").eq("client_id", clientId).range(f, t)),
    [],
  );

  // Which blocks the report covers.
  let blocks: RawBlock[];
  let scope: IntelScope;
  if (req.kind === "program") {
    // two programs on the go at once (a replaced one never archived): read which one they train
    const running = allBlocks.filter((b) => !b.archived && b.status !== "Archived" && b.start_date && b.start_date <= today && (!b.end_date || b.end_date >= today));
    const programs = new Set(running.map((b) => b.prep_id ?? b.id));
    const trained = programs.size > 1 ? await optional("latest training per program", () => latestTrainingFor(sb, allBlocks.map((b) => b.id)), new Map<string, string>()) : undefined;
    const cur = currentProgramBlocks(allBlocks, today, trained);
    const prep = preps.find((p: any) => p.id === cur.prepId);
    blocks = cur.blocks;
    scope = { kind: "program", label: prep?.title ? `Current program: ${prep.title}` : cur.blocks.length === 1 ? `Current block: ${cur.label}` : cur.label, from: null, to: null, blockIds: blocks.map((b) => b.id) };
  } else if (req.kind === "blocks") {
    const want = new Set(req.blockIds);
    blocks = allBlocks.filter((b) => want.has(b.id));
    scope = { kind: "blocks", label: blocks.length === 1 ? (blocks[0].name ?? "Block") : `${blocks.length} blocks`, from: null, to: null, blockIds: blocks.map((b) => b.id) };
  } else if (req.kind === "dates") {
    const { from, to } = req;
    blocks = allBlocks.filter((b) => (!b.start_date || b.start_date <= to) && (!b.end_date || b.end_date >= from));
    scope = { kind: "dates", label: `${from} to ${to}`, from, to, blockIds: blocks.map((b) => b.id) };
  } else {
    blocks = allBlocks;
    scope = { kind: "history", label: "Full athlete history", from: null, to: null, blockIds: blocks.map((b) => b.id) };
  }
  const blockIds = blocks.map((b) => b.id);

  const weeks = await fetchByIds<any>(blockIds, (ids, f, t) =>
    sb.from("pl_weeks").select("id, block_id, week_index, start_date, end_date, phase, notes").in("block_id", ids).eq("archived", false).is("deleted_at", null).order("week_index").range(f, t),
  );
  const days = await fetchByIds<any>(weeks.map((w) => w.id), (ids, f, t) =>
    sb.from("pl_days").select("id, week_id, day_index, title, focus, notes, scheduled_date").in("week_id", ids).eq("archived", false).is("deleted_at", null).order("day_index").range(f, t),
  );
  const dayIds = days.map((d) => d.id);
  const rows = await fetchByIds<any>(dayIds, (ids, f, t) =>
    sb
      .from("pl_exercise_rows")
      .select("id, day_id, sort_order, exercise_id, exercise_name_override, sets, reps_text, rpe, rir, percentage, percentage_basis, load_kg, load_lb, load_unit, tempo, rest_seconds, notes, purpose_label, measurement_type, duration_seconds, intensity_techniques, progression_method")
      .in("day_id", ids)
      .order("sort_order")
      .range(f, t),
  );
  const rowIds = rows.map((r) => r.id);
  const results = await fetchByIds<any>(rowIds, (ids, f, t) =>
    sb
      .from("pl_row_results")
      .select("id, row_id, set_index, actual_load, actual_load_unit, normalized_kg, actual_load_kg, actual_reps, actual_rpe, actual_rpe_num, actual_rir, is_working_set, is_bodyweight, load_type, completed_at, completed_duration_seconds, notes, mean_concentric_velocity_mps")
      .in("row_id", ids)
      .eq("client_id", clientId)
      .order("set_index")
      .range(f, t),
  );
  const completions = await fetchByIds<any>(dayIds, (ids, f, t) =>
    sb.from("pl_day_completions").select("id, day_id, completed_at, started_at, actual_duration_min, logging_percentage, session_rating, skipped_exercises_count, client_notes").in("day_id", ids).eq("client_id", clientId).range(f, t),
  );
  const setBlocks = await optional(
    "set structures (top sets / back-offs)",
    () => fetchByIds<any>(rowIds, (ids, f, t) => sb.from("pl_exercise_blocks").select("id, row_id, sort_order, block_type, label, sets, reps_text, rpe, rir, load_type, load_value, load_unit, amrap, notes").in("row_id", ids).range(f, t)),
    [],
  );
  const warmups = await optional(
    "logged warm-up sets",
    () => fetchByIds<any>(rowIds, (ids, f, t) => sb.from("pl_warmup_sets").select("id, row_id, load, reps, rpe, unit").in("row_id", ids).eq("client_id", clientId).range(f, t)),
    [],
  );
  const feedback = await optional(
    "post-workout check-outs",
    () =>
      fetchByIds<any>(dayIds, (ids, f, t) =>
        sb
          .from("pl_workout_feedback")
          .select("id, day_id, completion_id, created_at, session_rpe, overall_rating, strength_feel, fatigue_feel, hit_target, recovery_today, sleep_bucket, pain, pain_area, pain_level, pain_note, client_note, review_version")
          .in("day_id", ids)
          .eq("client_id", clientId)
          .range(f, t),
      ),
    [],
  );
  const exerciseNotes = await optional(
    "exercise notes",
    () => fetchByIds<any>(dayIds, (ids, f, t) => sb.from("pl_exercise_notes").select("id, row_id, day_id, exercise_id, exercise_name, content, created_at").in("day_id", ids).eq("client_id", clientId).range(f, t)),
    [],
  );
  const exerciseIds = [...new Set(rows.map((r) => r.exercise_id).filter(Boolean))] as string[];
  const exercises = await fetchByIds<any>(exerciseIds, (ids, f, t) =>
    sb
      .from("exercises")
      .select("id, name, primary_muscle_group, muscle_groups, secondary_muscle_groups, movement_family, is_competition_lift, competition_lift_type, exercise_category, variation_type, counts_toward_volume, volume_multiplier, equipment, vimeo_embed_url, video_url, youtube_url")
      .in("id", ids)
      .range(f, t),
  ).then((list) => list.map(({ vimeo_embed_url, video_url, youtube_url, ...e }) => ({ ...e, has_video: !!(vimeo_embed_url || video_url || youtube_url) })));
  const maxes = await optional(
    "maxes on file",
    () => fetchAll<any>((f, t) => sb.from("pl_client_maxes").select("lift, exercise_id, one_rm, training_max, estimated_1rm, unit, tested_at, source, active").eq("client_id", clientId).range(f, t)),
    [],
  );
  const meets = await optional(
    "meet results",
    () => fetchAll<any>((f, t) => sb.from("athlete_powerlifting_results").select("meet_date, meet_name, bodyweight_kg, squat_kg, bench_kg, deadlift_kg, total_kg, federation, weight_class_kg").eq("client_id", clientId).range(f, t)),
    [],
  );
  const bodyweight = client.user_id
    ? await optional(
        "bodyweight log",
        () =>
          fetchAll<any>((f, t) => sb.from("progress_bodyweight").select("logged_date, weight_value, weight_unit").eq("user_id", client.user_id).order("logged_date").range(f, t)).then((list) =>
            list
              .filter((b) => b.logged_date && Number(b.weight_value) > 0)
              .map((b) => ({ date: b.logged_date as string, kg: String(b.weight_unit ?? "").toLowerCase().startsWith("lb") ? Number(b.weight_value) / 2.2046226218 : Number(b.weight_value) })),
          ),
        [],
      )
    : [];
  const roadmapNotes = await optional(
    "roadmap notes",
    () => fetchByIds<any>(blockIds, (ids, f, t) => sb.from("pl_roadmap_notes").select("block_id, week_id, ai_style, ai_label, coach_label, coach_summary, hidden").in("block_id", ids).range(f, t)),
    [],
  );
  const fileNotes = await optional(
    "coach notes",
    () => fetchAll<any>((f, t) => sb.from("client_file_notes").select("id, title, body, pinned, created_at").eq("client_id", clientId).is("archived_at", null).order("created_at").range(f, t)),
    [],
  );
  const goals = await optional(
    "Goals & Setup",
    async () => {
      const { data, error } = await sb
        .from("client_goals_setup")
        .select("main_goal, main_goal_other, goal_target, training_days_per_week, workout_length_minutes, training_experience, training_styles, training_location, equipment, injuries_has, injuries_details, final_notes, available_weekdays, equipment_by_location, updated_at, completed_at, last_reviewed_at")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    null,
  );
  const settingsRow = await optional(
    "analytics settings",
    async () => {
      const { data, error } = await sb.from("client_analytics_settings").select("e1rm_formula, working_set_rpe_min, muscle_volume_targets").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    null,
  );
  const observations = await optional<RawObservation[]>(
    "athlete memory",
    () =>
      fetchAll<any>((f, t) =>
        sb
          .from("program_intel_observations")
          .select("id, kind, category, statement, corrected_statement, confidence, status, source, evidence, block_id, decision_id, created_at, reviewed_at")
          .eq("client_id", clientId)
          .order("created_at")
          .range(f, t),
      ),
    [],
  );

  const profile = await optional<RawIntelProfile | null>(
    "Program Intelligence settings",
    async () => {
      const { data, error } = await sb.from("program_intel_profiles").select("brain_override, equipment_profile, long_term_goal, updated_at").eq("client_id", clientId).maybeSingle();
      if (error) throw error;
      return (data as RawIntelProfile | null) ?? null;
    },
    null,
  );
  // Check-ins and other forms the athlete sent while this training ran (and the 4 weeks before it), answers as text.
  const firstTrainingDate = [...blocks.map((b) => b.start_date).filter(Boolean)].sort()[0] as string | undefined;
  const checkinsFrom = addDaysIso(scope.from ?? firstTrainingDate ?? today, -28);
  const checkins = await optional<RawCheckin[]>(
    "check-ins and forms",
    async () => {
      const subs = await fetchAll<any>((f, t) =>
        sb.from("nf_submissions").select("id, form_id, submitted_at, period_start").eq("client_id", clientId).not("submitted_at", "is", null).gte("submitted_at", `${checkinsFrom}T00:00:00Z`).order("submitted_at").range(f, t),
      );
      if (!subs.length) return [];
      const formIds = [...new Set(subs.map((x) => x.form_id).filter(Boolean))] as string[];
      const forms = await fetchByIds<any>(formIds, (ids, f, t) => sb.from("nf_forms").select("id, title").in("id", ids).range(f, t));
      const questions = await fetchByIds<any>(formIds, (ids, f, t) => sb.from("nf_questions").select("id, form_id, label, order_index, question_type").in("form_id", ids).range(f, t));
      const answers = await fetchByIds<any>(subs.map((x) => x.id), (ids, f, t) => sb.from("nf_answers").select("submission_id, question_id, value_text, value_number, value_json").in("submission_id", ids).range(f, t));
      const title = new Map(forms.map((x) => [x.id, x.title as string]));
      return subs.map((x) => ({
        id: x.id,
        form: title.get(x.form_id) ?? null,
        submitted_at: x.submitted_at,
        period_start: x.period_start,
        answers: answeredQuestions(
          questions.filter((q) => q.form_id === x.form_id),
          answers.filter((a) => a.submission_id === x.id),
        ).map((a) => ({ q: a.label, a: a.value.slice(0, 600) })),
      }));
    },
    [],
  );

  // The cardio plan (what the app adds to every workout and asks for on days off) and its log.
  const cardioTargets = await optional<RawCardioTarget[]>(
    "cardio plan",
    async () => {
      const { data, error } = await sb
        .from("cardio_targets")
        .select("id, day_type, cardio_type, custom_type, duration_minutes, frequency_per_week, scheduled_weekdays, incline, heart_rate_zone, status, enabled, visible_to_client, program_name, start_date, end_date, source, last_updated_at, updated_at")
        .eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as RawCardioTarget[];
    },
    [],
  );
  const cardioCompletions = await optional<RawCardioCompletion[]>(
    "cardio log",
    async () =>
      fetchAll<RawCardioCompletion>((f, t) =>
        sb.from("cardio_completions").select("cardio_target_id, completed_date, completed, skipped").eq("client_id", clientId).gte("completed_date", addDaysIso(today, -35)).order("completed_date").range(f, t),
      ),
    [],
  );

  // Booked PT sessions around now: a client who trains with the coach trains inside that hour.
  const ptSessions = await optional<RawPtSession[]>(
    "PT sessions",
    async () =>
      fetchAll<RawPtSession>((f, t) =>
        sb
          .from("pt_sessions")
          .select("starts_at, ends_at, status")
          .eq("client_id", clientId)
          .gte("starts_at", `${addDaysIso(today, -56)}T00:00:00Z`)
          .lte("starts_at", `${addDaysIso(today, 28)}T23:59:59Z`)
          .order("starts_at")
          .range(f, t),
      ),
    [],
  );

  return {
    client: {
      id: client.id,
      full_name: client.full_name,
      preferred_weight_unit: client.preferred_weight_unit,
      timezone: client.timezone,
      sex: client.sex,
      coach_notes: client.coach_notes,
      goals: client.goals,
      injuries: client.injuries,
      training_notes: client.training_notes,
      lifestyle_notes: client.lifestyle_notes,
      date_of_birth: client.date_of_birth ?? null,
      height_cm: client.height_cm != null ? Number(client.height_cm) : null,
      committed_training_days: client.committed_training_days ?? null,
      committed_training_frequency: client.committed_training_frequency ?? null,
      preferred_training_days: client.preferred_training_days ?? null,
      available_training_days: client.available_training_days ?? null,
      schedule_notes: client.schedule_notes ?? null,
      schedule_updated_at: client.schedule_updated_at ?? null,
      preferred_training_time: client.preferred_training_time ?? null,
      is_powerlifter: client.is_powerlifter ?? null,
      intake_training_experience: client.intake_training_experience ?? null,
      intake_injuries: client.intake_injuries ?? null,
      bodyweight_goal_type: client.bodyweight_goal_type ?? null,
      bodyweight_goal_value: client.bodyweight_goal_value != null ? Number(client.bodyweight_goal_value) : null,
      bodyweight_goal_unit: client.bodyweight_goal_unit ?? null,
      program_phase: client.program_phase ?? null,
    },
    goals,
    preps,
    blocks,
    weeks,
    days,
    rows,
    setBlocks,
    results,
    warmups,
    completions,
    feedback,
    exerciseNotes,
    exercises,
    maxes,
    meets,
    bodyweight,
    roadmapNotes,
    fileNotes,
    observations,
    checkins,
    profile,
    cardioTargets,
    cardioCompletions,
    ptSessions,
    settings: {
      e1rmFormula: settingsRow?.e1rm_formula === "brzycki" ? "brzycki" : "epley",
      workingRpeMin: Number(settingsRow?.working_set_rpe_min ?? 6) || 6,
      muscleTargets: (settingsRow?.muscle_volume_targets as any) ?? {},
    },
    scope,
    today,
    loadedAt: new Date().toISOString(),
    unreadable,
  };
}

/**
 * The records of some blocks only (the previous program inside a full-history
 * load), with everything that hangs off them, so one read serves both the
 * whole history and the program being followed up.
 */
export function sliceRecords(rec: IntelRecords, blockIds: string[], label: string): IntelRecords {
  const keep = new Set(blockIds);
  const blocks = rec.blocks.filter((b) => keep.has(b.id));
  const weeks = rec.weeks.filter((w) => keep.has(w.block_id));
  const weekIds = new Set(weeks.map((w) => w.id));
  const days = rec.days.filter((d) => weekIds.has(d.week_id));
  const dayIds = new Set(days.map((d) => d.id));
  const rows = rec.rows.filter((r) => dayIds.has(r.day_id));
  const rowIds = new Set(rows.map((r) => r.id));
  const dates = days.map((d) => d.scheduled_date).filter(Boolean).sort() as string[];
  const from = blocks.map((b) => b.start_date).filter(Boolean).sort()[0] ?? dates[0] ?? null;
  return {
    ...rec,
    blocks,
    weeks,
    days,
    rows,
    setBlocks: rec.setBlocks.filter((s) => rowIds.has(s.row_id)),
    results: rec.results.filter((r) => rowIds.has(r.row_id)),
    warmups: rec.warmups.filter((w) => rowIds.has(w.row_id)),
    completions: rec.completions.filter((c) => dayIds.has(c.day_id)),
    feedback: rec.feedback.filter((f) => !f.day_id || dayIds.has(f.day_id)),
    exerciseNotes: rec.exerciseNotes.filter((n) => !n.day_id || dayIds.has(n.day_id)),
    roadmapNotes: rec.roadmapNotes.filter((n) => keep.has(n.block_id)),
    checkins: (rec.checkins ?? []).filter((c) => !from || !c.submitted_at || c.submitted_at.slice(0, 10) >= addDaysIso(from, -28)),
    scope: { kind: "blocks", label, from: null, to: null, blockIds: blocks.map((b) => b.id) },
  };
}
