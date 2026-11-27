import { draftGameplan, readGameplan, type GameplanDoc, type DraftInput } from "@/lib/competition/gameplan";
import { readAthleteInfo } from "@/lib/competition/athlete-info";
import { readRules } from "@/lib/competition/rules";
import { buildBrief, type Brief } from "@/lib/competition/brief";
import { loadCompetitionContext, todayWinnipeg } from "@/lib/competition/load.server";
import { assertRequesterReaches } from "@/lib/cleo-actions.server";

const LIFTS = ["squat", "bench", "deadlift"] as const;

// Only explicit read-only attempt questions. No arbitrary prompts, history or files
// are processed here, and no external model is called.
export function isLocalAttemptQuestion(question: string): boolean {
  // Keep normalization local and narrowly scoped. A common speech-to-text
  // rendering of "attempt selection" is "temp selection" or "a temp selection".
  const q = question.normalize("NFKC").toLowerCase()
    .replace(/[‘’]/g, "'").replace(/\\s+/g, " ").trim()
    .replace(/[?.!]+$/, "").trim()
    .replace(/^(?:hey cleo[, ]+|cleo[, ]+|please )/, "")
    .replace(/,? please$/, "")
    .replace(/\\b(?:a temp|temp|atempt|attemt) selection\\b/g, "attempt selection");
  const subject = "(?:(?:the|their|these|those|client's|athlete's) )?(?:(?:squat|bench|deadlift) )?(?:attempt selection|attempt plan|attempt rationale|attempt sources|attempt weights|attempt numbers|attempts?|openers?|opener weights)";
  const verb = "(?:get|calculate|choose|pick|select|determine|decide on|come up with|work out)";
  const patterns = [
    `^how did (?:you|cleo) ${verb} ${subject}$`,
    `^how did (?:you|cleo) ${verb} (?:the |these |those )?(?:numbers|weights) for ${subject}$`,
    `^how (?:were|are|was|is) ${subject} (?:chosen|selected|calculated|determined|decided|worked out)$`,
    `^(?:(?:can|could|would) you )?(?:show(?: me)?|review|explain|check|walk me through|tell me about) ${subject}$`,
    `^why ${subject}$`,
    `^why did (?:you|cleo) ${verb} ${subject}$`,
    `^where did ${subject} come from$`,
    `^what (?:is|was) the (?:reason|rationale|basis) (?:for|behind) ${subject}$`,
  ];
  return patterns.some(pattern => new RegExp(pattern).test(q));
}

const sourceLabels = {
  athlete: "Athlete's own plan",
  existing_coach: "Athlete's existing coach",
  coach: "Coach-provided",
  records: "Training and meet records",
  cleo: "Cleo recommendation",
} as const;

export function formatLocalAttempts(input: {
  name: string;
  date: string;
  label: string;
  plan: GameplanDoc;
  brief?: Brief | null;
  increment: number;
  alternativeCount?: number;
}): string {
  const { plan, brief } = input;
  const lines = [`**${input.name} — ${input.date}**`, `Attempt selection · ${input.label}`];
  if (input.alternativeCount) lines.push("This is the default meet from the Competition tab; other meets also exist.");
  for (const lift of LIFTS) {
    const a = plan.attempts[lift];
    const title = lift[0].toUpperCase() + lift.slice(1);
    if (!a || [a.opener, a.second, a.third].every(x => x == null)) {
      lines.push(`**${title}:** No attempt weights on file.`);
      continue;
    }
    lines.push(`**${title}:** ${[a.opener, a.second, a.third].map(x => x == null ? "—" : String(x)).join(" / ")} kg — ${sourceLabels[a.source]} (${a.status})`);
    if (a.note) lines.push(a.note);
    // Only attribute the live engine inputs to an unsaved, record-based draft.
    // A saved plan may have been edited since it was created.
    if (a.source === "records" && brief) {
      const forecast = brief.forecast.lifts[lift];
      if (forecast) {
        const range = forecast.range;
        lines.push(`Forecast: ${range.conservative} / ${range.expected} / ${range.high} kg (conservative / expected / high).`);
        lines.push(...forecast.basis);
      }
      lines.push(...(brief.attempts.lifts[lift]?.why ?? []));
    }
  }
  if (plan.why.length) lines.push("**Recorded rationale**", ...plan.why);
  if (LIFTS.some(l => plan.attempts[l]?.source === "records" || plan.attempts[l]?.source === "cleo")) {
    lines.push(`For calculated recommendations, the engine normally uses historical opener percentages when available (otherwise 91% of expected squat/deadlift and 92% of expected bench), caps the opener at 96% of the conservative forecast and rounds to the federation increment (${input.increment} kg). These are recommendations, not automatic platform decisions.`);
  }
  if (!brief) lines.push("This is the saved plan and its recorded source labels. Historical calculation inputs may not have been saved; current training data is not presented as the original calculation.");
  return lines.join("\n\n");
}

