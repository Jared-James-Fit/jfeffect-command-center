// A made-up athlete ("Alex") on a coach-written program. No real client data.
const USER_ID = '11111111-2222-4333-8444-555555555555';
const CLIENT_ID = 'c1111111-2222-4333-8444-555555555555';
const COACH_ID = 'a1111111-2222-4333-8444-555555555555';
const COACH_USER = 'b1111111-2222-4333-8444-555555555555';
let n = 0; const uid = (p) => `${p}${String(++n).padStart(7,'0')}-0000-4000-8000-000000000000`.slice(0,36);
const iso = (d) => d.toISOString().slice(0,10);
const TODAY = new Date('2026-11-06T12:00:00');
const addDays = (d, k) => { const x = new Date(d); x.setDate(x.getDate()+k); return x; };
const now = '2026-11-06T17:00:00Z';

const EX = {
  squat: { name: 'Back Squat', muscle_group: 'Quads', category: 'Compound', equipment: 'Barbell', pl_lift_group: 'squat', is_competition_lift: true, competition_lift_type: 'squat', movement_family: 'squat' },
  rdl: { name: 'Romanian Deadlift', muscle_group: 'Hamstrings', category: 'Compound', equipment: 'Barbell', movement_family: 'hinge' },
  legpress: { name: 'Leg Press', muscle_group: 'Quads', category: 'Compound', equipment: 'Machine', movement_family: 'squat' },
  split: { name: 'Bulgarian Split Squat', muscle_group: 'Quads', category: 'Compound', equipment: 'Dumbbell', movement_family: 'lunge' },
  curl: { name: 'Seated Leg Curl', muscle_group: 'Hamstrings', category: 'Isolation', equipment: 'Machine', movement_family: 'knee_flexion' },
  bench: { name: 'Bench Press', muscle_group: 'Chest', category: 'Compound', equipment: 'Barbell', pl_lift_group: 'bench', is_competition_lift: true, competition_lift_type: 'bench', movement_family: 'horizontal_push' },
  row: { name: 'Chest Supported Row', muscle_group: 'Back', category: 'Compound', equipment: 'Machine', movement_family: 'horizontal_pull' },
  ohp: { name: 'Seated Dumbbell Shoulder Press', muscle_group: 'Shoulders', category: 'Compound', equipment: 'Dumbbell', movement_family: 'vertical_push' },
  pulldown: { name: 'Lat Pulldown', muscle_group: 'Back', category: 'Compound', equipment: 'Cable', movement_family: 'vertical_pull' },
  dead: { name: 'Deadlift', muscle_group: 'Back', category: 'Compound', equipment: 'Barbell', pl_lift_group: 'deadlift', is_competition_lift: true, competition_lift_type: 'deadlift', movement_family: 'hinge' },
  incline: { name: 'Incline Dumbbell Press', muscle_group: 'Chest', category: 'Compound', equipment: 'Dumbbell', movement_family: 'horizontal_push' },
  lateral: { name: 'Cable Lateral Raise', muscle_group: 'Shoulders', category: 'Isolation', equipment: 'Cable', movement_family: 'shoulder_abduction' },
};
const exercises = Object.entries(EX).map(([k, e]) => ({ id: uid('e'), key: k, archived: false, default_load_unit: 'lb', default_load_type: 'external', default_measurement_type: 'reps', exercise_category: e.category, difficulty: 'Intermediate', cues: null, video_url: null, vimeo_embed_url: null, ...e }));
const exById = Object.fromEntries(exercises.map(e => [e.key, e]));

