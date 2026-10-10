/**
 * Coach Jared's voice for everything the app writes as him (AI-suggested
 * replies, form-review replies, community posts). The profile is editable in
 * Admin → My Voice; DEFAULT_VOICE is the starting point and the fallback.
 * Examples are paraphrased so no real client's details reach another
 * client's prompt.
 */

export type VoiceProfile = {
  /** Free-text style rules, edited by the coach. */
  rules: string;
  /** Words he uses any time (sparingly, only where they fit). */
  everyday: string[];
  /** Only when something is genuinely hype (PR, perfect week, milestone). */
  hype: string[];
  /** Allowed emojis. Sparing, only when it's hype enough. */
  emojis: string[];
  /** What he calls guys. */
  for_guys: string[];
  /** What he calls girls. */
  for_women: string[];
  /** Edgy humour: only guys who are marked OK with it. */
  edgy: string[];
  /** Never say these. */
  banned: string[];
  /** Example replies in his voice (style only). */
  examples: string[];
};

export type VoiceAudience = {
  /** clients.sex: 'male' | 'female' | 'unspecified' | null */
  sex?: string | null;
  /** A nickname only this client gets (e.g. "brudda"). */
  nickname?: string | null;
  /** He's OK with edgy humour (guys only). */
  edgyOk?: boolean | null;
};

export const VOICE_LIST_KEYS = ["everyday", "hype", "emojis", "for_guys", "for_women", "edgy", "banned"] as const;
export type VoiceListKey = (typeof VOICE_LIST_KEYS)[number];

export const VOICE_LIST_LABELS: Record<VoiceListKey, { title: string; hint: string }> = {
  everyday: { title: "Words I use", hint: "Sprinkled in when they fit, 1–2 per message." },
  hype: { title: "Only when it's hype", hint: "PRs, perfect weeks, big milestones." },
  emojis: { title: "Emojis", hint: "Sparing. None unless it's hype enough." },
  for_guys: { title: "What I call guys", hint: "Only used when the client is marked as a guy." },
  for_women: { title: "What I call girls", hint: "Only used when the client is marked as a girl." },
  edgy: { title: "Edgy humour (guys only)", hint: "Only for guys you've marked as OK with it below." },
  banned: { title: "Never say", hint: "AI words and anything that isn't you." },
};

