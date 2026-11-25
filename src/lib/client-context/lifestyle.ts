/**
 * Client context (Nov 25 2026): a client's work and lifestyle, what's still
 * missing from it, when a weekly check-in may ask one question about it, and the
 * coach's private relationship labels. Pure, tested (client-context.test.ts).
 *
 * Two kinds of information, kept apart everywhere:
 * - Client-facing (`client_lifestyle`): employment, job, workday, schedule,
 *   physical demand. The client sees and edits their own; every change is kept
 *   with its source in `client_context_history`.
 * - Coach-only (`client_context_facts`, `client_relationships`): what the coach
 *   knows privately. Never shown or asked of the client, never quoted in
 *   anything the client reads, never part of the client's completion %.
 */

export type Opt<K extends string = string> = { key: K; label: string };

export const EMPLOYMENT = [
  { key: "full_time", label: "Full-time" },
  { key: "part_time", label: "Part-time" },
  { key: "self_employed", label: "Self-employed" },
  { key: "student", label: "Student" },
  { key: "retired", label: "Retired" },
  { key: "not_working", label: "Not currently working" },
  { key: "other", label: "Other" },
  { key: "prefer_not", label: "Prefer not to say / Not applicable" },
] as const satisfies readonly Opt[];

export const WORKDAY = [
  { key: "mostly_sitting", label: "Mostly sitting" },
  { key: "mostly_standing", label: "Mostly standing" },
  { key: "frequently_walking", label: "Frequently walking" },
  { key: "physically_demanding", label: "Physically demanding" },
  { key: "mixed", label: "A mixture" },
  { key: "varies", label: "Varies" },
] as const satisfies readonly Opt[];

export const SCHEDULE = [
  { key: "daytime", label: "Regular daytime hours" },
  { key: "evenings", label: "Evenings" },
  { key: "overnight", label: "Overnight shifts" },
  { key: "rotating", label: "Rotating shifts" },
  { key: "flexible", label: "Flexible" },
  { key: "irregular", label: "Irregular" },
] as const satisfies readonly Opt[];

export const DEMAND = [
  { key: "low", label: "Low" },
  { key: "moderate", label: "Moderate" },
  { key: "high", label: "High" },
  { key: "very_high", label: "Very high" },
  { key: "varies", label: "Varies" },
] as const satisfies readonly Opt[];

export type EmploymentKey = (typeof EMPLOYMENT)[number]["key"];
export type WorkdayKey = (typeof WORKDAY)[number]["key"];
export type ScheduleKey = (typeof SCHEDULE)[number]["key"];
export type DemandKey = (typeof DEMAND)[number]["key"];

/** The client-facing fields, in the order they're asked. */
export const LIFESTYLE_FIELDS = ["employment_status", "workday_activity", "work_schedule", "physical_demand", "occupation", "employer"] as const;
export type LifestyleField = (typeof LIFESTYLE_FIELDS)[number];
export const CHOICE_FIELDS = ["employment_status", "workday_activity", "work_schedule", "physical_demand"] as const;
export type ChoiceField = (typeof CHOICE_FIELDS)[number];

export const FIELD_OPTIONS: Record<ChoiceField, readonly Opt[]> = {
  employment_status: EMPLOYMENT,
  workday_activity: WORKDAY,
  work_schedule: SCHEDULE,
  physical_demand: DEMAND,
};

export const FIELD_LABEL: Record<LifestyleField, string> = {
  employment_status: "Employment",
  workday_activity: "Typical workday",
  work_schedule: "Work schedule",
  physical_demand: "Physical demand",
  occupation: "Job title",
  employer: "Employer",
};

/** How each question is put to the client (one tap each). */
export const FIELD_PROMPT: Record<LifestyleField, string> = {
  employment_status: "What's your work situation?",
  workday_activity: "What's your typical workday like?",
  work_schedule: "What's your work schedule like?",
  physical_demand: "How physically demanding is your work?",
  occupation: "What do you do?",
  employer: "Where do you work?",
};

/** Where a value came from (kept per field and on every history row). */
export const SOURCES = ["client_reported", "coach_provided", "ai_confirmed", "temporary", "historical"] as const;
export type ContextSource = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<ContextSource, string> = {
  client_reported: "Client",
  coach_provided: "Coach",
  ai_confirmed: "Cleo, confirmed by coach",
  temporary: "Temporary",
  historical: "Historical",
};

