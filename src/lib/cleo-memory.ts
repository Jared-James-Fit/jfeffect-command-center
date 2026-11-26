/**
 * What Cleo is sent from a conversation (Nov 24 2026). The whole conversation
 * is kept (summer_messages); the model gets only what the answer needs:
 *
 *   - the recent messages in full (RECENT_IN_FULL),
 *   - a running summary of everything older (summer_chats.summary), written
 *     after an answer once enough has built up past it (SUMMARIZE_AFTER), that
 *     keeps decisions, exact numbers, preferences and open instructions,
 *   - for a client's conversation: who it's about, the other recent
 *     conversations about them (title and summary), and the cards still waiting,
 *   - older details on demand (the past_conversations look-up), never by default.
 *
 * Pure: the server reads the rows, this decides what goes in.
 */
import { CATEGORY_LABEL, SECTION_LABEL, type CleoCategory, type CleoSection } from "@/lib/cleo-chats";

/** Messages sent in full with every question. */
export const RECENT_IN_FULL = 14;
/** Once this many messages sit past the summary, the older ones are folded into it (after the answer). */
export const SUMMARIZE_AFTER = 22;
/** What stays in full once the summary catches up. */
export const KEEP_AFTER_SUMMARY = 10;
/** One past message's share of the prompt. */
export const PAST_MESSAGE_CHARS = 3000;
export const SUMMARY_MAX_CHARS = 6000;

export type MemoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status?: string | null;
  superseded_at?: string | null;
};

/** A message that belongs in what the model reads: answered (or a question), not replaced. */
export function countsInMemory(m: MemoryMessage): boolean {
  if (m.superseded_at) return false;
  if (m.role === "assistant") return (m.status ?? "done") === "done" && !!m.content?.trim();
  return true;
}

/**
 * `since`: the messages after the summary (oldest first), the question being
 * answered excluded. Returns the ones sent in full and the ones the next
 * summary should fold in (empty until there are enough to be worth a call).
 */
export function planMemory(since: MemoryMessage[]): { recent: MemoryMessage[]; fold: MemoryMessage[] } {
  const usable = since.filter(countsInMemory);
  const recent = usable.slice(-RECENT_IN_FULL);
  // a reply is never sent without the question it answers
  while (recent.length && recent[0].role === "assistant") recent.shift();
  const fold = usable.length >= SUMMARIZE_AFTER ? usable.slice(0, usable.length - KEEP_AFTER_SUMMARY) : [];
  return { recent, fold };
}

