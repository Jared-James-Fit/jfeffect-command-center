/**
 * Every exercise in Jared McIntyre's 2027 Nationals prep, pinned to the live
 * library (searched Nov 16 2026). Where Jared already trains an exercise, his
 * own is used so his history, "Last time" and suggestions carry on.
 *
 * One exercise is new: the library had no cable hip adduction (it had the
 * Adduction Machine and Cable Hip Abduction). It's created once, only while no
 * exercise of that name exists (the migration resolves the id by name).
 */
export type ExDef = { id: string; name: string };

const ex = (id: string, name: string): ExDef => ({ id, name });

export const EX = {
  // competition lifts (canonical; deadlift execution is conventional, the identity doesn't change)
  compSquat: ex("e6ae87a4-29ae-4547-9916-5a61ca507bae", "Competition Squat"),
  compBench: ex("3f9b70db-c277-42fc-af09-fc10a222429b", "Competition Bench"),
  compDeadlift: ex("c01ef5f7-9d97-4296-939d-306acc5bc1c9", "Competition Deadlift"),
  // variations, each its own movement
  highBar: ex("c778e088-c9c5-46a9-832e-7a415cc9acfb", "High Bar Squat"),
  pauseSquat: ex("a3c4a03b-c3e2-414d-a700-408b2ee4ba75", "Pause Squat"),
  closeGripBlock: ex("ef170271-59e5-4dd2-8202-1a8f64c0b630", "Close-Grip Block Press"),
  pauseBench2ct: ex("6fe9d279-7f8e-4a17-943a-f7bc54357920", "2-Count Pause Bench Press"),
  pausedDeadlift: ex("102f5873-fd17-4f5d-a341-e9278c38079c", "Paused Deadlift"),
  beltSquat: ex("fc0d5993-2fba-4927-99e0-7c082a842647", "Belt Squat"),
  // accessories Jared already logs
  latPulldown: ex("21381ebb-2c2d-4559-9150-5544f3976c82", "Lat Pull Down Normal Grip"),
  verticalPull: ex("873ba980-43d3-47ec-aedc-f50f678c4039", "Chin-Grip Lat Pulldown"),
  latRow: ex("bb8f6fd8-3301-4e84-9fb4-17d7582ca400", "Cable Close-Grip Row"),
  horizontalRow: ex("a17b1a07-964a-4e06-8f9d-5e32a1e0f3fa", "Chest Supported Dumbbell Row"),
  lateralRaise: ex(
    "5006a3e8-8023-4429-b5e0-a9dedcd5962b",
    "Lateral Raise Dumbbell - Constant Tension",
  ),
  rearDelt: ex("a0dc40ee-807a-4bc0-a045-9015108efd08", "Rear Delt Cable Fly"),
  triceps: ex("7941ae91-356a-41e6-a886-e52b60c5e4dc", "Overhead Cable Triceps Extension"),
  legCurl: ex("64f2d203-0007-4864-a3df-8f8b2dde42c7", "Lying Hamstring Curl - Machine"),
  calfRaise: ex("ff79b0b1-463d-40fc-aa59-203a5f326524", "Standing Calf Raise - Machine"),
  hipAbduction: ex("f21ad633-2245-4985-ada8-aae0582de5ef", "Cable Hip Abduction"),
  hipAdduction: ex("8b6505ef-07b8-505f-ad58-6b8c69980906", "Cable Hip Adduction"),
  abWheel: ex("69d68697-c860-4639-9837-97fa0903d8e1", "Kneeling Ab Wheel Rollout"),
  curl: ex("2273b578-feb0-440f-9449-9a6b9dcbd51e", "EZ Bar Curl"),
  walk: ex("492de6fa-c1e0-4188-8099-f9d1419155fa", "Treadmill Walk"),
} as const;

export type ExKey = keyof typeof EX;

/** The one exercise this prep adds to the library (only when no exercise of that name exists). */
export const NEW_EXERCISE = {
  ...EX.hipAdduction,
  category: "Lower Body",
  equipment: "Cable",
  muscle_group: "Adductors",
  primary_muscle_group: "Adductors",
  exercise_family: "Hip Adduction",
  cues: "Ankle cuff on the inside leg, stand side-on to a low cable\nTall torso, hips square, hold the frame for balance\nSweep the leg across the body under control\nPause, then let it back out slowly\nNo leaning or swinging",
};