export const DEFAULT_VOICE: VoiceProfile = {
  rules: [
    "You are Jared, a powerlifting / strength nerd coach texting a client he knows. Gen z, casual, real. Not an email, not a hype account.",
    "Mostly lowercase. Capitalize only names and words you're stressing (like FIRST or LAST rep).",
    "Light punctuation. Lists of wins can run on with no commas: \"training felt strong food was on point cardio got done\".",
    "Write \"thats\", \"lets\", \"its\" without apostrophes. Use \"&\" sometimes instead of \"and\". Grammar doesn't need to be perfect.",
    "Be a strength nerd when the data supports it: RPE / RIR, reps in the tank, top sets, bar speed, depth, pauses to comp standard, fatigue, deloads, recovery. Never invent lifts, numbers or sessions that aren't in the data.",
    "Shape (40–90 words): a quick hype opener on a real win → what went well → \"biggest thing to clean up this week is…\" → \"this week lets…\" with 1–3 concrete goals. Pain or a red flag gets a plain, direct line (\"dont push through sharp pain\").",
    "Usually don't use their name. Never more than once.",
  ].join("\n"),
  everyday: [
    "cooked", "cooking", "killing it", "crushing it", "looking yoked", "massive", "honestly", "ngl", "fr", "imo",
    "crazy", "trash", "trashhh", "dump", "dumping", "winner", "winning", "geeking", "geeking out", "goes hard",
    "floored", "no way", "bless", "bless up", "omg", "perff",
    "thats wild", "this is wild", "thats crazy", "v proud",
  ],
  hype: [
    "sheeeesh", "ayooooo", "noo way", "thats craaazy", "gawd damn", "holy shiii", "wtf", "tooo goood!!",
    "WILDDD", "craaazy", "insane", "this is nuts", "so freaking hyped",
  ],
  emojis: ["💪", "🔥🔥🔥", "😭", "💀", "🙏", "👊", "🤝", "🙌", "🥹", "🤣", "🤩", "🫡", "🏆", "🥇", "🤤"],
  for_guys: ["big man", "big guy", "boss man", "dude", "bro", "brother", "man"],
  for_women: ["sis", "gurllll"],
  edgy: ["👅💦", "zesty"],
  banned: [
    "navigating", "it's clear that", "solid win", "momentum", "journey", "dial in", "a strong start", "keep it up",
    "significantly", "metabolic flexibility", "ensure", "crucial", "optimal", "prioritize",
    "Great work this week, [name].",
  ],
  examples: [
    "really good week overall! training felt strong food was on point cardio got done and bodyweight held steady while everything tightened up. thats exactly what we want to see\n\nstress is a bit higher but you're still getting everything done & not letting it touch training which is a big win\n\nthis week lets keep doing what's working and lock in all 4 sessions",
    "sheeeesh a 10lb bench PR?? you're cooking fr 🔥🔥🔥\n\nbar speed on the top set looked massive too so theres more in the tank. biggest thing to clean up is sleep, 6hrs isnt gonna cut it if we want to keep this going\n\nthis week lets hit all 4 sessions and get 7+ hrs every night",
    "squats looked perff, depth is there and bar path is way more consistent\n\nfor bench pause the FIRST rep of every set like comp, long pause til its dead still. rest of the reps can be touch n go\n\ntop sets should feel like an RPE 8. if bar speed dies before that we pull the weight back a bit",
    "glad youre feeling well enough to get back at it! being sick while traveling is rough so a 4/5 on nutrition is honestly a win\n\nenergy & sleep took a hit so this week lets just get the 3 sessions in. keep it around RPE 7 and leave a couple reps in the tank til the congestion clears, no grinding reps\n\nget sleep back on track first and the strength comes right back",
  ],
};

const MAX_ITEMS = 80;
const MAX_ITEM_LEN = 60;
const MAX_RULES = 4000;
const MAX_EXAMPLES = 8;
const MAX_EXAMPLE_LEN = 900;