// Day templates: [exerciseKey, sets, reps_text, rpe, rest, notes]
const DAYS = [
  { title: 'Upper · Bench focus', rows: [['bench',4,'5','7',180,'Pause every rep on the chest.'],['row',3,'8-10','8',120],['ohp',3,'8-10','8',90],['pulldown',3,'10-12','8',90],['lateral',3,'12-15','9',60]] },
  { title: 'Lower · Deadlift focus', rows: [['dead',4,'4','7',180],['split',3,'8','8',90],['curl',3,'10-12','8',75]] },
  { title: 'Upper · Volume', rows: [['incline',4,'8','8',120],['pulldown',4,'10','8',90],['ohp',3,'10','8',90],['lateral',3,'15','9',60]] },
  { title: 'Lower · Squat focus', rows: [['squat',4,'5','7',180,'Same weight all four sets. Brace before you unrack and keep every rep the same speed.'],['rdl',3,'8','7',150,'Slow on the way down. Stop when your back wants to round.'],['legpress',3,'10-12','8',120],['split',2,'10','8',90],['curl',3,'12','9',60]] },
];
const TRAIN_OFFSETS = [0,1,3,4]; // Mon Tue Thu Fri

const blockStart = new Date('2026-10-19T12:00:00'); // Monday, week 3 = Nov 2
const blocks = [], weeks = [], days = [], rows = [], results = [], completions = [];
const prevBlock = { id: uid('b0'), name: 'Foundation', weeks: 4, start_date: '2026-09-21', end_date: '2026-10-18', status: 'Completed' };
const block = { id: uid('b0'), name: 'Strength build', weeks: 5, start_date: iso(blockStart), end_date: iso(addDays(blockStart, 34)), status: 'Active' };
const nextBlock = { id: uid('b0'), name: 'Peak', weeks: 4, start_date: iso(addDays(blockStart, 35)), end_date: iso(addDays(blockStart, 62)), status: 'Upcoming' };
const baseBlock = (b, i) => ({ archived: false, archived_at: null, archived_by: null, client_id: CLIENT_ID, client_visible: true, coach_notes: null, completed_at: null, completion_method: null, created_at: '2026-09-15T00:00:00Z', created_by: COACH_USER, est_minutes_per_workout: 60, goal: 'Strength', last_scheduled_at: null, last_scheduled_availability: null, prep_id: null, sort_order: i, source_template_block_key: null, source_template_id: null, source_template_schema_version: null, training_focus: 'Strength', updated_at: now, warmup_protocol_id: null, week_duration_days: 7, week_start_index: null, ...b });
blocks.push(baseBlock(prevBlock, 0), baseBlock(block, 1), baseBlock(nextBlock, 2));

