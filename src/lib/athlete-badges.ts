/**
 * Athlete achievement/badge catalog.
 *
 * The catalog is stored in `public.athlete_badge_catalog` so new badges can be
 * added without a code deploy. The list below mirrors the seeded rows and is
 * used as an offline fallback and for progress maths in the UI.
 * Earned rows live in `public.athlete_achievements` (idempotent, server-awarded).
 */

export type BadgeRarity = "common" | "rare" | "epic" | "legendary";

export type BadgeMetric =
  | "workouts_completed"
  | "workouts_fully_logged"
  | "xp"
  | "days_since_first_workout";

export type CatalogBadge = {
  badge_key: string;
  name: string;
  category: string;
  icon_key: string;
  rarity: BadgeRarity;
  description: string;
  requirement: string;
  metric: BadgeMetric;
  threshold: number;
  is_public: boolean;
  sort_order: number;
};

export type EarnedBadge = { badge_key: string; earned_at: string };

export type BadgeStats = {
  xp: number;
  workoutsCompleted: number;
  workoutsFullyLogged: number;
  firstWorkoutAt: string | null;
};

const b = (
  badge_key: string,
  name: string,
  category: string,
  icon_key: string,
  rarity: BadgeRarity,
  description: string,
  requirement: string,
  metric: BadgeMetric,
  threshold: number,
  sort_order: number,
): CatalogBadge => ({
  badge_key, name, category, icon_key, rarity, description, requirement, metric, threshold,
  is_public: true, sort_order,
});

/** Mirrors migration 0011 seed data. */
export const FALLBACK_BADGE_CATALOG: CatalogBadge[] = [
  b("first_workout", "First Workout", "milestone", "flag", "common", "Where every transformation starts.", "Complete 1 workout", "workouts_completed", 1, 10),
  b("workouts_10", "Getting Serious", "milestone", "dumbbell", "common", "Ten sessions in the books.", "Complete 10 workouts", "workouts_completed", 10, 20),
  b("workouts_25", "Consistent", "consistency", "calendar", "common", "Consistency is the real program.", "Complete 25 workouts", "workouts_completed", 25, 30),
  b("workouts_50", "Half Century", "consistency", "flame", "rare", "Fifty sessions of work.", "Complete 50 workouts", "workouts_completed", 50, 40),
  b("workouts_100", "Centurion", "consistency", "shield", "epic", "One hundred workouts completed.", "Complete 100 workouts", "workouts_completed", 100, 50),
  b("workouts_250", "Iron Will", "consistency", "hammer", "legendary", "A quarter of a thousand sessions.", "Complete 250 workouts", "workouts_completed", 250, 60),
  b("logged_10", "Detail Oriented", "logging", "notebook", "common", "Every set, every time.", "Fully log 10 workouts", "workouts_fully_logged", 10, 70),
  b("logged_50", "Perfect Logger", "logging", "chart", "rare", "Data drives progress.", "Fully log 50 workouts", "workouts_fully_logged", 50, 80),
  b("logged_150", "Meticulous", "logging", "target", "epic", "Elite-level logging discipline.", "Fully log 150 workouts", "workouts_fully_logged", 150, 90),
  b("level_trained", "Trained", "progression", "medal", "common", "Reached the Trained tier.", "Earn 1,500 lifetime XP", "xp", 1500, 100),
  b("level_advanced", "Advanced", "progression", "medal", "rare", "Reached the Advanced tier.", "Earn 4,500 lifetime XP", "xp", 4500, 110),
  b("level_elite", "Elite", "progression", "crown", "epic", "Reached the Elite tier.", "Earn 9,000 lifetime XP", "xp", 9000, 120),
  b("level_legend", "Legend", "progression", "crown", "legendary", "Reached the Legend tier.", "Earn 18,000 lifetime XP", "xp", 18000, 130),
  b("half_year", "Six Months Strong", "tenure", "clock", "rare", "Half a year of training.", "180 days since your first workout", "days_since_first_workout", 180, 140),
  b("year_one", "One Year Strong", "tenure", "star", "epic", "A full year of training.", "365 days since your first workout", "days_since_first_workout", 365, 150),
];

export const RARITY_ORDER: Record<BadgeRarity, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };

export const RARITY_STYLE: Record<BadgeRarity, { label: string; ring: string; text: string; chip: string }> = {
  common: { label: "Common", ring: "border-border", text: "text-muted-foreground", chip: "bg-muted text-muted-foreground" },
  rare: { label: "Rare", ring: "border-primary/60", text: "text-primary", chip: "bg-primary/15 text-primary" },
  epic: { label: "Epic", ring: "border-warning/70", text: "text-warning", chip: "bg-warning/15 text-warning" },
  legendary: { label: "Legendary", ring: "border-primary bg-primary/10", text: "text-primary", chip: "bg-primary text-primary-foreground" },
};

export const BADGE_EMOJI: Record<string, string> = {
  flag: "🏁", dumbbell: "💪", calendar: "📅", flame: "🔥", shield: "🛡️", hammer: "⚒️",
  notebook: "📝", chart: "📊", target: "🎯", medal: "🥈", crown: "👑", clock: "⏳", star: "🎖️",
};

export const badgeEmoji = (iconKey: string) => BADGE_EMOJI[iconKey] ?? "🏅";

export const CATEGORY_LABEL: Record<string, string> = {
  milestone: "Milestones",
  consistency: "Consistency",
  logging: "Logging",
  progression: "Progression",
  tenure: "Tenure",
};

const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0);

export function metricValue(metric: BadgeMetric, s: BadgeStats): number {
  switch (metric) {
    case "workouts_completed": return s.workoutsCompleted;
    case "workouts_fully_logged": return s.workoutsFullyLogged;
    case "xp": return s.xp;
    case "days_since_first_workout": return daysSince(s.firstWorkoutAt);
  }
}

export type BadgeProgress = { value: number; target: number; pct: number; met: boolean };

export function badgeProgress(badge: CatalogBadge, s: BadgeStats): BadgeProgress {
  const value = metricValue(badge.metric, s);
  const target = badge.threshold;
  const pct = target <= 0 ? 100 : Math.min(100, Math.round((value / target) * 100));
  return { value, target, pct, met: value >= target };
}

/** Earned first (rarest first), then locked ordered by how close they are. */
export function sortForCollection(
  catalog: CatalogBadge[],
  earned: Map<string, string>,
  stats: BadgeStats,
): CatalogBadge[] {
  const isEarned = (x: CatalogBadge) => earned.has(x.badge_key);
  return [...catalog].sort((x, y) => {
    const ex = isEarned(x), ey = isEarned(y);
    if (ex !== ey) return ex ? -1 : 1;
    if (ex && ey) {
      const r = RARITY_ORDER[x.rarity] - RARITY_ORDER[y.rarity];
      if (r !== 0) return r;
      return (earned.get(y.badge_key) ?? "").localeCompare(earned.get(x.badge_key) ?? "");
    }
    return badgeProgress(y, stats).pct - badgeProgress(x, stats).pct;
  });
}

/** Featured = rarest earned badges, used for compact strips. */
export function featuredBadges(catalog: CatalogBadge[], earned: Map<string, string>, limit = 4): CatalogBadge[] {
  return catalog
    .filter((x) => earned.has(x.badge_key))
    .sort((x, y) => RARITY_ORDER[x.rarity] - RARITY_ORDER[y.rarity] || x.sort_order - y.sort_order)
    .slice(0, limit);
}
