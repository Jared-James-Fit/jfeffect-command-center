/**
 * Words and numbers as every JF Effect PDF writes them (Nov 22 2026).
 *
 * The PDFs use the PDF standard Helvetica (no font file to embed, so the
 * files stay small and every word is searchable and selectable). It draws
 * WinAnsi only: — – • · × … ' " ° ± é ü € ™ print, while →, ≥, ≤, ✓, −, ≈,
 * primes and emoji come out as garbage (checked by rendering). `pdfText`
 * turns those into what the font can draw, so nothing is ever silently wrong
 * on paper. Pure: no jsPDF here, so the tests read it directly.
 */

/** Text the PDF font can draw: the symbols it lacks as their plain words, everything else outside WinAnsi dropped. */
export function pdfText(s: unknown): string {
  if (s == null) return "";
  return (
    String(s)
      .replace(/\r\n?/g, "\n")
      // "140 → 150", "Week 1→3": "to" reads right between numbers and words alike
      .replace(/\s*(→|⟶|➝|➔)\s*/g, " to ")
      .replace(/←/g, "<-")
      .replace(/≥/g, ">=")
      .replace(/≤/g, "<=")
      .replace(/≈/g, "~")
      .replace(/[\u2212\u2010\u2011]/g, "-")
      .replace(/[\u2032\u02B9]/g, "'")
      .replace(/[\u2033\u02BA]/g, '"')
      .replace(/[\u2713\u2714\u2705]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/[\u2009\u200A\u202F]/g, " ")
      // what WinAnsi has beyond Latin-1, which the font draws (checked)
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF–—‘’‚“”„†‡•…‰‹›€™ŒœŠšŸŽžƒˆ˜]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +\n/g, "\n")
      .trim()
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A stored date as the calendar day it names. "2026-06-02" is that day, never
 * `new Date("2026-06-02")` (UTC midnight, the day before in Manitoba); a full
 * timestamp is read in the device's own zone.
 */
export function pdfDay(
  value: string | Date | null | undefined,
): { y: number; m: number; d: number; dow: number } | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth(), d: value.getDate(), dow: value.getDay() };
  }
  const s = String(value);
  const only = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10));
  if (only && s.length <= 10) {
    const y = Number(only[1]);
    const m = Number(only[2]) - 1;
    const d = Number(only[3]);
    return { y, m, d, dow: new Date(y, m, d).getDay() };
  }
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate(), dow: t.getDay() };
}

/** "Nov 3, 2026"; "Nov 3" when `year` is "auto" and it's this year; "Mon, Nov 3" with `weekday`. */
export function pdfDate(
  value: string | Date | null | undefined,
  opts: { year?: "always" | "auto" | "never"; weekday?: boolean; today?: Date } = {},
): string {
  const p = pdfDay(value);
  if (!p) return "";
  const thisYear = (opts.today ?? new Date()).getFullYear();
  const year = opts.year === "never" ? false : opts.year === "auto" ? p.y !== thisYear : true;
  return `${opts.weekday ? `${WEEKDAYS[p.dow]}, ` : ""}${MONTHS[p.m]} ${p.d}${year ? `, ${p.y}` : ""}`;
}

/** "November 22, 2026". */
export function pdfLongDate(value: string | Date | null | undefined): string {
  const p = pdfDay(value);
  return p ? `${LONG_MONTHS[p.m]} ${p.d}, ${p.y}` : "";
}

/** "Oct 6 – 12, 2026", "Sep 29 – Oct 5, 2026", "Dec 29, 2025 – Jan 4, 2026"; one end missing: "From Oct 6, 2026". */
export function pdfRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  const a = pdfDay(start);
  const b = pdfDay(end);
  if (a && b) {
    if (a.y !== b.y) return `${MONTHS[a.m]} ${a.d}, ${a.y} – ${MONTHS[b.m]} ${b.d}, ${b.y}`;
    if (a.m === b.m && a.d === b.d) return `${MONTHS[a.m]} ${a.d}, ${a.y}`;
    if (a.m === b.m) return `${MONTHS[a.m]} ${a.d} – ${b.d}, ${b.y}`;
    return `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}, ${b.y}`;
  }
  if (a) return `From ${MONTHS[a.m]} ${a.d}, ${a.y}`;
  if (b) return `Until ${MONTHS[b.m]} ${b.d}, ${b.y}`;
  return "";
}

/** A local calendar date as "YYYY-MM-DD". */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 1234.5 → "1,234.5"; whole numbers without decimals. */
export function pdfNumber(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return "";
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return r.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/** 45 → "45 s", 180 → "3 min", 150 → "2:30 min", 5400 → "1:30 h". */
export function pdfDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return "";
  const t = Math.round(Number(seconds));
  if (t < 60) return `${t} s`;
  if (t >= 3600) {
    const h = Math.floor(t / 3600);
    const m = Math.round((t % 3600) / 60);
    return m ? `${h}:${String(m).padStart(2, "0")} h` : `${h} h`;
  }
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s ? `${m}:${String(s).padStart(2, "0")} min` : `${m} min`;
}

/** "1 workout", "3 workouts". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * Every PDF's file name, one convention: who it's about, what it is, what
 * part, the day it was made. "jared-mcintyre-training-program-2026-11-22.pdf",
 * "jared-mcintyre-training-report-block-2-volume-2026-11-22.pdf".
 */
export function pdfFileName(p: {
  person?: string | null;
  document: string;
  detail?: string | null;
  date?: Date;
}): string {
  const head = [p.person ?? "", p.document, p.detail ?? ""]
    .map((x) => slug(String(x)))
    .filter(Boolean)
    .join("-");
  // a long block name never pushes the date off the end (cut at a word, not mid-word)
  const kept = head.length > 100 ? head.slice(0, 100).replace(/-[^-]*$/, "") : head;
  return `${[kept || "jf-effect", isoDay(p.date ?? new Date())].join("-")}.pdf`;
}