const WEEK_LABELS = ['Build the base', 'Add load', 'Heavier top sets', 'Push it', 'Back off'];
let todayDayId = null;
for (let w = 0; w < 5; w++) {
  const wStart = addDays(blockStart, w*7);
  const week = { id: uid('w0'), block_id: block.id, week_index: w+1, archived: false, archived_at: null, archived_by: null, created_at: now, date_source: 'auto', deleted_at: null, deleted_by: null, start_date: iso(wStart), end_date: iso(addDays(wStart,6)), est_minutes: null, manual_completed_at: null, manual_completed_by: null, manually_completed: false, notes: null, phase: WEEK_LABELS[w], status: 'Active', training_days: ['Mon','Tue','Thu','Fri'], updated_at: now };
  weeks.push(week);
  DAYS.forEach((tpl, di) => {
    const date = addDays(wStart, TRAIN_OFFSETS[di]);
    const day = { id: uid('d0'), week_id: week.id, day_index: di+1, title: tpl.title, focus: null, subtitle: null, notes: null, notes_client_visible: true, archived: false, archived_at: null, archived_by: null, at_home_backup_session_key: null, created_at: now, deleted_at: null, deleted_by: null, duration_estimate_min: 60, duration_override_min: null, duration_source: 'estimate', is_custom: false, schedule_locked: false, schedule_source: 'auto', scheduled_date: iso(date), source_day_id: null, updated_at: now, warmup_mode: 'none', warmup_protocol_id: null };
    days.push(day);
    const isToday = iso(date) === iso(TODAY);
    if (isToday) todayDayId = day.id;
    const past = date < TODAY && !isToday;
    tpl.rows.forEach((r, ri) => {
      const [k, sets, reps, rpe, rest, notes] = r;
      const row = { id: uid('r0'), day_id: day.id, exercise_id: exById[k].id, exercises: exById[k], exercise_name_override: null, sort_order: ri, sets, reps_text: reps, rpe, rir: null, rest_seconds: rest, rest_seconds_override: null, notes: notes ?? null, load_lb: null, load_kg: null, load_unit: 'lb', percentage: null, percentage_basis: null, override_of_pct: null, basis_row_id: null, card_color: null, cardio_target_id: null, created_at: now, duration_seconds: null, duration_seconds_backup: null, estimated_seconds: null, estimated_seconds_override: null, intensity_techniques: [], manual_override: false, measurement_type: 'reps', movement_family: null, progression_method: null, purpose_label: null, reps_text_backup: null, tempo: null, time_profile: 'standard', tracking_type: 'load_reps', updated_at: now };
      rows.push(row);
      const logSets = past ? sets : (isToday && k === 'squat' ? 4 : isToday && k === 'rdl' ? 1 : 0);
      const loadsFor = { squat: [295, 295, 295, 295], bench: [205,205,205,205], dead: [365,365,365,365] };
      for (let s = 0; s < logSets; s++) {
        const base = loadsFor[k]?.[s] ?? ({ rdl: 225, row: 140, ohp: 55, pulldown: 150, lateral: 20, split: 45, curl: 110, legpress: 360, incline: 70 })[k];
        const repsN = parseInt(reps, 10);
        results.push({ id: uid('x0'), row_id: row.id, client_id: CLIENT_ID, set_index: s+1, actual_load: base, actual_load_lb: base, actual_load_kg: Math.round(base/2.2046*10)/10, actual_load_unit: 'lb', entered_unit: 'lb', entered_value: base, actual_reps: repsN, actual_rpe: isToday ? (k === 'rdl' ? '7' : ['6.5','7','7','7.5'][s]) : rpe, actual_rpe_num: Number(isToday ? (k === 'rdl' ? '7' : ['6.5','7','7','7.5'][s]) : rpe), actual_rir: null, actual_calories: null, completed_at: isToday ? `2026-11-06T17:${10+s*4 + (k === 'rdl' ? 20 : 0)}:00Z` : `${iso(date)}T17:00:00Z`, completed_duration_seconds: null, completion_method: 'manual', created_at: now, is_bodyweight: false, is_working_set: true, load_type: 'external', mean_concentric_velocity_mps: null, normalized_kg: null, normalized_lb: null, notes: null, scheduled_workout_id: null, timer_completed_at: null, timer_started_at: null, updated_at: now, video_url: null });
      }
    });
    if (past) completions.push({ id: uid('k0'), day_id: day.id, client_id: CLIENT_ID, completed_at: `${iso(date)}T18:05:00Z`, started_at: `${iso(date)}T17:00:00Z`, in_progress_at: null, created_at: now, updated_at: now, scheduled_workout_id: null, actual_duration_min: 58, logging_quality: 'complete', logged_sets_count: null, required_sets_count: null, session_rating: 4, completion_method: 'manual', completion_source: 'app', completed_with_missing_logs: false, client_notes: null, active_duration_seconds: 3480, elapsed_duration_seconds: 3500, last_activity_at: null, logging_percentage: 100, session_weight_total: null, session_weight_unit: 'lb', skipped_exercises_count: 0, training_started_at: null, pl_workout_feedback: [] });
    if (isToday) completions.push({ id: uid('k0'), day_id: day.id, client_id: CLIENT_ID, completed_at: null, started_at: '2026-11-06T17:02:00Z', in_progress_at: '2026-11-06T17:02:00Z', training_started_at: '2026-11-06T17:02:00Z', last_activity_at: '2026-11-06T17:18:00Z', created_at: now, updated_at: now, scheduled_workout_id: null, pl_workout_feedback: [] });
  });
}
// nest for the tree query
const nested = blocks.map(b => ({ ...b, pl_weeks: weeks.filter(w => w.block_id === b.id).map(w => ({ ...w, pl_days: days.filter(d => d.week_id === w.id).map(d => ({ ...d, pl_exercise_rows: rows.filter(r => r.day_id === d.id).map(r => ({ ...r, pl_row_results: results.filter(x => x.row_id === r.id) })) })) })) }));

