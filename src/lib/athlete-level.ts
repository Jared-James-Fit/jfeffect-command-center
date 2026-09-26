export const ATHLETE_TIERS = ["Rookie", "Trained", "Advanced", "Elite", "Legend"] as const;
export type AthleteTier = (typeof ATHLETE_TIERS)[number];

export type AthleteLevel = { index: number; tier: AthleteTier; division: "I" | "II" | "III"; name: string; min: number };

const THRESHOLDS = [0, 500, 1000, 1500, 2500, 3500, 4500, 6000, 7500, 9000, 12000, 15000, 18000, 22000, 26000];
const DIVS = ["I", "II", "III"] as const;

export const ATHLETE_LEVELS: AthleteLevel[] = THRESHOLDS.map((min, index) => {
  const tier = ATHLETE_TIERS[Math.floor(index / 3)];
  const division = DIVS[index % 3];
  return { index, tier, division, name: `${tier} ${division}`, min };
});

export const XP_RULES = [
  { label: "Complete a scheduled workout", xp: 100 },
  { label: "Fully log every set in a workout", xp: 20 },
];

export function levelForXp(xp: number) {
  const safe = Math.max(0, Math.floor(xp || 0));
  let current = ATHLETE_LEVELS[0];
  for (const l of ATHLETE_LEVELS) if (safe >= l.min) current = l;
  const next = ATHLETE_LEVELS[current.index + 1] ?? null;
  const span = next ? next.min - current.min : 0;
  const pct = next ? Math.min(100, Math.round(((safe - current.min) / span) * 100)) : 100;
  return { xp: safe, current, next, pct, remaining: next ? next.min - safe : 0 };
}