export type Lifestyle = {
  employment_status: EmploymentKey | null;
  occupation: string | null;
  employer: string | null;
  workday_activity: WorkdayKey | null;
  work_schedule: ScheduleKey | null;
  physical_demand: DemandKey | null;
  /** Fields the client chose not to answer: never asked again, never lower the %. */
  declined: string[];
  /** Per field: when a check-in asked it, when it was skipped there and how often. */
  prompt_state: Record<string, { asked_at?: string | null; dismissed_at?: string | null; dismissals?: number }>;
  /** Per field: who set the current value and when. */
  field_meta: Record<string, { source?: ContextSource; at?: string }>;
};

export const EMPTY_LIFESTYLE: Lifestyle = {
  employment_status: null,
  occupation: null,
  employer: null,
  workday_activity: null,
  work_schedule: null,
  physical_demand: null,
  declined: [],
  prompt_state: {},
  field_meta: {},
};

const isKey = (opts: readonly Opt[], v: unknown): v is string => typeof v === "string" && opts.some((o) => o.key === v);
const clean = (v: unknown, n: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : null;
};

/** A stored row (or anything) → a safe Lifestyle: unknown keys and values dropped. */
export function normalizeLifestyle(raw: unknown): Lifestyle {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
  return {
    employment_status: isKey(EMPLOYMENT, r.employment_status) ? (r.employment_status as EmploymentKey) : null,
    occupation: clean(r.occupation, 120),
    employer: clean(r.employer, 120),
    workday_activity: isKey(WORKDAY, r.workday_activity) ? (r.workday_activity as WorkdayKey) : null,
    work_schedule: isKey(SCHEDULE, r.work_schedule) ? (r.work_schedule as ScheduleKey) : null,
    physical_demand: isKey(DEMAND, r.physical_demand) ? (r.physical_demand as DemandKey) : null,
    declined: Array.isArray(r.declined) ? r.declined.filter((f): f is string => (LIFESTYLE_FIELDS as readonly string[]).includes(String(f))).map(String) : [],
    prompt_state: obj(r.prompt_state),
    field_meta: obj(r.field_meta),
  };
}

export function optionLabel(field: LifestyleField, value: string | null | undefined): string | null {
  if (!value) return null;
  if (field === "occupation" || field === "employer") return value;
  return FIELD_OPTIONS[field].find((o) => o.key === value)?.label ?? null;
}

/** A label tapped (a check-in answer) back to its stored key. */
export function keyForLabel(field: ChoiceField, label: unknown): string | null {
  const s = String(label ?? "").trim();
  return FIELD_OPTIONS[field].find((o) => o.label === s || o.key === s)?.key ?? null;
}

/** No job to describe: the work questions don't apply (and count as done). */
const NO_WORK = new Set<string>(["retired", "not_working", "prefer_not"]);

/**
 * What the workday already says about physical demand: sitting is low, standing
 * or walking moderate, a physically demanding day high. Only a mixed or varied
 * day leaves it to ask.
 */
export function impliedDemand(workday: WorkdayKey | null): DemandKey | null {
  switch (workday) {
    case "mostly_sitting":
      return "low";
    case "mostly_standing":
    case "frequently_walking":
      return "moderate";
    case "physically_demanding":
      return "high";
    default:
      return null;
  }
}

/**
 * The questions that apply to them now, conditional on what they've said:
 * nothing about work for someone retired, not working or who'd rather not say;
 * physical demand only when the workday doesn't already imply it; the job
 * title and employer for someone working (a student is asked about their day,
 * not a job).
 */
export function applicableFields(l: Lifestyle): { essential: LifestyleField[]; optional: LifestyleField[] } {
  const s = l.employment_status;
  if (s && NO_WORK.has(s)) return { essential: ["employment_status"], optional: [] };
  const essential: LifestyleField[] = ["employment_status", "workday_activity", "work_schedule"];
  // ask only once the workday is known and doesn't imply it (a value already on file still counts)
  if (l.physical_demand || (l.workday_activity && !impliedDemand(l.workday_activity))) essential.push("physical_demand");
  const optional: LifestyleField[] = s === "student" ? [] : ["occupation", "employer"];
  return { essential, optional };
}

