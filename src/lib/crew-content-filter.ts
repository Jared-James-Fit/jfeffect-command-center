/**
 * Crew's objectionable-content filter (App Review Guideline 1.2): one
 * deterministic word and phrase list for slurs, sexual content and threats,
 * checked on the server before a Crew post caption, comment, story text,
 * bio or message request is saved (`crew_text_verdict`, in
 * supabase/migrations/20270527109000_crew_ugc_safety.sql, holds the same lists and
 * the same steps; crew-content-filter.test.ts fails if the two drift apart).
 *
 * - `block`: refused with a short neutral message, nothing is saved.
 * - `flag`: saved, and put in the coach's moderation queue (Crew → Manage →
 *   Needs you) for a look.
 * - `ok`: everything else. Ordinary gym swearing is never flagged.
 *
 * Tolerant of case, accents, l33t letters (k1ll), stretching (kiiiill),
 * spacing and dots between letters (k y s, k.y.s) and zero-width characters.
 * Whole words only, so "class" never matches a three-letter word inside it.
 *
 * The terms are stored ROT13 ("category:term") so this public repository
 * doesn't spell the slurs out; `rot13` turns them back. To add a term, add its
 * ROT13 here AND to the matching array in the migration (or a newer one that
 * replaces `crew_text_verdict`), lower case, letters and single spaces only.
 * Photos and clips aren't screened here: they're report-based.
 */

export type CrewFilterCategory = "hate" | "sexual" | "violence" | "harassment" | "self_harm";
export type CrewTextVerdict =
  | { verdict: "ok" }
  | { verdict: "block" | "flag"; category: CrewFilterCategory; term: string };

/** Refused outright (ROT13, "category:term"). */
export const CREW_BLOCK_TERMS: readonly string[] = [
  "hate:avttre", "hate:avttref", "hate:avttn", "hate:avttnf", "hate:avttnm", "hate:fnaqavttre",
  "hate:snttbg", "hate:snttbgf", "hate:sntbg", "hate:snt", "hate:sntf", "hate:xvxr", "hate:xvxrf",
  "hate:fcvp", "hate:fcvpf", "hate:tbbx", "hate:tbbxf", "hate:jrgonpx",
  "hate:jrgonpxf", "hate:ornare", "hate:ornaref", "hate:enturnq", "hate:enturnqf", "hate:gbjryurnq",
  "hate:gbjryurnqf", "hate:genaal", "hate:genaavrf", "hate:ergneq", "hate:ergneqf", "hate:ergneqrq",
  "hate:cnxv", "hate:cnxvf", "hate:wvtnobb", "hate:cbepu zbaxrl", "hate:urvy uvgyre", "hate:juvgr cbjre",
  "hate:tnf gur wrjf", "sexual:cbeauho", "sexual:oybjwbo", "sexual:oybjwbof",
  "sexual:unaqwbo", "sexual:unaqwbof", "sexual:phzfubg", "sexual:tnatonat", "sexual:fraq ahqrf",
  "sexual:fraq zr ahqrf", "sexual:qvpx cvp", "sexual:qvpx cvpf", "sexual:encr lbh", "sexual:v jvyy encr",
  "violence:xvyy lbhefrys", "violence:xvyy hefrys", "violence:xvyy lbhe frys", "violence:xvyy lbhefryirf",
  "violence:xlf", "violence:ubcr lbh qvr", "violence:v ubcr lbh qvr",
  "violence:v jvyy xvyy lbh", "violence:vyy xvyy lbh", "violence:v jvyy svaq lbh", "violence:fubbg lbh", "violence:fgno lbh", "violence:fyvg lbhe guebng",
  "violence:unat lbhefrys", "violence:arpx lbhefrys", "violence:qevax oyrnpu",
];

/** Saved, but sent to the moderation queue (ROT13, "category:term"). */
export const CREW_FLAG_TERMS: readonly string[] = [
  "sexual:ahqrf", "sexual:cbea", "sexual:cbeab", "hate:puvax", "hate:puvaxf", "violence:tb qvr", "sexual:ubeal", "sexual:chffl", "sexual:pbpx", "sexual:qvpx", "sexual:qvpxf",
  "sexual:gvgf", "sexual:gvggvrf", "sexual:phz", "sexual:baylsnaf", "sexual:fyhg", "sexual:fyhgf",
  "sexual:juber", "sexual:juberf", "sexual:gubg", "sexual:zvys", "sexual:qvyqb", "sexual:frkgvat",
  "sexual:encr", "sexual:encrq", "sexual:encvfg", "harassment:phag", "harassment:phagf",
  "harassment:qvpxurnq", "harassment:sngnff", "harassment:sng nff", "harassment:sng cvt",
  "harassment:sng pbj", "harassment:htyl ovgpu", "harassment:fghcvq ovgpu", "harassment:qhzo ovgpu",
  "harassment:lbh ovgpu", "harassment:abobql yvxrf lbh", "harassment:lbher htyl", "harassment:lbh ner htyl",
  "harassment:lbher qvfthfgvat", "harassment:lbh ner qvfthfgvat", "harassment:gjng", "harassment:jnaxre",
  "hate:qlxr", "hate:qlxrf", "hate:ubzb", "hate:ubzbf", "hate:pbba", "hate:pbbaf", "hate:anmv", "hate:anmvf",
  "violence:xvyy lbh", "violence:xvyy h", "violence:orng lbh hc", "violence:chapu lbh", "violence:uheg lbh",
  "violence:zheqre lbh", "violence:oernx lbhe yrtf", "self_harm:xvyy zlfrys", "self_harm:xvyyvat zlfrys",
  "self_harm:jnag gb qvr", "self_harm:jnaan qvr", "self_harm:fhvpvqr", "self_harm:fhvpvqny",
  "self_harm:phg zlfrys", "self_harm:phggvat zlfrys", "self_harm:frys unez", "self_harm:raq zl yvsr",
  "self_harm:raq vg nyy", "self_harm:uheg zlfrys", "self_harm:fgneir zlfrys",
  "self_harm:znxr zlfrys guebj hc",
];

