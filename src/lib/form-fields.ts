/**
 * The richer native-form fields (pure, tested), shared by the client's form,
 * the coach's answer views and the competition plan:
 *   competitions: pick meet levels, each with optional name, date, place,
 *     federation, registered and qualified ("None" stands alone);
 *   ranking: put items in order, most important first;
 *   options from another question: a choice or ranking whose items are the
 *     meets picked earlier (`validation.options_from`);
 *   weight classes grouped by Men's / Women's (`validation.group_prefixes`);
 *   age classes the athlete is eligible for from their birth year.
 */

export type MeetEntry = {
  id: string;
  level: string;
  name?: string | null;
  date?: string | null;
  location?: string | null;
  federation?: string | null;
  registered?: boolean | null;
  qualified?: boolean | null;
  /** "None, I'm not competing". */
  none?: boolean;
};

export type RankItem = { key: string; label: string };

const str = (v: unknown, max = 120): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};
const bool = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);

/** A competitions answer as stored (value_json), cleaned. */
export function readMeets(value: unknown): MeetEntry[] {
  if (!Array.isArray(value)) return [];
  const out: MeetEntry[] = [];
  for (const [i, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const level = str(r.level, 80);
    if (!level) continue;
    const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    out.push({
      id: str(r.id, 64) ?? `m${i}`,
      level,
      name: str(r.name),
      date,
      location: str(r.location),
      federation: str(r.federation, 40),
      registered: bool(r.registered),
      qualified: bool(r.qualified),
      ...(r.none === true ? { none: true } : {}),
    });
  }
  // "None" stands alone.
  return out.some((m) => m.none) ? out.filter((m) => m.none).slice(0, 1) : out.slice(0, 20);
}

/** Pick or unpick a level. "None" clears everything else; anything else clears "None". */
export function toggleMeetLevel(
  meets: MeetEntry[],
  level: string,
  noneLabel: string | null,
  newId: () => string,
): MeetEntry[] {
  if (noneLabel && level === noneLabel) {
    return meets.some((m) => m.none) ? [] : [{ id: newId(), level, none: true }];
  }
  const rest = meets.filter((m) => !m.none);
  if (rest.some((m) => m.level === level)) return rest.filter((m) => m.level !== level);
  return [...rest, { id: newId(), level }];
}

/** A meet as one line: "Provincials 2027 · Jun 6 · Winnipeg" (its level when it has no name). */
export function meetLabel(m: MeetEntry): string {
  const date = m.date
    ? new Date(`${m.date}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
    : null;
  return [m.name || m.level, date, m.location].filter(Boolean).join(" · ");
}

/** The meets a later question chooses from or ranks (never "None"). */
export function meetItems(value: unknown): RankItem[] {
  return readMeets(value)
    .filter((m) => !m.none)
    .map((m) => ({ key: m.id, label: meetLabel(m) }));
}

/** True when the answer says they're not competing. */
export function notCompeting(value: unknown): boolean {
  return readMeets(value).some((m) => m.none);
}

/**
 * A ranking as stored ([{key, label}]) lined up with the items it ranks now:
 * kept order for items still there (with their current labels), new ones at
 * the end, removed ones dropped.
 */
export function alignRanking(stored: unknown, items: RankItem[]): RankItem[] {
  const prev = Array.isArray(stored)
    ? stored.filter((x): x is RankItem => !!x && typeof x === "object" && typeof (x as any).key === "string")
    : [];
  const byKey = new Map(items.map((i) => [i.key, i]));
  const kept = prev.filter((p) => byKey.has(p.key)).map((p) => byKey.get(p.key)!);
  const keys = new Set(kept.map((k) => k.key));
  return [...kept, ...items.filter((i) => !keys.has(i.key))];
}

export function moveRank(list: RankItem[], index: number, dir: -1 | 1): RankItem[] {
  const j = index + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/**
 * Any answer as text, for follow-up questions ("show when … contains …"),
 * the coach's answer list and exports: words as written, a number, a
 * checkbox list, a ranking or meets by their labels.
 */
export function answerAsText(a: { value_text?: string | null; value_number?: number | null; value_json?: unknown } | null | undefined): string {
  if (!a) return "";
  if (a.value_text != null && a.value_text !== "") return a.value_text;
  const j = a.value_json;
  // A number with its unit (a bodyweight in lb or kg keeps value_json {unit}).
  if (a.value_number != null) {
    const unit = j && typeof j === "object" && !Array.isArray(j) && typeof (j as any).unit === "string" ? (j as any).unit : null;
    return unit ? `${a.value_number} ${unit}` : String(a.value_number);
  }
  if (Array.isArray(j)) {
    return j
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          if (o.none) return String(o.level ?? "");
          // A checklist item: "Singlet: Ready".
          if (typeof o.label === "string" && (o.state === "ready" || o.state === "need" || o.state === "na")) {
            return `${o.label}: ${o.state === "ready" ? "Ready" : o.state === "need" ? "Still need" : "N/A"}`;
          }
          if (typeof o.label === "string") return o.label;
          if (typeof o.level === "string") return meetLabel(o as unknown as MeetEntry);
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

// ── Weight and age classes ──────────────────────────────────────────────────

/** Options grouped by their prefix ("Men's", "Women's"), each with its short label ("59 kg"). */
export function groupOptions(
  options: string[],
  prefixes: string[],
): Array<{ prefix: string; label: string; options: Array<{ value: string; short: string }> }> {
  return prefixes
    .map((prefix) => ({
      prefix,
      label: prefix.replace(/['’]s\s*$/i, "").trim() || prefix,
      options: options
        .filter((o) => o.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((o) => ({ value: o, short: o.slice(prefix.length).trim() })),
    }))
    .filter((g) => g.options.length > 0);
}

/** Which group to open first: the one their answer is in, else their sex. */
export function startGroup(prefixes: string[], answer: string | null | undefined, sex: string | null | undefined): string | null {
  if (answer) {
    const hit = prefixes.find((p) => answer.toLowerCase().startsWith(p.toLowerCase()));
    if (hit) return hit;
  }
  const s = (sex ?? "").toLowerCase();
  const want = s.startsWith("m") ? /^men/i : s.startsWith("f") || s.startsWith("w") ? /^wom/i : null;
  return want ? prefixes.find((p) => want.test(p)) ?? null : null;
}

/**
 * The age classes a lifter can enter in a year, IPF / CPF style: the class
 * follows the age they turn that calendar year. Sub-junior 14–18, junior
 * 19–23, masters 40–49 / 50–59 / 60–69 / 70+, and open from 14 (a junior or
 * a master can always lift open too, so classes overlap).
 */
export function eligibleAgeClasses(birthDate: string | null | undefined, year: number): string[] {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return [];
  const age = year - Number(birthDate.slice(0, 4));
  if (!Number.isFinite(age) || age < 14) return [];
  const out = ["open"];
  if (age <= 18) out.push("sub-junior");
  else if (age <= 23) out.push("junior");
  if (age >= 40 && age <= 49) out.push("master 1");
  if (age >= 50 && age <= 59) out.push("master 2");
  if (age >= 60 && age <= 69) out.push("master 3");
  if (age >= 70) out.push("master 4");
  return out;
}

/** The form's own options that match those classes ("JUNIOR (19–23)" for "junior"). */
export function eligibleOptions(options: string[], classes: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return options.filter((o) => {
    const n = norm(o);
    return classes.some((c) => {
      const cn = norm(c);
      // "junior" must not match "sub junior".
      return n === cn || (n.startsWith(`${cn} `) && !(cn === "junior" && n.startsWith("sub")));
    });
  });
}