const client = { id: CLIENT_ID, user_id: USER_ID, first_name: 'Alex', last_name: 'Demo', full_name: 'Alex Demo', preferred_name: 'Alex', email: 'demo.athlete@example.com', status: 'Active', service_tier: 'coaching', archived: false, assigned_coach_id: COACH_ID, coaching_type: 'Online', preferred_weight_unit: 'lb', weight_unit_confirmed_at: '2026-01-01T00:00:00Z', committed_training_days: ['Monday','Tuesday','Thursday','Friday'], committed_training_frequency: 4, training_schedule_completed: true, available_training_days: ['Mon','Tue','Thu','Fri','Sat'], timezone: 'America/Winnipeg', time_zone: 'America/Winnipeg', agreement_signed: true, agreement_status: 'Signed', payment_status: 'Active', portal_access_disabled: false, home_screen_setup_status: 'completed', home_screen_setup_completed_at: '2026-01-01T00:00:00Z', basic_info_completed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', profile_picture_url: null, goals: 'Get stronger', account_status: 'active' };

function byFilter(table, url) {
  // narrow by the common equality filters so per-id reads get the right row
  const list = { pl_blocks: nested, pl_weeks: weeks, pl_days: days.map(d => ({ ...d, pl_weeks: { ...weeks.find(w => w.id === d.week_id), pl_blocks: blocks.find(b => b.id === weeks.find(w => w.id === d.week_id).block_id) } })), pl_exercise_rows: rows, pl_row_results: results, pl_day_completions: completions }[table];
  let out = list;
  for (const [k, v] of url.searchParams.entries()) {
    if (!v.startsWith('eq.') && !v.startsWith('in.(')) continue;
    if (k.includes('.')) continue;
    const vals = v.startsWith('eq.') ? [v.slice(3)] : v.slice(4, -1).split(',').map(s => s.replace(/"/g,''));
    if (!out.length || !(k in out[0])) continue;
    out = out.filter(r => vals.includes(String(r[k])));
  }
  return out;
}
const fixtures = {
  clients: [client],
  user_roles: [{ id: uid('u0'), user_id: USER_ID, role: 'client' }],
  profiles: [{ id: USER_ID, user_id: USER_ID, first_name: 'Alex', last_name: 'Demo', full_name: 'Alex Demo', email: client.email, avatar_url: null, theme: 'dark' }],
  coaches: [{ id: COACH_ID, user_id: COACH_USER, name: 'Jared McIntyre', first_name: 'Jared', last_name: 'McIntyre', active: true }],
  exercises,
  pl_blocks: (u) => byFilter('pl_blocks', u),
  pl_weeks: (u) => byFilter('pl_weeks', u),
  pl_days: (u) => byFilter('pl_days', u),
  pl_exercise_rows: (u) => byFilter('pl_exercise_rows', u),
  pl_row_results: (u) => byFilter('pl_row_results', u),
  pl_day_completions: (u) => byFilter('pl_day_completions', u),
  feature_announcement_views: [{ id: 'f1', user_id: USER_ID, feature_key: 'theme', announcement_key: 'theme', seen_at: now, created_at: now }],
};
module.exports = { fixtures, todayDayId, USER_ID, CLIENT_ID, COACH_USER, client, uid };
