/**
 * Exercise classifier — movement pattern, primary/secondary muscles and
 * equipment from an exercise's name (plus category as a weak hint).
 *
 * One source of truth for:
 *  - muscle analytics (primary = 1 set, secondary = ½ set — see volume.ts),
 *  - Quick Swap ("same pattern + same primary muscles" = a real substitute;
 *    hip ABduction ≠ hip ADduction even though both are "hip" work),
 *  - auto-tagging new library entries.
 *
 * Muscle keys match exercise_taxonomy / volume.ts: chest, lats, upper_back,
 * traps, front_delts, side_delts, rear_delts, biceps, triceps, forearms, quads,
 * hamstrings, glutes, adductors, calves, core, lower_back, other.
 *
 * Rules are ordered most-specific first and tag what matters for training
 * (what a coach would count), not every muscle that technically fires.
 * Pure function, no I/O.
 */

export type MuscleKey =
  | "chest"
  | "lats"
  | "upper_back"
  | "traps"
  | "front_delts"
  | "side_delts"
  | "rear_delts"
  | "biceps"
  | "triceps"
  | "forearms"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "adductors"
  | "calves"
  | "core"
  | "lower_back"
  | "other";

export type MovementPattern =
  | "squat"
  | "hinge"
  | "lunge"
  | "knee_extension"
  | "knee_flexion"
  | "hip_thrust"
  | "hip_abduction"
  | "hip_adduction"
  | "hip_flexion"
  | "calf_raise"
  | "back_extension"
  | "horizontal_press"
  | "incline_press"
  | "vertical_press"
  | "dip"
  | "chest_fly"
  | "horizontal_pull"
  | "vertical_pull"
  | "pullover"
  | "shrug"
  | "rear_delt"
  | "lateral_raise"
  | "front_raise"
  | "elbow_flexion"
  | "elbow_extension"
  | "wrist"
  | "core_flexion"
  | "core_anti_extension"
  | "core_rotation"
  | "core_lateral"
  | "carry"
  | "olympic"
  | "plyometric"
  | "conditioning"
  | "mobility"
  | "other";

export type Equipment =
  | "Barbell"
  | "Dumbbell"
  | "Machine"
  | "Cable"
  | "Smith Machine"
  | "Kettlebell"
  | "Bodyweight"
  | "Bands"
  | "Other";

export interface ExerciseProfile {
  pattern: MovementPattern;
  primary: MuscleKey[];
  secondary: MuscleKey[];
  equipment: Equipment | null;
  /** True when a movement rule matched (false = fell back to defaults). */
  matched: boolean;
}

/** Normalised name: lowercase words separated by single spaces, padded with a space each side. */
export const normName = (s: string | null | undefined) =>
  " " +
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() +
  " ";

/**
 * A name test. Plain data (no functions) so the database can run the exact same
 * rules: see exercise-classifier-sql.ts, which generates public.exercise_classify.
 */
export type Match = RegExp | { re: RegExp; and?: RegExp; not?: RegExp };

export const matches = (m: Match, n: string): boolean =>
  m instanceof RegExp
    ? m.test(n)
    : m.re.test(n) && (!m.and || m.and.test(n)) && !(m.not && m.not.test(n));

/** Ordered equipment rules: the first match wins. */
export const EQUIPMENT_RULES: ReadonlyArray<{ match: Match; equipment: Equipment }> = [
  { match: / smith /, equipment: "Smith Machine" },
  {
    match:
      / (barbell|bb|ez bar|ez|trap bar|hex bar|safety bar|ssb|landmine|axle|cambered|swiss bar|football bar) /,
    equipment: "Barbell",
  },
  { match: / (dumbbell|dumbbells|db) /, equipment: "Dumbbell" },
  { match: / (kettlebell|kettlebells|kb) /, equipment: "Kettlebell" },
  {
    match: / (cable|cables|rope|pulldown|pull down|lat pull|pushdown|push down|crossover) /,
    equipment: "Cable",
  },
  { match: / (band|bands|banded|resistance band|mini band) /, equipment: "Bands" },
  {
    match:
      / (machine|hammer strength|leg press|hack squat|pendulum|belt squat|pec deck|selectorized|plate loaded|seated row machine|chest supported row machine|multi hip|glute ham|ghd|reverse hyper|leg extension|leg curl) /,
    equipment: "Machine",
  },
  {
    match:
      / (push up|pushup|pull up|pullup|chin up|chinup|dip|dips|plank|bodyweight|bw|air squat|inverted row|nordic|sit up|situp|crunch|burpee|jump|hollow|l sit|muscle up|pistol) /,
    equipment: "Bodyweight",
  },
];

