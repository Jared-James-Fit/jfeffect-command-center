/**
 * A client's health profile: one read of everything on file about their
 * health, for the coach's Health card (client Summary), the Training tab's
 * Athlete setup, the nutrition AI and its supplement advice, and the program
 * AI (Generate Next Program, Edit with AI), so they always agree.
 *
 * What it reads (never guessed):
 * - What the coach or the client added (client_health_items): injuries,
 *   conditions, medications, supplements they take, allergies. Resolved ones
 *   are kept as history.
 * - What they said on their forms, through the food history (food-history.ts):
 *   every Nutrition Update's health answer, "anything I missed" and the
 *   allergies, sticky until the coach marks one as no longer applying.
 * - Goals & Setup's injuries (and the older intake fields).
 * - Pain they reported after workouts (pl_workout_feedback) in the last
 *   PAIN_WEEKS weeks, by body area.
 * - The coach's settings (client_health_profiles): drug-tested, federation,
 *   supplement budget; the budget falls back to the latest form answer, then
 *   the essentials.
 *
 * Pure, so it's tested and every side reads it the same way.
 */
import type { FactKind, FoodHistory, StickyFact } from "@/lib/nutrition-targets/food-history";
import { saidWhen, splitHealthParts } from "@/lib/nutrition-targets/food-history";
import { isNoneAnswer } from "@/lib/nutrition-targets/food-notes";
import { answerFor, type QA } from "@/lib/nutrition-ai-prompts";

export type HealthKind = "injury" | "condition" | "medication" | "supplement" | "allergy";
export type SupplementBudget = "essentials" | "some" | "open";

export const HEALTH_KINDS: Array<{ kind: HealthKind; label: string; plural: string; hint: string }> = [
  { kind: "injury", label: "Injury", plural: "Injuries", hint: "e.g. Left knee, patellar tendinopathy" },
  { kind: "condition", label: "Condition", plural: "Conditions", hint: "e.g. Hypothyroidism, IBS, asthma" },
  { kind: "medication", label: "Medication", plural: "Medications", hint: "e.g. Levothyroxine 100 mcg" },
  { kind: "supplement", label: "Supplement", plural: "Supplements they take", hint: "e.g. Creatine 5 g" },
  { kind: "allergy", label: "Allergy", plural: "Allergies", hint: "e.g. Shellfish" },
];

export const BUDGET_LABELS: Record<SupplementBudget, string> = {
  essentials: "Just the essentials",
  some: "A few worthwhile extras",
  open: "Whatever's worth it",
};

/** client_health_items, as read. */
export type HealthItem = {
  id: string;
  client_id: string;
  kind: HealthKind;
  label: string;
  details: string | null;
  body_area: string | null;
  status: "active" | "resolved";
  since: string | null;
  resolved_on: string | null;
  source: "coach" | "client";
  coach_only: boolean;
  created_at: string;
  updated_at: string;
};

/** client_health_profiles, as read. */
export type HealthSettings = {
  drug_tested: boolean | null;
  federation: string | null;
  supplement_budget: SupplementBudget | null;
};

export type HealthEntry = {
  /** The item's id, or `fact:<kind>:<key>` / `setup:injury` / `intake:<n>` / `form:supplements`. */
  id: string;
  kind: HealthKind | "diet";
  label: string;
  details: string | null;
  area: string | null;
  since: string | null;
  /** Last said or changed, YYYY-MM-DD. */
  at: string;
  /** When it was said on forms ("Jul 12 – Nov 8"), for facts. */
  said?: string;
  from: "coach" | "client" | "form" | "setup";
  /** "You", "Them", "Nutrition Update", "Goals & Setup". */
  fromLabel: string;
  coachOnly: boolean;
  /** Editable: the client_health_items row. */
  item?: HealthItem;
  /** Said on forms: marks as no longer applying (client_food_history_dismissals). */
  fact?: { kind: FactKind; key: string };
};

export type PainArea = { area: string; count: number; last: string; worst: number | null };