const answered = (l: Lifestyle, f: LifestyleField) => l[f] != null && String(l[f]).trim() !== "";
const declinedField = (l: Lifestyle, f: LifestyleField) => l.declined.includes(f);

export type Completion = {
  /** 0–100: answered or declined over what applies. Declined never lowers it; coach-only data isn't in it. */
  percent: number;
  essentialDone: number;
  essentialTotal: number;
  optionalDone: number;
  optionalTotal: number;
  missingEssential: LifestyleField[];
  missingOptional: LifestyleField[];
  /** Every essential answered or declined (optional ones never hold this back). */
  complete: boolean;
};

/**
 * How complete their profile is. Essentials weigh 80% and optional
 * personalization 20%, so a missing job title never reads as an incomplete
 * profile; an answer they declined counts as done, and so does a question
 * that doesn't apply to them.
 */
export function profileCompletion(raw: Lifestyle): Completion {
  const l = normalizeLifestyle(raw);
  const { essential, optional } = applicableFields(l);
  const done = (f: LifestyleField) => answered(l, f) || declinedField(l, f);
  const eDone = essential.filter(done).length;
  const oDone = optional.filter(done).length;
  const eShare = essential.length ? eDone / essential.length : 1;
  const oShare = optional.length ? oDone / optional.length : 1;
  const percent = Math.round((optional.length ? eShare * 0.8 + oShare * 0.2 : eShare) * 100);
  return {
    percent,
    essentialDone: eDone,
    essentialTotal: essential.length,
    optionalDone: oDone,
    optionalTotal: optional.length,
    missingEssential: essential.filter((f) => !done(f)),
    missingOptional: optional.filter((f) => !done(f)),
    complete: essential.every(done),
  };
}

export type ProfileItem = {
  field: LifestyleField;
  essential: boolean;
  prompt: string;
  /** One-tap answers (labels); none for the free-text job title and employer. */
  options: string[] | null;
};

const itemFor = (field: LifestyleField, essential: boolean): ProfileItem => ({
  field,
  essential,
  prompt: FIELD_PROMPT[field],
  options: field === "occupation" || field === "employer" ? null : FIELD_OPTIONS[field].map((o) => o.label),
});

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: string) => (iso ? (Date.parse(now) - Date.parse(iso)) / DAY : Infinity);

/** Skipped in "Complete your profile": out of the way this long. */
export const PROFILE_SNOOZE_DAYS = 14;

/**
 * The one thing to ask next in "Complete your profile": the first missing
 * essential, then optional personalization; something they snoozed in the last
 * two weeks waits. Null when there's nothing worth asking.
 */
export function nextMissingItem(raw: Lifestyle, now: string = new Date().toISOString()): ProfileItem | null {
  const l = normalizeLifestyle(raw);
  const c = profileCompletion(l);
  const snoozed = (f: LifestyleField) => daysSince(l.prompt_state[f]?.dismissed_at, now) < PROFILE_SNOOZE_DAYS;
  const e = c.missingEssential.find((f) => !snoozed(f));
  if (e) return itemFor(e, true);
  const o = c.missingOptional.find((f) => !snoozed(f));
  return o ? itemFor(o, false) : null;
}

/** A check-in asks about their profile at most this often. */
export const CHECKIN_ASK_GAP_DAYS = 21;
/** Skipped in a check-in: not asked again for this long. */
export const CHECKIN_DISMISS_DAYS = 42;
/** Skipped this many times: never asked in a check-in again (it stays in their profile). */
export const CHECKIN_MAX_DISMISSALS = 2;

/**
 * The one optional profile question a weekly check-in may carry, or null.
 * Essentials only, one tap (never the free-text job title), never something
 * answered or declined, nothing within 3 weeks of the last ask, a skipped
 * question rests 6 weeks and stops after two skips.
 */