export function inferEquipment(name: string): Equipment | null {
  const n = normName(name);
  return EQUIPMENT_RULES.find((r) => matches(r.match, n))?.equipment ?? null;
}

export type Rule = {
  match: Match;
  pattern: MovementPattern;
  primary: MuscleKey[];
  secondary: MuscleKey[];
};

const R = (
  match: Match,
  pattern: MovementPattern,
  primary: MuscleKey[],
  secondary: MuscleKey[] = [],
): Rule => ({ match, pattern, primary, secondary });

/** Ordered rules: the first match wins (specific movements before generic words). */
export const RULES: ReadonlyArray<Rule> = [
  // ── non-training / conditioning (kept out of muscle volume) ──
  R(
    /stretch|mobility|yoga|pose|foam roll|smr|lacrosse ball|release|cat cow|90 90|world s greatest|thread the needle|circles|dislocat| cars |basic toe touch|standing toe touch|forward fold/,
    "mobility",
    ["other"],
  ),
  R(
    / (walk|walking|jog|jogging|run|running|sprint|bike|cycling|airbike|assault|row erg|rowing machine|ski erg|ski ergometer|elliptical|stair|treadmill|jump rope|skipping|jumping jack|battle rope|agility|shadow box|punch|punches|march|marching|sled push|prowler|ball slam|slams|burpee) /,
    "conditioning",
    ["other"],
  ),
  R(
    {
      re: / (clean|snatch|jerk|high pull) /,
      not: / (grip deadlift|snatch deadlift|clean deadlift) /,
    },
    "olympic",
    ["quads", "glutes", "traps"],
    ["hamstrings", "upper_back", "calves"],
  ),
  R(
    / (clap push|plyo push|plyometric push) /,
    "horizontal_press",
    ["chest", "triceps"],
    ["front_delts"],
  ),
  R(
    / (box jump|broad jump|depth jump|jump squat|squat jump|tuck jump|bound|bounding|pogo|plyo|med ball throw|medicine ball throw|lateral hop|skater jump) /,
    "plyometric",
    ["quads", "glutes"],
    ["calves"],
  ),

  // ── hip abduction / adduction / flexion / glute isolation ──
  R(
    / (copenhagen|adduction|adductor|adductors|hip adduct|groin squeeze|inner thigh) /,
    "hip_adduction",
    ["adductors"],
    ["core"],
  ),
  R(
    / (abduction|abductor|abductors|clamshell|clam shell|clams?|fire hydrants?|monster walks?|lateral band walks?|band walks?|crab walks?|side lying leg (raise|lift)s?|side lying hip raises?|standing side leg raises?|side kicks?) /,
    "hip_abduction",
    ["glutes"],
  ),
  R(/ (hip flexion|hip flexor march|psoas march) /, "hip_flexion", ["core"]),
  R(
    {
      re: / (glute kick ?backs?|kickback glute|donkey kicks?|glute medius kickback|hip extension|glute extension|cable kickback|reverse lunge kickback|quadruped kickback|rear kicks?) /,
      not: / pullover /,
    },
    "hip_thrust",
    ["glutes"],
    ["hamstrings"],
  ),

  // ── small joints first (so "grip", "incline", "bench" can't steal them) ──
  R(
    / ((external|internal) (shoulder )?rotation?|rotator|cuban|no money) /,
    "rear_delt",
    ["rear_delts"],
    ["upper_back"],
  ),
  R(/ (upward rotation|scapular elevation) /, "shrug", ["traps"]),
  R(
    / (wrist curl|wrist extension|reverse wrist|wrist roller|pronation|supination|palm up palm down|gripper|grip trainer|grip strength|hand grip|dead hang|plate pinch|farmer s hold) /,
    "wrist",
    ["forearms"],
  ),
  R(
    / (calf|calves|calve|heel raises?|donkey raises?|tibialis|tib raises?|toe raises?|plantar flexion|dorsal flexion) /,
    "calf_raise",
    ["calves"],
  ),

  // ── posterior chain ──
  R(/ (mountain climber) /, "core_flexion", ["core"]),
  R(
    / (nordic|glute ham raise|ghr|leg curl|hamstring curl|lying curl|seated curl machine|slider curl|stability ball curl|swiss ball leg curl|ball leg curl) /,
    "knee_flexion",
    ["hamstrings"],
    ["calves"],
  ),
  R(
    / (hip thrusts?|hip thrusters?|glute bridges?|frog pumps?|kas glute|glute drive|bridge) /,
    "hip_thrust",
    ["glutes"],
    ["hamstrings"],
  ),
  R(
    / (romanian|rdl|stiff leg|stiff legged|sldl|good mornings?|single leg deadlift|b stance deadlift|kickstand deadlift) /,
    "hinge",
    ["hamstrings", "glutes"],
    ["lower_back", "forearms"],
  ),
  R(
    / (back extension|hyperextension|hyper extension|reverse hyper|45 degree (back|hyper|glute)|superman|bird dog) /,
    "back_extension",
    ["lower_back", "glutes"],
    ["hamstrings"],
  ),
  R(
    / (kettlebell swings?|kb swings?|dumbbell swings?|pull ?throughs?) /,
    "hinge",
    ["glutes", "hamstrings"],
    ["lower_back", "core"],
  ),
  R(
    / (trap bar deadlift|hex bar deadlift|trap bar pull) /,
    "hinge",
    ["quads", "glutes", "hamstrings"],
    ["lower_back", "traps", "forearms"],
  ),
  R(
    / (deadlifts?|rack pulls?|block pulls?|deficit pulls?) /,
    "hinge",
    ["glutes", "hamstrings", "lower_back"],
    ["quads", "upper_back", "traps", "forearms", "adductors"],
  ),

  // ── knee extension before "extension" (triceps) ──
  R(
    / (leg extension|knee extension|sissy squat|reverse nordic|spanish squat|terminal knee) /,
    "knee_extension",
    ["quads"],
  ),

  // ── arms ──
  R(
    / (bench dip|chair dip|triceps dip|tricep dip|dip on floor|between chairs|floor dip|couch) /,
    "dip",
    ["triceps"],
    ["chest", "front_delts"],
  ),
  R(/ (reverse curl|hammer curl|zottman) /, "elbow_flexion", ["biceps", "forearms"]),
  R(/ (curl|curls) /, "elbow_flexion", ["biceps"], ["forearms"]),
  R(
    / (jm press|close grip bench|close grip press|cg bench|close grip floor press|close grip push up|diamond push up|tate press) /,
    "horizontal_press",
    ["triceps", "chest"],
    ["front_delts"],
  ),
  R(
    / (tricep|triceps|pushdown|push down|skull crusher|skullcrusher|kickback|french press|overhead extension|lying extension|elbow extension) /,
    "elbow_extension",
    ["triceps"],
  ),

  // ── shoulders ──
  R(
    / (face ?pulls?|rear delt|rear deltoid|reverse fly|reverse flye|reverse machine fly|reverse cable fly|reverse dumbbell fly|rear fly|rear lateral|reverse pec deck|band pull apart|pull apart|bent over fly|bent over raise|bent over lateral|prone t|t raise|w raise|breeding) /,
    "rear_delt",
    ["rear_delts"],
    ["upper_back"],
  ),
  R(/ (upright rows?) /, "lateral_raise", ["side_delts", "traps"]),
  R(
    / (lateral raises?|side raises?|lat raises?|lateral delt|lu raises?|shoulder abduction|iron cross|y raises?|prone y|side lying one hand raise) /,
    "lateral_raise",
    ["side_delts"],
    ["traps"],
  ),
  R(
    / (front raises?|plate raises?|shoulder flexion|alternate raises?|vertical front raises?|cross raises?) /,
    "front_raise",
    ["front_delts"],
  ),
  R(/ (shrug|shrugs) /, "shrug", ["traps"], ["forearms"]),

  // ── legs ──
  R(
    / (wall sit|lunge|lunges|split squat|bulgarian|step up|stepup|step ups|step down|curtsy|pistol|skater squat|single leg squat|rear foot elevated|rfess) /,
    "lunge",
    ["quads", "glutes"],
    ["adductors", "hamstrings"],
  ),
  R(/ (thrusters?) /, "squat", ["quads", "glutes", "front_delts"], ["triceps", "core"]),
  R(
    / (leg press|hack squat|pendulum squat|belt squat|v squat) /,
    "squat",
    ["quads", "glutes"],
    ["adductors"],
  ),
  R(
    / (front squat|goblet squat|zercher|cyclist squat|heel elevated squat|high bar|highbar) /,
    "squat",
    ["quads", "glutes"],
    ["adductors", "upper_back", "core"],
  ),
  R(/ (squat|squats) /, "squat", ["quads", "glutes", "adductors"], ["lower_back", "core"]),

  // ── pulling before pressing ("incline row", "bench pull up") ──
  R(
    / (pullover|pull over|straight arm pulldown|straight arm pull down|lat prayer|shoulder adduction|shoulder extension) /,
    "pullover",
    ["lats"],
    ["chest", "triceps"],
  ),
  R(
    / (pull up|pullup|pull ups|pullups|chin up|chinup|chin ups|pulldown|pull down|lat pull|muscle up) /,
    "vertical_pull",
    ["lats"],
    ["biceps", "upper_back"],
  ),
  R(
    / (row|rows|seal row|pendlay|meadows|kroc|t bar|renegade) /,
    "horizontal_pull",
    ["upper_back", "lats"],
    ["rear_delts", "biceps"],
  ),

  // ── pressing ──
  R(/ (dip|dips) /, "dip", ["chest", "triceps"], ["front_delts"]),
  R(
    / (fly|flye|flyes|flys|pec deck|crossovers?|cross over|squeeze fly|high to low|low to high) /,
    "chest_fly",
    ["chest"],
    ["front_delts"],
  ),
  R(
    / (overhead press|ohp|military press|shoulder press|shoulders press|shoulder pres|push press|strict press|arnold press|landmine press|landmine alternating single arm press|z press|seated press|seated alternate press|alternate side press|palms in press|scott press|w press|y press|seesaw press|behind neck press|anti gravity press|press under|viking press|pike push ups?|handstand push|hspu) /,
    "vertical_press",
    ["front_delts"],
    ["triceps", "side_delts"],
  ),
  R(
    { re: / incline /, and: /(press|push up|pushup)/ },
    "incline_press",
    ["chest", "front_delts"],
    ["triceps"],
  ),
  R(
    / (bench press|competition bench|dead bench|paused? bench|flat bench|touch and go bench|floor press|spoto|spotto|larsen|pin press|board press|chest press|push up|pushup|push ups|pushups|press up|svend|plate press|squeeze press|hex press|decline press|decline hammer press|decline one arm hammer press|decline bench|close neutral grip press|dumbbell press|db press|machine press|band press) /,
    "horizontal_press",
    ["chest", "triceps"],
    ["front_delts"],
  ),

  // ── loaded carries ──
  R(
    / (farmer|farmers|suitcase carry|carry|carries|yoke) /,
    "carry",
    ["forearms", "traps", "core"],
    ["glutes"],
  ),

  // ── core ──
  R(/ (side plank|side bends?|oblique|windmill) /, "core_lateral", ["core"]),
  R(
    / (plank|ab wheel|rollout|roll out|dead bug|deadbug|hollow|body saw|stir the pot|bear hold|l sit) /,
    "core_anti_extension",
    ["core"],
  ),
  R(
    / (pallof|palloff|woodchop|wood chop|wood choppers?|diagonal chop|chop|russian twist|rotation|rotational|twist|twisting|landmine 180|anti rotation) /,
    "core_rotation",
    ["core"],
  ),
  R(/ (front lever|back lever|dragon flag) /, "core_anti_extension", ["core", "lats"]),
  R(/ (turkish get ?up|tgu) /, "core_lateral", ["core", "front_delts"], ["glutes"]),
  R(/ (handstand hold|hand stand hold) /, "vertical_press", ["front_delts"], ["triceps", "core"]),
  R(
    / (crunch|crunches|sit up|situp|sit ups|situps|leg raises?|knee raises?|toes to bar|v up|vup|flutter|scissors?|toe touch|toe touches|jackknife|jack knives|hanging raise|mountain climbers?|heel touch|heel touches|knee tucks?|bicycles?|wind wipers|dragonfly|leg lifts?|toe taps?|abs|ab) /,
    "core_flexion",
    ["core"],
  ),
];

