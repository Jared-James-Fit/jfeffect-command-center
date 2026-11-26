/**
 * The rules a virtual Crew account's name is held to, written once here and copied into the
 * database by the generated migration (names-sql.ts), so the admin page's instant hint and the
 * database's refusal say the same thing. Pure; virtual-account-names.test.ts runs every case in
 * PLACEHOLDER_CASES here, and supabase/tests/virtual-names runs the same cases against the SQL.
 *
 * A name is a placeholder when it reads as one: John / Jon / Jane Doe and the other stock names,
 * a word like "Test", "User" or "Demo", a bot's word ("Bot", "AI", "Virtual", "Cleo"), a word
 * that could pass for staff ("Coach", "Admin", "JF Effect"), numbers, initials, keyboard mashes,
 * or the same word twice.
 */

const FOLD_PAIRS =
  "àa áa âa ãa äa åa āa ăa ąa çc ćc čc ďd đd èe ée êe ëe ēe ėe ęe ěe ìi íi îi ïi īi įi ıi ñn ńn ňn " +
  "òo óo ôo õo öo øo ōo őo ùu úu ûu üu ūu ůu űu ųu ýy ÿy źz żz žz śs šs şs ğg łl ţt ťt";

const foldPairs = FOLD_PAIRS.split(" ").flatMap((p) => {
  const [from, to] = [p.charAt(0), p.charAt(1)];
  const up = from.toUpperCase();
  return up.length === 1 && up !== from && !/[A-Z]/.test(up)
    ? [
        [from, to],
        [up, to],
      ]
    : [[from, to]];
});

/** The accented letters folded to plain ones, both cases: the same table the database's translate() uses. */
export const FOLD_FROM = foldPairs.map(([f]) => f).join("");
export const FOLD_TO = foldPairs.map(([, t]) => t).join("");
const FOLD_MAP = new Map(foldPairs.map(([f, t]) => [f, t] as const));

/**
 * Lower case, accents off, apostrophes dropped, anything else that isn't a letter a space. Step
 * for step what public.virtual_name_fold does, so a name folds the same on both sides.
 */