export function checkinProfileAsk(raw: Lifestyle | null | undefined, now: string = new Date().toISOString()): ProfileItem | null {
  if (!raw) return null;
  const l = normalizeLifestyle(raw);
  const lastAsked = Object.values(l.prompt_state)
    .map((s) => s?.asked_at)
    .filter(Boolean)
    .sort()
    .pop();
  if (daysSince(lastAsked, now) < CHECKIN_ASK_GAP_DAYS) return null;
  const c = profileCompletion(l);
  for (const f of c.missingEssential) {
    const st = l.prompt_state[f] ?? {};
    if ((st.dismissals ?? 0) >= CHECKIN_MAX_DISMISSALS) continue;
    if (daysSince(st.dismissed_at, now) < CHECKIN_DISMISS_DAYS) continue;
    return itemFor(f, true);
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Relationship labels (coach-only)                                           */

export const RELATIONSHIPS = [
  { key: "client", label: "Client" },
  { key: "friend", label: "Friend" },
  { key: "close_friend", label: "Close friend" },
  { key: "partner", label: "Partner" },
  { key: "family", label: "Family member" },
  { key: "training_partner", label: "Training partner" },
  { key: "professional", label: "Professional acquaintance" },
  { key: "custom", label: "Custom" },
] as const satisfies readonly Opt[];
export type RelationshipKey = (typeof RELATIONSHIPS)[number]["key"];

export type Relationship = { labels: RelationshipKey[]; custom: string | null; note: string | null };

export function normalizeRelationship(raw: unknown): Relationship {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const labels = Array.isArray(r.labels) ? [...new Set(r.labels.map(String).filter((k) => RELATIONSHIPS.some((o) => o.key === k)))] : [];
  const custom = clean(r.custom ?? r.custom_label, 60);
  return { labels: (custom ? labels : labels.filter((l) => l !== "custom")) as RelationshipKey[], custom, note: clean(r.note, 300) };
}

const TONE: Record<RelationshipKey, string | null> = {
  client: null,
  friend: "a friend outside coaching: relaxed and familiar is fine",
  close_friend: "a close friend: familiar, and joking around is fine where it fits",
  partner: "his partner: warm and personal is fine, while the message stays about the coaching",
  family: "family: warm and familiar is fine",
  training_partner: "someone he trains with: gym-banter familiar is fine",
  professional: "a professional acquaintance: a little more polished, less slang",
  custom: null,
};

/**
 * The relationship as a tone instruction for anything written as the coach,
 * or null for a plain client. Tone and familiarity only: the label is never
 * said or hinted at, and it never softens standards, honesty or what the data
 * says.
 */
export function relationshipToneLine(raw: Relationship | null | undefined): string | null {
  if (!raw) return null;
  const r = normalizeRelationship(raw);
  const parts = r.labels.map((k) => TONE[k]).filter(Boolean) as string[];
  if (r.custom) parts.push(`described privately as "${r.custom}": let that set how familiar to be`);
  if (!parts.length) return null;
  return `RELATIONSHIP (private, tone only): outside coaching this person is ${parts.join("; also ")}. It changes how familiar the message sounds, nothing else: never mention or hint at the relationship, and never soften standards, honesty, or what the data says because of it.`;
}

export function relationshipWords(raw: Relationship | null | undefined): string | null {
  if (!raw) return null;
  const r = normalizeRelationship(raw);
  const words = r.labels.filter((k) => k !== "custom").map((k) => RELATIONSHIPS.find((o) => o.key === k)!.label);
  if (r.custom) words.push(r.custom);
  return words.length ? words.join(", ") : null;
}

/* ------------------------------------------------------------------------ */
/* Text for the AI (one context source)                                       */

export type ContextFact = {
  id?: string;
  category: FactCategory;
  fact: string;
  source: ContextSource;
  status: "active" | "historical";
  valid_until: string | null;
  created_at?: string;
};

export const FACT_CATEGORIES = ["work", "schedule", "lifestyle", "family", "interests", "training_background", "other"] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
export const FACT_CATEGORY_LABEL: Record<FactCategory, string> = {
  work: "Work",
  schedule: "Schedule",
  lifestyle: "Lifestyle",
  family: "Family",
  interests: "Interests",
  training_background: "Training background",
  other: "Other",
};

/** Active facts still in force today (a temporary one past its date drops out). */
export function liveFacts(facts: ContextFact[], today: string): ContextFact[] {
  return facts.filter((f) => f.status === "active" && (!f.valid_until || f.valid_until >= today.slice(0, 10)));
}

export const LIFESTYLE_RULES =
  "Use their work and lifestyle to fit the plan around their life (timing, session length, recovery windows, meal timing, steps), never as a reason on its own to train less: a physically demanding job or shift work is judged by their actual recovery, performance and check-ins, never assumed.";

/**
 * Their work and lifestyle as lines for a prompt. `privateFacts` adds the
 * coach's private context (coach-facing work only, labelled never to be quoted).
 */
export function lifestyleText(raw: Lifestyle | null | undefined, opts: { facts?: ContextFact[]; today?: string; relationship?: Relationship | null } = {}): string | null {
  const lines: string[] = [];
  if (raw) {
    const l = normalizeLifestyle(raw);
    const s = l.employment_status;
    const src = (f: LifestyleField) => {
      const m = l.field_meta[f];
      return m?.source && m.source !== "client_reported" ? ` (${SOURCE_LABEL[m.source].toLowerCase()})` : "";
    };
    if (s && s !== "prefer_not") lines.push(`- Work: ${optionLabel("employment_status", s)}${l.occupation ? `, ${l.occupation}` : ""}${src("employment_status")}`);
    else if (l.occupation) lines.push(`- Work: ${l.occupation}${src("occupation")}`);
    if (l.workday_activity) lines.push(`- Typical workday: ${optionLabel("workday_activity", l.workday_activity)}${src("workday_activity")}`);
    if (l.work_schedule) lines.push(`- Work schedule: ${optionLabel("work_schedule", l.work_schedule)}${src("work_schedule")}`);
    const demand = l.physical_demand ?? impliedDemand(l.workday_activity);
    if (demand) lines.push(`- Physical demand of work: ${optionLabel("physical_demand", demand)}${l.physical_demand ? src("physical_demand") : " (from their workday)"}`);
  }
  const out: string[] = [];
  if (lines.length) out.push(`WORK AND LIFESTYLE (client-facing profile; ${LIFESTYLE_RULES}):\n${lines.join("\n")}`);
  const facts = opts.facts ? liveFacts(opts.facts, opts.today ?? new Date().toISOString().slice(0, 10)) : [];
  if (facts.length) {
    out.push(
      `COACH'S PRIVATE CONTEXT (coach-only: context for decisions; never quote, mention or hint at it in anything the client reads):\n${facts
        .slice(0, 20)
        .map((f) => `- ${FACT_CATEGORY_LABEL[f.category]}: ${f.fact.slice(0, 240)}${f.valid_until ? ` (until ${f.valid_until})` : ""}`)
        .join("\n")}`,
    );
  }
  const rel = relationshipWords(opts.relationship);
  if (rel) out.push(`RELATIONSHIP WITH THE COACH (private): ${rel}. Tone and familiarity of messages only; it never changes a coaching decision, a standard or how honestly the data is read.`);
  return out.length ? out.join("\n\n") : null;
}

/* ------------------------------------------------------------------------ */
/* Cleo reading what the coach typed                                          */

export type ExtractedProfile = { field: LifestyleField; fieldLabel: string; value: string; label: string; current: string | null; replaces: boolean };
export type ExtractedFact = { category: FactCategory; text: string; validUntil: string | null };
export type Extraction = {
  profile: ExtractedProfile[];
  facts: ExtractedFact[];
  relationship: { labels: RelationshipKey[]; custom: string | null; words: string } | null;
  /** What Cleo's answer had that couldn't be used. */
  dropped: string[];
};

export const EXTRACT_MAX_INPUT = 4000;

export function extractionPrompt(x: { name: string; text: string; today: string; current: Lifestyle | null }): { system: string; prompt: string } {
  const opts = (f: ChoiceField) => FIELD_OPTIONS[f].map((o) => o.key).join(" | ");
  const system = [
    "You read a coach's private note about one of their clients and pull out structured facts. Copy, never infer: only what the note actually says.",
    "Return ONLY JSON:",
    `{"profile":{"employment_status"?:${JSON.stringify(opts("employment_status"))},"workday_activity"?:${JSON.stringify(opts("workday_activity"))},"work_schedule"?:${JSON.stringify(opts("work_schedule"))},"physical_demand"?:${JSON.stringify(opts("physical_demand"))},"occupation"?:string,"employer"?:string},"facts":[{"category":${JSON.stringify(FACT_CATEGORIES.join(" | "))},"text":string,"valid_until"?:"YYYY-MM-DD"}],"relationship":{"labels":[${JSON.stringify(RELATIONSHIPS.filter((r) => r.key !== "custom").map((r) => r.key).join(" | "))}],"custom"?:string}|null}`,
    "profile: only fields the note states plainly; leave a field out when unsure.",
    "facts: short third-person statements a coach would want to remember (work, schedule, family, interests, lifestyle, training background), one per item, at most 8. A temporary situation with an end date gets valid_until.",
    "relationship: only when the note says how the COACH knows this person personally (\"a close friend of mine\" → close_friend; \"my sister\" → family). Otherwise null.",
    "Never record health conditions, diagnoses, medications, injuries or anything medical: the app keeps health in its own Health profile. Leave them out.",
    `Today is ${x.today}.`,
  ].join("\n");
  const cur = x.current ? LIFESTYLE_FIELDS.map((f) => (x.current![f] ? `${f}=${x.current![f]}` : null)).filter(Boolean).join(", ") : "";
  const prompt = [`CLIENT: ${x.name}`, cur ? `ALREADY ON THEIR PROFILE: ${cur}` : "", "COACH'S NOTE:", x.text.slice(0, EXTRACT_MAX_INPUT)].filter(Boolean).join("\n");
  return { system, prompt };
}

/** The first JSON object in a model's answer (bare, or in a code fence). */
export function firstJsonObject(text: string): any | null {
  const t = String(text ?? "");
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(body.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const MEDICAL = /\b(diagnos|ms\b|multiple sclerosis|cancer|diabet|medicat|prescri|surgery|injur|lesion|disorder|depress|anxiety|adhd|pregnan|seizure|epilep|disease|syndrome|therapy|mental health)/i;

/**
 * Cleo's answer → what the coach confirms. Only known fields and values,
 * trimmed text, at most 8 facts, nothing medical (the Health profile is its own
 * system), duplicates of what's on file dropped; a value that differs from a
 * confirmed one is marked `replaces` (the card leaves it unticked, so nothing
 * on file is ever overwritten without the coach saying so).
 */
export function parseExtraction(answer: unknown, current: Lifestyle | null, existingFacts: string[] = [], today?: string): Extraction {
  const raw = typeof answer === "string" ? firstJsonObject(answer) : answer;
  const out: Extraction = { profile: [], facts: [], relationship: null, dropped: [] };
  if (!raw || typeof raw !== "object") {
    out.dropped.push("Cleo's answer wasn't readable");
    return out;
  }
  const cur = current ? normalizeLifestyle(current) : EMPTY_LIFESTYLE;
  const p = raw.profile && typeof raw.profile === "object" ? raw.profile : {};
  for (const f of LIFESTYLE_FIELDS) {
    const v = p[f];
    if (v == null || v === "") continue;
    let value: string | null;
    if (f === "occupation" || f === "employer") value = clean(v, 120);
    else value = isKey(FIELD_OPTIONS[f], v) ? String(v) : keyForLabel(f, v);
    if (!value) {
      out.dropped.push(`${FIELD_LABEL[f]}: "${String(v).slice(0, 40)}" isn't an answer the app knows`);
      continue;
    }
    const now = cur[f] as string | null;
    if (now && now.toLowerCase() === value.toLowerCase()) continue;
    out.profile.push({ field: f, fieldLabel: FIELD_LABEL[f], value, label: optionLabel(f, value) ?? value, current: now ? optionLabel(f, now) : null, replaces: !!now });
  }
  const seen = new Set(existingFacts.map((t) => t.trim().toLowerCase()));
  const facts = Array.isArray(raw.facts) ? raw.facts : [];
  for (const item of facts) {
    if (out.facts.length >= 8) break;
    const text = clean(item?.text, 300);
    if (!text) continue;
    if (MEDICAL.test(text)) {
      out.dropped.push("A health detail was left out: health belongs in the Health profile");
      continue;
    }
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const category = (FACT_CATEGORIES as readonly string[]).includes(item?.category) ? (item.category as FactCategory) : "other";
    const until = typeof item?.valid_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.valid_until) && (!today || item.valid_until >= today.slice(0, 10)) ? item.valid_until : null;
    out.facts.push({ category, text, validUntil: until });
  }
  if (raw.relationship && typeof raw.relationship === "object") {
    const rel = normalizeRelationship({ labels: raw.relationship.labels, custom: raw.relationship.custom });
    const labels = rel.custom ? ([...new Set([...rel.labels, "custom"])] as RelationshipKey[]) : rel.labels;
    if (labels.length) out.relationship = { labels, custom: rel.custom, words: relationshipWords({ labels, custom: rel.custom, note: null }) ?? "" };
  }
  return out;
}

/**
 * What the confirm card starts ticked: new answers and new facts yes; a profile
 * answer that would replace one on file no; a relationship only when none is on
 * file (it's added to the labels there, so the coach opts in). Nothing on file
 * changes unless the coach ticks it.
 */
export function defaultTicks(x: Extraction, hasRelationship: boolean): Record<string, boolean> {
  const t: Record<string, boolean> = {};
  for (const p of x.profile) t[`p:${p.field}`] = !p.replaces;
  x.facts.forEach((_, i) => (t[`f:${i}`] = true));
  if (x.relationship) t.r = !hasRelationship;
  return t;
}

/** One history row in words: what changed, from what to what, and who said so. */
export function historyLine(r: { field: string; old_value: string | null; new_value: string | null; source: string }): { what: string; change: string; source: string } {
  const isField = (LIFESTYLE_FIELDS as readonly string[]).includes(r.field);
  const show = (v: string | null) => {
    if (v == null || v === "") return null;
    if (v === "(declined)") return "Rather not say";
    if (isField) return optionLabel(r.field as LifestyleField, v) ?? v;
    if (r.field === "relationship")
      return v
        .split(" · ")
        .map((part, i) => (i === 0 ? part.split(", ").map((k) => RELATIONSHIPS.find((o) => o.key === k)?.label ?? k).join(", ") : part))
        .join(" · ");
    return v;
  };
  const what = isField
    ? FIELD_LABEL[r.field as LifestyleField]
    : r.field === "relationship"
      ? "Relationship"
      : r.field.startsWith("fact:")
        ? `Private note · ${FACT_CATEGORY_LABEL[r.field.slice(5) as FactCategory] ?? "Other"}`
        : r.field;
  const a = show(r.old_value);
  const b = show(r.new_value);
  const change = a && b ? `${a} → ${b}` : b ? b : a ? `${a} → cleared` : "cleared";
  return { what, change, source: SOURCE_LABEL[r.source as ContextSource] ?? "Coach" };
}

/* ------------------------------------------------------------------------ */
/* Occupation search                                                          */

export const OCCUPATIONS = [
  "Accountant", "Administrative assistant", "Architect", "Baker", "Bank teller", "Barber", "Bartender", "Carpenter", "Cashier", "Chef",
  "Civil engineer", "Cleaner", "Construction worker", "Consultant", "Correctional officer", "Customer service representative", "Daycare worker",
  "Delivery driver", "Dental hygienist", "Dentist", "Designer", "Developer", "Doctor", "Electrician", "Engineer", "Entrepreneur", "Farmer",
  "Financial advisor", "Firefighter", "Fitness coach", "Flight attendant", "Graphic designer", "Hairstylist", "Health care aide", "Heavy equipment operator",
  "HR specialist", "Insurance broker", "IT specialist", "Janitor", "Journalist", "Lab technician", "Labourer", "Lawyer", "Librarian", "Machinist",
  "Manager", "Marketing specialist", "Massage therapist", "Mechanic", "Military", "Nurse", "Office worker", "Paramedic", "Personal trainer",
  "Pharmacist", "Physiotherapist", "Pilot", "Plumber", "Police officer", "Project manager", "Psychologist", "Real estate agent", "Receptionist",
  "Research scientist", "Restaurant server", "Retail associate", "Sales representative", "Security guard", "Social worker", "Software engineer",
  "Store manager", "Teacher", "Teaching assistant", "Technician", "Tradesperson", "Truck driver", "University professor", "Veterinarian",
  "Warehouse worker", "Welder", "Writer",
] as const;

/** Autocomplete: names starting with what's typed, then a word in them starting with it, then containing it; at most `limit`. */
export function occupationMatches(query: string, limit = 6, list: readonly string[] = OCCUPATIONS): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts = list.filter((o) => o.toLowerCase().startsWith(q));
  const word = list.filter((o) => !starts.includes(o) && o.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)));
  const has = list.filter((o) => !starts.includes(o) && !word.includes(o) && o.toLowerCase().includes(q));
  return [...starts, ...word, ...has].slice(0, limit);
}
