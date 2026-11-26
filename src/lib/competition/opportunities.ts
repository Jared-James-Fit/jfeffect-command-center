/**
 * Service opportunities in a meeting's notes (pure, tested in
 * competition-handling.test.ts): someone the coach agreed, or was asked, to
 * handle at a competition. Read from the meeting's checked analysis (its items,
 * quotes and summary), never a model: the athlete's name only when it was said
 * after "handle" / "handling" / "handler", the meet only when the meeting was
 * about one, and everything else listed as missing. Nothing here contacts
 * anyone; the coach decides what to send.
 */

export type MeetingItem = {
  kind?: string | null;
  text?: string | null;
  quote?: string | null;
  speaker?: string | null;
  basis?: string | null;
  due?: string | null;
};

export type HandlingOpportunity = {
  key: string;
  athleteName: string;
  referrer: { clientId: string; name: string };
  competition: { id: string | null; name: string | null; date: string | null; location: string | null } | null;
  /** the person who asked looks like the athlete's coach: a guess the athlete confirms */
  existingCoachGuess: string | null;
  evidence: Array<{ text: string; quote: string | null }>;
  /** what the meeting said someone would do */
  waitingOn: string[];
  missing: string[];
  followUpWhen: string | null;
};

const NOT_NAMES = new Set(
  [
    "the", "a", "an", "at", "in", "on", "her", "him", "his", "them", "their", "me", "you", "us", "it",
    "this", "that", "someone", "somebody", "everyone", "logistics", "attempts", "meet", "day",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "and", "or", "but", "if", "so", "both", "all", "same", "flight", "nationals", "provincials",
  ],
);

const NAME_PATTERNS: RegExp[] = [
  /\bhandl(?:e|ing)\s+(?:for\s+)?([A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)?)/g,
  /\bhandler\s+(?:for|to)\s+([A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)?)/g,
  /\b([A-Z][a-z]+)(?:'s|’s)\s+handler\b/g,
];

function namesIn(text: string, exclude: Set<string>): string[] {
  const out: string[] = [];
  for (const re of NAME_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // a second capitalised word that's a common word ("Ari At") isn't a surname
      const parts = m[1].replace(/['’]s$/, "").split(/\s+/);
      const kept: string[] = [];
      for (const p of parts) {
        if (NOT_NAMES.has(p.toLowerCase()) || exclude.has(p.toLowerCase())) break;
        kept.push(p);
      }
      if (kept.length) out.push(kept.join(" "));
    }
  }
  return out;
}

export function handlingOpportunities(input: {
  sessionId: string;
  referrer: { clientId: string; name: string; first: string };
  coachFirst?: string | null;
  analysis: { summary?: string | null; items?: MeetingItem[] | null; followUp?: { when?: string | null; why?: string | null } | null } | null;
  event?: { kind?: string | null; title?: string | null; date?: string | null; competitionId?: string | null; location?: string | null } | null;
  /** names already invited from this meeting (lowercase) */
  alreadyInvited?: string[];
}): HandlingOpportunity[] {
  const a = input.analysis;
  if (!a) return [];
  const exclude = new Set(
    [input.referrer.first, input.coachFirst ?? "", ...(input.referrer.name.split(/\s+/) ?? []), "jared", "cleo", "coach"]
      .map((x) => x.toLowerCase())
      .filter(Boolean),
  );
  const texts: Array<{ text: string; quote: string | null; item: MeetingItem | null }> = [];
  for (const it of a.items ?? []) {
    if (it?.text) texts.push({ text: it.text, quote: it.quote ?? null, item: it });
    if (it?.quote) texts.push({ text: it.quote, quote: it.quote, item: it });
  }
  if (a.summary) texts.push({ text: a.summary, quote: null, item: null });

  const counts = new Map<string, number>();
  for (const t of texts)
    for (const n of namesIn(t.text, exclude)) counts.set(n, (counts.get(n) ?? 0) + 1);
  if (!counts.size) return [];

  const already = new Set((input.alreadyInvited ?? []).map((x) => x.toLowerCase()));
  const out: HandlingOpportunity[] = [];
  // a full name beats its own first name ("Ari Chen" over "Ari")
  const names = [...counts.keys()].filter((n) => ![...counts.keys()].some((m) => m !== n && m.startsWith(`${n} `)));
  for (const name of names.sort((x, y) => (counts.get(y) ?? 0) - (counts.get(x) ?? 0))) {
    const first = name.split(" ")[0];
    if (already.has(name.toLowerCase()) || already.has(first.toLowerCase())) continue;
    const mentions = (s: string | null | undefined) => !!s && new RegExp(`\\b${first}\\b`).test(s);
    const evidence = texts
      .filter((t) => t.item && mentions(t.text) && t.text !== t.quote)
      .map((t) => ({ text: t.text, quote: t.quote }))
      .slice(0, 4);
    const waitingOn = (a.items ?? [])
      .filter((it) => /commitment/.test(String(it.kind ?? "")) && (mentions(it.text) || mentions(it.quote)))
      .map((it) => String(it.text))
      .slice(0, 3);
    const all = texts.map((t) => t.text).join("\n");
    const ref = input.referrer.first;
    const coachSignal =
      new RegExp(`\\b(her|his|their|my)\\s+(client|athlete|lifter)\\b`, "i").test(all) ||
      new RegExp(`\\b${ref}(?:'s|’s)\\s+(client|athlete|lifter)\\b`, "i").test(all) ||
      waitingOn.some((w) => new RegExp(`^${ref}\\b`).test(w) && /numbers|brief|scenario|attempt|program/i.test(w));
    const ev = input.event && input.event.kind === "competition" ? input.event : null;
    const missing = [
      name.includes(" ") ? null : "Last name",
      "Email or phone to send the link",
      "Weight class and bodyweight",
      waitingOn.length ? null : "Their numbers (recent lifts, targets)",
      ev ? null : "Which competition, and when",
      "Price (or no charge)",
    ].filter((x): x is string => !!x);
    out.push({
      key: `handling:${input.sessionId}:${name.toLowerCase()}`,
      athleteName: name,
      referrer: { clientId: input.referrer.clientId, name: input.referrer.name },
      competition: ev ? { id: ev.competitionId ?? null, name: ev.title ?? null, date: ev.date ?? null, location: ev.location ?? null } : null,
      existingCoachGuess: coachSignal ? input.referrer.name : null,
      evidence: evidence.length ? evidence : texts.filter((t) => mentions(t.text)).slice(0, 2).map((t) => ({ text: t.text, quote: t.quote })),
      waitingOn,
      missing,
      followUpWhen: a.followUp?.when ?? null,
    });
  }
  return out;
}

/** A note to the person who asked, for the coach to send if he wants (never sent by itself). */
export function referrerAsk(o: { referrerFirst: string; athleteFirst: string; meetName: string | null; url?: string | null }): string {
  const meet = o.meetName ? ` for ${o.meetName}` : "";
  return o.url
    ? `Hey ${o.referrerFirst}, here's ${o.athleteFirst}'s link${meet}. Can you send it to them? It asks for their meet details, numbers, warm-ups and rack heights, and I'll build the plan from there. ${o.url}`
    : `Hey ${o.referrerFirst}, when you get a sec send me ${o.athleteFirst}'s numbers and the scenarios you've got${meet}. I'll get their plan, warm-ups and timeline set up.`;
}