/**
 * Refinements a coach would make once the movement is known; the first one
 * whose pattern and name test match replaces primary and/or secondary muscles.
 */
export const REFINEMENTS: ReadonlyArray<{
  pattern: MovementPattern;
  match: Match;
  primary?: MuscleKey[];
  secondary?: MuscleKey[];
}> = [
  {
    pattern: "horizontal_pull",
    match: /wide/,
    primary: ["upper_back", "rear_delts"],
    secondary: ["biceps"],
  },
  {
    pattern: "horizontal_pull",
    match: /(lat focus|lat row|kayak|single arm|one arm|1 arm)/,
    primary: ["lats", "upper_back"],
    secondary: ["biceps", "rear_delts"],
  },
  {
    pattern: "vertical_pull",
    match: /(chin|underhand|supinated)/,
    secondary: ["biceps", "upper_back"],
  },
  { pattern: "squat", match: /(sumo|wide stance|plie)/, primary: ["quads", "glutes", "adductors"] },
  {
    pattern: "hinge",
    match: { re: /(sumo)/, not: /(romanian|rdl|stiff)/ },
    primary: ["glutes", "quads", "adductors"],
    secondary: ["hamstrings", "lower_back", "upper_back", "forearms"],
  },
  {
    pattern: "horizontal_press",
    match: /(wide grip)/,
    primary: ["chest"],
    secondary: ["front_delts", "triceps"],
  },
  {
    pattern: "lunge",
    match: /(lateral lunge|side lunge|cossack)/,
    primary: ["adductors", "quads", "glutes"],
    secondary: [],
  },
];

