/**
 * What an athlete reads of their coach's notes (Nov 18 2026): only what helps
 * them train today, said once.
 *
 * - Exercise notes the program generator wrote (`athleteNotes`, joined with
 *   " · ": the cue, "Progress: …", "Swap if needed: …") lose the app's own
 *   boilerplate: a progression rule with nothing to act on ("Progress: Double
 *   progression."), a "Week 1: …" line carried onto a later week, and the
 *   model explaining its programming ("Replacing DB Bench to overcome
 *   plateau."), which is for the coach. A note a coach typed is never touched.
 * - A day's notes that say exactly what last week's did fold to one line
 *   ("Same as last week"); when a sentence is new, that sentence leads.
 *
 * Pure: the generator (program-view.ts), the logger and the tests share it.
 * Nothing stored is ever rewritten; this only decides what's shown.
 */

const PART_SEP = " · ";

/** Lines the app itself once wrote into notes that were never true for long (Devin's cardio, Nov 11 2026). */
const APP_BOILERPLATE = [/\s*Your nutrition plan will adjust this when it's made\.?/gi];

/** A note in the generator's own format: its parts joined by " · ", with its own labels. */
export function isGeneratedNote(notes: string | null | undefined): boolean {
  return /(^|\s·\s)(Progress|Swap if needed): /.test(notes ?? "");
}

/**
 * Progression lines that tell the athlete nothing the card doesn't: a
 * method's name ("Double progression.", 340 of the live ones), "Add load if
 * RPE < target." (every RPE prescription means that), "Add reps." beside a rep
 * range. Anything else, with or without a number ("Hold a plate if reps are
 * easy.", "Hold load until top set moves up."), is an instruction and stays.
 */
const GENERIC_PROGRESSION = [
  /^(double|linear|wave|step|undulating|rpe[- ]based|autoregulated)\s+progression(\s*\((add|increase) (weight|load|reps)\))?\.?$/i,
  /^(add|increase) (load|weight) (if|when|once) (the )?rpe (is )?(<|below|under|less than|lower than) (the )?target\.?$/i,
  /^(add|increase) reps\.?$/i,
];

const genericSentence = (s: string) => GENERIC_PROGRESSION.some((re) => re.test(s.trim()));

/** A progression rule with nothing in it to act on (every sentence generic, or none). */
export function isGenericProgression(rule: string | null | undefined): boolean {
  const all = sentences(rule ?? "");
  return all.every((s) => genericSentence(s) || RATIONALE.test(s));
}

/** "Replacing DB Bench to overcome plateau." / "New addition for …": the model explaining its choices to the coach. */
const RATIONALE = /^(replac(ing|es|ed)|new addition|added (to|for|this)|swapp(ed|ing) (in|out|from)|chosen (to|for|because)|selected (to|for|because)|this replaces)\b/i;

/** Sentences, split only after a stop followed by a space (so "2.5 kg" and "RPE 7.5" stay whole), and at line breaks. */
function sentences(text: string): string[] {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "Week 1: …" on a week that isn't week 1 (a base note the generator repeated into every week). */
function staleWeekLine(sentence: string, week: number | null | undefined): boolean {
  if (week == null) return false;
  const m = /^week\s*(\d+)\s*[:\-–—]/i.exec(sentence);
  return !!m && Number(m[1]) !== week;
}

/**
 * The note an exercise card shows, or null when nothing is left worth showing.
 * A coach's own note comes back as written (only the app's boilerplate line
 * is ever taken out of it); a generated one loses what isn't for the athlete.
 */
export function exerciseNoteForAthlete(notes: string | null | undefined, week?: number | null): string | null {
  let text = (notes ?? "").trim();
  for (const re of APP_BOILERPLATE) text = text.replace(re, "").trim();
  if (!text) return null;
  return isGeneratedNote(text) ? cleanGeneratedNote(text, week) : text;
}

/** A note the generator is writing (or wrote): its parts without what isn't for the athlete, null when nothing's left. */
export function cleanGeneratedNote(notes: string | null | undefined, week?: number | null): string | null {
  const text = (notes ?? "").trim();
  if (!text) return null;
  const parts = text
    .split(PART_SEP)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const progress = /^Progress:\s*(.*)$/.exec(part);
      if (progress) {
        const kept = sentences(progress[1]).filter((s) => !genericSentence(s) && !RATIONALE.test(s) && !staleWeekLine(s, week));
        return kept.length ? `Progress: ${kept.join(" ")}` : "";
      }
      if (/^Swap if needed: /.test(part)) return part;
      return sentences(part)
        .filter((s) => !staleWeekLine(s, week) && !RATIONALE.test(s))
        .join(" ");
    })
    .filter(Boolean);
  const out = parts.join(PART_SEP).trim();
  return out || null;
}

/* ------------------------------------------------------------------ */
/*  A day's notes against last week's                                  */
/* ------------------------------------------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.!?\s]+$/, "").trim();

export type DayNoteView = {
  /** What shows before a tap. */
  lead: string;
  /** The rest, a tap away (the whole note when it's a repeat). */
  detail: string | null;
  /** "same": word for word last week's (folds to one line); "new": these sentences are new this week. */
  repeat: "same" | "new" | null;
};

/**
 * A day's notes as the athlete reads them, given the same workout's notes
 * last week (null when there were none or they weren't for the athlete). The
 * first paragraph leads and the rest is a tap away, as before; a note that's
 * word for word last week's is one line, and one with a new sentence or two
 * leads with those.
 */
export function dayNoteView(current: string | null | undefined, previous?: string | null): DayNoteView | null {
  const text = (current ?? "").trim();
  if (!text) return null;
  const [first, ...rest] = text.split(/\r?\n\s*\r?\n/);
  const plain: DayNoteView = { lead: first.trim(), detail: rest.join("\n\n").trim() || null, repeat: null };
  const before = (previous ?? "").trim();
  if (!before) return plain;
  const seen = new Set(sentences(before).map(norm));
  const all = sentences(text);
  const fresh = all.filter((s) => !seen.has(norm(s)));
  if (fresh.length === 0) return { lead: "", detail: text, repeat: "same" };
  if (fresh.length === all.length) return plain;
  return { lead: fresh.join(" "), detail: text, repeat: "new" };
}