export function clipText(text: string, max: number): string {
  const t = String(text ?? "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export type RelatedConversation = { title: string; last_message_at: string; summary: string | null; preview: string | null };
export type WaitingCard = { summary: string; status: string };

/**
 * The conversation's own context, sent after Cleo's instructions (so those stay
 * cached): who it's about, the summary, related conversations, waiting cards,
 * and where the coach is now.
 */
export function memoryText(x: {
  client?: { id: string; name: string } | null;
  category?: CleoCategory | null;
  section?: CleoSection | null;
  summary?: string | null;
  related?: RelatedConversation[];
  waiting?: WaitingCard[];
  clientBrief?: string | null;
}): string {
  const out: string[] = [];
  if (x.client) {
    out.push(
      `THIS CONVERSATION IS ABOUT ${x.client.name.toUpperCase()} (client id ${x.client.id}). "They", "them", "this client" and "their" mean ${x.client.name}.`,
      `Stay on ${x.client.name}. Never mix in another client's records, numbers or plans. If the coach asks about someone else, say this conversation is ${x.client.name}'s and that opening Cleo on that client's page (or a general conversation) keeps their history separate; you may answer a quick factual question about them but never set up a change for anyone but ${x.client.name} here (it's refused).`,
    );
  } else {
    out.push("THIS IS A GENERAL CONVERSATION (not about one client). For a change to one client, it's fine to set it up here; name the client every time.");
  }
  if (x.section) out.push(`WHERE THE COACH IS NOW: ${SECTION_LABEL[x.section]}.`);
  if (x.category && x.category !== "general") out.push(`THE CONVERSATION'S TOPIC SO FAR: ${CATEGORY_LABEL[x.category]}.`);
  if (x.summary?.trim()) {
    out.push(
      "",
      "WHAT WAS SAID EARLIER IN THIS CONVERSATION (a summary of the older messages; the recent ones follow in full). Decisions, numbers and open instructions in it still stand unless a later message changed them:",
      clipText(x.summary.trim(), SUMMARY_MAX_CHARS),
    );
  }
  if (x.waiting?.length) {
    out.push("", "CARDS STILL WAITING IN THIS CONVERSATION (don't set them up again; remind them only if it helps):");
    for (const w of x.waiting.slice(0, 6)) out.push(`- ${clipText(w.summary.split("\n")[0], 200)} (${w.status === "awaiting_approval" ? "waiting on the owner's approval" : w.status === "running" ? "running" : "waiting for them to tap Confirm"})`);
  }
  if (x.related?.length) {
    out.push("", `EARLIER CONVERSATIONS${x.client ? ` ABOUT ${x.client.name.toUpperCase()}` : ""} (for continuity; use past_conversations to read one in detail when it matters):`);
    for (const r of x.related.slice(0, 3)) {
      const gist = r.summary?.trim() || r.preview?.trim() || "";
      out.push(`- "${r.title}" (last active ${r.last_message_at.slice(0, 10)})${gist ? `: ${clipText(gist.replace(/\s+/g, " "), 500)}` : ""}`);
    }
  }
  if (x.clientBrief?.trim()) out.push("", x.clientBrief.trim());
  return out.join("\n");
}

/** What the summarizer is told: keep what a coach would need to pick the conversation up again. */
export const SUMMARY_SYSTEM = [
  "You keep the running memory of a conversation between a strength coach (or their finance or team login) and Cleo, the app's AI assistant.",
  "Write a summary that lets the conversation continue as if nothing was forgotten. Keep, exactly as said:",
  "- who it's about (client names), and any decision made or agreed (what, for whom, from when);",
  "- every number that was prescribed, agreed or reported: sets, reps, RPE/RIR, loads with units, percentages, calories, macros, steps, minutes, dates, amounts of money;",
  "- the coach's preferences and instructions for this client or for how Cleo should work, and anything still open (questions not answered, changes not made yet, things to check later);",
  "- what Cleo set up as cards and whether they were confirmed, if said.",
  "Leave out greetings, small talk and anything already superseded by a later message (say what it became instead).",
  "Plain text, short lines grouped under: People, Decisions, Numbers, Preferences, Open items. No other headings, no markdown tables. At most 450 words.",
  "Never invent anything that isn't in the messages.",
].join("\n");

export function summaryPrompt(previous: string | null, messages: MemoryMessage[], clientName?: string | null): string {
  const lines = messages.map((m) => `${m.role === "user" ? "COACH" : "CLEO"} (${m.created_at.slice(0, 16).replace("T", " ")}): ${clipText(m.content.replace(/\s+\n/g, "\n"), PAST_MESSAGE_CHARS)}`);
  return [
    clientName ? `The conversation is about ${clientName}.` : "",
    previous?.trim() ? `THE SUMMARY SO FAR (fold the new messages into it; keep everything in it that still stands):\n${previous.trim()}` : "There's no summary yet.",
    "",
    "NEW MESSAGES TO FOLD IN (oldest first):",
    ...lines,
    "",
    "Write the updated summary now.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** A summary the model wrote, tidied; null when it's empty or obviously not a summary. */
export function cleanSummary(raw: unknown): string | null {
  const t = String(raw ?? "")
    .replace(/\r/g, "")
    .replace(/^```[a-z]*\n?|```$/g, "")
    .trim();
  if (t.length < 20) return null;
  return clipText(t, SUMMARY_MAX_CHARS);
}

/** The title-and-topic call's instructions (one cheap call after the first answer). */
export const TITLE_SYSTEM = [
  "Name a conversation between a strength coach and their AI assistant, and say what it's about.",
  'Answer with JSON only: {"title": "...", "category": "..."}',
  "title: 2 to 6 words, sentence case, specific (a client's first name when it's about one, the lift, the change), no quotes, no ending period, never \"Chat\" or \"Question\".",
  `category: one of ${["general", "workout", "nutrition", "cardio", "recovery", "analytics", "checkins", "program"].join(", ")} (checkins = weekly check-ins and forms; program = building or changing a program; workout = a session, sets, exercises; general = business, calendar, messages or anything else).`,
].join("\n");

export function titlePrompt(question: string, answer: string, clientName?: string | null): string {
  return [
    clientName ? `It's about ${clientName}.` : "",
    `COACH: ${clipText(question, 1200)}`,
    `CLEO: ${clipText(answer, 1200)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseTitleReply(raw: unknown): { title: string | null; category: string | null } {
  const t = String(raw ?? "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return { title: null, category: null };
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return { title: typeof v?.title === "string" ? v.title : null, category: typeof v?.category === "string" ? v.category : null };
  } catch {
    return { title: null, category: null };
  }
}

/** What Cleo is doing, from the look-up it just made (the line under "Cleo is working on it"). */
const TOOL_PROGRESS: Array<[RegExp, string]> = [
  [/^propose_/, "Setting up a card"],
  [/ask_choice/, "Checking which one you mean"],
  [/training_log|personal_records|team_training/, "Reading the training log"],
  [/^strength$/, "Reading their strength"],
  [/training_program|program_detail|program_history|program_templates/, "Reading the program"],
  [/exercise_library/, "Searching the exercise library"],
  [/nutrition/, "Reading the nutrition plan"],
  [/body_weight/, "Checking bodyweight"],
  [/^goals$/, "Reading their goals"],
  [/check_ins/, "Reading check-ins"],
  [/pain_flags/, "Checking pain reports"],
  [/message_thread/, "Reading their messages"],
  [/purchases/, "Checking purchases"],
  [/calendar/, "Checking the calendar"],
  [/client_file/, "Reading the client file"],
  [/openipf/, "Looking them up on OpenIPF"],
  [/business_documents/, "Reading the policies"],
  [/find_data|read_data/, "Looking through the records"],
  [/past_conversations/, "Looking back at earlier conversations"],
];

export function progressFor(toolNames: string[]): string {
  for (let i = toolNames.length - 1; i >= 0; i--) {
    for (const [re, label] of TOOL_PROGRESS) if (re.test(toolNames[i])) return `${label}…`;
  }
  return toolNames.length ? "Looking things up…" : "Thinking…";
}