/** A library category of "stretching"/"yoga" decides only when the name names no movement. */
export const isMobilityCategory = (category: string | null | undefined) => {
  const c = String(category ?? "").toLowerCase();
  return c.includes("stretch") || c === "yoga";
};

/**
 * Classify an exercise. `category` (library category text) is only a fallback
 * for stretches; the name decides everything else.
 */
export function classifyExercise(name: string, category?: string | null): ExerciseProfile {
  const n = normName(name);
  const equipment = inferEquipment(name);
  // Any stretch/mobility word wins first: "Banded Hip Flexor Stretch" is a
  // stretch even though it names a hip movement.
  const rule = RULES.find((r) => matches(r.match, n));
  if (!rule) {
    // "Glute Bridge" filed under Stretching is still a bridge — so the category
    // only decides here, after every movement rule has had its chance.
    if (isMobilityCategory(category))
      return {
        pattern: "mobility",
        primary: ["other"],
        secondary: [],
        equipment: null,
        matched: true,
      };
    return { pattern: "other", primary: ["other"], secondary: [], equipment, matched: false };
  }
  const ref = REFINEMENTS.find((r) => r.pattern === rule.pattern && matches(r.match, n));
  const primary = [...(ref?.primary ?? rule.primary)];
  const secondary = (ref?.secondary ?? rule.secondary).filter((m) => !primary.includes(m));
  return {
    pattern: rule.pattern,
    primary,
    secondary,
    // Stretches carry no load: don't let "crossover" etc. invent a cable.
    equipment: rule.pattern === "mobility" && equipment !== "Bands" ? null : equipment,
    matched: true,
  };
}