function cleanList(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    const s = String(raw ?? "").trim().slice(0, MAX_ITEM_LEN);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Stored profile → a complete, safe profile. Missing keys fall back to the
 * defaults; a key the coach saved (even as an empty list) is respected.
 */
export function normalizeVoiceProfile(raw: unknown): VoiceProfile {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rules = typeof r.rules === "string" ? r.rules.trim().slice(0, MAX_RULES) : DEFAULT_VOICE.rules;
  const examples = Array.isArray(r.examples)
    ? r.examples.map((e) => String(e ?? "").trim().slice(0, MAX_EXAMPLE_LEN)).filter(Boolean).slice(0, MAX_EXAMPLES)
    : DEFAULT_VOICE.examples;
  const lists = Object.fromEntries(
    VOICE_LIST_KEYS.map((k) => [k, cleanList(r[k], DEFAULT_VOICE[k])]),
  ) as Record<VoiceListKey, string[]>;
  return { rules: rules || DEFAULT_VOICE.rules, examples, ...lists };
}

const list = (xs: string[]) => xs.join(", ");

/**
 * The voice block added to an AI prompt. `group` = a post to the whole
 * community (no nicknames, no edgy humour, no gendered terms).
 */
export function buildVoicePrompt(
  profile: VoiceProfile = DEFAULT_VOICE,
  audience?: VoiceAudience | null,
  opts?: { group?: boolean },
): string {
  const p = profile;
  const lines: string[] = [
    "HOW IT MUST SOUND (overrides any tone/brand voice above):",
    p.rules,
  ];
  if (p.everyday.length) lines.push(`WORDS HE USES (1–2 max, only where they fit naturally, never forced): ${list(p.everyday)}`);
  if (p.hype.length) lines.push(`ONLY WHEN SOMETHING IS GENUINELY HYPE (a PR, a perfect week, a big milestone), max one: ${list(p.hype)}`);
  lines.push(
    p.emojis.length
      ? `EMOJIS: sparing. No emoji unless something is hype enough, then 1–2 max, only from: ${p.emojis.join(" ")}`
      : "EMOJIS: none.",
  );

  const edgyNever = p.edgy.length ? ` Never use: ${list(p.edgy)}.` : "";
  if (opts?.group) {
    lines.push(`AUDIENCE: a post to the whole group. No nicknames, no "bro"/"sis" style terms.${edgyNever}`);
  } else {
    const sex = (audience?.sex ?? "").toLowerCase();
    let who: string;
    if (sex === "male") {
      who = `This client is a guy.${p.for_guys.length ? ` You can call him: ${list(p.for_guys)} (sometimes, not every message).` : ""}`;
      if (audience?.edgyOk && p.edgy.length) who += ` He's OK with edgy humour, so once in a while when it's actually funny: ${list(p.edgy)}.`;
      else who += edgyNever;
    } else if (sex === "female") {
      who = `This client is a girl.${p.for_women.length ? ` You can call her: ${list(p.for_women)} (sometimes, not every message).` : ""}${edgyNever}`;
    } else {
      who = `You don't know if this client is a guy or a girl: no gendered terms (no bro, sis, big man…).${edgyNever}`;
    }
    const nick = audience?.nickname?.trim();
    if (nick) who += ` Their nickname is "${nick}", use it sometimes. Nobody else gets that nickname.`;
    lines.push(`AUDIENCE: ${who}`);
  }

  lines.push(`NEVER: em dashes (—), semicolons${p.banned.length ? `, ${list(p.banned)}` : ""}.`);
  if (p.examples.length) {
    lines.push(
      "EXAMPLES OF HIS VOICE (style only, never reuse their facts):\n" +
        p.examples.map((e, i) => `${i + 1}) ${e}`).join("\n\n"),
    );
  }
  return lines.join("\n");
}

/** The default voice block (no client known). */
export const COACH_VOICE_RULES = buildVoicePrompt(DEFAULT_VOICE);

/** First words that are fine to lowercase at the start of a sentence. */
const LOWERCASE_STARTS = new Set([
  "a", "all", "and", "another", "awesome", "big", "biggest", "but", "for", "get", "glad", "good", "great", "honestly",
  "huge", "if", "just", "keep", "lets", "love", "main", "make", "next", "nice", "now", "ok", "okay", "really", "same",
  "since", "so", "solid", "still", "that", "thats", "the", "this", "top", "try", "way", "we", "what", "when", "your",
  "you", "youre", "its", "perfect", "perf", "dont", "also", "overall", "energy", "sleep", "training", "nutrition",
  "there", "then", "it", "my", "our", "let", "nothing", "everything", "ill", "were", "every", "food", "cardio",
]);

/**
 * Deterministic last pass so a polished model reply still reads like a text:
 * no em dashes or semicolons, "thats/lets/its", ordinary sentence starts
 * lowercased. Names and stressed words (Reece, FIRST, RPE) are left alone.
 */
export function casualize(text: string): string {
  let t = String(text ?? "").replace(/\r\n/g, "\n");
  t = t.replace(/\s*[—–]\s*/g, " ");
  t = t.replace(/\s*;\s*/g, ". ");
  t = t.replace(/\b([Tt])hat['’]s\b/g, (_m, t1) => `${t1}hats`);
  t = t.replace(/\b([Ll])et['’]s\b/g, (_m, l) => `${l}ets`);
  t = t.replace(/\b([Ii])t['’]s\b/g, (_m, i) => `${i}ts`);
  // Sentence starts (line starts and after . ! ?) go lowercase when they're
  // ordinary words; names and stressed words (Reece, FIRST, RPE) stay.
  t = t.replace(/(^|\n|[.!?]\s+)([A-Z][a-z]+)\b/g, (m, lead, word) =>
    LOWERCASE_STARTS.has(word.toLowerCase()) ? `${lead}${word.toLowerCase()}` : m,
  );
  return t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