export type HealthInput = {
  items: HealthItem[];
  settings?: HealthSettings | null;
  /** The food history (food-history.ts): allergies, diets and health said on forms, dismissed ones flagged. */
  food?: Pick<FoodHistory, "allergies" | "diets" | "health"> | null;
  goals?: { injuries_has?: boolean | null; injuries_details?: string | null; updated_at?: string | null; completed_at?: string | null } | null;
  /** clients.injuries / clients.intake_injuries. */
  clientInjuries?: Array<string | null | undefined>;
  /** Their latest Nutrition Update. */
  latest?: { at: string; answers: QA[] } | null;
  /** Check-outs that reported pain. */
  pain?: Array<{ date: string | null; area: string | null; level: number | null }>;
  /** YYYY-MM-DD */
  today: string;
};

export type HealthProfile = {
  injuries: HealthEntry[];
  conditions: HealthEntry[];
  medications: HealthEntry[];
  /** What they take now. */
  supplements: HealthEntry[];
  allergies: HealthEntry[];
  diets: HealthEntry[];
  /** Resolved items and facts marked as no longer applying, newest first. */
  past: HealthEntry[];
  /** Pain after workouts in the last PAIN_WEEKS weeks, most reported first. */
  pain: PainArea[];
  drugTested: boolean | null;
  federation: string | null;
  budget: SupplementBudget;
  budgetFrom: "coach" | "form" | "default";
  /** Nothing on file at all. */
  empty: boolean;
};

export const PAIN_WEEKS = 6;

const INJURY =
  /\b(injur\w*|sprain\w*|strain\w*|tear|torn|rupture\w*|fractur\w*|broke|broken|dislocat\w*|tendin\w*|tendon\w*|bursitis|impinge\w*|labrum|labral|rotator|meniscus|acl|mcl|pcl|disc|herniat\w*|bulg\w*|sciatica|whiplash|surgery|surgeries|operation|replacement|knee|shoulder|hip|elbow|wrist|ankle|back pain|low back|lower back|neck|hamstring|groin|achilles|shin|plantar|it band|si joint|pec)\b/i;
const MEDICATION =
  /\b(medication|meds|med|pills?|prescri\w*|mg|mcg|tablets?|inhaler|injection|levothyroxine|synthroid|eltroxin|metformin|insulin|ozempic|wegovy|mounjaro|zepbound|rybelsus|saxenda|semaglutide|tirzepatide|liraglutide|warfarin|coumadin|apixaban|eliquis|rivaroxaban|xarelto|clopidogrel|plavix|lisinopril|ramipril|losartan|valsartan|amlodipine|metoprolol|bisoprolol|propranolol|atorvastatin|rosuvastatin|statin|hydrochlorothiazide|hctz|furosemide|lasix|spironolactone|sertraline|zoloft|escitalopram|cipralex|lexapro|fluoxetine|prozac|citalopram|venlafaxine|effexor|bupropion|wellbutrin|lithium|adderall|vyvanse|ritalin|concerta|methylphenidate|omeprazole|pantoprazole|esomeprazole|nexium|prednisone|birth control|the pill|iud|testosterone|trt|accutane|isotretinoin|antibiotic\w*|doxycycline|amoxicillin|ventolin|salbutamol|albuterol)\b/i;

/** A named condition: "hypothyroid on levothyroxine" is a condition with its medication, not a medication. */
const CONDITION =
  /\b(condition|disease|disorder|syndrome|deficien\w*|diagnos\w*|(hypo|hyper)?thyroid\w*|hashimoto\w*|graves|diabet\w*|pcos|polycystic|asthma|ibs|crohn\w*|colitis|celiac|coeliac|anemi\w*|anaemi\w*|hypertension|high blood pressure|cholesterol|depress\w*|anxiety|adhd|add\b|bipolar|migraine\w*|epilep\w*|endometriosis|menopaus\w*|pregnan\w*|gout|lupus|psoriasis|eczema|apnea|insomnia|reflux|gerd|kidney|liver|heart)\b/i;