/**
 * The database stores a coarser movement vocabulary (CHECK constraint on
 * exercises.primary_movement_pattern); this is how each fine pattern maps to it.
 */
export const COARSE_PATTERN: Record<MovementPattern, string> = {
  squat: "squat",
  lunge: "squat",
  hinge: "hip_hinge",
  back_extension: "hip_hinge",
  knee_extension: "knee_extension",
  knee_flexion: "hamstring_curl",
  hip_thrust: "glutes",
  hip_abduction: "glutes",
  hip_adduction: "other",
  hip_flexion: "core",
  calf_raise: "other",
  horizontal_press: "horizontal_push",
  incline_press: "horizontal_push",
  dip: "horizontal_push",
  chest_fly: "horizontal_push",
  vertical_press: "vertical_push",
  horizontal_pull: "horizontal_pull",
  vertical_pull: "vertical_pull",
  pullover: "vertical_pull",
  shrug: "other",
  rear_delt: "delts",
  lateral_raise: "delts",
  front_raise: "delts",
  elbow_flexion: "arms",
  elbow_extension: "arms",
  wrist: "arms",
  core_flexion: "core",
  core_anti_extension: "core",
  core_rotation: "core",
  core_lateral: "core",
  carry: "conditioning",
  olympic: "conditioning",
  plyometric: "conditioning",
  conditioning: "conditioning",
  mobility: "other",
  other: "other",
};

