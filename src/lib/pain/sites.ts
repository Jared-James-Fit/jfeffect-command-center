/**
 * The places on the anatomical body map (pure, tested): every muscle, tendon
 * and joint area an athlete can tap, in plain words with the anatomical name
 * beside it. Each belongs to one of the pain regions (regions.ts), whose keys
 * every reader groups history by, so a site only ever adds detail: "Left side
 * delt" is still a left shoulder to the history, the coach's dashboard and
 * the AI.
 *
 * A site says where the athlete feels it, never what's wrong. Keys are stored
 * in `pain_reports.site` and never renamed; a new site is added, never
 * repurposed.
 */
import { regionOf, type PainSide } from "@/lib/pain/regions";

export type SiteKind = "muscle" | "tendon" | "joint" | "area";

export type PainSite = {
  key: string;
  /** The pain region it belongs to (regions.ts). */
  region: string;
  /** What an athlete calls it. */
  label: string;
  /** The anatomical name, shown beside it (never needed to use the map). */
  anat?: string;
  kind: SiteKind;
  /** On the midline (one, no left or right): the spine, the sternum, the tailbone. */
  midline?: boolean;
  /** Under other muscles: drawn on the map's "Deeper" layer. */
  deep?: boolean;
  /** Other words people use, for the search. */
  also?: string[];
};