/** Which kind a thing they wrote is: an injury, a medication, else a condition. */
export function classifyHealthText(text: string): "injury" | "medication" | "condition" {
  const t = String(text ?? "");
  // a body part or injury word first ("hip arthritis" trains like an injury)
  if (INJURY.test(t)) return "injury";
  if (MEDICATION.test(t) && !CONDITION.test(t)) return "medication";
  return "condition";
}

const day = (iso: string | null | undefined) => String(iso ?? "").slice(0, 10);
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const key = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function fromItem(it: HealthItem): HealthEntry {
  return {
    id: it.id,
    kind: it.kind,
    label: clean(it.label),
    details: clean(it.details) || null,
    area: clean(it.body_area) || null,
    since: it.since,
    at: day(it.updated_at || it.created_at),
    from: it.source === "client" ? "client" : "coach",
    fromLabel: it.source === "client" ? "Them" : "You",
    coachOnly: !!it.coach_only,
    item: it,
  };
}

function fromFact(f: StickyFact, kind: HealthEntry["kind"]): HealthEntry {
  const words = f.mentions[0]?.text ?? f.label;
  const sources = [...new Set(f.mentions.map((m) => m.source))];
  const fromProfile = sources.every((s) => /health profile/i.test(s));
  return {
    id: `fact:${f.kind}:${f.key}`,
    kind,
    label: f.label,
    details: clean(words) && key(words) !== key(f.label) ? clean(words) : null,
    area: null,
    since: null,
    at: f.last,
    said: saidWhen(f),
    from: fromProfile ? "coach" : sources.some((s) => /goals/i.test(s)) && sources.length === 1 ? "setup" : "form",
    fromLabel: sources.filter((s) => !/health profile/i.test(s)).join(" · ") || "Health profile",
    coachOnly: false,
    fact: { kind: f.kind, key: f.key },
  };
}

