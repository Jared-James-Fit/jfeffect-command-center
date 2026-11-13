/**
 * Every exercise the 12 JF Effect library programs use, pinned to the live
 * exercise library's own record (read Nov 13 2026). Where the library holds
 * two entries for one movement (one used for months, one with a demo video
 * and little history), the one clients already have history on wins, so
 * "Last time", PRs and analytics carry straight over; the pairs are listed in
 * DUPLICATE_PAIRS for a later, deliberate merge (admin_make_exercise_alias).
 *
 * Six zero-equipment movements had no entry at all; they are created once by
 * the import (NEW_EXERCISES), under fixed ids, and only when no exercise of
 * the same name exists.
 */

export type ExKind = "main" | "secondary" | "compound" | "isolation" | "core" | "timed";

export type CatalogExercise = {
  id: string;
  /** exercises.name: what the logger shows */
  name: string;
  kind: ExKind;
  /** pl_exercise_rows.time_profile (session-length estimate) */
  timeProfile: "main_lift" | "secondary_lift" | "accessory_compound" | "accessory_isolation";
};

const ex = (id: string, name: string, kind: ExKind): CatalogExercise => ({
  id,
  name,
  kind,
  timeProfile:
    kind === "main" ? "main_lift"
    : kind === "secondary" ? "secondary_lift"
    : kind === "isolation" || kind === "core" || kind === "timed" ? "accessory_isolation"
    : "accessory_compound",
});

/** The six movements the library lacked (zero-equipment programs). */
export const NEW_EXERCISES = {
  proneW: {
    id: "6a1d2f0e-3b0c-5c4e-9f11-0a7e1c2b3d01",
    name: "Prone W Raise",
    category: "Back",
    muscle_group: "Upper Back, Rear Delts",
    primary_muscle_group: "Upper Back",
    equipment: "Bodyweight",
    cues: "Lie face down, elbows bent into a W\nSqueeze the shoulder blades back and down\nLift the arms an inch or two, hold 1 second\nKeep the neck long and the lower back quiet",
    pattern: "horizontal_pull",
  },
  proneYTW: {
    id: "6a1d2f0e-3b0c-5c4e-9f11-0a7e1c2b3d02",
    name: "Prone Y-T-W Raise",
    category: "Back",
    muscle_group: "Upper Back, Rear Delts",
    primary_muscle_group: "Upper Back",
    equipment: "Bodyweight",
    cues: "Lie face down, thumbs up\nRaise the arms in a Y, then a T, then a W\nLead with the shoulder blades, not the lower back\nSlow reps, 1-second hold at the top",
    pattern: "horizontal_pull",
  },
  proneSnowAngel: {
    id: "6a1d2f0e-3b0c-5c4e-9f11-0a7e1c2b3d03",
    name: "Prone Reverse Snow Angel",
    category: "Back",
    muscle_group: "Upper Back, Rear Delts",
    primary_muscle_group: "Upper Back",
    equipment: "Bodyweight",
    cues: "Lie face down, arms by your sides, palms down\nLift the arms off the floor and sweep them overhead\nSweep back down without touching the floor\nKeep the chest down and the neck long",
    pattern: "horizontal_pull",
  },
  splitSquat: {
    id: "6a1d2f0e-3b0c-5c4e-9f11-0a7e1c2b3d04",
    name: "Split Squat",
    category: "Legs",
    muscle_group: "Quads, Glutes",
    primary_muscle_group: "Quads",
    equipment: "Bodyweight",
    cues: "Long stance, both feet pointing forward\nDrop the back knee straight down\nFront knee travels forward over the toes\nPush through the whole front foot to stand",
    pattern: "squat",
  },
  singleLegCalf: {
    id: "6a1d2f0e-3b0c-5c4e-9f11-0a7e1c2b3d05",
    name: "Single-Leg Calf Raise",
    category: "Legs",
    muscle_group: "Calves",
    primary_muscle_group: "Calves",
    equipment: "Bodyweight",
    cues: "Stand on one foot, lightly touch a wall for balance\nRise as high as you can and pause\nLower slowly all the way down\nKeep the knee straight but not locked",
    pattern: "other",
  },
  singleLegBridge: {
    id: "6a1d2f0e-3b0c-5c4e-9f11-0a7e1c2b3d06",
    name: "Single-Leg Glute Bridge",
    category: "Legs",
    muscle_group: "Glutes, Hamstrings",
    primary_muscle_group: "Glutes",
    equipment: "Bodyweight",
    cues: "One heel planted close to the hips, other knee pulled in\nDrive through the heel and lift the hips level\nSqueeze the glute and hold 1 second at the top\nDon't let the hips twist or drop",
    pattern: "glutes",
  },
} as const;

