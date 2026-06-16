import type { ProgramFacets } from "./facets";

export type CategoryId =
  | "recommended"
  | "fat_loss"
  | "muscle"
  | "glutes"
  | "strength"
  | "powerlifting"
  | "powerbuilding"
  | "beginner"
  | "home"
  | "short"
  | "all";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  requiresProfile?: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "recommended", label: "Recommended for You", requiresProfile: true },
  { id: "fat_loss", label: "Fat Loss" },
  { id: "muscle", label: "Build Muscle" },
  { id: "glutes", label: "Glute Focus" },
  { id: "strength", label: "Strength" },
  { id: "powerlifting", label: "Powerlifting" },
  { id: "powerbuilding", label: "Powerbuilding" },
  { id: "beginner", label: "Beginner" },
  { id: "home", label: "At Home" },
  { id: "short", label: "Short Workouts" },
  { id: "all", label: "All Programs" },
];

export function matchesCategory(f: ProgramFacets, id: CategoryId): boolean {
  switch (id) {
    case "all":
    case "recommended":
      return true;
    case "fat_loss":
      return f.goals.includes("fat_loss");
    case "muscle":
      return f.goals.includes("muscle") || f.style === "bodybuilding" || f.style === "hypertrophy";
    case "glutes":
      return f.goals.includes("glutes");
    case "strength":
      return f.goals.includes("strength") || f.style === "strength";
    case "powerlifting":
      return f.goals.includes("powerlifting") || f.style === "powerlifting";
    case "powerbuilding":
      return f.goals.includes("powerbuilding") || f.style === "powerbuilding";
    case "beginner":
      return f.level === "beginner" || f.level === "novice";
    case "home":
      return f.location === "home";
    case "short":
      return (f.lengthMin ?? 99) <= 45;
  }
}

export interface GroupSection {
  id: string;
  label: string;
  predicate: (f: ProgramFacets) => boolean;
}

export const GROUP_SECTIONS: GroupSection[] = [
  {
    id: "beginner_foundations",
    label: "Beginner Foundations",
    predicate: (f) => f.level === "beginner" || f.level === "novice",
  },
  {
    id: "muscle_building",
    label: "Muscle Building",
    predicate: (f) =>
      f.goals.includes("muscle") && !f.goals.includes("glutes") && f.level !== "beginner",
  },
  {
    id: "glute_development",
    label: "Glute Development",
    predicate: (f) => f.goals.includes("glutes"),
  },
  {
    id: "powerbuilding",
    label: "Powerbuilding",
    predicate: (f) => f.goals.includes("powerbuilding") || f.style === "powerbuilding",
  },
  {
    id: "powerlifting",
    label: "Powerlifting",
    predicate: (f) => f.goals.includes("powerlifting") || f.style === "powerlifting",
  },
  {
    id: "home_training",
    label: "Home Training",
    predicate: (f) => f.location === "home",
  },
  {
    id: "advanced",
    label: "Advanced Programs",
    predicate: (f) => f.level === "advanced" || f.level === "elite",
  },
];

export function groupBySections<T extends { facets: ProgramFacets }>(
  items: T[],
): Array<{ section: GroupSection; items: T[] }> {
  const buckets = new Map<string, T[]>();
  GROUP_SECTIONS.forEach((s) => buckets.set(s.id, []));
  const other: T[] = [];
  for (const item of items) {
    const section = GROUP_SECTIONS.find((s) => s.predicate(item.facets));
    if (section) buckets.get(section.id)!.push(item);
    else other.push(item);
  }
  const result = GROUP_SECTIONS.filter((s) => (buckets.get(s.id) ?? []).length > 0).map((s) => ({
    section: s,
    items: buckets.get(s.id)!,
  }));
  if (other.length > 0) {
    result.push({
      section: { id: "other", label: "More Programs", predicate: () => true },
      items: other,
    });
  }
  return result;
}