/** The client's health, across their whole account. */
export function buildHealthProfile(input: HealthInput): HealthProfile {
  const items = input.items ?? [];
  const live = items.filter((i) => i.status !== "resolved");
  const past: HealthEntry[] = items.filter((i) => i.status === "resolved").map(fromItem);

  const injuries: HealthEntry[] = live.filter((i) => i.kind === "injury").map(fromItem);
  const conditions: HealthEntry[] = live.filter((i) => i.kind === "condition").map(fromItem);
  const medications: HealthEntry[] = live.filter((i) => i.kind === "medication").map(fromItem);
  const supplements: HealthEntry[] = live.filter((i) => i.kind === "supplement").map(fromItem);

  // what an item already says, so a form that says the same isn't listed twice
  const said = new Set(live.map((i) => key(`${i.label} ${i.details ?? ""}`)));
  const covered = (text: string) => {
    const k = key(text);
    if (!k) return true;
    for (const s of said) if (s.includes(k) || (k.length > 5 && k.includes(s))) return true;
    return false;
  };

  // Health said on forms: each into its kind, unless an item already covers it.
  for (const f of input.food?.health ?? []) {
    if (/health profile/i.test(f.mentions.map((m) => m.source).join(" ")) && f.mentions.every((m) => /health profile/i.test(m.source))) continue;
    const text = f.mentions[0]?.text ?? f.label;
    const kind = classifyHealthText(`${f.label} ${text}`);
    const e = fromFact(f, kind);
    if (f.dismissed) past.push({ ...e, at: f.dismissed.at });
    else if (!covered(text) && !covered(f.label)) (kind === "injury" ? injuries : kind === "medication" ? medications : conditions).push(e);
  }

  // Goals & Setup's injuries, and the older intake fields.
  const g = input.goals;
  if (g?.injuries_has || clean(g?.injuries_details)) {
    const text = clean(g?.injuries_details);
    for (const part of text ? splitHealthParts(text) : ["Injury noted (no details)"]) {
      if (covered(part)) continue;
      injuries.push({
        id: `setup:injury:${key(part)}`,
        kind: "injury",
        label: part,
        details: null,
        area: null,
        since: null,
        at: day(g?.updated_at ?? g?.completed_at ?? input.today),
        from: "setup",
        fromLabel: "Goals & Setup",
        coachOnly: false,
      });
    }
  }
  (input.clientInjuries ?? []).forEach((t, n) => {
    const text = clean(t);
    if (!text || isNoneAnswer(text) || covered(text) || injuries.some((e) => key(e.label) === key(text))) return;
    injuries.push({ id: `intake:${n}`, kind: "injury", label: text, details: null, area: null, since: null, at: input.today, from: "setup", fromLabel: "Intake", coachOnly: false });
  });

  // What they take now: the items, then their latest Nutrition Update's answer.
  const latest = input.latest ?? null;
  const takes = latest ? clean(answerFor(latest.answers, "supplements", "take")) : "";
  if (takes && !isNoneAnswer(takes)) {
    for (const part of splitHealthParts(takes)) {
      if (covered(part) || supplements.some((e) => key(e.label) === key(part))) continue;
      supplements.push({ id: `form:supplements:${key(part)}`, kind: "supplement", label: part, details: null, area: null, since: null, at: day(latest!.at), from: "form", fromLabel: "Nutrition Update", coachOnly: false });
    }
  }

  // Allergies and diets are the food history's (the Food & diet card's); items feed it.
  const allergies: HealthEntry[] = [];
  for (const f of input.food?.allergies ?? []) (f.dismissed ? past : allergies).push(f.dismissed ? { ...fromFact(f, "allergy"), at: f.dismissed.at } : fromFact(f, "allergy"));
  const diets: HealthEntry[] = [];
  for (const f of input.food?.diets ?? []) (f.dismissed ? past : diets).push(f.dismissed ? { ...fromFact(f, "diet"), at: f.dismissed.at } : fromFact(f, "diet"));

  // Pain after workouts, by area, in the last PAIN_WEEKS weeks.
  const since = new Date(Date.parse(`${input.today}T00:00:00Z`) - PAIN_WEEKS * 7 * 86_400_000).toISOString().slice(0, 10);
  const byArea = new Map<string, PainArea>();
  for (const p of input.pain ?? []) {
    const d = day(p.date);
    if (!d || d < since) continue;
    const area = clean(p.area).toLowerCase() || "not said";
    const a = byArea.get(area) ?? { area, count: 0, last: d, worst: null };
    a.count++;
    if (d > a.last) a.last = d;
    if (p.level != null && (a.worst == null || p.level > a.worst)) a.worst = p.level;
    byArea.set(area, a);
  }
  const pain = [...byArea.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));

  // The budget: the coach's setting, else what they answered last, else the essentials.
  const budgetAnswer = latest ? clean(answerFor(latest.answers, "spend", "supplements")) : "";
  const fromAnswer: SupplementBudget | null = /essential/i.test(budgetAnswer) ? "essentials" : /extras?/i.test(budgetAnswer) ? "some" : /worth it/i.test(budgetAnswer) ? "open" : null;
  const s = input.settings ?? null;
  const budget: SupplementBudget = s?.supplement_budget ?? fromAnswer ?? "essentials";

  const byDate = (a: HealthEntry, b: HealthEntry) => b.at.localeCompare(a.at) || a.label.localeCompare(b.label);
  const out: HealthProfile = {
    injuries: injuries.sort(byDate),
    conditions: conditions.sort(byDate),
    medications: medications.sort(byDate),
    supplements: supplements.sort(byDate),
    allergies,
    diets,
    past: past.sort(byDate),
    pain,
    drugTested: s?.drug_tested ?? null,
    federation: clean(s?.federation) || null,
    budget,
    budgetFrom: s?.supplement_budget ? "coach" : fromAnswer ? "form" : "default",
    empty: false,
  };
  out.empty = !out.injuries.length && !out.conditions.length && !out.medications.length && !out.supplements.length && !out.allergies.length && !out.diets.length && !out.pain.length;
  return out;
}

