/**
 * Where it hurts: the body regions a pain report can name (pure, tested).
 *
 * One list for the body map, the list fallback, the stored reports and every
 * reader. A region is either sided (a shoulder: the map's tap says which one)
 * or on the midline (the neck, low back: a side is an optional detail, "left
 * side of my low back"). Keys are stored in `pain_reports.region` and never
 * renamed; a new region is added, never repurposed.
 *
 * The groupings come from what clients wrote under "Other" (Nov 2026: neck,
 * mid back, a shoulder blade "pinch", adductor, tennis elbow, calf), and the
 * shoulder blade, mid back and glute are their own regions because lifters
 * tell them apart from the shoulder, low back and hip.
 */

export type PainSide = "L" | "R";

export type RegionGroup = "upper" | "trunk" | "lower";

export type PainRegion = {
  key: string;
  label: string;
  /** Comes in pairs: a report is one side (the map's tap says which). */
  sided: boolean;
  /** Midline region that can still lean to one side (low back, neck). */
  lateral?: boolean;
  group: RegionGroup;
};

export const PAIN_REGIONS: readonly PainRegion[] = [
  { key: "neck", label: "Neck", sided: false, lateral: true, group: "upper" },
  { key: "shoulder", label: "Shoulder", sided: true, group: "upper" },
  { key: "chest", label: "Chest", sided: true, group: "upper" },
  { key: "upper_arm", label: "Upper arm", sided: true, group: "upper" },
  { key: "elbow", label: "Elbow", sided: true, group: "upper" },
  { key: "wrist_hand", label: "Wrist / hand", sided: true, group: "upper" },
  { key: "upper_back", label: "Upper back", sided: false, lateral: true, group: "trunk" },
  { key: "shoulder_blade", label: "Shoulder blade", sided: true, group: "trunk" },
  { key: "mid_back", label: "Mid back", sided: false, lateral: true, group: "trunk" },
  { key: "low_back", label: "Low back", sided: false, lateral: true, group: "trunk" },
  { key: "abs", label: "Abs / core", sided: false, group: "trunk" },
  { key: "hip_groin", label: "Hip / groin", sided: true, group: "lower" },
  { key: "glute", label: "Glute", sided: true, group: "lower" },
  { key: "quad", label: "Quad", sided: true, group: "lower" },
  { key: "hamstring", label: "Hamstring", sided: true, group: "lower" },
  { key: "knee", label: "Knee", sided: true, group: "lower" },
  { key: "shin", label: "Shin", sided: true, group: "lower" },
  { key: "calf", label: "Calf", sided: true, group: "lower" },
  { key: "ankle_foot", label: "Ankle / foot", sided: true, group: "lower" },
  // only from the list (and older reports): where they say it in words
  { key: "other", label: "Somewhere else", sided: false, group: "trunk" },
];

export const REGION_KEYS: readonly string[] = PAIN_REGIONS.map((r) => r.key);
const BY_KEY = new Map(PAIN_REGIONS.map((r) => [r.key, r]));

export function regionOf(key: string | null | undefined): PainRegion | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export const REGION_GROUPS: { key: RegionGroup; label: string }[] = [
  { key: "upper", label: "Neck, shoulders & arms" },
  { key: "trunk", label: "Back & trunk" },
  { key: "lower", label: "Hips & legs" },
];

/** "Left shoulder", "Low back (right side)", "Neck". Lowercase after a side. */
export function areaLabel(region: string, side: PainSide | null | undefined): string {
  const r = regionOf(region);
  const name = r?.label ?? region;
  if (!side) return name;
  const word = side === "L" ? "Left" : "Right";
  if (r && !r.sided) return `${name} (${word.toLowerCase()} side)`;
  return `${word} ${name.toLowerCase()}`;
}

/** One place, keyed the way history groups it: a region and its side. */
export function areaKey(region: string, side: PainSide | null | undefined): string {
  return `${region}:${side ?? "-"}`;
}

/**
 * The stored pain_area text (shown to the coach as-is, read by Program
 * Intelligence and the inbox): the format the earlier review wrote, "Shoulder
 * (L), Low back". Both sides of a place come out as two entries.
 */
export function legacyAreaText(picks: { region: string; side: PainSide | null; note?: string | null }[]): string | null {
  const parts: string[] = [];
  for (const p of picks) {
    const r = regionOf(p.region);
    if (!r) continue;
    const name = r.key === "other" ? (p.note?.trim().slice(0, 60) || "Other") : r.label;
    const part = p.side ? `${name} (${p.side})` : name;
    if (!parts.includes(part)) parts.push(part);
  }
  return parts.length ? parts.join(", ") : null;
}

