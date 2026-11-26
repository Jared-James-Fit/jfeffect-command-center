/**
 * "Describe it": an athlete says what hurts in their own words, typed or
 * spoken, and this turns it into the review's places (pure, tested, instant,
 * free). "Both knees have been bothering me during squats. The left is about
 * a 5 and the right is a 3. My right shoulder also pinches during bench."
 * becomes Left knee 5/10, Right knee 3/10 (during squats) and Right shoulder
 * (pinching, during bench, not rated yet). The athlete confirms or changes
 * every one before anything is kept.
 *
 * It never guesses a spot: a muscle, tendon or joint is picked only when they
 * name it ("biceps", "patellar tendon", "outside of my elbow"); "shoulder"
 * stays the whole shoulder. It never invents a number: a score is only a
 * number they said out of 10. Words it can't place ("my back") come back as a
 * question, and anything it can't read at all goes to the server's reader
 * (describe.functions.ts) instead.
 *
 * The whole body (Nov 26 2026): the head and face ("a headache behind my
 * eyes"), the jaw, the ribs, each finger, the palm, the toes and the bottom
 * of the foot; general symptoms that aren't one place (dizziness, nausea,
 * feeling unwell: symptoms.ts); tired, cramping or weak muscles; several
 * symptoms in one breath ("my lower back feels tight and my hands are
 * tingling"). Something it can't place in part of what they said goes to the
 * server's reader too, and what that finds is added, never swapped for what
 * this reader already read. It asks only what changes what happens next
 * (`needs`, `safetyQuestions`): the side of a limb, how bad a pain is, and
 * the safety questions a warning sign turns on.
 */
import type { PainSide } from "@/lib/pain/regions";
import { NON_TRAINING_REGIONS, regionOf } from "@/lib/pain/regions";
import type { Change, Feel, Impact, Timing } from "@/lib/pain/report";
import { NOTE_MAX } from "@/lib/pain/report";
import { PAIN_SITES, siteCovers } from "@/lib/pain/sites";
import { GENERAL_KEYS, generalOf, generalSymptomsIn, symptomClass, type GeneralSymptom } from "@/lib/pain/symptoms";

export type DescribedPlace = {
  region: string;
  site: string | null;
  side: PainSide | null;
  score: number | null;
  feel: Feel[];
  timing: Timing[];
  exerciseName: string | null;
  exerciseId: string | null;
  impact: Impact | null;
  /** What they said about how it's going ("getting worse"); used only when there's an earlier report to compare. */
  change: Change | null;
  /** Their own words this place came from. */
  note: string;
  /** What's still needed from them. */
  needs: ("score" | "side")[];
  /** A general symptom (a headache, dizziness, nausea…), null for a place that hurts. */
  symptom?: GeneralSymptom | null;
};

export type Unclear = { word: string; options: string[] };

/**
 * What they said that names no place of its own ("it's sharp, about a 6"):
 * when the review already has places, it's about one of them (picks.ts
 * `applyDetail`), never a new place.
 */
export type DescribedDetail = {
  score: number | null;
  feel: Feel[];
  timing: Timing[];
  exerciseName: string | null;
  exerciseId: string | null;
  impact: Impact | null;
  change: Change | null;
  note: string;
};

export type DescribeResult = {
  places: DescribedPlace[];
  unclear: Unclear[];
  detail?: DescribedDetail | null;
  /** Part of what they said read like a symptom but named nowhere this reader knows: the server reads the whole thing. */
  leftover?: string[];
};

export const DESCRIBE_MAX_CHARS = 600;

// ── the words ───────────────────────────────────────────────────────────

type PlaceWord = { re: RegExp; region: string; site?: string; plural?: RegExp };