export const PAIN_SITES: readonly PainSite[] = [
  // neck
  { key: "neck_side", region: "neck", label: "Side of neck", anat: "Sternocleidomastoid", kind: "muscle", also: ["scm", "front of neck"] },
  { key: "neck_back", region: "neck", label: "Back of neck", anat: "Neck extensors (splenius)", kind: "muscle", also: ["nape"] },
  { key: "neck_spine", region: "neck", label: "Center of neck", anat: "Cervical spine", kind: "area", midline: true, also: ["neck bones", "vertebrae"] },
  { key: "levator_scap", region: "neck", label: "Neck into shoulder blade", anat: "Levator scapulae", kind: "muscle", deep: true, also: ["levator"] },
  { key: "scalenes", region: "neck", label: "Deep front of neck", anat: "Scalenes", kind: "muscle", deep: true },
  // shoulder
  { key: "front_delt", region: "shoulder", label: "Front delt", anat: "Anterior deltoid", kind: "muscle", also: ["front shoulder", "anterior delt"] },
  { key: "side_delt", region: "shoulder", label: "Side delt", anat: "Lateral deltoid", kind: "muscle", also: ["middle delt", "outer shoulder"] },
  { key: "rear_delt", region: "shoulder", label: "Rear delt", anat: "Posterior deltoid", kind: "muscle", also: ["back of shoulder"] },
  { key: "ac_joint", region: "shoulder", label: "Top of shoulder", anat: "AC joint", kind: "joint", also: ["acromioclavicular"] },
  { key: "shoulder_front", region: "shoulder", label: "Front of shoulder joint", anat: "Biceps tendon (long head)", kind: "tendon", also: ["bicipital groove", "front of shoulder"] },
  { key: "supraspinatus", region: "shoulder", label: "Top of shoulder blade", anat: "Supraspinatus (rotator cuff)", kind: "muscle", deep: true, also: ["rotator cuff"] },
  { key: "infraspinatus", region: "shoulder", label: "Back of shoulder blade", anat: "Infraspinatus (rotator cuff)", kind: "muscle", also: ["rotator cuff"] },
  { key: "teres_minor", region: "shoulder", label: "Back of the armpit", anat: "Teres minor (rotator cuff)", kind: "muscle", also: ["rotator cuff"] },
  // chest
  { key: "upper_chest", region: "chest", label: "Upper chest", anat: "Pec major (clavicular head)", kind: "muscle", also: ["upper pec", "clavicular pec"] },
  { key: "chest", region: "chest", label: "Chest", anat: "Pec major (sternal head)", kind: "muscle", also: ["pec", "pecs", "pectoral"] },
  { key: "pec_minor", region: "chest", label: "Deep chest, under the collarbone", anat: "Pec minor", kind: "muscle", deep: true },
  { key: "serratus", region: "chest", label: "Side of ribs", anat: "Serratus anterior", kind: "muscle", also: ["ribs", "side"] },
  { key: "sternum", region: "chest", label: "Breastbone", anat: "Sternum", kind: "area", midline: true, also: ["middle of chest"] },
  // upper arm
  { key: "biceps", region: "upper_arm", label: "Biceps", anat: "Biceps brachii", kind: "muscle", also: ["bicep", "front of arm"] },
  { key: "brachialis", region: "upper_arm", label: "Lower outer arm", anat: "Brachialis", kind: "muscle" },
  { key: "triceps", region: "upper_arm", label: "Back of arm", anat: "Triceps", kind: "muscle", also: ["tricep"] },
  // elbow & forearm
  { key: "elbow_outer", region: "elbow", label: "Outside of elbow", anat: "Lateral epicondyle (tennis elbow area)", kind: "joint", also: ["tennis elbow", "lateral elbow"] },
  { key: "elbow_inner", region: "elbow", label: "Inside of elbow", anat: "Medial epicondyle (golfer's elbow area)", kind: "joint", also: ["golfers elbow", "golfer's elbow", "medial elbow"] },
  { key: "elbow_front", region: "elbow", label: "Front of elbow", anat: "Distal biceps tendon", kind: "tendon", also: ["elbow crease"] },
  { key: "elbow_back", region: "elbow", label: "Back of elbow", anat: "Olecranon / triceps tendon", kind: "joint", also: ["elbow point"] },
  { key: "brachioradialis", region: "elbow", label: "Top of forearm", anat: "Brachioradialis", kind: "muscle", also: ["forearm"] },
  { key: "forearm_flexors", region: "elbow", label: "Inner forearm", anat: "Wrist flexors", kind: "muscle", also: ["forearm", "grip"] },
  { key: "forearm_extensors", region: "elbow", label: "Back of forearm", anat: "Wrist extensors", kind: "muscle", also: ["forearm"] },
  // wrist & hand
  { key: "wrist_front", region: "wrist_hand", label: "Wrist, palm side", anat: "Wrist (palmar)", kind: "joint", also: ["wrist"] },
  { key: "wrist_back", region: "wrist_hand", label: "Back of wrist", anat: "Wrist (dorsal)", kind: "joint", also: ["wrist"] },
  { key: "hand", region: "wrist_hand", label: "Hand and fingers", anat: "Hand", kind: "area", also: ["palm", "fingers", "knuckles"] },
  { key: "thumb", region: "wrist_hand", label: "Thumb", anat: "Thumb (thenar)", kind: "area" },
  // upper back
  { key: "upper_trap", region: "upper_back", label: "Upper trap", anat: "Upper trapezius", kind: "muscle", also: ["traps", "trap", "top of shoulder"] },
  { key: "mid_trap", region: "upper_back", label: "Between the shoulder blades", anat: "Middle trapezius", kind: "muscle", also: ["traps"] },
  { key: "upper_spine", region: "upper_back", label: "Upper spine", anat: "Thoracic spine (upper)", kind: "area", midline: true },
  // shoulder blade
  { key: "scapula_border", region: "shoulder_blade", label: "Inside edge of shoulder blade", anat: "Medial scapular border", kind: "area", also: ["shoulder blade pinch"] },
  { key: "rhomboids", region: "shoulder_blade", label: "Under the shoulder blade edge", anat: "Rhomboids", kind: "muscle", deep: true, also: ["rhomboid"] },
  { key: "teres_major", region: "shoulder_blade", label: "Lower corner of shoulder blade", anat: "Teres major", kind: "muscle" },
  // mid back
  { key: "lower_trap", region: "mid_back", label: "Lower trap", anat: "Lower trapezius", kind: "muscle" },
  { key: "lats", region: "mid_back", label: "Lats", anat: "Latissimus dorsi", kind: "muscle", also: ["lat", "side of back"] },
  { key: "erectors_mid", region: "mid_back", label: "Mid back muscles", anat: "Erector spinae (thoracic)", kind: "muscle", also: ["spinal erectors"] },
  { key: "mid_spine", region: "mid_back", label: "Mid spine", anat: "Thoracic spine", kind: "area", midline: true },
  // low back
  { key: "erectors_low", region: "low_back", label: "Low back muscles", anat: "Erector spinae (lumbar)", kind: "muscle", also: ["lower back", "spinal erectors"] },
  { key: "low_spine", region: "low_back", label: "Center of low back", anat: "Lumbar spine", kind: "area", midline: true, also: ["lumbar"] },
  { key: "ql", region: "low_back", label: "Deep side of low back", anat: "Quadratus lumborum", kind: "muscle", deep: true, also: ["ql"] },
  { key: "si_joint", region: "low_back", label: "SI joint", anat: "Sacroiliac joint", kind: "joint", also: ["sacrum", "dimple"] },
  { key: "tailbone", region: "low_back", label: "Tailbone", anat: "Coccyx", kind: "area", midline: true },
  // abs
  { key: "abs", region: "abs", label: "Abs", anat: "Rectus abdominis", kind: "muscle", also: ["stomach", "six pack", "core"] },
  { key: "obliques", region: "abs", label: "Side of waist", anat: "Obliques", kind: "muscle", also: ["oblique", "love handle"] },
  // hip & groin
  { key: "hip_flexor", region: "hip_groin", label: "Hip flexor", anat: "Iliopsoas", kind: "muscle", also: ["psoas", "front of hip"] },
  { key: "tfl", region: "hip_groin", label: "Front-outer hip", anat: "Tensor fasciae latae", kind: "muscle", also: ["tfl"] },
  { key: "hip_outer", region: "hip_groin", label: "Outer hip bone", anat: "Greater trochanter", kind: "joint", also: ["side of hip"] },
  { key: "groin", region: "hip_groin", label: "Groin", anat: "Pectineus", kind: "muscle", also: ["groin strain"] },
  { key: "adductors", region: "hip_groin", label: "Inner thigh", anat: "Adductors", kind: "muscle", also: ["adductor", "inner thigh"] },
  // glute
  { key: "glute_max", region: "glute", label: "Glute", anat: "Gluteus maximus", kind: "muscle", also: ["butt", "glutes"] },
  { key: "glute_med", region: "glute", label: "Upper outer glute", anat: "Gluteus medius", kind: "muscle", also: ["side glute"] },
  { key: "glute_min", region: "glute", label: "Deep upper glute", anat: "Gluteus minimus", kind: "muscle", deep: true },
  { key: "piriformis", region: "glute", label: "Deep in the glute", anat: "Piriformis", kind: "muscle", deep: true, also: ["sciatic"] },
  // thigh
  { key: "rectus_femoris", region: "quad", label: "Front of thigh", anat: "Rectus femoris", kind: "muscle", also: ["quad"] },
  { key: "vastus_lateralis", region: "quad", label: "Outer quad", anat: "Vastus lateralis", kind: "muscle", also: ["quad"] },
  { key: "vmo", region: "quad", label: "Inner quad (teardrop)", anat: "Vastus medialis", kind: "muscle", also: ["vmo", "quad"] },
  { key: "sartorius", region: "quad", label: "Inner-front thigh strap", anat: "Sartorius", kind: "muscle" },
  { key: "it_band", region: "quad", label: "Outer thigh", anat: "IT band", kind: "tendon", also: ["itb", "iliotibial"] },
  { key: "hamstring_outer", region: "hamstring", label: "Outer hamstring", anat: "Biceps femoris", kind: "muscle", also: ["hamstring"] },
  { key: "hamstring_inner", region: "hamstring", label: "Inner hamstring", anat: "Semitendinosus / semimembranosus", kind: "muscle", also: ["hamstring"] },
  { key: "high_hamstring", region: "hamstring", label: "High hamstring, near the sit bone", anat: "Proximal hamstring tendon", kind: "tendon", also: ["sit bone", "hamstring"] },
  // knee
  { key: "kneecap", region: "knee", label: "Kneecap", anat: "Patella", kind: "joint", also: ["patella"] },
  { key: "patellar_tendon", region: "knee", label: "Below the kneecap", anat: "Patellar tendon", kind: "tendon", also: ["jumper's knee"] },
  { key: "quad_tendon", region: "knee", label: "Above the kneecap", anat: "Quadriceps tendon", kind: "tendon" },
  { key: "knee_inner", region: "knee", label: "Inside of knee", anat: "Medial knee", kind: "joint" },
  { key: "knee_outer", region: "knee", label: "Outside of knee", anat: "Lateral knee", kind: "joint" },
  { key: "knee_back", region: "knee", label: "Back of knee", anat: "Popliteal area", kind: "area" },
  // shin & calf
  { key: "tibialis", region: "shin", label: "Front of shin", anat: "Tibialis anterior", kind: "muscle", also: ["shin"] },
  { key: "shin_inner", region: "shin", label: "Inner shin", anat: "Medial tibia (shin splints area)", kind: "area", also: ["shin splints"] },
  { key: "peroneals", region: "shin", label: "Outer lower leg", anat: "Peroneals", kind: "muscle", also: ["fibularis"] },
  { key: "calf_inner", region: "calf", label: "Inner calf", anat: "Gastrocnemius (medial head)", kind: "muscle", also: ["calf", "gastroc"] },
  { key: "calf_outer", region: "calf", label: "Outer calf", anat: "Gastrocnemius (lateral head)", kind: "muscle", also: ["calf", "gastroc"] },
  { key: "soleus", region: "calf", label: "Lower calf", anat: "Soleus", kind: "muscle", also: ["calf"] },
  // ankle & foot
  { key: "achilles", region: "ankle_foot", label: "Achilles", anat: "Achilles tendon", kind: "tendon", also: ["heel cord"] },
  { key: "ankle_front", region: "ankle_foot", label: "Front of ankle", anat: "Ankle (anterior)", kind: "joint", also: ["ankle"] },
  { key: "ankle_inner", region: "ankle_foot", label: "Inside of ankle", anat: "Medial malleolus", kind: "joint", also: ["ankle"] },
  { key: "ankle_outer", region: "ankle_foot", label: "Outside of ankle", anat: "Lateral malleolus", kind: "joint", also: ["ankle", "rolled ankle"] },
  { key: "heel", region: "ankle_foot", label: "Heel", anat: "Calcaneus", kind: "joint" },
  { key: "arch", region: "ankle_foot", label: "Arch of foot", anat: "Plantar fascia", kind: "tendon", also: ["plantar", "sole"] },
  { key: "foot_top", region: "ankle_foot", label: "Top of foot", anat: "Dorsum of foot", kind: "area", also: ["toes", "foot"] },
];

