/**
 * The coach's speaking script (pure, tested in coaching-sessions-script.test.ts):
 * one script per stage of the plan, built in code from the very plan the shared
 * screen reads, so the script and the screen never disagree. Coach-led: the
 * coach says what they see, what's working, what's limiting progress and what
 * to do about it; a question appears only where a talking point is one (a
 * clarification, the closing say-back). No model writes it: each line is the
 * point's own phrasing (the coach's edit first, then Cleo's checked refinement,
 * then the plan's), so nothing is invented, it costs nothing and it's ready
 * the moment the meeting opens. Private: only the coach's windows render it.
 */
import { normalizeAgenda, type Agenda, type PrepItem, type SectionKey, type TalkingPoint } from "./prepare";
import type { SessionBrief } from "./brief";

export type ScriptSlide = {
  key: SectionKey | "title";
  title: string;
  minutes: number;
  /** what to say, in order */
  say: string[];
  /** questions to ask (only real ones) */
  ask: string[];
  /** a note to the coach about this stage */
  pause: string | null;
  /** the line that moves to the next stage */
  transition: string | null;
  /** the talking points behind it, for marking addressed */
  pointIds?: string[];
};

export type ScriptInput = {
  agenda: Agenda | null | undefined | unknown;
  brief?: SessionBrief | null;
  firstName: string | null;
  eventTitle?: string | null;
  daysOut?: number | null;
  phase?: string | null;
  missing?: PrepItem[];
};

