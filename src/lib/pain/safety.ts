/**
 * When pain needs more than a coach: the warning signs, worded once (pure,
 * tested). Nothing here diagnoses. It says when a report is worth a
 * professional's look, and which signs mean get help now.
 *
 * The athlete sees the urgent signs in the review only when what they picked
 * calls for it (a severe place, numbness or tingling, a pop, swelling): a
 * static safety notice, never coaching advice. Everything else reaches them
 * only through a message the coach writes or approves.
 */
import { generalFlagged, severeAtRest, type PainEntry } from "@/lib/pain/history";
import { generalLabel } from "@/lib/pain/symptoms";
import { placeLabel, type Feel, type Severity, type Timing, type Trigger } from "@/lib/pain/report";
import type { PainSide } from "@/lib/pain/regions";

/** Get help now: the athlete's notice and the coach's sheet say the same. */
export const URGENT_SIGNS = [
  "chest pain, or pain with shortness of breath",
  "numbness in the groin or inner thighs, or new trouble controlling bladder or bowels",
  "sudden weakness in an arm or leg",
  "a sudden, severe headache (the worst you've had), or a headache with weakness, numbness, confusion, or trouble seeing or speaking",
  "fainting, or dizziness with chest pain, shortness of breath or a racing heart",
  "a joint that looks out of place, or a limb you can't put weight on",
  "severe pain after a fall or a hard hit",
] as const;

export type SafetyPick = { region: string; side: PainSide | null; severity: Severity | null; score?: number | null; feel?: Feel[]; trigger?: Trigger | null; timing?: Timing[]; symptom?: string | null };

/** General symptoms that always show the notice (the rest show it with a warning sign). */
const NOTICE_SYMPTOMS = new Set(["fainted", "breathless", "palpitations"]);

/** The review shows the notice when any place calls for it. */
export function needsSafetyNotice(picks: SafetyPick[]): boolean {
  const symptoms = new Set(picks.map((p) => p.symptom).filter(Boolean) as string[]);
  return picks.some(
    (p) =>
      p.severity === "severe" ||
      (typeof p.score === "number" && p.score >= 7) ||
      (p.feel ?? []).some((f) => f === "numb" || f === "pop" || f === "swollen" || f === "weak" || f === "sudden") ||
      (!!p.symptom && NOTICE_SYMPTOMS.has(p.symptom)) ||
      (p.symptom === "dizziness" && (symptoms.has("breathless") || symptoms.has("palpitations") || picks.some((q) => q.region === "chest"))) ||
      (p.region === "chest" && (p.trigger === "daily" || p.trigger === "unsure" || ((p.timing ?? []).includes("rest") && !(p.timing ?? []).some((t) => t === "during" || t === "after")))),
  );
}

/** What the athlete reads in the review (static, the same for everyone). */
export const CLIENT_SAFETY_NOTICE = {
  title: "Get it checked",
  body: "Pain like this is worth a physio or doctor's look before you train it hard again. Your coach will see this.",
  urgentLead: "Get medical help right away if there's",
};

export type RedFlag = { key: string; area: string; date: string; text: string; urgent: boolean };

/**
 * The warning signs in recent reports, worded for the coach. `urgent` = ask
 * about the urgent signs today; the rest = get it assessed.
 */
export function redFlags(entries: PainEntry[]): RedFlag[] {
  const out: RedFlag[] = [];
  const seen = new Set<string>();
  const add = (e: PainEntry, key: string, text: string, urgent = false) => {
    const id = `${e.region}:${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ key, area: placeLabel(e), date: e.date, text, urgent });
  };
  for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
    if (e.symptom) {
      if (!generalFlagged(e, entries)) continue;
      const name = generalLabel(e.symptom) ?? "A symptom";
      if (e.symptom === "fainted")
        add(e, "fainted", "Fainted or nearly fainted: they should see a doctor before training hard again, and get medical help now if it came with chest pain, a racing heart or shortness of breath.", true);
      else if (e.symptom === "headache" && (e.feel.includes("sudden") || e.feel.includes("weak") || e.feel.includes("numb")))
        add(e, "headache_sudden", "A headache that came on suddenly, or with weakness or numbness: ask about it today, and get medical help now if it was severe and sudden or came with confusion or trouble seeing or speaking.", true);
      else if (e.symptom === "breathless" || e.symptom === "palpitations")
        add(e, `${e.symptom}_with`, `${name} with dizziness or chest pain: ask about it today, and get medical help now if it happens again.`, true);
      else add(e, `${e.symptom}_training`, `${name} while training${e.symptom === "headache" || e.symptom === "breathless" ? ", more than once" : ""}: worth a doctor's look before pushing hard sessions.`);
      continue;
    }
    if (e.feel.includes("weak"))
      add(e, "weak", "Weakness reported: ask whether it came on suddenly (that's urgent) and get it assessed rather than training through it.", true);
    if (e.feel.includes("numb")) {
      if (e.region === "low_back" || e.region === "glute")
        add(e, "nerve_back", "Numbness or tingling with back pain: ask about numbness in the groin and bladder or bowel changes today (that's urgent), otherwise get it assessed.", true);
      else if (e.region === "neck" || e.region === "upper_back")
        add(e, "nerve_neck", "Numbness or tingling with neck pain: ask whether it runs down the arm or comes with weakness, and get it assessed.");
      else add(e, "nerve", "Numbness or tingling: nerve involvement is possible, worth an assessment rather than training through it.");
    }
    if (e.feel.includes("pop") && (e.severity === "severe" || e.feel.includes("swollen") || e.impact === "stopped"))
      add(e, "pop", "A pop with swelling, severe pain or a stopped session: get it assessed before loading it again.");
    else if (e.feel.includes("swollen") && e.severity === "severe")
      add(e, "swollen", "Severe and swollen: get it assessed before loading it again.");
    if (severeAtRest(e))
      add(e, "rest", "Severe pain at rest, not only when training: get it assessed rather than training around it.");
    if (e.region === "chest" && (e.trigger === "daily" || e.trigger === "unsure") && (e.severity === "moderate" || e.severity === "severe"))
      add(e, "chest", "Chest pain that isn't clearly from a lift: ask about shortness of breath, arm or jaw pain, and send them for medical help if there's any doubt.", true);
  }
  return out;
}