/**
 * Names a person (or the earlier review) used for a place, mapped to a
 * region. Order matters only for the text reader: longer phrases first.
 */
const ALIASES: [RegExp, string][] = [
  [/\b(shoulder ?blades?|scapula[es]?|rhomboids?)\b/i, "shoulder_blade"],
  [/\b(mid(dle)?[ -]?back|thoracic)\b/i, "mid_back"],
  [/\b(low(er)?[ -]?back|lumbar|si joint|sacr\w*|ql)\b/i, "low_back"],
  [/\b(upper[ -]?back|traps?|trapezius)\b/i, "upper_back"],
  [/\b(neck|cervical)\b/i, "neck"],
  [/\b(rotator cuff|shoulders?|delts?|deltoids?|ac joint)\b/i, "shoulder"],
  [/\b(chest|pecs?|pectorals?|sternum|ribs?)\b/i, "chest"],
  [/\b(biceps?|triceps?|upper arms?)\b/i, "upper_arm"],
  [/\b(elbows?|tennis elbow|golfer'?s elbow|forearms?)\b/i, "elbow"],
  [/\b(wrists?|hands?|fingers?|thumbs?)\b/i, "wrist_hand"],
  [/\b(abs|abdominals?|core|oblique?s?|stomach)\b/i, "abs"],
  [/\b(hips?|groin|adductors?|hip flexors?|inner thighs?)\b/i, "hip_groin"],
  [/\b(glutes?|butt|piriformis|sciatic\w*)\b/i, "glute"],
  [/\b(quads?|quadriceps|thighs?)\b/i, "quad"],
  [/\b(hamstrings?|hammies)\b/i, "hamstring"],
  [/\b(knees?|patella\w*)\b/i, "knee"],
  [/\b(shins?)\b/i, "shin"],
  [/\b(calf|calves)\b/i, "calf"],
  [/\b(ankles?|feet|foot|achilles|heels?|toes?|plantar)\b/i, "ankle_foot"],
];

/** The chips of the review before Nov 2026, as stored ("Calf / ankle", "Hip / groin"). */
const LEGACY_CHIPS: Record<string, string> = {
  neck: "neck",
  shoulder: "shoulder",
  "upper back": "upper_back",
  "mid back": "mid_back",
  chest: "chest",
  elbow: "elbow",
  wrist: "wrist_hand",
  "low back": "low_back",
  "lower back": "low_back",
  "hip / groin": "hip_groin",
  hip: "hip_groin",
  groin: "hip_groin",
  hamstring: "hamstring",
  knee: "knee",
  "calf / ankle": "calf",
  calf: "calf",
  "ankle/foot": "ankle_foot",
  ankle: "ankle_foot",
};

/** A single region read from a word or phrase, or null. */
export function regionFromName(name: string | null | undefined): string | null {
  const t = (name ?? "").trim().toLowerCase();
  if (!t) return null;
  if (BY_KEY.has(t.replace(/[ /]+/g, "_"))) return t.replace(/[ /]+/g, "_");
  for (const r of PAIN_REGIONS) if (r.label.toLowerCase() === t) return r.key;
  if (LEGACY_CHIPS[t]) return LEGACY_CHIPS[t];
  for (const [re, key] of ALIASES) if (re.test(t)) return key;
  return null;
}

/**
 * Places named in someone's own words ("Lower back & neck", "Right tennis
 * elbow", "mid back right side - pinch feeling"), each with the side the words
 * give it. Used only to read older reports that were typed, never to decide
 * anything on its own: callers mark what it found as read from their words.
 */
export function regionsInText(text: string | null | undefined): { region: string; side: PainSide | null }[] {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return [];
  const out: { region: string; side: PainSide | null }[] = [];
  const seen = new Set<string>();
  // split into clauses so "left knee and right shoulder" keeps each side
  for (const clause of t.split(/[,;&\n]|\band\b|\bplus\b/)) {
    for (const [re, key] of ALIASES) {
      if (!re.test(clause)) continue;
      const side: PainSide | null = /\bleft\b|\(l\)/.test(clause) ? "L" : /\bright\b|\(r\)/.test(clause) ? "R" : null;
      const id = `${key}:${side ?? ""}`;
      if (seen.has(id)) continue;
      // "low back" also matches "back": one per clause
      seen.add(id);
      out.push({ region: key, side });
      break;
    }
  }
  return out;
}
