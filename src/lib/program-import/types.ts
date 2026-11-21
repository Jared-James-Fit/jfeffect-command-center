/**
 * A program read from someone's own file (the importer, Nov 21 2026), before
 * it's a plan: what the file says, in the file's own words, with every value
 * the reader wasn't sure of marked. Pure types shared by the phone, the
 * server and the tests.
 */

/** What was given: typed or pasted text, or a file the phone or the server reads. */
export type ImportSourceKind = "text" | "csv" | "xlsx" | "docx" | "pdf" | "image";

/** One sheet of a spreadsheet (or a table in a document): rows of cell text, as shown. */
export type SourceSheet = { name: string; rows: string[][] };

/**
 * What the phone read out of a file, ready to parse: plain text always
 * (`text`, what an AI reads and what grounding is checked against), and the
 * sheets when the file had tables.
 */
export type SourceDoc = {
  kind: ImportSourceKind;
  name: string;
  text: string;
  sheets?: SourceSheet[];
};

export type WeightUnit = "kg" | "lb";

export type ImportedExercise = {
  /** As the file names it ("Comp Squat", "DB RDL"); matched to the library on the phone. */
  name: string;
  sets: number | null;
  /** "5", "8-10", "AMRAP", "5+"… as written. */
  reps: string | null;
  load: number | null;
  unit: WeightUnit | null;
  pct: number | null;
  pct_of: "1rm" | "top_set" | null;
  rpe: string | null;
  rir: string | null;
  tempo: string | null;
  rest_seconds: number | null;
  /** A superset / circuit label ("A1", "Superset B"). */
  group: string | null;
  /** A velocity target as written ("0.6 m/s", "0.8–1.0 m/s"). */
  velocity: string | null;
  notes: string | null;
  /** Where it came from: the line or row it was read from. */
  src: string | null;
  /** What the reader wasn't sure of, in words (null when it was sure). */
  unsure: string | null;
};

export type ImportedDay = { title: string | null; notes: string | null; exercises: ImportedExercise[] };
export type ImportedWeek = {
  label: string | null;
  deload: boolean;
  notes: string | null;
  days: ImportedDay[];
  /** Written once for a range of weeks ("Weeks 1-4"): how many it covers (expanded by weeks.ts). */
  repeat?: number | null;
};
export type ImportedBlock = { name: string | null; weeks: ImportedWeek[] };

export type ImportedProgram = {
  title: string | null;
  /** Instructions for the whole program, as written. */
  notes: string | null;
  /** The unit the file's weights are in, when it says. */
  unit: WeightUnit | null;
  blocks: ImportedBlock[];
  /** Progression written in words ("add 5 lb a week"): kept as words, never turned into numbers silently. */
  progression: string[];
  /** Things the reader couldn't place, said where they are. */
  issues: { where: string; text: string }[];
};

/** How the program was read: by the parser (free, instant) or by AI (credits). */
export type ImportMethod = "parsed" | "ai";

/** Where a flag points in the plan (indexes), when it points somewhere. */
export type FlagAt = { b: number; w: number; d: number; e?: number };

export type ImportFlag = {
  /** "fix": saving waits for it; "check": worth a look; "info": what was done. */
  level: "fix" | "check" | "info";
  code: string;
  text: string;
  at?: FlagAt;
};
