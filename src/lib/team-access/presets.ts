/**
 * Specialists: people on the team who study an athlete without coaching them
 * (docs/COACHING_PLATFORM.md §7). A game day coach handles an athlete at a
 * meet; a performance specialist reads their training. Both see only the
 * athletes they're given and only the categories turned on for each; the
 * database decides it (specialist_can_view, 20270603090100_team_specialists.sql),
 * this file only says it in words. Pure.
 */

export type SpecialistPreset = "game_day_coach" | "performance_specialist";
export type ViewCategory = "footage" | "training" | "performance";

export const VIEW_CATEGORIES: readonly ViewCategory[] = ["footage", "training", "performance"];

export type CategoryFlags = Record<ViewCategory, boolean>;

export const CATEGORY_WORDS: Record<ViewCategory, { label: string; line: string }> = {
  footage: { label: "Footage", line: "Set videos, with the weight, reps and effort of each set" },
  training: {
    label: "Training",
    line: "The program and what was logged, read-only, without the coach's notes",
  },
  performance: {
    label: "Performance",
    line: "Estimated maxes, heavy singles, bar speed and meet results",
  },
};

export type PresetInfo = {
  key: SpecialistPreset;
  label: string;
  summary: string;
  defaults: CategoryFlags;
};

export const PRESETS: Record<SpecialistPreset, PresetInfo> = {
  game_day_coach: {
    key: "game_day_coach",
    label: "Game Day Coach",
    summary: "Studies an athlete's lifting so they can handle them at a meet. Never programs.",
    defaults: { footage: true, training: true, performance: true },
  },
  performance_specialist: {
    key: "performance_specialist",
    label: "Performance Specialist",
    summary: "Reads an athlete's lifting and training to advise. Never programs.",
    defaults: { footage: true, training: true, performance: true },
  },
};

export const PRESET_ORDER: SpecialistPreset[] = ["game_day_coach", "performance_specialist"];

export function isPreset(v: unknown): v is SpecialistPreset {
  return v === "game_day_coach" || v === "performance_specialist";
}

/** What never comes with this role, whatever is switched on. Shown before an invite is sent. */
export const SPECIALIST_NEVER: readonly string[] = [
  "Change any training, program or logged set",
  "Messages, Crew, nutrition, check-ins or recovery",
  "Cleo, automations or attempt planning",
  "Billing, business information or admin tools",
  "Any athlete they weren't given",
];

/**
 * The permission summary an admin reads before sending: what this person will
 * see, per athlete, and what they never can.
 */
export function permissionSummary(athletes: Array<{ name: string; flags: CategoryFlags }>): {
  sees: string[];
  never: readonly string[];
} {
  const sees: string[] = [];
  for (const a of athletes) {
    const on = VIEW_CATEGORIES.filter((c) => a.flags[c]).map((c) =>
      CATEGORY_WORDS[c].label.toLowerCase(),
    );
    if (!on.length) continue;
    sees.push(`${a.name}: ${listWords(on)}`);
  }
  return { sees, never: SPECIALIST_NEVER };
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * What a specialist agrees to before they see anything. The exact words and
 * time are kept on their record (team_specialists.confidentiality_text / _at).
 */
export const CONFIDENTIALITY_TEXT =
  "I'll keep every athlete's footage, training and results private: I won't download, share or post them, and I'll only use them to help the athletes I'm working with.";

/** A specialist invite's access list, as stored on staff_invites.access. */
export type InviteAccess = Array<{ client_id: string } & CategoryFlags>;

/** Clean an access list from the client: one row per athlete, booleans only, at most 25. */
export function cleanAccess(input: unknown): InviteAccess {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: InviteAccess = [];
  for (const raw of input) {
    const id = typeof raw?.client_id === "string" ? raw.client_id : null;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      client_id: id,
      footage: raw.footage !== false,
      training: raw.training !== false,
      performance: raw.performance !== false,
    });
    if (out.length >= 25) break;
  }
  return out;
}

export function anyCategory(f: CategoryFlags): boolean {
  return f.footage || f.training || f.performance;
}

/** Where a specialist login lands. */
export const SPECIALIST_HOME = "/specialist";
