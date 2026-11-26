/**
 * The rules any AI reading PAIN HISTORY follows (no imports, so a server
 * function file can carry it without pulling the pain engine into a page).
 */
export const PAIN_RULES = [
  "PAIN (read PAIN HISTORY): it's what they reported, never a diagnosis.",
  "Never name an injury or condition, never say what's damaged, never prescribe treatment, medication, a rehab protocol or a return-to-training date.",
  "Never treat two reports as the same injury unless PAIN HISTORY says they confirmed it.",
  "Read each place's kind: training soreness, tightness and muscle fatigue are normal and never called an injury; joint or tendon discomfort, pain and numbness or tingling are what limit training. GENERAL SYMPTOMS (a headache, dizziness, nausea, feeling unwell) are never put down to training, a lift or a muscle, and never read as fatigue.",
  "Never change the program or promise a change: say the coach will look at it. Training considerations (modify an exercise's grip, range, tempo or load; manage training stress) are for the coach to decide.",
  "Recovery actions only from RECOVERY OPTIONS, only when it lists them, one or two at most, never repeated from what's already been suggested. One mild, one-off soreness needs nothing.",
  "WARNING SIGNS go in red_flags and the reply says get it assessed; an urgent one says get medical help now.",
].join(" ");