/** One entry as a line: "Left knee: patellar tendinopathy (since Sep 2026, you, Nov 12)". */
export function entryLine(e: HealthEntry, opts: { when?: boolean } = {}): string {
  const head = e.area && !key(e.label).includes(key(e.area)) ? `${e.label} (${e.area})` : e.label;
  const detail = e.details ? `: ${e.details.slice(0, 160)}` : "";
  const when = opts.when === false ? "" : ` [${[e.since ? `since ${e.since.slice(0, 7)}` : null, e.said ? `said ${e.said}` : `${e.fromLabel === "You" ? "coach" : e.fromLabel === "Them" ? "client" : e.fromLabel} ${shortDate(e.at)}`].filter(Boolean).join(", ")}]`;
  return `${head}${detail}${when}`;
}

/** Everything a profile says that the client may see (never a coach-only item). */
export function clientVisible(p: HealthProfile): HealthProfile {
  const keep = (xs: HealthEntry[]) => xs.filter((e) => !e.coachOnly);
  return { ...p, injuries: keep(p.injuries), conditions: keep(p.conditions), medications: keep(p.medications), supplements: keep(p.supplements), past: keep(p.past) };
}

/**
 * The profile as an AI reads it. Nutrition gets conditions, medications, what
 * they take and injuries (allergies and diets are in its FOOD HISTORY);
 * training gets injuries, pain, conditions and medications.
 */
export function healthProfileForAi(p: HealthProfile, audience: "nutrition" | "training"): string | null {
  const lines: string[] = [];
  const list = (xs: HealthEntry[]) => xs.map((e) => entryLine(e)).join("; ");
  if (p.injuries.length) lines.push(`- Injuries: ${list(p.injuries)}`);
  if (p.pain.length)
    lines.push(`- Pain reported after workouts, last ${PAIN_WEEKS} weeks: ${p.pain.map((a) => `${a.area} ${a.count}× (last ${shortDate(a.last)}${a.worst != null ? `, worst ${a.worst}/10` : ""})`).join("; ")}`);
  if (p.conditions.length) lines.push(`- Conditions: ${list(p.conditions)}`);
  if (p.medications.length) lines.push(`- Medications: ${list(p.medications)}`);
  if (audience === "nutrition") {
    if (p.supplements.length) lines.push(`- Supplements they take now: ${list(p.supplements)}`);
    if (p.drugTested != null) lines.push(`- Drug-tested athlete: ${p.drugTested ? `yes${p.federation ? ` (${p.federation})` : ""}` : "no"}`);
  } else if (p.drugTested) {
    lines.push(`- Competes drug-tested${p.federation ? ` (${p.federation})` : ""}`);
  }
  const gone = p.past.filter((e) => e.kind !== "allergy" && e.kind !== "diet").slice(0, 6);
  if (gone.length) lines.push(`- Resolved / no longer applies (the coach checked): ${gone.map((e) => e.label).join(", ")}`);
  if (!lines.length) return null;
  const head =
    audience === "training"
      ? "HEALTH PROFILE (what the coach and client recorded, Goals & Setup, their forms and check-outs. Train around it: exercise choice, range, tempo and load, never by dropping the muscle; never diagnose; anything that needs medical clearance goes to the coach):"
      : "HEALTH PROFILE (what the coach and client recorded and their forms. Plan conservatively around conditions and medications, never diagnose, and send anything medical to their doctor or a registered dietitian):";
  return [head, ...lines].join("\n");
}

/** "2 injuries · 1 condition · 3 supplements" for a row, or null when nothing's on file. */
export function healthSummary(p: HealthProfile): string | null {
  const parts = [
    p.injuries.length ? `${p.injuries.length} ${p.injuries.length === 1 ? "injury" : "injuries"}` : null,
    p.pain.length ? `pain: ${p.pain.slice(0, 2).map((a) => a.area).join(", ")}` : null,
    p.conditions.length ? `${p.conditions.length} ${p.conditions.length === 1 ? "condition" : "conditions"}` : null,
    p.medications.length ? `${p.medications.length} ${p.medications.length === 1 ? "medication" : "medications"}` : null,
    p.allergies.length ? `${p.allergies.length} ${p.allergies.length === 1 ? "allergy" : "allergies"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export const healthProfileKey = (clientId: string) => ["health-profile", clientId] as const;
