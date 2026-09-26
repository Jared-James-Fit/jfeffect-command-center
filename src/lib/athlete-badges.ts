import { levelForXp } from "@/lib/athlete-level";

export type BadgeRarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type BadgeStats = {
  xp: number;
  workoutsCompleted: number;
  workoutsFullyLogged: number;
  firstWorkoutAt: string | null;
};

export type AthleteBadge = {
  id: string;
  name: string;
  emoji: string;
  rarity: BadgeRarity;
  description: string;
  earned: (s: BadgeStats) => boolean;
};

const tierIndex = (s: BadgeStats) => Math.floor(levelForXp(s.xp).current.index / 3);
const daysSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0);

/** Public badges — derived only from workout XP counts, never private data. */
export const ATHLETE_BADGES: AthleteBadge[] = [
  { id: "first-rep", name: "First Rep", emoji: "🏁", rarity: "common", description: "Complete your first workout.", earned: (s) => s.workoutsCompleted >= 1 },
  { id: "w10", name: "Getting Serious", emoji: "💪", rarity: "common", description: "Complete 10 workouts.", earned: (s) => s.workoutsCompleted >= 10 },
  { id: "w25", name: "Consistent", emoji: "📅", rarity: "uncommon", description: "Complete 25 workouts.", earned: (s) => s.workoutsCompleted >= 25 },
  { id: "w50", name: "Half Century", emoji: "🔥", rarity: "rare", description: "Complete 50 workouts.", earned: (s) => s.workoutsCompleted >= 50 },
  { id: "w100", name: "Centurion", emoji: "🛡️", rarity: "epic", description: "Complete 100 workouts.", earned: (s) => s.workoutsCompleted >= 100 },
  { id: "w250", name: "Iron Will", emoji: "⚒️", rarity: "legendary", description: "Complete 250 workouts.", earned: (s) => s.workoutsCompleted >= 250 },
  { id: "log10", name: "Detail Oriented", emoji: "📝", rarity: "uncommon", description: "Fully log every set in 10 workouts.", earned: (s) => s.workoutsFullyLogged >= 10 },
  { id: "log50", name: "Perfect Logger", emoji: "📊", rarity: "rare", description: "Fully log every set in 50 workouts.", earned: (s) => s.workoutsFullyLogged >= 50 },
  { id: "trained", name: "Trained", emoji: "🥉", rarity: "uncommon", description: "Reach the Trained level.", earned: (s) => tierIndex(s) >= 1 },
  { id: "advanced", name: "Advanced", emoji: "🥈", rarity: "rare", description: "Reach the Advanced level.", earned: (s) => tierIndex(s) >= 2 },
  { id: "elite", name: "Elite", emoji: "🥇", rarity: "epic", description: "Reach the Elite level.", earned: (s) => tierIndex(s) >= 3 },
  { id: "legend", name: "Legend", emoji: "👑", rarity: "legendary", description: "Reach the Legend level.", earned: (s) => tierIndex(s) >= 4 },
  { id: "veteran", name: "One Year Strong", emoji: "🎖️", rarity: "epic", description: "Train with JF Effect for a full year since your first workout.", earned: (s) => daysSince(s.firstWorkoutAt) >= 365 },
];

export const RARITY_STYLE: Record<BadgeRarity, { label: string; ring: string; text: string }> = {
  common: { label: "Common", ring: "border-border", text: "text-muted-foreground" },
  uncommon: { label: "Uncommon", ring: "border-success/60", text: "text-success" },
  rare: { label: "Rare", ring: "border-primary/60", text: "text-primary" },
  epic: { label: "Epic", ring: "border-warning/70", text: "text-warning" },
  legendary: { label: "Legendary", ring: "border-primary bg-primary/10", text: "text-primary" },
};

export function earnedBadges(s: BadgeStats) {
  return ATHLETE_BADGES.filter((b) => b.earned(s));
}