/** Exact spots, only when they name them. Longest phrases first. */
const SITE_WORDS: PlaceWord[] = [
  // the head and face
  { re: /\b(?:behind|in|around) (?:my |the |both )?eyes?\b|\beye ?(?:balls?|sockets?)\b|\beyes?\b/, region: "face", site: "eyes", plural: /eyes\b/ },
  { re: /\btemples?\b/, region: "head", site: "temple" },
  { re: /\bforehead\b|\bfront of (?:my |the )?head\b/, region: "head", site: "forehead" },
  { re: /\b(?:top of (?:my |the )?head|crown of (?:my |the )?head)\b/, region: "head", site: "top_of_head" },
  { re: /\b(?:base of (?:my |the )?skull|where (?:my |the )?neck meets (?:my |the )?head|suboccipitals?)\b/, region: "head", site: "skull_base" },
  { re: /\bback of (?:my |the )?head\b/, region: "head", site: "back_of_head" },
  { re: /\b(?:sinus(?:es)?|cheek ?bones?|cheeks?)\b/, region: "face", site: "cheek", plural: /cheeks|sinuses|bones\b/ },
  { re: /\b(?:tmj|jaw joint|jaw (?:clicks?|clicking|pops?|popping|locks?))\b/, region: "jaw", site: "tmj" },
  { re: /\b(?:clench\w*|grind\w*) (?:my )?(?:jaw|teeth)\b|\bmasseter\b/, region: "jaw", site: "jaw_muscle" },
  { re: /\bchin\b/, region: "jaw", site: "chin" },
  { re: /\bears?\b(?!ly)/, region: "head", site: "ear", plural: /ears\b/ },
  // the ribs
  { re: /\bfront (?:of )?(?:my |the )?ribs?\b|\bbottom of (?:my |the )?ribs?\b/, region: "ribs", site: "ribs_front" },
  { re: /\bside (?:of )?(?:my |the )?ribs?\b|\bintercostals?\b/, region: "ribs", site: "ribs_side" },
  { re: /\bback (?:of )?(?:my |the )?ribs?\b|\brib (?:is )?out\b/, region: "ribs", site: "ribs_back" },
  // the hand
  { re: /\b(?:index|pointer|first) fingers?\b/, region: "wrist_hand", site: "index_finger", plural: /fingers\b/ },
  { re: /\bmiddle fingers?\b/, region: "wrist_hand", site: "middle_finger", plural: /fingers\b/ },
  { re: /\bring fingers?\b/, region: "wrist_hand", site: "ring_finger", plural: /fingers\b/ },
  { re: /\b(?:little fingers?|pink(?:y|ie|ies))\b/, region: "wrist_hand", site: "little_finger", plural: /fingers|pinkies\b/ },
  { re: /\bback of (?:my |the )?hands?\b/, region: "wrist_hand", site: "back_of_hand", plural: /hands\b/ },
  { re: /\bpalms?\b/, region: "wrist_hand", site: "palm", plural: /palms\b/ },
  { re: /\bknuckles?\b/, region: "wrist_hand", site: "knuckles", plural: /knuckles\b/ },
  { re: /\b(?:fingers?|finger ?tips?)\b/, region: "wrist_hand", site: "fingers", plural: /fingers|tips\b/ },
  { re: /\bhands?\b/, region: "wrist_hand", site: "hand", plural: /hands\b/ },
  // the foot
  { re: /\b(?:bottom|underneath|sole)s? of (?:my |the |both )?(?:left |right )?(?:foot|feet)\b|\bunder(?:neath)? (?:my |the )?(?:foot|feet)\b|\bsoles?(?: of (?:my |the )?(?:foot|feet))?\b/, region: "ankle_foot", site: "foot_sole", plural: /feet|soles\b/ },
  { re: /\bballs? of (?:my |the )?(?:left |right )?(?:foot|feet)\b|\bforefoot\b/, region: "ankle_foot", site: "ball_of_foot", plural: /balls|feet\b/ },
  { re: /\bbig toes?\b|\bbunions?\b/, region: "ankle_foot", site: "big_toe", plural: /toes|bunions\b/ },
  { re: /\btoes?\b/, region: "ankle_foot", site: "toes", plural: /toes\b/ },
  { re: /\b(?:outside|outer edge) of (?:my |the )?(?:left |right )?(?:foot|feet)\b/, region: "ankle_foot", site: "foot_outer", plural: /feet\b/ },
  { re: /\btop of (?:my |the )?(?:left |right )?(?:foot|feet)\b/, region: "ankle_foot", site: "foot_top", plural: /feet\b/ },
  // the pelvis and hip joint
  { re: /\b(?:pubic bone|pubic|front of (?:my |the )?pelvis)\b/, region: "hip_groin", site: "pubic_bone" },
  { re: /\b(?:hip joint|hip socket|deep (?:in|inside) (?:my |the )?hip)\b/, region: "hip_groin", site: "hip_joint", plural: /joints|sockets\b/ },
  { re: /\bbetween (?:my |the )?shoulder ?blades?\b/, region: "upper_back", site: "mid_trap" },
  { re: /\binside edge of (?:my |the )?shoulder ?blade\b/, region: "shoulder_blade", site: "scapula_border" },
  { re: /\b(?:patellar tendon|below (?:my |the )?knee ?caps?|under(?:neath)? (?:my |the )?knee ?caps?|jumper'?s knee)\b/, region: "knee", site: "patellar_tendon", plural: /caps\b/ },
  { re: /\b(?:quad(?:riceps)? tendon|above (?:my |the )?knee ?cap)\b/, region: "knee", site: "quad_tendon" },
  { re: /\b(?:inside|inner|medial side) (?:of )?(?:my |the )?knees?\b/, region: "knee", site: "knee_inner", plural: /knees\b/ },
  { re: /\b(?:outside|outer|lateral side) (?:of )?(?:my |the )?knees?\b/, region: "knee", site: "knee_outer", plural: /knees\b/ },
  { re: /\bback of (?:my |the )?knees?\b/, region: "knee", site: "knee_back", plural: /knees\b/ },
  { re: /\b(?:knee ?caps?|patella)\b/, region: "knee", site: "kneecap", plural: /caps\b/ },
  { re: /\b(?:outside|outer|lateral side) (?:of )?(?:my |the )?elbows?\b|\btennis elbow\b/, region: "elbow", site: "elbow_outer", plural: /elbows\b/ },
  { re: /\b(?:inside|inner|medial side) (?:of )?(?:my |the )?elbows?\b|\bgolfer'?s elbow\b/, region: "elbow", site: "elbow_inner", plural: /elbows\b/ },
  { re: /\bfront of (?:my |the )?elbows?\b|\belbow crease\b/, region: "elbow", site: "elbow_front", plural: /elbows\b/ },
  { re: /\bback of (?:my |the )?elbows?\b/, region: "elbow", site: "elbow_back", plural: /elbows\b/ },
  { re: /\b(?:front|anterior) delts?\b/, region: "shoulder", site: "front_delt", plural: /delts\b/ },
  { re: /\b(?:side|lateral|middle) delts?\b/, region: "shoulder", site: "side_delt", plural: /delts\b/ },
  { re: /\b(?:rear|back|posterior) delts?\b/, region: "shoulder", site: "rear_delt", plural: /delts\b/ },
  { re: /\bac joint\b/, region: "shoulder", site: "ac_joint" },
  { re: /\b(?:biceps?|bicep)\b(?! tendon at (?:my |the )?elbow)/, region: "upper_arm", site: "biceps" },
  { re: /\btriceps?\b/, region: "upper_arm", site: "triceps" },
  { re: /\bbrachialis\b/, region: "upper_arm", site: "brachialis" },
  { re: /\blats?\b/, region: "mid_back", site: "lats", plural: /lats\b/ },
  { re: /\bupper traps?\b/, region: "upper_back", site: "upper_trap", plural: /traps\b/ },
  { re: /\blower traps?\b/, region: "mid_back", site: "lower_trap", plural: /traps\b/ },
  { re: /\brhomboids?\b/, region: "shoulder_blade", site: "rhomboids", plural: /rhomboids\b/ },
  { re: /\b(?:si joint|sacroiliac)\b/, region: "low_back", site: "si_joint" },
  { re: /\b(?:tailbone|coccyx)\b/, region: "low_back", site: "tailbone" },
  { re: /\bql\b|\bquadratus lumborum\b/, region: "low_back", site: "ql" },
  { re: /\bobliques?\b|\bside of (?:my |the )?waist\b/, region: "abs", site: "obliques" },
  { re: /\bhip flexors?\b|\bpsoas\b/, region: "hip_groin", site: "hip_flexor", plural: /flexors\b/ },
  { re: /\btfl\b/, region: "hip_groin", site: "tfl" },
  { re: /\b(?:adductors?|inner thighs?)\b/, region: "hip_groin", site: "adductors", plural: /adductors|thighs\b/ },
  { re: /\bpiriformis\b/, region: "glute", site: "piriformis" },
  { re: /\b(?:glute med(?:ius)?)\b/, region: "glute", site: "glute_med" },
  { re: /\b(?:it ?band|itb|iliotibial)\b/, region: "quad", site: "it_band" },
  { re: /\bvmo\b|\binner quads?\b/, region: "quad", site: "vmo", plural: /quads\b/ },
  { re: /\b(?:high hamstrings?|sit ?bones?)\b/, region: "hamstring", site: "high_hamstring", plural: /hamstrings|bones\b/ },
  { re: /\bshin splints?\b/, region: "shin", site: "shin_inner" },
  { re: /\bachilles\b/, region: "ankle_foot", site: "achilles" },
  { re: /\bheels?\b/, region: "ankle_foot", site: "heel", plural: /heels\b/ },
  { re: /\b(?:arch(?:es)? of (?:my |the )?feet|arch(?:es)? of (?:my |the )?foot|plantar(?: fascia)?)\b/, region: "ankle_foot", site: "arch", plural: /arches|feet\b/ },
  { re: /\bthumbs?\b/, region: "wrist_hand", site: "thumb", plural: /thumbs\b/ },
  { re: /\b(?:arch(?:es)?|instep)\b/, region: "ankle_foot", site: "arch", plural: /arches\b/ },
  { re: /\b(?:breast ?bone|sternum)\b/, region: "chest", site: "sternum" },
  { re: /\bside of (?:my |the )?neck\b/, region: "neck", site: "neck_side" },
  { re: /\b(?:back of (?:my |the )?neck|nape)\b/, region: "neck", site: "neck_back" },
  { re: /\bfront of (?:my |the )?shoulders?\b/, region: "shoulder", site: "shoulder_front", plural: /shoulders\b/ },
  { re: /\b(?:upper (?:chest|pecs?))\b/, region: "chest", site: "upper_chest", plural: /pecs\b/ },
  { re: /\bpec minor\b/, region: "chest", site: "pec_minor" },
  { re: /\b(?:inner|inside) forearms?\b/, region: "elbow", site: "forearm_flexors", plural: /forearms\b/ },
  { re: /\b(?:outer|outside|back of (?:my |the )?) ?forearms?\b/, region: "elbow", site: "forearm_extensors", plural: /forearms\b/ },
  { re: /\b(?:outer|outside of (?:my |the )?) ?hips?\b/, region: "hip_groin", site: "hip_outer", plural: /hips\b/ },
  { re: /\b(?:front of (?:my |the )?hips?)\b/, region: "hip_groin", site: "hip_flexor", plural: /hips\b/ },
  { re: /\b(?:outer|outside) quads?\b/, region: "quad", site: "vastus_lateralis", plural: /quads\b/ },
  { re: /\b(?:outer|outside) hamstrings?\b/, region: "hamstring", site: "hamstring_outer", plural: /hamstrings\b/ },
  { re: /\b(?:inner|inside) hamstrings?\b/, region: "hamstring", site: "hamstring_inner", plural: /hamstrings\b/ },
  { re: /\b(?:inner|inside) calf\b|\b(?:inner|inside) calves\b/, region: "calf", site: "calf_inner", plural: /calves\b/ },
  { re: /\b(?:outer|outside) calf\b|\b(?:outer|outside) calves\b/, region: "calf", site: "calf_outer", plural: /calves\b/ },
  { re: /\b(?:outside|outer) (?:of )?(?:my |the )?ankles?\b|\brolled (?:my )?ankles?\b/, region: "ankle_foot", site: "ankle_outer", plural: /ankles\b/ },
  { re: /\b(?:inside|inner) (?:of )?(?:my |the )?ankles?\b/, region: "ankle_foot", site: "ankle_inner", plural: /ankles\b/ },
  { re: /\btop of (?:my |the )?(?:foot|feet)\b/, region: "ankle_foot", site: "foot_top", plural: /feet\b/ },
];

/**
 * The anatomy the map labels (sites.ts: its anatomical name and other names,
 * "sartorius", "infraspinatus", "medial knee", "love handle"), read the same
 * as the words above: only a name that means one spot, never a word that's a
 * whole region on its own ("calf", "quad") or that could be anywhere ("side").
 */
const ANATOMY_STOP = new Set(["side", "grip", "dimple", "sciatic", "sole", "hand", "wrist", "lower back", "spinal erectors", "biceps tendon"]);
let anatomyCache: { multi: PlaceWord[]; single: PlaceWord[] } | null = null;
function anatomyWords(): { multi: PlaceWord[]; single: PlaceWord[] } {
  if (anatomyCache) return anatomyCache;
  const phrases = new Map<string, { region: string; site: string }[]>();
  for (const s of PAIN_SITES) {
    const names = [
      ...(s.anat ?? "").replace(/\([^)]*\)/g, "").split("/"),
      ...((s as { also?: readonly string[] }).also ?? []),
    ];
    for (const raw of names) {
      const n = raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
      if (n.length < 4 || ANATOMY_STOP.has(n)) continue;
      const list = phrases.get(n) ?? [];
      if (!list.some((x) => x.site === s.key)) list.push({ region: s.region, site: s.key });
      phrases.set(n, list);
    }
  }
  const out: (PlaceWord & { multi: boolean })[] = [];
  for (const [n, list] of phrases) {
    if (list.length !== 1) continue;
    // a whole region on its own stays the region ("calf", "ankle")
    if (REGION_WORDS.some((w) => new RegExp(`^(?:${w.re.source})$`).test(n))) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    out.push({ re: new RegExp(`\\b${esc}s?\\b`), region: list[0].region, site: list[0].site, multi: n.includes(" ") });
  }
  // longer names first, so "biceps femoris" is never read as "biceps"
  out.sort((a, b) => b.re.source.length - a.re.source.length);
  anatomyCache = { multi: out.filter((w) => w.multi), single: out.filter((w) => !w.multi) };
  return anatomyCache;
}

/** Whole regions (a word that could be any spot in it stays the region). */
const REGION_WORDS: PlaceWord[] = [
  { re: /\bjaw\b/, region: "jaw" },
  { re: /\b(?:face|facial)\b/, region: "face" },
  { re: /\b(?:head|skull)\b/, region: "head" },
  { re: /\b(?:ribs?|rib ?cage)\b/, region: "ribs" },
  { re: /\bpelvis\b/, region: "hip_groin" },
  { re: /\bshoulder ?blades?\b|\bscapula[es]?\b/, region: "shoulder_blade", plural: /blades|scapulae\b/ },
  { re: /\b(?:mid(?:dle)?[ -]?back|thoracic)\b/, region: "mid_back" },
  { re: /\b(?:low(?:er)?[ -]?back|lumbar)\b/, region: "low_back" },
  { re: /\b(?:upper[ -]?back|traps?|trapezius)\b/, region: "upper_back" },
  { re: /\bnecks?\b/, region: "neck" },
  { re: /\b(?:shoulders?|delts?|deltoids?|rotator cuffs?)\b/, region: "shoulder", plural: /shoulders|delts|deltoids|cuffs\b/ },
  { re: /\b(?:chest|pecs?|pectorals?)\b/, region: "chest", plural: /pecs|pectorals\b/ },
  { re: /\bupper arms?\b/, region: "upper_arm", plural: /arms\b/ },
  { re: /\b(?:elbows?|forearms?)\b/, region: "elbow", plural: /elbows|forearms\b/ },
  { re: /\bwrists?\b/, region: "wrist_hand", plural: /wrists\b/ },
  { re: /\b(?:abs|abdominals?|core|stomach)\b/, region: "abs" },
  { re: /\b(?:hips?|groin)\b/, region: "hip_groin", plural: /hips\b/ },
  { re: /\b(?:glutes?|butt)\b/, region: "glute", plural: /glutes\b/ },
  { re: /\b(?:quads?|quadriceps|thighs?)\b/, region: "quad", plural: /quads|thighs\b/ },
  { re: /\b(?:hamstrings?|hammies|hammy)\b/, region: "hamstring", plural: /hamstrings|hammies\b/ },
  { re: /\bknees?\b/, region: "knee", plural: /knees\b/ },
  { re: /\bshins?\b/, region: "shin", plural: /shins\b/ },
  { re: /\b(?:calf|calves)\b/, region: "calf", plural: /calves\b/ },
  { re: /\b(?:ankles?|feet|foot)\b/, region: "ankle_foot", plural: /ankles|feet\b/ },
];

/** Words that name more than one region: asked, never guessed. */
const VAGUE: { re: RegExp; word: string; options: string[] }[] = [
  { re: /\b(?:my|the|in my|in the) back\b(?! (?:squats?|off|again|to|from))/, word: "back", options: ["upper_back", "mid_back", "low_back", "shoulder_blade"] },
  { re: /\b(?:my|the|in my|both) arms?\b/, word: "arm", options: ["shoulder", "upper_arm", "elbow", "wrist_hand"] },
  { re: /\b(?:my|the|in my|both) legs?\b(?! (?:day|press|curls?|extensions?))/, word: "leg", options: ["hip_groin", "quad", "hamstring", "knee", "calf", "shin"] },
  { re: /\b(?:my|the|in my) spine\b/, word: "spine", options: ["neck", "upper_back", "mid_back", "low_back"] },
];

/** Spots on the midline: no left or right (sites.ts `midline`). */
export const SITE_MIDLINE: ReadonlySet<string> = new Set(PAIN_SITES.filter((s) => s.midline).map((s) => s.key));

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const NUM = "10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten";
const SCORE_OUT_OF = new RegExp(`\\b(${NUM})\\s*(?:\\/|out of|outta)\\s*(?:10|ten)\\b`);
/** "a 3 or 4", "6-7", "5 to 6": the higher number (the safer read of how bad). */
const SCORE_RANGE_AFTER = new RegExp(`^\\s*(?:or|to|-|–)\\s*(?:a\\s+)?(${NUM})\\b(?!\\s*(?:sets?|reps?|lbs?|kgs?|pounds?|kilos?|days?|weeks?|months?|mins?|minutes?|hours?|times?|x\\b|%))`);
const SCORE_SAID =
  /\b(?:a|an|about|around|like|maybe|is|was|at|its|it's|probably|rated|rate|now|still|only|level|pain|solid|easily|roughly|honestly)\s+(?:a\s+|an\s+|like\s+|of\s+)?(10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:ish)?\b(?!\s*(?:sets?|reps?|lbs?|kgs?|pounds?|kilos?|days?|weeks?|months?|years?|mins?|minutes?|hours?|hrs?|times?|x\b|%|percent|plates?|secs?|seconds?|sessions?|workouts?|miles?|km|k\b))/;

const FEEL_WORDS: [RegExp, Feel][] = [
  [/\b(?:pins and needles|tingl\w*|numb\w*)\b|\b(?:hands?|arms?|feet|foot|legs?|fingers?|toes?) (?:keeps? |kept )?(?:fall(?:s|ing)?|fell|going|goes|went|go) (?:to )?(?:sleep|asleep)\b/, "numb"],
  [/\b(?:weak(?:ness)?|gave out|gives out|giving (?:out|way))\b/, "weak"],
  [/\b(?:cramp\w*|spasm\w*|charley horse)\b/, "cramp"],
  [/\b(?:fatigued|tired|smoked|fried|toast|gassed|wrecked|cooked|dead|heavy|drained|exhausted)\b(?! (?:sets?|squats?|singles?|doubles?|triples?|weights?|lifts?|bench\w*|deadlifts?|day|session|lifting|hang))/, "fatigued"],
  [/\bpressure\b/, "pressure"],
  [/\b(?:throb\w*|pounding|pulsing)\b/, "throbbing"],
  [/\b(?:sudden(?:ly)?|out of nowhere|came on (?:fast|quick\w*)|thunderclap|worst (?:headache|pain) (?:ever|of my life|i'?ve (?:ever )?had))\b/, "sudden"],
  [/\b(?:pinch\w*)\b/, "pinch"],
  [/\b(?:sharp|stabbing|shooting|stabs?|electric|zing\w*)\b/, "sharp"],
  [/\b(?:burn\w*)\b/, "burning"],
  [/\b(?:tight\w*|stiff\w*|knot(?:ted|s|ty)?)\b/, "tight"],
  [/\b(?:sore\w*|tender\w*|bruised)\b/, "sore"],
  [/\b(?:dull|ach\w*)\b(?<!head ?ach\w*)/, "ache"],
  [/\b(?:swollen|swelling|swell\w*|puffy)\b/, "swollen"],
  [/\b(?:popped|felt a pop|a pop|popping)\b/, "pop"],
];

const TIMING_WORDS: [RegExp, Timing][] = [
  [/\b(?:after (?:training|lifting|the session|the workout|workouts?|i train|i lift|my session|(?:my |the )?(?:squats?|bench\w*|deadlifts?|sets?|runs?|running|lifting))|post[- ]?workout|afterwards?|the (?:next|following) (?:day|morning)|day after)\b/, "after"],
  [/\b(?:at rest|resting|at night|in bed|sleeping|sitting|when i wake|in the morning|all day|constant(?:ly)?|even when (?:i'?m )?not|at my desk|at work|driving|lying down|laying down)\b/, "rest"],
  [/\b(?:when i (?:reach|turn|bend|raise|walk|run|climb|stand|sit down|get up|twist|look|lift my arm)\w*|reaching|turning my head|going up stairs|stairs|bending over)\b/, "movement"],
  [/\b(?:during|while|mid[- ]?set|under the bar|in the hole|out of the hole|at the bottom|off the chest|off the floor|at lockout|locking out|on (?:the |my )?(?:way up|lockout|descent)|unrack\w*|walk ?outs?|setting up|on (?:my |the )?(?:top sets?|heavy sets?|working sets?|warm ?ups?|singles?|doubles?|triples?)|when i (?:squat|bench|deadlift|pull|press|lift)\w*|under load)\b/, "during"],
];

const IMPACT_WORDS: [RegExp, Impact][] = [
  [/\b(?:had to stop|stopped (?:the|my)? ?(?:set|session|workout|lifting)?|couldn'?t finish|cut (?:it|the session|the workout) short|ended (?:the )?(?:session|workout) early)\b/, "stopped"],
  [/\b(?:went lighter|dropped the weight|lowered the weight|took weight off|skipped|swapped|modified)\b/, "modified"],
];

const CHANGE_WORDS: [RegExp, Change][] = [
  [/\b(?:getting worse|worse than|worse (?:today|now|this week)|flared up|flaring up)\b/, "worse"],
  [/\b(?:getting better|better than|feels better|improving|better (?:today|now|this week))\b/, "better"],
  [/\b(?:same as (?:before|last)|no change|still the same)\b/, "same"],
];

/** The movements people name, the word that finds them in a workout, and a name to fall back on. */
const MOVEMENTS: { re: RegExp; key: string; name: string }[] = [
  { re: /\b(?:rdls?|romanian deadlifts?|stiff[- ]leg(?:ged)? deadlifts?)\b/, key: "romanian", name: "Romanian deadlifts" },
  { re: /\b(?:good ?mornings?)\b/, key: "good morning", name: "Good mornings" },
  { re: /\b(?:leg curls?|ham(?:string)? curls?|nordics?)\b/, key: "leg curl", name: "Leg curls" },
  { re: /\b(?:leg extensions?)\b/, key: "leg extension", name: "Leg extensions" },
  { re: /\b(?:calf raises?)\b/, key: "calf", name: "Calf raises" },
  { re: /\b(?:split squats?|bulgarians?|lunges?|lunging)\b/, key: "split", name: "Split squats or lunges" },
  { re: /\b(?:leg press(?:ing)?)\b/, key: "leg press", name: "Leg press" },
  { re: /\b(?:hip thrusts?)\b/, key: "thrust", name: "Hip thrusts" },
  { re: /\b(?:pull ?downs?|lat pulldowns?)\b/, key: "pulldown", name: "Pulldowns" },
  { re: /\b(?:ohp|overhead press(?:ing)?|military press|shoulder press(?:ing)?|push press|jerks?)\b/, key: "overhead", name: "Overhead press" },
  { re: /\b(?:bench(?:ing)?(?: press(?:ing)?)?|larsens?|spoto|floor press(?:ing)?|close ?grip|pin press|board press)\b/, key: "bench", name: "Bench press" },
  { re: /\b(?:squat(?:s|ting)?|low ?bar|high ?bar|ssb|safety (?:squat )?bar)\b/, key: "squat", name: "Squats" },
  { re: /\b(?:dead ?lift(?:s|ing)?|deads|sumo|conventional|deficits?|block pulls?|rack pulls?|trap ?bar)\b/, key: "deadlift", name: "Deadlifts" },
  { re: /\b(?:pull[- ]?ups?|chin[- ]?ups?)\b/, key: "pull", name: "Pull-ups" },
  { re: /\b(?:rows?|rowing)\b/, key: "row", name: "Rows" },
  { re: /\b(?:dips?)\b/, key: "dip", name: "Dips" },
  { re: /\b(?:curls?|curling)\b/, key: "curl", name: "Curls" },
  { re: /\b(?:runs?|running|jogging|sprints?|sprinting)\b/, key: "run", name: "Running" },
  { re: /\b(?:push[- ]?ups?)\b/, key: "push", name: "Push-ups" },
  { re: /\b(?:pushdowns?|skull ?crushers?|triceps? extensions?)\b/, key: "extension", name: "Triceps work" },
  { re: /\b(?:lateral raises?|side raises?|front raises?)\b/, key: "raise", name: "Raises" },
  { re: /\b(?:flyes|flys|fly|flies)\b/, key: "fly", name: "Flyes" },
];

// ── reading it ─────────────────────────────────────────────────────────

type Span = { at: number; end: number };
type PlaceHit = Span & { region: string; site: string | null; plural: boolean };

function norm(t: string): string {
  return t
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bpins and needles\b/g, "tingling")
    .replace(/\bw\//g, "with ")
    .replace(/\b(?:left and right|right and left|left & right|left \/ right)\b/g, "both")
    // "on a scale of 1 to 10, it's a 4": the scale is never the rating
    .replace(/\b(?:on a scale (?:of|from) |from |between )?(?:0|1|zero|one)\s*(?:to|-|–|and)\s*(?:10|ten)\b,?/g, " ")
    .replace(/\bout of a (10|ten)\b/g, "out of 10")
    .replace(/\s+/g, " ");
}

function allMatches(re: RegExp, text: string): Span[] {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const out: Span[] = [];
  for (const m of text.matchAll(g)) out.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}

const overlaps = (a: Span, b: Span) => a.at < b.end && b.at < a.end;

function placesIn(text: string): PlaceHit[] {
  const hits: PlaceHit[] = [];
  // a named structure ("biceps femoris", "medial knee") before the plain words, those before a lone anatomy word, regions last
  const anatomy = anatomyWords();
  for (const list of [anatomy.multi, SITE_WORDS, anatomy.single, REGION_WORDS]) {
    for (const w of list) {
      for (const m of allMatches(w.re, text)) {
        if (hits.some((h) => overlaps(h, m))) continue;
        const word = text.slice(m.at, m.end);
        hits.push({ ...m, region: w.region, site: w.site ?? null, plural: !!w.plural && w.plural.test(word) });
      }
    }
  }
  // "my knee hurts underneath the kneecap" is one place, the exact spot: a region word in a
  // clause that also names a spot in that region is the same place (its plural carries over)
  const sites = hits.filter((h) => h.site);
  const kept = hits.filter((h) => {
    // "pinky on my right hand": the finger, never the finger and the whole hand
    if (h.site) return !sites.some((x) => x !== h && siteCovers(h.site).includes(x.site!));
    const same = sites.find((x) => x.region === h.region);
    if (!same) return true;
    if (h.plural) same.plural = true;
    return false;
  });
  return kept.sort((a, b) => a.at - b.at);
}

type SideHit = Span & { side: PainSide | "both" };

const RIGHT_NOT_SIDE = /^ (?:now|away|after|before|when|at|there|here|below|above|under|over|beside|next|behind|between|in|on|around|by|where|as|into|off|up|down|through|then)\b/;

function sidesIn(text: string): SideHit[] {
  const out: SideHit[] = [];
  for (const m of allMatches(/\b(?:left|lft)\b/, text)) out.push({ ...m, side: "L" });
  // "right" the side, never "right now" / "right below the kneecap" (unless it's "the right" / "my right")
  for (const m of allMatches(/\b(?:right|rt)\b/, text)) {
    const before = text.slice(Math.max(0, m.at - 8), m.at);
    const after = text.slice(m.end);
    if (/\b(?:the|my|on|to|her|his)\s+$/.test(before) || !RIGHT_NOT_SIDE.test(after)) out.push({ ...m, side: "R" });
  }
  for (const m of allMatches(/\b(?:both|bilateral|each side|either side|both sides)\b/, text)) out.push({ ...m, side: "both" });
  return out.sort((a, b) => a.at - b.at);
}

const toScore = (raw: string | undefined): number | null => {
  if (raw == null) return null;
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return n != null && n >= 0 && n <= 10 ? n : null;
};

function scoreIn(text: string): number | null {
  const a = SCORE_OUT_OF.exec(text);
  const m = a ?? SCORE_SAID.exec(text);
  if (!m) return null;
  let n = toScore(m[1]);
  // "a 3 or 4" / "6-7 out of 10": the higher one
  const after = SCORE_RANGE_AFTER.exec(text.slice((m.index ?? 0) + m[0].length));
  const hi = toScore(after?.[1]);
  if (n != null && hi != null && hi > n && hi - n <= 3) n = hi;
  // "3-7/10" read by SCORE_OUT_OF from the later number already; nothing else to do
  return n;
}

function feelsIn(text: string): Feel[] {
  const out: Feel[] = [];
  for (const [re, f] of FEEL_WORDS) if (re.test(text) && !out.includes(f)) out.push(f);
  return out;
}

function timingIn(text: string, hasExercise: boolean): Timing[] {
  const out: Timing[] = [];
  for (const [re, t] of TIMING_WORDS) if (re.test(text)) out.push(t);
  // "bothering me on squats", "pinches with bench": named in a lift is during it
  if (hasExercise && !out.length) out.push("during");
  return out;
}

function firstOf<T>(pairs: [RegExp, T][], text: string): T | null {
  for (const [re, v] of pairs) if (re.test(text)) return v;
  return null;
}

export type WorkoutExercise = { id: string | null; name: string };

/** The exercise they mean: today's workout's own when one fits, else the movement's plain name. */
function exerciseIn(text: string, exercises: WorkoutExercise[]): { name: string; id: string | null } | null {
  const named = exercises.find((x) => x.name.length >= 4 && text.includes(x.name.toLowerCase()));
  if (named) return { name: named.name, id: named.id };
  for (const m of MOVEMENTS) {
    if (!m.re.test(text)) continue;
    const words = text.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const fits = exercises.filter((x) => x.name.toLowerCase().includes(m.key));
    // the workout's exercise that shares the most words with what they said ("competition bench")
    const best = fits
      .map((x) => ({ x, n: words.filter((w) => x.name.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.n - a.n)[0];
    if (best) return { name: best.x.name, id: best.x.id };
    return { name: m.name, id: null };
  }
  return null;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?;\n])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Clauses inside a sentence: "the left is a 5 and the right is a 3" are two. */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(/,|\bbut\b|\band\b|\balso\b|\bplus\b/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const sidedRegion = (region: string) => !!regionOf(region)?.sided;
const lateralRegion = (region: string) => !!regionOf(region)?.lateral;

function blank(region: string, site: string | null, side: PainSide | null): DescribedPlace {
  return { region, site, side, score: null, feel: [], timing: [], exerciseName: null, exerciseId: null, impact: null, change: null, note: "", needs: [], symptom: null };
}

function addNote(p: DescribedPlace, words: string) {
  const w = words.trim();
  if (!w || p.note.includes(w)) return;
  p.note = (p.note ? `${p.note} ${w}` : w).slice(0, NOTE_MAX);
}

/** What a clause adds to places that already exist (it named none of its own). */
type Detail = { score: number | null; feel: Feel[]; timing: Timing[]; exercise: { name: string; id: string | null } | null; impact: Impact | null; change: Change | null };

function detailOf(clause: string, exercises: WorkoutExercise[]): Detail {
  const exercise = exerciseIn(clause, exercises);
  return {
    score: scoreIn(clause),
    feel: feelsIn(clause),
    timing: timingIn(clause, !!exercise),
    exercise,
    impact: firstOf(IMPACT_WORDS, clause),
    change: firstOf(CHANGE_WORDS, clause),
  };
}

function apply(p: DescribedPlace, d: Detail, opts: { score: boolean; force?: boolean }) {
  if (opts.score && d.score != null && (p.score == null || opts.force)) p.score = d.score;
  for (const f of d.feel) if (!p.feel.includes(f)) p.feel.push(f);
  for (const t of d.timing) if (!p.timing.includes(t)) p.timing.push(t);
  if (d.exercise && !p.exerciseName) {
    p.exerciseName = d.exercise.name;
    p.exerciseId = d.exercise.id;
  }
  if (d.impact && !p.impact) p.impact = d.impact;
  if (d.change && !p.change) p.change = d.change;
}

/** What it reads as needing from them: how bad only for a pain or a joint, a side only for a limb. */
export function needsOf(p: DescribedPlace): ("score" | "side")[] {
  const out: ("score" | "side")[] = [];
  const cls = symptomClass({ ...p, score: null, severity: null });
  if (p.score == null && (cls === "pain" || cls === "joint")) out.push("score");
  if (p.side == null && (p.site ? !SITE_MIDLINE.has(p.site) && sidedRegion(p.region) : sidedRegion(p.region))) out.push("side");
  return out;
}

/** Words that say something hurts or feels off (a clause with these and no place is read by the server). */
const SYMPTOM_HINT = /\b(?:hurt\w*|pain\w*|ach\w*|sore\w*|tight\w*|stiff\w*|numb\w*|tingl\w*|burn\w*|throb\w*|cramp\w*|swoll\w*|sharp|pinch\w*|tweak\w*|strain\w*|injur\w*|bother\w*|killing|weak\w*|bruis\w*)\b/;
/** "My knee is fine", "doesn't hurt at rest": said about a place that isn't hurting. */
const NEGATED =
  /\b(?:(?:is|are|feels?|felt|was|were|seems?|'s|'re)\s+(?:fine|good|great|ok(?:ay)?|alright|all good|totally fine|normal)|no (?:pain|issues?|problems?)|(?:doesn'?t|don'?t|didn'?t|does not|do not|did not|never) (?:hurt|bother|ache)|not (?:hurting|sore|bothering|painful|an issue|a problem))\b/;

/** "Left knee, actually the right", "I mean a 6": what comes next replaces what was just said. */
const CORRECTION = /\b(?:actually|i mean|i meant|sorry|no wait|wait no|correction|scratch that|or rather|make that)\b/;
const ONLY_NO = /^(?:no|nope|wait)$/;
const NOT_SIDE = /\bnot (?:the|my) (left|right)\b/;

function mergeDetail(a: Detail, b: Detail): Detail {
  return {
    score: b.score ?? a.score,
    feel: [...new Set([...a.feel, ...b.feel])],
    timing: [...new Set([...a.timing, ...b.timing])],
    exercise: a.exercise ?? b.exercise,
    impact: a.impact ?? b.impact,
    change: a.change ?? b.change,
  };
}

const emptyDetail = (d: Detail) => d.score == null && !d.feel.length && !d.timing.length && !d.exercise && !d.impact && !d.change;

/**
 * Read a description. `exercises`: today's workout first, then what they've
 * trained lately, so "bench" is their own Competition Bench Press and "hack
 * squat" the one they did last week.
 *
 * Corrections count the way people say them ("left knee, no, the right",
 * "a 6, actually more like a 7"), a place said to be fine is never added
 * ("my knee is fine but my back hurts"), and what's said about one issue twice
 * is one place (`reconcilePlaces`).
 */
export function describePain(input: string, opts: { exercises?: WorkoutExercise[] } = {}): DescribeResult {
  const exercises = opts.exercises ?? [];
  const original = (input ?? "").slice(0, DESCRIBE_MAX_CHARS);
  const places: DescribedPlace[] = [];
  const unclear: Unclear[] = [];
  const leftover: string[] = [];
  // the places the last clause with a place named: a clause with none of its own adds to these
  let group: DescribedPlace[] = [];
  // what this description made (a correction can take those back; places found again are kept)
  const made = new Set<DescribedPlace>();
  let pending: { detail: Detail; words: string } | null = null;
  let correcting = false;
  // a place said not to hurt in one way ("doesn't hurt at rest"), for "but hurts on squats" right after
  let negated: { hits: PlaceHit[]; sides: SideHit[] } | null = null;

  const placeFor = (h: PlaceHit, said: PainSide | "both" | null, plural: boolean): DescribedPlace[] => {
    const canSide = h.site ? !SITE_MIDLINE.has(h.site) : sidedRegion(h.region) || lateralRegion(h.region);
    const both = canSide && sidedRegion(h.region) && (said === "both" || (said == null && plural));
    return both ? [blank(h.region, h.site, "L"), blank(h.region, h.site, "R")] : [blank(h.region, h.site, canSide && (said === "L" || said === "R") ? said : null)];
  };

  // a general symptom said in this clause (a headache, dizziness): found again, or added
  const place = (fresh: DescribedPlace, detail: Detail, words: string, score: boolean): DescribedPlace => {
    const existing = places.find((q) => q.region === fresh.region && q.site === fresh.site && q.side === fresh.side && (q.symptom ?? null) === (fresh.symptom ?? null));
    const p = existing ?? fresh;
    apply(p, detail, { score });
    if (pending) apply(p, pending.detail, { score: false });
    addNote(p, words);
    if (!existing) {
      places.push(p);
      made.add(p);
    }
    return p;
  };

  for (const rawSentence of sentencesOf(original)) {
    const sentence = norm(rawSentence);
    for (const clause of clausesOf(sentence)) {
      if (ONLY_NO.test(clause)) {
        correcting = true;
        continue;
      }
      let hits = placesIn(clause);
      const sides = sidesIn(clause);
      const detail = detailOf(clause, exercises);
      const correction = correcting || CORRECTION.test(clause) || NOT_SIDE.test(clause);
      correcting = false;

      if (NEGATED.test(clause)) {
        if (hits.length) negated = { hits, sides };
        else {
          // "both knees hurt, the left is fine": the left comes off
          const side = sides[0]?.side;
          if ((side === "L" || side === "R") && group.length > 1) {
            const off = group.filter((p) => p.side === side && made.has(p));
            for (const p of off) places.splice(places.indexOf(p), 1);
            group = group.filter((p) => !off.includes(p));
          }
        }
        continue;
      }
      // "my knee doesn't hurt at rest, but it hurts on squats"
      if (!hits.length && negated && !emptyDetail(detail)) {
        hits = negated.hits;
        for (const s of negated.sides) sides.unshift(s);
      }
      negated = null;

      // general symptoms: a headache takes the head or face spot named with it, the rest are no one place
      const symptoms = generalSymptomsIn(clause);
      const symptomPlaces: DescribedPlace[] = [];
      if (symptoms.includes("headache")) {
        const headHits = hits.filter((h) => h.region === "head" || h.region === "face");
        hits = hits.filter((h) => !headHits.includes(h));
        const said = sides.find((x) => x.side === "L" || x.side === "R")?.side;
        const side: PainSide | null = said === "L" || said === "R" ? said : null;
        if (headHits.length) for (const h of headHits) symptomPlaces.push(place({ ...blank(h.region, h.site, h.site && SITE_MIDLINE.has(h.site) ? null : side), symptom: "headache" }, detail, rawSentence, true));
        else symptomPlaces.push(place({ ...blank("head", null, side), symptom: "headache" }, detail, rawSentence, true));
      }
      for (const k of symptoms) {
        if (k === "headache") continue;
        const def = generalOf(k);
        if (!def) continue;
        // a number goes to a symptom only when it's the one thing in the clause ("dizzy, about a 4")
        symptomPlaces.push(place({ ...blank(def.region, null, null), symptom: k }, detail, rawSentence, !hits.length && symptoms.length === 1));
      }

      if (!hits.length) {
        if (symptomPlaces.length) {
          group = symptomPlaces;
          pending = null;
          continue;
        }
        const vague = VAGUE.find((v) => v.re.test(clause));
        if (vague && !unclear.some((u) => u.word === vague.word)) unclear.push({ word: vague.word, options: vague.options });
        const hasDetail = !emptyDetail(detail) || sides.length;
        if (!hasDetail) {
          // something hurts somewhere this reader doesn't know ("something in my gizmo hurts"): the server reads it
          if (!vague && (group.length ? namesUnknownPart(clause) : SYMPTOM_HINT.test(clause))) leftover.push(clause.trim());
          continue;
        }
        if (!group.length) {
          pending = pending ? { detail: mergeDetail(pending.detail, detail), words: `${pending.words} ${rawSentence}` } : { detail, words: rawSentence };
          continue;
        }
        const notSide = NOT_SIDE.exec(clause)?.[1];
        let side = sides.find((s) => s.side !== (notSide === "left" ? "L" : notSide === "right" ? "R" : null))?.side ?? null;
        if (notSide && !side) side = notSide === "left" ? "R" : "L";
        if (correction && (side === "L" || side === "R")) {
          // "left knee, actually the right one": the place moves to the side they meant
          const keep = group.find((p) => p.side !== side) ?? group[0];
          const twin = group.find((p) => p !== keep && p.side === side);
          if (twin) {
            places.splice(places.indexOf(keep), 1);
            group = [twin];
          } else {
            keep.side = side;
            for (const p of group) if (p !== keep && made.has(p)) places.splice(places.indexOf(p), 1);
            group = [keep];
          }
          for (const p of group) {
            apply(p, detail, { score: true, force: true });
            addNote(p, rawSentence);
          }
          continue;
        }
        // which of the group: a side said picks that side ("the left is a 5"); none means all of them
        let targets = group;
        if (side === "L" || side === "R") {
          const same = group.filter((p) => p.side === side);
          if (same.length) targets = same;
          else {
            // "my knee hurts. the left one is a 5": the place takes the side
            const unsided = group.find((p) => p.side == null && !p.symptom && (sidedRegion(p.region) || lateralRegion(p.region)));
            if (unsided) {
              unsided.side = side;
              targets = [unsided];
            } else targets = [];
          }
        }
        for (const p of targets) {
          apply(p, detail, { score: true, force: correction });
          addNote(p, rawSentence);
        }
        continue;
      }

      // "left knee no right knee" in one breath: the place after a correction replaces the one before it
      const kept: PlaceHit[] = [];
      for (const h of hits) {
        const prev = kept[kept.length - 1];
        const between = prev ? clause.slice(prev.end, h.at) : "";
        if (prev && (CORRECTION.test(between) || /\b(?:no|nope)\b/.test(between))) kept.pop();
        kept.push(h);
      }
      hits = kept;

      // a place said as a correction replaces the one just said, keeping what was said about it
      let carried: DescribedPlace[] = [];
      if (correction && group.length) {
        carried = group.filter((p) => made.has(p) && !p.symptom);
        for (const p of carried) places.splice(places.indexOf(p), 1);
      }

      group = [...symptomPlaces];
      hits.forEach((h, i) => {
        // the side for this place: a side word inside it ("bottom of my left foot"), else
        // before it (and after the place before it), else after it when it's alone
        const prevEnd = i > 0 ? hits[i - 1].end : 0;
        const within = sides.filter((s) => s.at >= h.at && s.end <= h.end);
        const before = sides.filter((s) => s.at >= prevEnd && s.end <= h.at);
        const after = hits.length === 1 ? sides.filter((s) => s.at >= h.end) : [];
        const said = within[0]?.side ?? before[before.length - 1]?.side ?? after[0]?.side ?? null;
        const madeHere = placeFor(h, said, h.plural);
        const both = madeHere.length === 2;
        for (const p of madeHere) {
          const existing = places.find((q) => q.region === p.region && q.site === p.site && q.side === p.side && !q.symptom);
          const place = existing ?? p;
          for (const c of carried) {
            apply(place, { score: c.score, feel: c.feel, timing: c.timing, exercise: c.exerciseName ? { name: c.exerciseName, id: c.exerciseId } : null, impact: c.impact, change: c.change }, { score: true });
            addNote(place, c.note);
          }
          // a score in a clause naming two places belongs to neither (it can't be told which)
          apply(place, detail, { score: hits.length === 1 && !both, force: correction });
          if (both && detail.score != null && hits.length === 1 && place.score == null) place.score = detail.score;
          if (pending) apply(place, pending.detail, { score: false });
          addNote(place, rawSentence);
          if (!existing) {
            places.push(place);
            made.add(place);
          }
          group.push(place);
        }
      });
      pending = null;
    }
  }

  const out = reconcilePlaces(places);
  for (const p of out) p.needs = needsOf(p);
  // said about nothing named here ("it's sharp, about a 6"): for a place they already have
  const detail: DescribedDetail | null =
    !out.length && pending && !emptyDetail(pending.detail)
      ? {
          score: pending.detail.score,
          feel: pending.detail.feel,
          timing: pending.detail.timing,
          exerciseName: pending.detail.exercise?.name ?? null,
          exerciseId: pending.detail.exercise?.id ?? null,
          impact: pending.detail.impact,
          change: pending.detail.change,
          note: original.trim().slice(0, NOTE_MAX),
        }
      : null;
  const res: DescribeResult = { places: out, unclear };
  if (detail) res.detail = detail;
  if (leftover.length) res.leftover = leftover;
  return res;
}

/**
 * One issue said twice is one place: a region and a spot in it said together
 * ("my knee, right below the kneecap") are the spot; the same spot with and
 * without a side is the sided one. Different spots or different sides stay
 * apart: those are genuinely different.
 */
export function reconcilePlaces(places: DescribedPlace[]): DescribedPlace[] {
  const out = [...places];
  const fold = (from: DescribedPlace, into: DescribedPlace) => {
    if (into.side == null && from.side != null) into.side = from.side;
    apply(into, { score: from.score, feel: from.feel, timing: from.timing, exercise: from.exerciseName ? { name: from.exerciseName, id: from.exerciseId } : null, impact: from.impact, change: from.change }, { score: true });
    addNote(into, from.note);
    out.splice(out.indexOf(from), 1);
  };
  // two different ratings, symptoms or lifts are two things they felt, never folded
  const conflict = (a: DescribedPlace, b: DescribedPlace) =>
    (a.score != null && b.score != null && a.score !== b.score) ||
    (a.feel.length > 0 && b.feel.length > 0 && !a.feel.some((f) => b.feel.includes(f))) ||
    (!!a.exerciseName && !!b.exerciseName && a.exerciseName !== b.exerciseName);
  // a general symptom (a headache) is never folded into a place, nor one place into it
  const compatible = (a: DescribedPlace, b: DescribedPlace) =>
    a.region === b.region && (a.symptom ?? null) === (b.symptom ?? null) && (a.side == null || b.side == null || a.side === b.side) && !conflict(a, b);
  // a region said beside a spot in it: the spot
  for (const r of [...out]) {
    if (r.site != null || r.region === "other") continue;
    const spot = out.find((q) => q !== r && q.site != null && compatible(q, r));
    if (spot) fold(r, spot);
  }
  // the same place with and without a side: the sided one (all of them when both sides were said)
  for (const p of [...out]) {
    if (p.side != null || !out.includes(p)) continue;
    const sided = out.filter((q) => q !== p && q.region === p.region && q.site === p.site && (q.symptom ?? null) === (p.symptom ?? null) && q.side != null && !conflict(p, q));
    if (!sided.length) continue;
    for (const q of sided) {
      apply(q, { score: p.score, feel: p.feel, timing: p.timing, exercise: p.exerciseName ? { name: p.exerciseName, id: p.exerciseId } : null, impact: p.impact, change: p.change }, { score: true });
      addNote(q, p.note);
    }
    out.splice(out.indexOf(p), 1);
  }
  return out;
}

/** Words after "my" that aren't a body part (so "my workout hurt" isn't something unplaced). */
const NOT_A_PART = new Set(["workout", "session", "set", "sets", "lift", "lifts", "squat", "squats", "bench", "deadlift", "deadlifts", "run", "runs", "training", "form", "body", "whole", "last", "first", "second", "third", "top", "next", "old", "usual", "same", "other", "left", "right", "own", "one", "coach", "program", "warm", "back", "arm", "arms", "leg", "legs", "energy", "sleep", "day", "week", "morning", "night", "life", "mind", "gym", "pr", "rep", "reps", "grip", "belt", "shoes", "knee", "knees"]);

/** A clause that says something hurts in a part this reader doesn't know ("something in my gizmo hurts"). */
function namesUnknownPart(clause: string): boolean {
  if (!SYMPTOM_HINT.test(clause)) return false;
  for (const m of clause.matchAll(/\b(?:my|the|in my|on my|of my)\s+([a-z]{3,})/g)) if (!NOT_A_PART.has(m[1])) return true;
  return false;
}

/**
 * What the server's reader found, added to what this reader already read:
 * a place this reader has (the same spot and side, or the same symptom) keeps
 * this reader's details; anything new is added. Never swaps one for the other.
 */
export function mergeDescribed(local: DescribeResult, server: DescribeResult): DescribeResult {
  const places = [...local.places];
  const same = (a: DescribedPlace, b: DescribedPlace) =>
    (a.symptom ?? null) === (b.symptom ?? null) &&
    a.region === b.region &&
    (a.side ?? null) === (b.side ?? null) &&
    // a region this reader read stays when the server only found a spot in it, and the other way round
    (a.site === b.site || a.site == null || b.site == null);
  for (const p of server.places) if (!places.some((q) => same(q, p) || (!!p.symptom && q.symptom === p.symptom))) places.push(p);
  const unclear = [...local.unclear];
  for (const u of server.unclear) if (!unclear.some((x) => x.word === u.word)) unclear.push(u);
  return { places, unclear, leftover: [] };
}

// ── safety questions ─────────────────────────────────────────────────────

export type SafetyQuestion = {
  id: "weak" | "cauda" | "sudden" | "fainted";
  text: string;
  /** The places a yes is about (place keys: describedKey). */
  keys: string[];
};

export const describedKey = (p: Pick<DescribedPlace, "region" | "site" | "side" | "symptom">) => `${p.region}:${p.site ?? ""}:${p.side ?? ""}:${p.symptom ?? ""}`;

const BACK_AND_LEGS = new Set(["low_back", "glute", "hamstring", "hip_groin", "quad", "calf", "shin", "ankle_foot", "knee"]);

/**
 * The questions a report turns on because the answer decides whether it
 * needs help now (safety.ts's urgent signs), never more: numbness or tingling
 * asks about weakness (and, with the low back or legs, the groin and bladder);
 * a headache asks whether it came on suddenly and severely; dizziness asks
 * whether they fainted. Nothing already said is asked again.
 */
export function safetyQuestions(places: Pick<DescribedPlace, "region" | "site" | "side" | "symptom" | "feel">[]): SafetyQuestion[] {
  const out: SafetyQuestion[] = [];
  const nerve = places.filter((p) => !p.symptom && p.feel.includes("numb"));
  if (nerve.length && !nerve.some((p) => p.feel.includes("weak")))
    out.push({ id: "weak", text: "Any weakness with the numbness or tingling?", keys: nerve.map(describedKey) });
  const backNerve = nerve.filter((p) => BACK_AND_LEGS.has(p.region));
  if (backNerve.length)
    out.push({ id: "cauda", text: "Any numbness in the groin or inner thighs, or new trouble with your bladder or bowels?", keys: backNerve.map(describedKey) });
  const headache = places.filter((p) => p.symptom === "headache");
  if (headache.length && !headache.some((p) => p.feel.includes("sudden")))
    out.push({ id: "sudden", text: "Did the headache come on suddenly and severely, like the worst you've had?", keys: headache.map(describedKey) });
  const dizzy = places.filter((p) => p.symptom === "dizziness");
  if (dizzy.length && !places.some((p) => p.symptom === "fainted"))
    out.push({ id: "fainted", text: "Did you faint, or nearly faint?", keys: dizzy.map(describedKey) });
  return out;
}

/** A yes to a safety question, as what changes in their places (a no changes nothing). */
export function answerSafety(places: DescribedPlace[], q: SafetyQuestion): DescribedPlace[] {
  const on = new Set(q.keys);
  if (q.id === "fainted") {
    if (places.some((p) => p.symptom === "fainted")) return places;
    return [...places, { ...blank("general", null, null), symptom: "fainted", note: "Said yes to fainting or nearly fainting." }];
  }
  const feel: Feel = q.id === "sudden" ? "sudden" : q.id === "weak" ? "weak" : "numb";
  return places.map((p) => {
    if (!on.has(describedKey(p))) return p;
    const next = { ...p, feel: p.feel.includes(feel) ? p.feel : [...p.feel, feel] };
    if (q.id === "cauda") next.note = `${p.note ? `${p.note} ` : ""}Said yes to numbness in the groin or bladder or bowel changes.`.slice(0, NOTE_MAX);
    return next;
  });
}

/** "Left knee · 5/10 · during squats" for the confirm list. */
export function describedLine(p: DescribedPlace): string {
  const bits: string[] = [];
  if (p.score != null) bits.push(`${p.score}/10`);
  if (p.exerciseName) bits.push(p.exerciseName);
  return bits.join(" · ");
}

// ── what the server's reader sent back, checked against their words ─────

/** A body part said in the plural ("my knees"): both sides. */
const PLURAL_PLACES = /\b(?:knees|shoulders|elbows|wrists|hands|hips|ankles|calves|quads|hamstrings|glutes|shins|feet|heels|thumbs|thighs|delts|lats|traps|forearms|arms|legs|pecs|fingers|toes|palms|knuckles|soles|arches|pinkies)\b/;

const FEEL_SET = new Set<Feel>(["sore", "tight", "ache", "sharp", "pinch", "numb", "swollen", "pop", "burning", "other", "fatigued", "cramp", "weak", "pressure", "throbbing", "sudden"]);
const TIMING_SET = new Set<Timing>(["during", "after", "rest", "movement"]);
const IMPACT_SET = new Set<Impact>(["none", "modified", "stopped"]);

function numberSaid(text: string, n: number): boolean {
  const words = Object.entries(NUMBER_WORDS).filter(([, v]) => v === n).map(([w]) => w);
  return new RegExp(`\\b(?:${n}|${words.join("|")})\\b`).test(text);
}

/**
 * The reader is told to copy, never add; this keeps only what it could have
 * copied: a region and spot that exist (a spot in its own region), a number
 * they said, an exercise whose words are in theirs, their own words as the
 * note. Anything else is dropped, never guessed back in.
 */
export function groundedPlaces(raw: unknown, original: string, opts: { exercises?: WorkoutExercise[]; sites: readonly { key: string; region: string; midline?: boolean }[] }): DescribeResult {
  const text = norm(original);
  const r = (raw ?? {}) as { places?: unknown; unclear?: unknown };
  const out: DescribedPlace[] = [];
  const siteRegion = new Map(opts.sites.map((s) => [s.key, s]));
  const saidSymptoms = new Set(generalSymptomsIn(text));
  for (const x of Array.isArray(r.places) ? r.places.slice(0, 12) : []) {
    const p = (x ?? {}) as Record<string, unknown>;
    // a general symptom only when their own words say it (a made-up "dizzy" would raise a warning sign)
    const symptom = typeof p.symptom === "string" && GENERAL_KEYS.has(p.symptom) && saidSymptoms.has(p.symptom as GeneralSymptom) ? (p.symptom as GeneralSymptom) : null;
    let region = typeof p.region === "string" ? p.region : "";
    if (symptom) {
      const home = generalOf(symptom)!.region;
      if (home === "general" || !(region === "head" || region === "face")) region = home;
    }
    if (!regionOf(region) || region === "other" || (region === "general" && !symptom)) continue;
    const siteDef = typeof p.site === "string" ? siteRegion.get(p.site) : undefined;
    const site = siteDef && siteDef.region === region ? siteDef.key : null;
    const sided = site ? !siteDef!.midline && sidedRegion(region) : sidedRegion(region);
    const canSide = site ? !siteDef!.midline : sidedRegion(region) || lateralRegion(region);
    // a side only when they said one (left, right, both, or a plural): else it's asked
    const saidSide = sidesIn(text).length > 0 || PLURAL_PLACES.test(text);
    const rawSide = saidSide && (p.side === "L" || p.side === "R" || p.side === "both") ? p.side : null;
    const score = typeof p.score === "number" && Number.isInteger(p.score) && p.score >= 0 && p.score <= 10 && numberSaid(text, p.score) ? p.score : null;
    // what it feels like, when, and what it did to the session: only what their own words say
    // (a made-up "numb" would raise a warning sign that was never reported)
    const saidFeels = new Set(feelsIn(text));
    const saidTiming = new Set(TIMING_WORDS.filter(([re]) => re.test(text)).map(([, t]) => t));
    const saidImpact = firstOf(IMPACT_WORDS, text);
    const feel = (Array.isArray(p.feel) ? p.feel : []).filter((f): f is Feel => typeof f === "string" && FEEL_SET.has(f as Feel) && saidFeels.has(f as Feel));
    const timing = (Array.isArray(p.timing) ? p.timing : []).filter((t): t is Timing => typeof t === "string" && TIMING_SET.has(t as Timing) && saidTiming.has(t as Timing));
    const impact = typeof p.impact === "string" && IMPACT_SET.has(p.impact as Impact) && saidImpact === p.impact ? (p.impact as Impact) : null;
    const said = typeof p.exercise === "string" ? norm(p.exercise) : "";
    const exWords = said.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const exercise = said && exWords.some((w) => text.includes(w)) ? exerciseIn(said, opts.exercises ?? []) ?? exerciseIn(text, opts.exercises ?? []) : null;
    const words = typeof p.words === "string" ? p.words.trim() : "";
    const note = (words && text.includes(norm(words)) ? words : original.trim()).slice(0, NOTE_MAX);
    const sides: (PainSide | null)[] = rawSide === "both" && sided ? ["L", "R"] : [canSide && (rawSide === "L" || rawSide === "R") ? rawSide : null];
    for (const side of symptom && region === "general" ? [null] : sides) {
      if (out.some((q) => q.region === region && q.site === site && q.side === side && (q.symptom ?? null) === symptom)) continue;
      const place: DescribedPlace = { ...blank(region, region === "general" ? null : site, side), symptom, score, feel, timing, impact, exerciseName: exercise?.name ?? null, exerciseId: exercise?.id ?? null, note };
      place.needs = needsOf(place);
      out.push(place);
    }
  }
  const unclear: Unclear[] = [];
  for (const u of Array.isArray(r.unclear) ? r.unclear : []) {
    const v = VAGUE.find((x) => x.word === u);
    if (v && !unclear.some((q) => q.word === v.word)) unclear.push({ word: v.word, options: v.options });
  }
  return { places: out, unclear };
}

// ── the confirm list: one row per spot, its sides together ───────────────

export type DescribedGroup = { key: string; region: string; site: string | null; symptom: GeneralSymptom | null; places: DescribedPlace[]; choice: "L" | "R" | "both" | null; sided: boolean };

/** Places grouped by spot, so "both knees" is one row with Left · Right · Both. */
export function describedGroups(places: DescribedPlace[]): DescribedGroup[] {
  const out: DescribedGroup[] = [];
  for (const p of places) {
    const key = `${p.region}:${p.site ?? ""}:${p.symptom ?? ""}`;
    let g = out.find((x) => x.key === key);
    if (!g) {
      const sided = p.site ? !SITE_MIDLINE.has(p.site) && sidedRegion(p.region) : sidedRegion(p.region);
      g = { key, region: p.region, site: p.site, symptom: p.symptom ?? null, places: [], choice: null, sided };
      out.push(g);
    }
    g.places.push(p);
  }
  for (const g of out) {
    const sides = new Set(g.places.map((p) => p.side));
    g.choice = sides.has("L") && sides.has("R") ? "both" : sides.has("L") ? "L" : sides.has("R") ? "R" : null;
  }
  return out;
}

/** A row's side changed in the confirm list: its places, re-sided, what was said kept. */
export function chooseSide(group: DescribedGroup, choice: "L" | "R" | "both"): DescribedPlace[] {
  const base = group.places.find((p) => p.side === choice) ?? group.places[0];
  const resided = (side: PainSide, from: DescribedPlace): DescribedPlace => {
    const p = { ...from, side, feel: [...from.feel], timing: [...from.timing] };
    p.needs = needsOf(p);
    return p;
  };
  if (choice === "both") {
    const l = group.places.find((p) => p.side === "L") ?? base;
    const r = group.places.find((p) => p.side === "R") ?? base;
    return [resided("L", l), resided("R", r)];
  }
  return [resided(choice, base)];
}