export function foldName(s: string | null | undefined): string {
  return Array.from(String(s ?? ""))
    .map((c) => FOLD_MAP.get(c) ?? c)
    .join("")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/['’ʼ`]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** Stock placeholder names, folded. */
export const PLACEHOLDER_FULL = [
  "john doe",
  "jon doe",
  "jane doe",
  "baby doe",
  "john roe",
  "jane roe",
  "richard roe",
  "john smith",
  "jane smith",
  "joe bloggs",
  "fred bloggs",
  "joe schmoe",
  "joe shmoe",
  "joe blow",
  "average joe",
  "john q public",
  "john public",
  "jane public",
  "first last",
  "firstname lastname",
  "first name last name",
  "name surname",
  "given name family name",
  "lorem ipsum",
  "foo bar",
  "real person",
  "fake name",
  "your name",
  "full name",
] as const;

/** Words that make a name read as something other than a person, by what they read as. */
export const PLACEHOLDER_WORDS = {
  placeholder: [
    "test",
    "tester",
    "testing",
    "tst",
    "demo",
    "sample",
    "example",
    "placeholder",
    "dummy",
    "fake",
    "temp",
    "tmp",
    "default",
    "unknown",
    "anonymous",
    "anon",
    "null",
    "undefined",
    "none",
    "nobody",
    "noname",
    "nil",
    "lorem",
    "ipsum",
    "foo",
    "foobar",
    "baz",
    "qux",
    "qa",
    "user",
    "username",
    "guest",
    "person",
    "someone",
    "somebody",
    "name",
    "firstname",
    "lastname",
    "surname",
    "doe",
    "bloggs",
    "schmoe",
    "shmoe",
    "blah",
    "random",
    "untitled",
    "unnamed",
    "member",
    "account",
    "profile",
    "persona",
  ],
  bot: [
    "bot",
    "bots",
    "robot",
    "ai",
    "npc",
    "android",
    "cyborg",
    "virtual",
    "automated",
    "auto",
    "generated",
    "generic",
    "avatar",
    "crawler",
    "spam",
    "spambot",
    "chatbot",
    "gpt",
    "cleo",
    "algorithm",
    "synthetic",
  ],
  staff: [
    "coach",
    "trainer",
    "staff",
    "admin",
    "administrator",
    "support",
    "team",
    "official",
    "moderator",
    "mod",
    "jf",
    "jfeffect",
    "helpdesk",
    "system",
    "owner",
    "crew",
    "athlete",
    "lifter",
    "gymrat",
  ],
  mash: [
    "asdf",
    "asdfgh",
    "qwer",
    "qwerty",
    "zxcv",
    "hjkl",
    "abc",
    "abcd",
    "xyz",
    "xxx",
    "aaa",
    "zzz",
  ],
} as const;

export type PlaceholderKind = keyof typeof PLACEHOLDER_WORDS;

const WORD_KIND = new Map<string, PlaceholderKind>(
  (Object.keys(PLACEHOLDER_WORDS) as PlaceholderKind[]).flatMap((k) =>
    PLACEHOLDER_WORDS[k].map((w) => [w, k] as const),
  ),
);

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** The words the reasons quote, word by word, the way the database says them (initcap). */
export function placeholderWordReason(word: string, kind: PlaceholderKind): string {
  switch (kind) {
    case "placeholder":
      return `"${cap(word)}" reads as a placeholder`;
    case "bot":
      return `"${cap(word)}" reads like a bot's name`;
    case "staff":
      return `"${cap(word)}" could be mistaken for JF Effect staff`;
    default:
      return "That doesn't read like a real name";
  }
}

export const REASONS = {
  noFirst: "Add a first name",
  digits: "Names with numbers read as placeholders",
  stock: "That's a placeholder name",
  mash: "That doesn't read like a real name",
  initials: "Use a full first and last name, not initials",
  same: "First and last name are the same",
} as const;

/** Why this name reads as a placeholder, a bot or staff, or null when it reads as a person's. */
export function placeholderReason(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  const rawFirst = String(first ?? "").trim();
  const rawLast = String(last ?? "").trim();
  const f = foldName(rawFirst);
  const l = foldName(rawLast);
  if (!f) return REASONS.noFirst;
  if (/[0-9]/.test(rawFirst) || /[0-9]/.test(rawLast)) return REASONS.digits;
  const full = l ? `${f} ${l}` : f;
  if ((PLACEHOLDER_FULL as readonly string[]).includes(full)) return REASONS.stock;
  const tokens = full.split(" ");
  for (const t of tokens) {
    const kind = WORD_KIND.get(t);
    if (kind) return placeholderWordReason(t, kind);
    if (/^(.)\1+$/.test(t)) return REASONS.mash;
  }
  if (tokens.some((t) => t.length === 1)) return REASONS.initials;
  if (l && f.replace(/ /g, "") === l.replace(/ /g, "")) return REASONS.same;
  return null;
}

/** True when a username reads as a placeholder, a bot or staff (split on dots, underscores, digits). */
export function usernameReadsAsPlaceholder(username: string | null | undefined): boolean {
  const parts = String(username ?? "")
    .toLowerCase()
    .split(/[._0-9]+/)
    .filter(Boolean);
  if (!parts.length) return true;
  const joined = parts.join(" ");
  if ((PLACEHOLDER_FULL as readonly string[]).includes(joined)) return true;
  return parts.some(
    (p) => WORD_KIND.has(p) || /^(.)\1+$/.test(p) || /^(testuser|user|test|bot|demo)/.test(p),
  );
}

/**
 * The cases both implementations must agree on: [first, last, reads as a placeholder?].
 * supabase/tests/virtual-names/cases.sql is generated from this list.
 */
export const PLACEHOLDER_CASES: Array<[string, string, boolean]> = [
  ["Jon", "Doe", true],
  ["John", "Doe", true],
  ["Jane", "Doe", true],
  ["JANE", "DOE", true],
  ["Emily", "Doe", true],
  ["John", "Smith", true],
  ["Joe", "Bloggs", true],
  ["Test", "User", true],
  ["Test", "Account", true],
  ["User", "4821", true],
  ["Athlete", "3", true],
  ["Crew", "Member", true],
  ["Demo", "Member", true],
  ["Lift", "Bot", true],
  ["Virtual", "Lifter", true],
  ["Cleo", "Walsh", true],
  ["AI", "Coach", true],
  ["Coach", "Mike", true],
  ["Jf", "Effect", true],
  ["Asdf", "Qwerty", true],
  ["Aaa", "Bbb", true],
  ["J", "D", true],
  ["J.", "Mitchell", true],
  ["Jordan", "Jordan", true],
  ["Lorem", "Ipsum", true],
  ["First", "Last", true],
  ["", "Bennett", true],
  ["Ethan", "Mitchell", false],
  ["Ryan", "Bennett", false],
  ["Marcus", "Reid", false],
  ["Daniel", "Foster", false],
  ["Noah", "Sullivan", false],
  ["Alyssa", "Morgan", false],
  ["Natalie", "Brooks", false],
  ["Sophia", "Reyes", false],
  ["Vanessa", "Cruz", false],
  ["Emily", "Parker", false],
  ["Diego", "Marín", false],
  ["Marie-Ève", "Côté", false],
  ["Liam", "O'Brien", false],
  ["Kristine", "Dela Cruz", false],
  ["Sanne", "de Vries", false],
  ["Ji-woo", "Kim", false],
  ["Harpreet", "Kaur", false],
  ["Chinedu", "Okafor", false],
  ["Yusuf", "Haddad", false],
  ["Maya", "Okafor", false],
  ["Sam", "Whitford", false],
];