const BY_KEY = new Map(PAIN_SITES.map((s) => [s.key, s]));
export const SITE_KEYS: ReadonlySet<string> = new Set(PAIN_SITES.map((s) => s.key));

export function siteOf(key: string | null | undefined): PainSite | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function sitesIn(region: string): PainSite[] {
  return PAIN_SITES.filter((s) => s.region === region);
}

/** Does this place take a left or right? A midline site never does; a whole region does when it comes in pairs. */
export function siteSided(site: string | null | undefined, region: string): boolean {
  const s = siteOf(site);
  if (s) return !s.midline;
  return !!regionOf(region)?.sided;
}

const sideWord = (side: PainSide) => (side === "L" ? "Left" : "Right");

/** "Left side delt", "Center of low back", "Breastbone". Sentence case, side first. */
export function siteLabel(site: string, side: PainSide | null | undefined): string {
  const s = siteOf(site);
  if (!s) return site;
  if (!side || s.midline) return s.label;
  return `${sideWord(side)} ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}`;
}

/** The anatomical name in lowercase for a sentence ("lateral deltoid"), or null when it adds nothing. */
export function siteAnatomy(site: string | null | undefined): string | null {
  const s = siteOf(site);
  if (!s?.anat) return null;
  if (s.anat.toLowerCase() === s.label.toLowerCase()) return null;
  return s.anat;
}

const norm = (t: string) => t.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The list's search: every word typed must be in the site's plain name, its
 * anatomical name, its region or one of its other names. Best matches first:
 * a name that starts with the query, then a whole-word match, then the rest.
 */
export function searchSites(query: string): PainSite[] {
  const q = norm(query);
  if (!q) return [...PAIN_SITES];
  const words = q.split(" ");
  const scored: { s: PainSite; score: number }[] = [];
  for (const s of PAIN_SITES) {
    const region = regionOf(s.region)?.label ?? "";
    const hay = norm([s.label, s.anat ?? "", region, ...(s.also ?? [])].join(" "));
    if (!words.every((w) => hay.includes(w))) continue;
    const label = norm(s.label);
    const score = label.startsWith(q) ? 0 : norm(s.anat ?? "").startsWith(q) ? 1 : (s.also ?? []).some((a) => norm(a) === q) ? 1 : ` ${hay} `.includes(` ${q} `) ? 2 : 3;
    scored.push({ s, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((x) => x.s);
}
