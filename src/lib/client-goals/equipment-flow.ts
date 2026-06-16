import { EQUIPMENT_OPTIONS, type ClientGoalsSetupRow } from "./schema";

export type LocationKind = "full_gym" | "home" | "bodyweight" | "multi" | "unknown";

/**
 * Classify the user's training_location into a flow branch.
 * Existing free-text values fall through to "unknown" so we render the
 * legacy generic chip grid without losing data.
 */
export function classifyLocation(location: string | null | undefined): LocationKind {
  switch (location) {
    case "Commercial gym":
    case "Powerlifting gym":
    case "Apartment gym":
      return "full_gym";
    case "Home gym":
    case "At home with limited equipment":
      return "home";
    case "Multiple locations":
      return "multi";
    default:
      return location ? "unknown" : "unknown";
  }
}

/** Grouped equipment for the simplified home / gym checklist. */
export const EQUIPMENT_GROUPS: { label: string; items: string[] }[] = [
  {
    label: "Free weights",
    items: ["Barbell", "Squat rack", "Bench", "Dumbbells", "Adjustable dumbbells"],
  },
  {
    label: "Machines",
    items: [
      "Machines",
      "Cable station",
      "Smith machine",
      "Leg press",
      "Leg extension",
      "Leg curl",
      "Lat pulldown",
      "Seated row",
      "Hip thrust or glute machine",
    ],
  },
  {
    label: "Accessories",
    items: ["Resistance bands", "Pull-up bar"],
  },
  {
    label: "Cardio",
    items: ["Cardio equipment"],
  },
];

/** Equipment chips that don't belong in a category checklist. */
const MINIMAL_OPTIONS = ["Bodyweight only", "No equipment"];

/** All "real" equipment chips (excluding meta values like All of it / Other). */
export const REAL_EQUIPMENT_ITEMS: string[] = EQUIPMENT_OPTIONS.filter(
  (o) => o !== "All of it" && o !== "Other" && !MINIMAL_OPTIONS.includes(o),
);

/** Build a one-line equipment summary for the profile card. */
export function getEquipmentSummary(row: ClientGoalsSetupRow): string {
  const byLoc = row.equipment_by_location ?? {};
  const locKeys = Object.keys(byLoc);
  if (locKeys.length > 0) {
    const total = locKeys.reduce((acc, k) => acc + (byLoc[k]?.length ?? 0), 0);
    return `${locKeys.length} locations · ${total} items`;
  }
  const eq = row.equipment ?? [];
  const location = row.training_location ?? "Not set";
  if (eq.length === 0) return location;
  if (eq.includes("Bodyweight only") || eq.includes("No equipment")) {
    return `${location} · bodyweight only`;
  }
  const realCount = eq.filter((x) => x !== "All of it" && x !== "Other" && !x.startsWith("Other: ")).length;
  const allReal = REAL_EQUIPMENT_ITEMS.every((o) => eq.includes(o));
  if (allReal) return `${location} · all equipment`;
  return `${location} · ${realCount} item${realCount === 1 ? "" : "s"}`;
}