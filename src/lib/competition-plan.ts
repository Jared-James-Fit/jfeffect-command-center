/**
 * The Competition Calendar + Strategy form as a plan (pure, tested): the
 * athlete's answers read into structured fields, what changed since their
 * last plan, the coach's summary, and the line the program AI reads once the
 * coach approves it. Questions are found by `validation.plan_key`, never by
 * their wording, so the coach can reword them freely.
 */
import { answerAsText, readMeets, type MeetEntry } from "@/lib/form-fields";

export const COMPETITION_FORM_TYPE = "competition_strategy";
export const COMPETITION_FORM_ID = "c0a1e7e0-5a7e-4c0d-9f00-000000000c01";

export type PlanKey =
  | "name"
  | "age_classes"
  | "weight_class"
  | "bodyweight_plan"
  | "meets"
  | "ranking"
  | "primary"
  | "goal"
  | "full_peaks"
  | "non_peak"
  | "notes";

export type RankedMeet = MeetEntry & { rank: number | null };

export type CompetitionPlan = {
  name: string | null;
  ageClasses: string[];
  weightClass: string | null;
  bodyweightPlan: string | null;
  competing: boolean;
  /** In the athlete's order of importance (unranked ones after). */
  meets: RankedMeet[];
  primary: RankedMeet | null;
  goal: string | null;
  fullPeaks: string | null;
  nonPeak: string | null;
  notes: string | null;
};

type Q = { id: string; validation?: Record<string, unknown> | null };
type A = { question_id: string; value_text?: string | null; value_number?: number | null; value_json?: unknown };

export function competitionPlanFromAnswers(questions: Q[], answers: A[]): CompetitionPlan {
  const byKey = new Map<PlanKey, A | undefined>();
  for (const q of questions) {
    const key = (q.validation as any)?.plan_key as PlanKey | undefined;
    if (key) byKey.set(key, answers.find((a) => a.question_id === q.id));
  }
  const text = (k: PlanKey) => {
    const t = answerAsText(byKey.get(k)).trim();
    return t || null;
  };
  const list = (k: PlanKey) => {
    const j = byKey.get(k)?.value_json;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : [];
  };

  const raw = readMeets(byKey.get("meets")?.value_json);
  const competing = raw.length > 0 && !raw.some((m) => m.none);
  const order = byKey.get("ranking")?.value_json;
  const keys = Array.isArray(order) ? order.map((x: any) => x?.key).filter((k): k is string => typeof k === "string") : [];
  const meets: RankedMeet[] = competing
    ? raw
        .map((m) => ({ ...m, rank: keys.includes(m.id) ? keys.indexOf(m.id) + 1 : null }))
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    : [];
  // The primary meet was picked by its label; find it among the meets (by that label or its name).
  const primaryText = text("primary");
  const primary =
    (primaryText && meets.find((m) => primaryText === labelOf(m) || (!!m.name && primaryText.startsWith(m.name)) || primaryText.startsWith(m.level))) ||
    (competing ? meets[0] ?? null : null);

  return {
    name: text("name"),
    ageClasses: list("age_classes"),
    weightClass: text("weight_class"),
    bodyweightPlan: competing ? text("bodyweight_plan") : null,
    competing,
    meets,
    primary: primary ?? null,
    goal: competing ? text("goal") : null,
    fullPeaks: competing ? text("full_peaks") : null,
    nonPeak: competing ? text("non_peak") : null,
    notes: text("notes"),
  };
}