/** Patterns that never build muscle volume (stretches, cardio). */
export const NON_VOLUME_PATTERNS: ReadonlyArray<MovementPattern> = ["mobility", "conditioning"];

/** Movement patterns that are real substitutes for each other in a swap. */
export const COMPATIBLE_PATTERNS: Partial<Record<MovementPattern, MovementPattern[]>> = {
  horizontal_press: ["incline_press", "dip"],
  incline_press: ["horizontal_press", "vertical_press"],
  vertical_press: ["incline_press"],
  dip: ["horizontal_press", "elbow_extension"],
  horizontal_pull: ["vertical_pull"],
  vertical_pull: ["horizontal_pull", "pullover"],
  pullover: ["vertical_pull"],
  squat: ["lunge", "knee_extension"],
  lunge: ["squat"],
  knee_extension: ["squat"],
  hinge: ["hip_thrust", "back_extension"],
  hip_thrust: ["hinge"],
  back_extension: ["hinge"],
  rear_delt: ["horizontal_pull"],
  core_anti_extension: ["core_flexion"],
  core_flexion: ["core_anti_extension"],
};

export interface SwapCandidateMeta {
  pattern: string | null;
  primary: string[];
  secondary?: string[];
  equipment?: string | null;
}

/**
 * How good a substitute `cand` is for `src` (0–100). Same movement pattern and
 * primary muscles score highest; a compatible pattern still scores; a different
 * primary-muscle target scores low (and should show the "Different target"
 * warning).
 */
export function swapScore(src: SwapCandidateMeta, cand: SwapCandidateMeta): number {
  const sp = new Set(src.primary.filter((m) => m !== "other"));
  const cp = new Set(cand.primary.filter((m) => m !== "other"));
  const overlap = [...sp].filter((m) => cp.has(m)).length;
  const union = new Set([...sp, ...cp]).size || 1;
  const muscle = overlap / union; // Jaccard on primary muscles
  const secOverlap = (src.secondary ?? []).filter(
    (m) => cand.primary.includes(m) || (cand.secondary ?? []).includes(m),
  ).length;
  let pattern = 0;
  if (src.pattern && cand.pattern) {
    if (src.pattern === cand.pattern) pattern = 1;
    else if (
      COMPATIBLE_PATTERNS[src.pattern as MovementPattern]?.includes(cand.pattern as MovementPattern)
    )
      pattern = 0.5;
  }
  return Math.round(55 * muscle + 35 * pattern + Math.min(10, secOverlap * 3));
}

/** True when the candidate trains a genuinely different primary target. */
export function isDifferentTarget(src: SwapCandidateMeta, cand: SwapCandidateMeta): boolean {
  const sp = src.primary.filter((m) => m !== "other");
  const cp = cand.primary.filter((m) => m !== "other");
  if (!sp.length || !cp.length) return false; // unknown → don't cry wolf
  const sharesMuscle = sp.some((m) => cp.includes(m));
  // Same muscle but opposite hip action (abduction vs adduction) is still different.
  const opposite = (a: string | null, b: string | null) =>
    (a === "hip_abduction" && b === "hip_adduction") ||
    (a === "hip_adduction" && b === "hip_abduction");
  return !sharesMuscle || opposite(src.pattern, cand.pattern);
}