/** Role check first, then internal reads only. Never modifies a meet, plan or consent. */
export async function localAttemptAnswer(sb: any, requester: string, clientId: string): Promise<string> {
  await assertRequesterReaches(sb, requester, clientId);
  const { data, error } = await sb.from("competitions")
    .select("id, name, meet_date, meet_end_date, status, is_primary, federation, rules, objective, athlete_info")
    .eq("client_id", clientId)
    .or("internal_test.eq.false,name.not.ilike.Validation rehearsal:*")
    .order("meet_date", { ascending: false });
  if (error) throw new Error("Could not read competitions");
  const all = (data ?? []) as any[];
  const today = todayWinnipeg();
  const comp = [...all].filter(c => c.status === "upcoming" && String(c.meet_end_date ?? c.meet_date) >= today)
    .sort((a, b) => String(a.meet_date).localeCompare(String(b.meet_date)) || Number(b.is_primary) - Number(a.is_primary))[0]
    ?? all.find(c => c.status === "completed") ?? all.find(c => c.status === "upcoming")
    ?? all.find(c => c.status !== "archived") ?? all[0];
  if (!comp) return "There is no competition on file to explain attempt selection for yet.";
  const rules = readRules(comp.rules, comp.federation);
  const { data: versions, error: versionError } = await sb.from("competition_gameplans")
    .select("version, status, plan").eq("competition_id", comp.id).eq("client_id", clientId)
    .in("status", ["approved", "draft"]).order("version", { ascending: false });
  if (versionError) throw new Error("Could not read gameplan");
  const current = (versions ?? []).find((v: any) => v.status === "approved") ?? (versions ?? []).find((v: any) => v.status === "draft");
  const common = { name: String(comp.name), date: String(comp.meet_date), increment: rules.incrementKg, alternativeCount: all.length - 1 };
  if (current) return formatLocalAttempts({ ...common, label: `Saved ${current.status} · v${current.version}`, plan: readGameplan(current.plan) });

  // Same deterministic draft engine and source order as the Competition workspace.
  // Do not call loadPrep: it can update handling status.
  let brief: Brief | null = null;
  try {
    const { ctx } = await loadCompetitionContext(sb, comp.id, { today });
    brief = buildBrief(ctx);
  } catch {
    return "I couldn't verify the training and meet records used for the current draft. Open the Competition tab and try again rather than assuming the source of these numbers.";
  }
  let intel: DraftInput["intel"] = null;
  const { loadFacts } = await import("@/lib/athlete-intel/fact-store.server");
  const { gameplanIntel } = await import("@/lib/athlete-intel/engine-input");
  const { resolveFacts } = await import("@/lib/athlete-intel/facts");
  const facts = (await loadFacts(sb, clientId)).filter(f => f.competition_id == null || f.competition_id === comp.id);
  if (facts.length) intel = {
    ...gameplanIntel(facts, comp.id),
    conflicts: [...new Set(resolveFacts(facts).conflicts.filter(c => c.kind === "attempt_plan" && c.lift).map(c => c.lift!))],
  };
  const plan = draftGameplan({
    intel, rules, objective: comp.objective ?? null,
    info: readAthleteInfo(comp.athlete_info),
    recordsAttempts: brief.attempts,
    warmupHistory: brief.inputs.warmups,
    athlete: { name: "Athlete" },
  });
  return formatLocalAttempts({ ...common, label: "Current calculated draft (not approved)", plan, brief });
}