export const EX = {
  // competition lifts and their variations
  compSquat: ex("e6ae87a4-29ae-4547-9916-5a61ca507bae", "Competition Squat", "main"),
  compBench: ex("3f9b70db-c277-42fc-af09-fc10a222429b", "Competition Bench", "main"),
  compDeadlift: ex("c01ef5f7-9d97-4296-939d-306acc5bc1c9", "Competition Deadlift", "main"),
  pausedBench: ex("2ccdba15-4237-4123-93be-8e502a0b1b22", "Paused Bench Press", "secondary"),
  pauseDeadlift: ex("6a86c185-bcde-4f68-94f1-cd35596414ab", "Pause Deadlifts", "secondary"),
  highBarSquat: ex("c778e088-c9c5-46a9-832e-7a415cc9acfb", "High Bar Squat", "secondary"),
  cgBlockPress: ex("ef170271-59e5-4dd2-8202-1a8f64c0b630", "Close-Grip Block Press", "secondary"),
  beltSquat: ex("fc0d5993-2fba-4927-99e0-7c082a842647", "Belt Squat", "compound"),
  // gym lower body
  legPress: ex("931ace15-7bc2-46cb-bdfd-549dd7f932bc", "Leg Press", "compound"),
  gobletSquat: ex("504dd0d0-6cb9-480b-b7e6-fb9f76d173f8", "Goblet Squat", "compound"),
  rdl: ex("d77d3107-be4e-4857-930e-0ad955024255", "Romanian Deadlift", "compound"),
  dbRdl: ex("7de26b7d-ea0d-4c79-bc69-5c00f5c39839", "Dumbbell Romanian Deadlift", "compound"),
  bStanceRdl: ex("1f3fb474-85ce-4189-bcd1-3b2e1f20513e", "B Stance Dumbbell Romanian Deadlift", "compound"),
  hipThrust: ex("b968ee50-8a25-47f1-aba5-75e2b4fba115", "Hip Thrust - Barbell", "compound"),
  bss: ex("07e3c6d3-c663-4961-b5b8-7aaf38b0676e", "Bulgarian Split Squats", "compound"),
  dbSplitSquat: ex("6f9a65f0-6852-4ee9-82e2-503a76f0d6d7", "Dumbbell Split Squat", "compound"),
  dbReverseLunge: ex("7bbfbca2-b728-4cb9-8fce-b633ef81f4b9", "Dumbbell Reverse Lunge", "compound"),
  dbStepUp: ex("789a6a5f-0343-49bd-a271-2a56b1d78cd5", "Dumbbell Step Up On Bench", "compound"),
  walkingLunge: ex("70f8e53e-ed06-4dd1-8ffc-2f5ba6adf15e", "Walking Lunges", "compound"),
  legExtension: ex("06b9136b-3277-4212-9a9e-b4ec91e6fb2d", "Leg Extension - Machine", "isolation"),
  seatedLegCurl: ex("7f552c69-90ab-497c-9e86-5a6e162a89fb", "Seated Leg Curl Machine", "isolation"),
  lyingLegCurl: ex("64f2d203-0007-4864-a3df-8f8b2dde42c7", "Lying Hamstring Curl - Machine", "isolation"),
  hipAbduction: ex("649f2231-adf0-4eab-ae31-05b922c06b19", "Abduction Machine", "isolation"),
  adductor: ex("ce527474-e420-4da9-a544-e5bf3ab7207c", "Adductor Machine", "isolation"),
  standingCalf: ex("ff79b0b1-463d-40fc-aa59-203a5f326524", "Standing Calf Raise - Machine", "isolation"),
  seatedCalf: ex("e4cd9b67-dc0d-4b8d-a6d1-74a102492c23", "Seated Calf Raise", "isolation"),
  dbGluteBridge: ex("d3f91cd5-c971-4198-b636-0d950a5ae636", "Dumbbell Glute Bridge", "compound"),
  dbStandingCalf: ex("355f89da-6555-4b4a-8707-65d6bc1a1381", "Dumbbell Standing Calf Raise", "isolation"),
  // gym upper body
  bbBench: ex("f4a3c012-eabe-45d7-b9bf-07fc6c5064e6", "Barbell Bench Press", "compound"),
  dbBench: ex("48117e3b-ac08-4bef-a766-2c35aff4fc02", "Flat Bench Press - Dumbbell", "compound"),
  inclineDbPress: ex("66912787-82f3-4450-9d8f-c53ce4d9dca4", "Incline Dumbbell Press", "compound"),
  inclineSmith: ex("874bf10e-a9e0-45d6-a6bc-3df0b176c1e5", "Smith Machine Press Incline", "compound"),
  machineChestPress: ex("e6f53f0c-aef4-42eb-a416-3058781da6ed", "Chest Press Machine", "compound"),
  pecDeck: ex("dde3a9e9-d137-4231-bf75-091889767208", "Pec Deck", "isolation"),
  cableFly: ex("f0bdb57d-55fa-4ed8-85e3-d4c1f68e1e99", "Cable Fly", "isolation"),
  seatedDbPress: ex("60e6b45c-aaf8-4a2a-a1f2-adac1a1ff621", "Seated Shoulder Press - Dumbbell", "compound"),
  latPulldown: ex("873ba980-43d3-47ec-aedc-f50f678c4039", "Chin-Grip Lat Pulldown", "compound"),
  neutralPulldown: ex("6dee8220-649e-444d-9258-98d75b415d6b", "Cable Twin Handle Parallel Grip Lat Pulldown", "compound"),
  pullUp: ex("1f614f68-6f10-4151-8b14-e9534282dc7d", "Pull Up Normal Grip", "compound"),
  csRow: ex("a17b1a07-964a-4e06-8f9d-5e32a1e0f3fa", "Chest Supported Dumbbell Row", "compound"),
  cableRow: ex("bb8f6fd8-3301-4e84-9fb4-17d7582ca400", "Cable Close-Grip Row", "compound"),
  oneArmCableRow: ex("4af9db45-0293-4c6a-8a4b-2a869725ba48", "Supine Cable Row - Unilateral", "compound"),
  rearDeltMachine: ex("31d2ed09-5912-489f-9976-191be20a6edf", "Machine Rear Delt Fly", "isolation"),
  dbLateralRaise: ex("5006a3e8-8023-4429-b5e0-a9dedcd5962b", "Lateral Raise Dumbbell - Constant Tension", "isolation"),
  cableLateral: ex("adbc5244-ef33-4c1a-b152-eb511bce723c", "Cable Lateral Raises", "isolation"),
  pushdown: ex("c360c823-0275-4475-ad5b-4fc31ba887a6", "Cable Triceps Pushdown", "isolation"),
  ohCableTriceps: ex("7941ae91-356a-41e6-a886-e52b60c5e4dc", "Overhead Cable Triceps Extension", "isolation"),
  dbCurl: ex("1db6cbbe-c3af-4ee7-9dd4-ce9dff102402", "Dumbbell Curl", "isolation"),
  inclineDbCurl: ex("cd15455e-36a4-418d-9cee-1de22d2a7bea", "Incline Dumbbell Curl", "isolation"),
  hammerCurl: ex("d430acf8-ebbe-46e5-bcd1-a306b12400db", "Dumbbell Hammer Curl", "isolation"),
  // core
  cableCrunch: ex("7314e914-12dd-41e4-9abe-28d1b5b253b3", "High Cable Kneeling Crunch", "core"),
  deadBug: ex("4d787abe-feea-4ecc-81c8-6989ed2eb7bf", "Dead Bug", "core"),
  plank: ex("0e81113b-e0bf-4c5c-936e-d9ba7087554e", "Plank", "timed"),
  sidePlank: ex("1ac65643-7ef3-4cd9-8d16-cb5dccb7a718", "Side Plank", "timed"),
  floorCrunch: ex("305cb334-79ac-4d56-9903-9f4988a0334c", "Crunch Floor", "core"),
  suitcaseCarry: ex("dfc40863-83ed-4426-9c5c-4dd1a97eadc2", "Dumbbell Suitcase Carry", "timed"),
  // at home
  bwSquat: ex("2d2be9c9-c1dd-4506-b20c-945475957f86", "Bodyweight Squat", "compound"),
  pushUp: ex("71c02ac2-a639-4196-a2fb-662e273ae453", "Kneeling Push-Up or Full Push-Up", "compound"),
  bwReverseLunge: ex("2269b844-8b44-4388-9cfb-f36c8d1f7f32", "Reverse Lunges", "compound"),
  bwGluteBridge: ex("14d37c3d-c248-4784-b63f-518c1753eecf", "Glute Bridge Bodyweight", "compound"),
  bwSingleLegRdl: ex("9aaa4645-6fd9-4c44-b0a6-e58f8d85b78d", "Bodyweight Single Leg Deadlift", "compound"),
  lateralLunge: ex("2a81688f-c802-4b97-bc74-2caea3c4710a", "Side Lunges Bodyweight", "compound"),
  dbFloorPress: ex("3aa101fa-2dfa-4da3-9a11-0fc08cfcacfb", "Paused Dumbbell Floor Press", "compound"),
  oneArmDbRow: ex("d1b21c0a-a585-490d-a28d-edf8ad54e70f", "Single-Arm Bent-Over Dumbbell Row", "compound"),
  standingDbPress: ex("f5b2de4e-5408-4ffb-8e2d-419a5cb46d54", "Standing Shoulder Press Dumbbell", "compound"),
  dbBentRow: ex("ac13a37d-0e74-49b7-9960-43c39f97eb61", "Dumbbell Bent Over Row", "compound"),
  rearDeltDb: ex("ae61bcd3-0f06-46c4-bed9-7fe29ef8fbc5", "Bent Over Rear Delt Fly Dumbbell", "isolation"),
  dbOhTriceps: ex("494f5013-2221-4f15-8949-d26d6931ae89", "Dumbbell Overhead Triceps Extension", "isolation"),
  proneW: ex(NEW_EXERCISES.proneW.id, NEW_EXERCISES.proneW.name, "isolation"),
  proneYTW: ex(NEW_EXERCISES.proneYTW.id, NEW_EXERCISES.proneYTW.name, "isolation"),
  proneSnowAngel: ex(NEW_EXERCISES.proneSnowAngel.id, NEW_EXERCISES.proneSnowAngel.name, "isolation"),
  splitSquat: ex(NEW_EXERCISES.splitSquat.id, NEW_EXERCISES.splitSquat.name, "compound"),
  singleLegCalf: ex(NEW_EXERCISES.singleLegCalf.id, NEW_EXERCISES.singleLegCalf.name, "isolation"),
  singleLegBridge: ex(NEW_EXERCISES.singleLegBridge.id, NEW_EXERCISES.singleLegBridge.name, "compound"),
} as const;