const lower = (t: string) => (t ? t[0]!.toLowerCase() + t.slice(1) : t);
const end = (s: string) => (/[.!?”"]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

const NEXT_WORDS: Record<SectionKey, string> = {
  connect: "catching up",
  recognize: "what's going well",
  evaluate: "what I'm seeing",
  coach: "what I recommend",
  execute: "the plan from here",
  align: "where we're headed",
};

/** What the stage is for, said to the coach. */
const COACH_NOTE: Record<SectionKey, string> = {
  connect: "Keep it short and real. Listen, then lead into the meeting.",
  recognize: "Be specific: name the win and why it matters. Don't rush past it.",
  evaluate: "Say what you see plainly. Facts first, your read second, and settle anything unclear before you build on it.",
  coach: "Give direction with the why. Leave a beat after each recommendation for their reaction.",
  execute: "Be concrete: who does what, by when, and how you'll both know it's done.",
  align: "Have them say it back. Finish on confidence, not a list.",
};

/** A point as spoken: the coach's edit, Cleo's refinement, the plan's phrasing, else the statement itself. */
export function spoken(i: TalkingPoint, section: SectionKey): string {
  if (i.edited) return end(i.say?.trim() || i.text);
  if (i.cleoSay?.trim()) return end(i.cleoSay);
  if (i.say?.trim()) return end(i.say);
  const t = i.text.trim();
  if (i.kind === "question") return end(t);
  switch (section) {
    case "recognize":
      return `${end(t)} That's earned.`;
    case "evaluate":
      return i.source === "read" ? `My read: ${end(lower(t))}` : `What I'm seeing: ${end(lower(t))}`;
    case "coach":
      return i.source === "athlete" ? `You raised this: ${end(lower(t.replace(/^They want to cover:\s*/i, "")))} Here's my take.` : `My recommendation: ${end(lower(t))}`;
    case "execute":
      return end(t);
    default:
      return end(t);
  }
}

export function buildPresenterScript(x: ScriptInput): ScriptSlide[] {
  const agenda = normalizeAgenda(x.agenda);
  const name = x.firstName?.trim() || "";
  const sections = (agenda?.sections ?? []).map((s) => ({ ...s, items: s.items.filter((i) => i.status !== "skipped") })).filter((s) => s.items.length);
  const minutes = agenda?.minutes ?? null;
  const meet = x.daysOut != null && x.daysOut >= 0;
  const slides: ScriptSlide[] = [];

  const titleSay: string[] = [
    `${name ? `Hey ${name}, ` : "Hey, "}thanks for making the time.`,
    agenda?.objective
      ? `Today's about one thing: ${end(lower(agenda.objective))}`
      : meet
        ? `We're ${x.daysOut === 0 ? "at meet day" : `${x.daysOut} days out${x.eventTitle ? ` from ${x.eventTitle}` : ""}`}${x.phase ? `, in ${lower(x.phase)}` : ""}.`
        : "Today's about where things stand and what we do next.",
    `${minutes ? `We've got about ${minutes} minutes. ` : ""}I'll go through what I'm seeing and what I recommend, and there's room for anything you want to raise.`,
  ];
  slides.push({
    key: "title",
    title: x.eventTitle || "Opening",
    minutes: 1,
    say: titleSay,
    ask: [],
    pause: agenda?.outcome ? `The outcome you want: ${agenda.outcome}` : null,
    transition: sections[0] ? `Let's start with ${NEXT_WORDS[sections[0].key]}.` : null,
  });

  sections.forEach((sec, idx) => {
    const next = sections[idx + 1];
    const say: string[] = [];
    const ask: string[] = [];
    for (const i of sec.items) {
      const line = spoken(i, sec.key);
      if (i.kind === "question") ask.push(line);
      // the coach sees which lines aren't on the shared screen (a greeting or the close never is)
      else say.push(i.share || sec.key === "connect" || sec.key === "align" ? line : `(For you) ${line}`);
    }
    if (sec.key === "align") {
      for (const m of (x.missing ?? []).slice(0, 2)) say.push(`One thing I still need from you: ${end(lower(m.text))}`);
      say.push(meet ? "You've done the work. Now we execute. I'm with you the whole way." : "Good work today. I'm with you on all of it.");
    }
    const transition = next ? `Next, ${NEXT_WORDS[next.key]}.` : "That's it. I'll send the recap to your chat.";
    slides.push({ key: sec.key, title: sec.title, minutes: sec.minutes, say, ask, pause: COACH_NOTE[sec.key], transition, pointIds: sec.items.map((i) => i.id) });
  });

  // what's still unclear is asked where it's evaluated (else the first stage after the opening),
  // and only while it's open: a question is there to settle something, never to interview
  const open = (agenda?.clarify ?? []).filter((c) => (c.status ?? "open") === "open");
  if (open.length) {
    const target = slides.find((s) => s.key === "evaluate") ?? slides.find((s) => s.key === "coach") ?? slides.find((s) => s.key !== "title" && s.key !== "connect") ?? slides[0];
    for (const c of open.slice(0, 3)) {
      const q = (c.say?.trim() || c.text).trim();
      if (!target.ask.includes(q)) target.ask.push(/[?]$/.test(q) ? q : `${q.replace(/[.!]$/, "")}?`);
    }
    target.pointIds = [...(target.pointIds ?? []), ...open.slice(0, 3).map((c) => c.id)];
  }

  return slides;
}

/** The script for one slide as plain text, for editing in place. */
export function slideText(s: ScriptSlide): string {
  const parts: string[] = [];
  if (s.say.length) parts.push(s.say.join("\n"));
  if (s.ask.length) parts.push(`Ask:\n${s.ask.map((q) => `- ${q}`).join("\n")}`);
  if (s.pause) parts.push(`Note: ${s.pause}`);
  if (s.transition) parts.push(`Then: ${s.transition}`);
  return parts.join("\n\n");
}

/** The channel the shared screen and the coach's windows talk on (same browser, same origin). */
export const presentChannel = (sessionId: string) => `jf-present-${sessionId}`;
export type PresentMessage = { type: "slide"; index: number } | { type: "go"; index: number } | { type: "hello" };

/**
 * The coach's script in a window of its own, so only the slides window is
 * ever shared. Falls back to this tab when the browser blocks it.
 */
export function openScriptWindow(sessionId: string): boolean {
  const url = `/admin/meetings/${sessionId}/script`;
  const w = window.open(url, `jf-script-${sessionId}`, "popup,width=560,height=860");
  if (w) {
    w.opener = null;
    return true;
  }
  return false;
}

/** The script's input from a session read (getSessionFn), the same everywhere it's shown. */
export function scriptInputFrom(data: any): ScriptInput {
  const s = data?.session ?? {};
  return {
    agenda: s.agenda ?? null,
    brief: s.write_up ?? null,
    firstName: data?.firstName ?? (data?.clientName ? String(data.clientName).split(" ")[0] : null),
    eventTitle: s.event?.title ?? null,
    daysOut: s.event?.daysOut ?? null,
    phase: s.event?.phase ?? null,
    missing: s.prep?.missing ?? [],
  };
}