function labelOf(m: MeetEntry): string {
  const date = m.date
    ? new Date(`${m.date}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
    : null;
  return [m.name || m.level, date, m.location].filter(Boolean).join(" · ");
}

/** "MPA Provincials (Provincial Championships) · Jun 6, 2027 · Winnipeg · registered" */
export function meetLine(m: MeetEntry): string {
  const name = m.name ? `${m.name} (${m.level})` : m.level;
  const date = m.date
    ? new Date(`${m.date}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
    : "date not set";
  const status = [m.registered ? "registered" : null, m.qualified ? "qualified" : m.qualified === false ? "not qualified yet" : null].filter(Boolean);
  return [name, date, m.location, m.federation, ...status].filter(Boolean).join(" · ");
}

/** The coach's summary, a line each, only what was answered. */
export function planSummaryLines(p: CompetitionPlan): Array<{ label: string; value: string }> {
  if (!p.competing) {
    return [
      { label: "Competing", value: "Not planning to compete" },
      ...(p.weightClass ? [{ label: "Weight class", value: p.weightClass }] : []),
      ...(p.notes ? [{ label: "Anything else", value: p.notes }] : []),
    ];
  }
  const out: Array<{ label: string; value: string }> = [];
  if (p.primary) out.push({ label: "Primary meet", value: meetLine(p.primary) });
  const others = p.meets.filter((m) => m.id !== p.primary?.id);
  if (others.length) out.push({ label: others.length === 1 ? "Also considering" : "Then, in order", value: others.map((m) => meetLine(m)).join("\n") });
  if (p.goal) out.push({ label: "Goal there", value: p.goal });
  if (p.fullPeaks) out.push({ label: "Full peaks this year", value: p.fullPeaks });
  if (p.nonPeak) out.push({ label: "Meets that aren't a peak", value: p.nonPeak === "Yes" ? "Open to them" : p.nonPeak === "No" ? "Not interested" : p.nonPeak });
  if (p.weightClass) out.push({ label: "Weight class", value: p.weightClass + (p.bodyweightPlan ? ` · ${p.bodyweightPlan.toLowerCase()}` : "") });
  if (p.ageClasses.length) out.push({ label: "Age class", value: p.ageClasses.map((a) => a.replace(/\s*\(.*\)\s*$/, "")).join(", ") });
  if (p.notes) out.push({ label: "Anything else", value: p.notes });
  return out;
}

/** What changed since their last plan, in a line each ("Primary meet: Nationals → Worlds"). */
export function planChanges(prev: CompetitionPlan | null, next: CompetitionPlan): string[] {
  if (!prev) return [];
  const out: string[] = [];
  if (prev.competing !== next.competing) out.push(next.competing ? "Now planning to compete" : "No longer planning to compete");
  const pName = (m: MeetEntry | null) => (m ? m.name || m.level : "none");
  if (pName(prev.primary) !== pName(next.primary)) out.push(`Primary meet: ${pName(prev.primary)} → ${pName(next.primary)}`);
  else if (prev.primary && next.primary && prev.primary.date !== next.primary.date)
    out.push(`${pName(next.primary)} date: ${prev.primary.date ?? "not set"} → ${next.primary.date ?? "not set"}`);
  const names = (p: CompetitionPlan) => new Set(p.meets.map((m) => m.name || m.level));
  const a = names(prev);
  const b = names(next);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  if (added.length) out.push(`Added: ${added.join(", ")}`);
  if (removed.length) out.push(`Dropped: ${removed.join(", ")}`);
  const field = (label: string, x: string | null, y: string | null) => {
    if ((x ?? "") !== (y ?? "")) out.push(`${label}: ${x ?? "not set"} → ${y ?? "not set"}`);
  };
  field("Full peaks", prev.fullPeaks, next.fullPeaks);
  field("Weight class", prev.weightClass, next.weightClass);
  field("Bodyweight plan", prev.bodyweightPlan, next.bodyweightPlan);
  field("Goal", prev.goal, next.goal);
  field("Non-peak meets", prev.nonPeak, next.nonPeak);
  return out;
}

/** The primary meet as the program's dated goal (Generate Next Program's horizon), when it has a date. */
export function planGoal(p: CompetitionPlan): { text: string; date: string } | null {
  const m = p.primary;
  if (!p.competing || !m?.date) return null;
  return { text: `Peak for ${m.name || m.level}${m.name ? ` (${m.level})` : ""}${p.goal ? `: ${p.goal.toLowerCase()}` : ""}`, date: m.date };
}

/**
 * The plan as the program AI reads it (only once the coach approved it):
 * the meets in their order with weeks out, the primary meet, how many full
 * peaks and whether other meets are practice. A plan never changes a program
 * by itself; it's context the coach's runs read.
 */
export function planBriefText(p: CompetitionPlan, approvedOn: string, today: string): string {
  const weeksOut = (d: string | null | undefined) => {
    if (!d) return null;
    const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return days < 0 ? "past" : `${Math.round(days / 7)} weeks out`;
  };
  if (!p.competing) return `Competition plan (approved by the coach ${approvedOn}): not planning to compete this year.`;
  const lines = [`Competition plan (the athlete's, approved by the coach ${approvedOn}; context for planning, never a reason to rewrite a running program by itself):`];
  if (p.primary) lines.push(`- Primary meet (peak for this one): ${meetLine(p.primary)}${weeksOut(p.primary.date) ? ` (${weeksOut(p.primary.date)})` : ""}`);
  for (const m of p.meets.filter((x) => x.id !== p.primary?.id)) lines.push(`- Also: ${meetLine(m)}${weeksOut(m.date) ? ` (${weeksOut(m.date)})` : ""}`);
  if (p.fullPeaks) lines.push(`- Full peaks they'll do this year: ${p.fullPeaks}`);
  if (p.nonPeak) lines.push(`- Meets that aren't a full peak (practice, experience, data): ${p.nonPeak === "Yes" ? "open to them" : p.nonPeak === "No" ? "not interested" : p.nonPeak}`);
  if (p.goal) lines.push(`- Goal at the primary meet: ${p.goal}`);
  if (p.weightClass) lines.push(`- Weight class: ${p.weightClass}${p.bodyweightPlan ? ` (bodyweight: ${p.bodyweightPlan.toLowerCase()})` : ""}`);
  if (p.notes) lines.push(`- Constraints they mentioned: ${p.notes}`);
  return lines.join("\n");
}