export type ExKey = keyof typeof EX;

/**
 * Same movement, two library entries. The first is what the programs use
 * (clients' history lives there); the second has a demo video. Merge with
 * admin_make_exercise_alias(duplicate, canonical) when ready: it moves every
 * reference and keeps the old name as an alias.
 */
export const DUPLICATE_PAIRS: Array<{ used: string; alsoExists: string; note: string }> = [
  { used: "Leg Press", alsoExists: "Leg Press Machine", note: "157 program rows vs 16; only the second has a video" },
  { used: "Incline Dumbbell Press", alsoExists: "Incline Bench Press - Dumbbell", note: "168 vs 62; only the second has a video" },
  { used: "Adductor Machine", alsoExists: "Adduction Machine", note: "12 vs 5; only the second has a video" },
  { used: "Paused Bench Press", alsoExists: "2-Count Pause Bench Press, 3-Count Pause Bench Press", note: "pause length belongs in the row's note" },
  { used: "Pause Deadlifts", alsoExists: "Two-Count Paused Deadlift, 2-Count Paused Deadlift, Paused Deadlift", note: "pause length and position belong in the row's note" },
  { used: "Pec Deck", alsoExists: "Pec Deck Fly Machine Flies", note: "36 vs 0; only the second has a video" },
  { used: "Goblet Squat", alsoExists: "Dumbbell Goblet Squat", note: "62 vs 0" },
  { used: "Flat Bench Press - Dumbbell", alsoExists: "Dumbbell Bench Press", note: "53 vs 10" },
];
