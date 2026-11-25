/**
 * The coach's presenter script (Nov 25 2026, pure, tested in
 * coaching-sessions-script.test.ts): one script per slide of the shared
 * screen, built in code from the very agenda the presentation reads
 * (athleteView's order: a title slide, then each agenda section), so the
 * script and the screen can never disagree. No model writes it: every line
 * is a template around the prep's own sourced items and Cleo's checked brief
 * questions, so nothing is invented, it costs nothing and it's ready the
 * moment the meeting opens. Private: only the coach's window renders it; the
 * shared screen (getPresentationFn) never sees any of it.
 */
import type { Agenda, PrepItem, SectionKey } from "./prepare";
import type { SessionBrief } from "./brief";

export type ScriptSlide = {
  key: SectionKey | "title";
  title: string;
  minutes: number;
  /** what to say, in order */
  say: string[];
  /** questions to ask */
  ask: string[];
  /** where to stop talking and let them speak */
  pause: string | null;
  /** the line that moves to the next slide */
  transition: string | null;
};

export type ScriptInput = {
  agenda: Agenda | null | undefined;
  brief?: SessionBrief | null;
  firstName: string | null;
  eventTitle?: string | null;
  daysOut?: number | null;
  phase?: string | null;
  missing?: PrepItem[];
};

const lower = (t: string) => (t ? t[0].toLowerCase() + t.slice(1) : t);
const shareable = (i: PrepItem) => i.source === "record" || i.source === "athlete";

const NEXT_WORDS: Record<SectionKey, string> = {
  going_well: "what's going well",
  improve: "where we can improve",
  athletes_corner: "your corner, where you lead",
  game_plan: "our game plan",
  alignment: "next steps",
};

export function buildPresenterScript(x: ScriptInput): ScriptSlide[] {
  const name = x.firstName?.trim() || "";
  const hi = name ? `${name}, ` : "";
  const sections = x.agenda?.sections ?? [];
  const minutes = x.agenda?.minutes ?? null;
  const questions = x.brief?.questions ?? [];
  const qFor = (k: SectionKey) => questions.filter((q) => q.section === k).map((q) => q.text);
  const meet = x.daysOut != null && x.daysOut >= 0;
  const slides: ScriptSlide[] = [];

  // Title slide
  const titleSay: string[] = [
    `${name ? `Hey ${name}, ` : "Hey, "}thanks for making the time.`,
    meet
      ? `${x.daysOut === 0 ? "It's meet day" : `We're ${x.daysOut} days out${x.eventTitle ? ` from ${x.eventTitle}` : ""}`}${x.phase ? `, in ${lower(x.phase)}` : ""}. This call is about walking into it clear and confident.`
      : `This call is about where things stand and what we do next.`,
    `${minutes ? `We've got about ${minutes} minutes. ` : ""}Quick plan: what's going well, where we can improve, then your corner, where you lead, and we finish with our game plan and next steps.`,
  ];
  slides.push({
    key: "title",
    title: x.eventTitle || "Opening",
    minutes: 1,
    say: titleSay,
    ask: ["Before we start, anything on your mind you want to make sure we get to today?"],
    pause: "Stop and let them answer. Write down anything they raise and make sure it gets time in their corner.",
    transition: sections[0] ? `Good. Let's start with ${NEXT_WORDS[sections[0].key]}.` : null,
  });

  sections.forEach((sec, idx) => {
    const next = sections[idx + 1];
    const transition = next ? `Let's move to ${NEXT_WORDS[next.key]}.` : "That's everything. Thanks for this, I'll send the game plan to your chat after the call.";
    const shared = sec.items.filter(shareable).map((i) => i.text);
    const priv = sec.items.filter((i) => !shareable(i)).map((i) => i.text);
    const say: string[] = [];
    const ask: string[] = [...qFor(sec.key)];
    let pause: string | null = null;

    if (sec.key === "going_well") {
      if (shared.length) {
        say.push("Let's start with what's working, because it's earned.");
        for (const t of shared) say.push(`${t}. That's yours, nice work.`);
      } else {
        say.push("Before the numbers, I want to hear what you think has gone well. You know your training better than any record.");
      }
      if (!ask.length) ask.push("What are you proudest of from this prep so far?");
      pause = "Let them answer fully. Reinforce what they name: repeat it back and say why it matters for the meet.";
    } else if (sec.key === "improve") {
      say.push("Now the stuff that will move you forward most. This isn't about blame, it's about fixing it before it costs us.");
      for (const t of shared) say.push(`On file: ${lower(t)}.`);
      for (const t of priv) say.push(`(Your read, keep it as your own framing) ${t}`);
      if (!ask.length) ask.push("What's made that harder lately?");
      ask.push("What would make it easier to get done between now and the meet?");
      pause = "Ask, then stop. Don't fill the silence or offer reasons for them. Listen for the real cause before you suggest a fix.";
    } else if (sec.key === "athletes_corner") {
      say.push(`${hi}this part is yours. Anything you want to talk about, questions, worries, things you want from me.`);
      for (const t of shared) say.push(`You mentioned: ${lower(t)}. Tell me more about that.`);
      if (!ask.length) ask.push("What's on your mind about the meet right now?");
      ask.push("Is there anything you're nervous about that we haven't talked about?");
      ask.push("What do you need from me between now and the meet to feel ready?");
      pause = "This is their time. Talk less than they do. Acknowledge every concern before answering it, and if you don't know, say you'll find out.";
    } else if (sec.key === "game_plan") {
      say.push("Here's what's coming and what we're deciding together.");
      for (const t of shared) say.push(t.endsWith(".") ? t : `${t}.`);
      for (const t of priv) say.push(`(Your read, talk it through, don't read it out) ${t}`);
      if (!ask.length) ask.push("How does that plan sit with you?");
      ask.push("Anything in there you'd change or that doesn't feel right?");
      pause = "Pause after each decision and get a clear yes or their concern before moving on. Add each agreement under What we agreed.";
    } else if (sec.key === "alignment") {
      say.push("Let's lock in who does what, by when.");
      for (const t of shared) say.push(t.endsWith(".") ? t : `${t}.`);
      for (const t of priv) say.push(`(Follow-up from last time) ${t}`);
      for (const m of x.missing ?? []) say.push(`I still need ${lower(m.text)}. Can you get that to me this week?`);
      if (!ask.length) ask.push("Can you say back what you're doing before the meet, so we're on the same page?");
      say.push(
        meet
          ? "You've done the work. The job now is to show up rested, make your weight and execute. I'm with you the whole way."
          : "Good work today. I'm with you on all of it.",
      );
      pause = "Let them summarise their part in their own words. Add each one under commitments.";
    }

    slides.push({ key: sec.key, title: sec.title, minutes: sec.minutes, say, ask, pause, transition });
  });

  return slides;
}

/** The script for one slide as plain text, for editing in place. */
export function slideText(s: ScriptSlide): string {
  const parts: string[] = [];
  if (s.say.length) parts.push(s.say.join("\n"));
  if (s.ask.length) parts.push(`Ask:\n${s.ask.map((q) => `- ${q}`).join("\n")}`);
  if (s.pause) parts.push(`Pause: ${s.pause}`);
  if (s.transition) parts.push(`Then: ${s.transition}`);
  return parts.join("\n\n");
}

/** The channel the shared screen and the coach's script talk on (same browser, same origin). */
export const presentChannel = (sessionId: string) => `jf-present-${sessionId}`;
export type PresentMessage = { type: "slide"; index: number } | { type: "go"; index: number } | { type: "hello" };
