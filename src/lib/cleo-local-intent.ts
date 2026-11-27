/**
 * Local topic routing. This never sends a prompt or records to a model.
 * Match concepts, not a list of exact commands. All selected readers are
 * independently restricted to the conversation's authorized client.
 */
export type LocalTopic =
  | "setup" | "attempts" | "competition" | "profile" | "strength" | "training"
  | "program" | "records" | "weight" | "nutrition" | "cardio" | "checkins"
  | "goals" | "meetings" | "messages" | "purchases";

export type LocalIntent = { topics: LocalTopic[]; action: boolean; days: number | null; date?: string; exercise?: string };

const TOPICS: Array<[LocalTopic, RegExp]> = [
  ["setup", /\b(?:onboarding|intake|account setup|coaching setup|setup checklist|profile setup|what(?:'s| is) (?:still )?(?:missing|left|outstanding)|account access|sign.?in|agreements?|forms? (?:left|missing)|(?:setup|checklist) (?:status|complete|missing|outstanding)|outstanding setup)\b/],
  ["attempts", /\b(?:attempt(?:s| selection| plan| numbers| weights| rationale)?|openers?|game\s?plan|(?:a )?temp selection|atempt selection|attemt selection)\b/],
  ["competition", /\b(?:competition|meet(?:s| day| prep)?|weigh.?in|flight|weight class|federation|openipf|openpowerlifting|handling)\b/],
  ["strength", /\b(?:strength|(?:e|estimated )?1rm|one.rep max|training max|(?:squat|bench|deadlift) max|how strong|strength trend|strength progress)\b/],
  ["records", /\b(?:prs?|personal records?|personal bests?|all.time bests?|best lifts?)\b/],
  ["program", /\b(?:program(?:ming|me|mes|s)?|training plan|workout plan|training block|schedule|workout today|next workout|missed workouts?|workout adherence|training compliance|training frequency|adherence|attendance)\b/],
  ["training", /\b(?:training (?:log|history|progress|performance|data|sessions?|volume)|workout(?:s| history| log| results| performance)?|sets?|reps?|rpe|rir|bar (?:speed|velocity)|velocity|lift(?:s|ed|ing)?|squat|bench|deadlift)\b/],
  ["weight", /\b(?:body\s?weight|weigh.?ins?|scale weight|weight (?:trend|change|loss|gain|progress)|how much (?:do|does|did) (?:they|he|she) weigh)\b/],
  ["nutrition", /\b(?:nutrition|macros?|calories?|kcal|protein|carbs?|fat intake|diet|meal(?:s| plan)?|food|water intake|digestion)\b/],
  ["cardio", /\b(?:cardio|conditioning|step targets?|cardio minutes)\b/],
  ["checkins", /\b(?:check[ -]?ins?|feedback|recovery|pain|injur(?:y|ies)|sleep|stress|fatigue|soreness|form submissions?)\b/],
  ["goals", /\b(?:goals?|targets?|projection|feasibility|realistic|objectives?)\b/],
  ["meetings", /\b(?:meetings?|calls?|discussion|discussed|agreed|follow[ -]?ups?|said on|decisions?)\b/],
  ["messages", /\b(?:messages?|chat|thread|conversation|texts?|what (?:did|has) (?:she|he|they) (?:say|said|sent|send|ask))\b/],
  ["purchases", /\b(?:billing|payments?|purchases?|balance|owes?|invoices?|subscription|renewal|paid)\b/],
  ["profile", /\b(?:profile|client file|client details|contact|phone|email|coach notes|client notes|status|client overview|about (?:them|her|him|the client))\b/],
];

export function localClientIntent(question: string): LocalIntent {
  const q = question.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  const start = q.replace(/^(?:hey cleo[, ]+|cleo[, ]+|please |(?:can|could|would) you )+/, "");
  // A read-only route must never imply a write, a new draft or a send occurred.
  const action = /^(?:add|change|update|delete|remove|create|draft|write|send|publish|approve|cancel|schedule|move|reschedule|assign|set|record|save|mark|edit|replace|generate|make|build|adjust|increase|decrease|reduce|fix|rewrite|reply)\b/.test(start)
    || /\b(?:and|then) (?:add|change|update|delete|remove|create|draft|write|send|publish|approve|cancel|schedule|move|assign|set|record|save|mark|edit|replace|generate|make|build|adjust|fix)\b/.test(q);
  const found = TOPICS.filter(([, pattern]) => pattern.test(q)).map(([topic]) => topic);
  // A specific topic is better than unrelated matches such as "training plan"
  // also matching "training", or an attempt question matching a general meet.
  const drop = new Set<LocalTopic>();
  if (found.includes("attempts")) { drop.add("competition"); if (!/\btraining (?:history|log|data|progress)\b/.test(q)) drop.add("training"); }
  if (found.includes("setup")) { if (!/\bclient file|coach notes|contact|phone|email\b/.test(q)) drop.add("profile"); if (!/\bcompetition (?:schedule|results|history)\b/.test(q)) drop.add("competition"); }
  if (found.includes("program") && !/\b(?:logged|actual|results|training (?:history|log|progress|performance|data)|sets|reps|rpe)\b/.test(q)) drop.add("training");
  if (found.includes("strength") && !/\b(?:training log|history|logged sets|reps|rpe)\b/.test(q)) drop.add("training");
  if (found.includes("nutrition") && !/\b(?:goals ledger|goal approval|approved goals|competition goals)\b/.test(q)) drop.add("goals");
  if (found.includes("cardio") && !/\b(?:goals ledger|goal approval|approved goals)\b/.test(q)) drop.add("goals");
  if (found.length > 1 && !/\b(?:profile|client file|contact|phone|email|coach notes|client notes)\b/.test(q)) drop.add("profile");
  let topics = found.filter(topic => !drop.has(topic));
  if (!topics.length && /\b(?:overview|summary|how (?:is|are) (?:she|he|they) doing|progress|what's going on|everything on file)\b/.test(q)) topics = ["profile", "strength", "checkins"];
  const duration = q.match(/\b(?:last|past|previous|over the last) (\d{1,3}) (days?|weeks?|months?)\b/);
  let days = duration ? Math.max(1, Math.min(365, Number(duration[1]) * (duration[2].startsWith("week") ? 7 : duration[2].startsWith("month") ? 30 : 1))) : null;
  if (days == null && /\b(?:last|past|this) week\b/.test(q)) days = 7;
  if (days == null && /\b(?:last|past|this) month\b/.test(q)) days = 30;
  const date = q.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const lift = q.match(/\b(?:(?:competition|high bar|low bar|pause|paused|tempo|sumo|conventional|close grip) )?(?:squat|bench(?: press)?|deadlift)\b/)?.[0];
  return { topics, action, days, date, exercise: lift };
}