/** What the person sees when their words are refused (also the server's message). */
export const CREW_BLOCKED_MESSAGE = "This can't be posted. It goes against the Crew community rules.";

/** Report reason a filter category files under (community_reports.reason). */
export const CREW_FILTER_REASON: Record<CrewFilterCategory, string> = {
  hate: "hate",
  sexual: "nudity",
  violence: "violence",
  harassment: "harassment",
  self_harm: "self_harm",
};

export function rot13(s: string): string {
  return s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
}

const ACCENTS_FROM = "àáâãäåèéêëìíîïòóôõöùúûüýÿñç";
const ACCENTS_TO = "aaaaaaeeeeiiiiooooouuuuyync";
const LEET_FROM = "0134578@$!|";
const LEET_TO = "oieastbasii";

function translate(s: string, from: string, to: string): string {
  let out = "";
  for (const ch of s) {
    const i = from.indexOf(ch);
    out += i < 0 ? ch : (to[i] ?? "");
  }
  return out;
}

/** Every run of a doubled letter down to one ("kiiill" → "kil"). */
export function collapseRepeats(s: string): string {
  return s.replace(/([a-z])\1+/g, "$1");
}

/**
 * The words as the filter reads them: lower case, accents and l33t letters
 * turned into plain ones, apostrophes dropped ("you're" → "youre"), runs with
 * no letter dropped (set counts, weights) unless a lone l33t character, and
 * letters typed one at a time joined back up ("k y s" → "kys").
 */
export function crewFilterTokens(text: string): string[] {
  let s = translate(text.toLowerCase(), ACCENTS_FROM, ACCENTS_TO);
  s = s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/['’‘`]/g, "");
  const runs = s.split(/[^a-z0-9@$!|]+/);
  const words: string[] = [];
  for (const raw of runs) {
    const run = raw.replace(/^[!|]+|[!|]+$/g, "");
    // a run with no letter (a set count, a weight) is dropped, unless it's one l33t character between spaced letters ("f 4 g")
    if (!/[a-z]/.test(run) && !(run.length === 1 && LEET_FROM.includes(run))) continue;
    words.push(translate(run, LEET_FROM, LEET_TO));
  }
  const out: string[] = [];
  let letters = "";
  for (const w of words) {
    if (w.length === 1) {
      letters += w;
      continue;
    }
    if (letters) out.push(letters);
    letters = "";
    out.push(w);
  }
  if (letters) out.push(letters);
  return out;
}

function match(terms: readonly string[], raw: string, collapsed: string, stretched: string): { category: CrewFilterCategory; term: string } | null {
  for (const entry of terms) {
    const at = entry.indexOf(":");
    const category = entry.slice(0, at) as CrewFilterCategory;
    const term = rot13(entry.slice(at + 1));
    const hit = raw.includes(` ${term} `) || (term.includes(" ") ? collapsed : stretched).includes(` ${collapseRepeats(term)} `);
    if (hit) return { category, term };
  }
  return null;
}

/**
 * The verdict on some words. A single word matches as typed, or stretched
 * ("kiiiill") once its doubled letters are folded; a phrase matches with
 * every word's doubled letters folded. Blocked terms win over flagged ones.
 */
export function crewTextVerdict(text: string | null | undefined): CrewTextVerdict {
  if (!text || !text.trim()) return { verdict: "ok" };
  const tokens = crewFilterTokens(text);
  if (!tokens.length) return { verdict: "ok" };
  const raw = ` ${tokens.join(" ")} `;
  const collapsed = ` ${tokens.map(collapseRepeats).join(" ")} `;
  const stretched = ` ${tokens.filter((t) => /([a-z])\1\1/.test(t)).map(collapseRepeats).join(" ")} `;
  const block = match(CREW_BLOCK_TERMS, raw, collapsed, stretched);
  if (block) return { verdict: "block", ...block };
  const flag = match(CREW_FLAG_TERMS, raw, collapsed, stretched);
  if (flag) return { verdict: "flag", ...flag };
  return { verdict: "ok" };
}

/** True when a database error is the filter refusing the words. */
export function isCrewFilterError(e: unknown): boolean {
  const err = e as { hint?: string; message?: string } | null;
  return err?.hint === "crew_filter" || /goes against the Crew community rules/.test(err?.message ?? "");
}
