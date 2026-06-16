// Shared grouping helper for the admin Program Library (pl_templates) and
// Plan Library (member_plans). Categories are derived from existing fields —
// no schema change. An item can appear in multiple sections (e.g. Recently
// edited + Bodybuilding); de-duplication is per-section, not global.

export type LibrarySectionId =
  | "recent"
  | "drafts"
  | "published"
  | "membership"
  | "coaching"
  | "beginner"
  | "bodybuilding"
  | "glutes"
  | "powerbuilding"
  | "powerlifting"
  | "athome"
  | "archived";

export type LibrarySection<T> = {
  id: LibrarySectionId;
  label: string;
  description: string;
  items: T[];
};

const RECENT_DAYS = 14;
const RECENT_LIMIT = 8;

function isRecentlyEdited(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < RECENT_DAYS * 24 * 60 * 60 * 1000;
}

function hasTag(tags: unknown, needle: string): boolean {
  if (!Array.isArray(tags)) return false;
  const n = needle.toLowerCase();
  return tags.some((t) => String(t).toLowerCase().includes(n));
}

function nameIncludes(name: unknown, needle: string): boolean {
  return typeof name === "string" && name.toLowerCase().includes(needle.toLowerCase());
}

// ---------- pl_templates ----------

export type TemplateLike = {
  id: string;
  name?: string | null;
  status?: string | null;
  archived?: boolean | null;
  updated_at?: string | null;
  training_style?: string | null;
  training_focus?: string | null;
  owner_role?: string | null;
  difficulty?: string | null;
  tags?: string[] | null;
  required_access_level?: string | null;
};

export function groupTemplates<T extends TemplateLike>(rows: T[]): LibrarySection<T>[] {
  const recent = [...rows]
    .filter((r) => isRecentlyEdited(r.updated_at) && !r.archived)
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, RECENT_LIMIT);

  const drafts = rows.filter((r) => !r.archived && (r.status ?? "Draft") === "Draft");
  const published = rows.filter((r) => !r.archived && r.status === "Published");

  const membership = rows.filter(
    (r) => !r.archived && (
      String(r.required_access_level ?? "").toLowerCase().includes("member") ||
      hasTag(r.tags, "membership")
    ),
  );
  const coaching = rows.filter(
    (r) => !r.archived && (
      r.owner_role === "coach" ||
      String(r.required_access_level ?? "").toLowerCase().includes("coach") ||
      hasTag(r.tags, "coaching")
    ),
  );
  const beginner = rows.filter(
    (r) => !r.archived && (
      String(r.difficulty ?? "").toLowerCase() === "beginner" ||
      hasTag(r.tags, "beginner")
    ),
  );
  const bodybuilding = rows.filter(
    (r) => !r.archived && (
      String(r.training_style ?? "").toLowerCase() === "bodybuilding" ||
      hasTag(r.tags, "bodybuilding")
    ),
  );
  const glutes = rows.filter(
    (r) => !r.archived && (
      String(r.training_focus ?? "").toLowerCase().includes("glute") ||
      hasTag(r.tags, "glute") ||
      nameIncludes(r.name, "glute")
    ),
  );
  const powerbuilding = rows.filter(
    (r) => !r.archived && (
      String(r.training_style ?? "").toLowerCase() === "powerbuilding" ||
      hasTag(r.tags, "powerbuilding") ||
      nameIncludes(r.name, "powerbuilding")
    ),
  );
  const powerlifting = rows.filter(
    (r) => !r.archived && (
      String(r.training_style ?? "").toLowerCase() === "powerlifting" ||
      hasTag(r.tags, "powerlifting")
    ),
  );
  const athome = rows.filter(
    (r) => !r.archived && (
      hasTag(r.tags, "at home") ||
      hasTag(r.tags, "at-home") ||
      hasTag(r.tags, "home") ||
      hasTag(r.tags, "no equipment") ||
      hasTag(r.tags, "bodyweight") ||
      nameIncludes(r.name, "at home") ||
      nameIncludes(r.name, "at-home")
    ),
  );
  const archived = rows.filter((r) => !!r.archived);

  return [
    { id: "recent", label: "Recently edited", description: "Updated in the last 2 weeks", items: recent },
    { id: "drafts", label: "Drafts", description: "Not yet published", items: drafts },
    { id: "published", label: "Published", description: "Live for the intended audience", items: published },
    { id: "membership", label: "Membership", description: "Access tier or tagged for membership", items: membership },
    { id: "coaching", label: "Coaching", description: "Coach-owned or coaching-tier", items: coaching },
    { id: "beginner", label: "Beginner", description: "Beginner difficulty", items: beginner },
    { id: "bodybuilding", label: "Bodybuilding", description: "Training style: bodybuilding", items: bodybuilding },
    { id: "glutes", label: "Glute focused", description: "Focus or name mentions glutes", items: glutes },
    { id: "powerbuilding", label: "Powerbuilding", description: "Style: powerbuilding", items: powerbuilding },
    { id: "powerlifting", label: "Powerlifting", description: "Style: powerlifting", items: powerlifting },
    { id: "athome", label: "At home", description: "No-equipment, bodyweight, or home programs", items: athome },
    { id: "archived", label: "Archived", description: "Hidden from members", items: archived },
  ];
}

// ---------- member_plans ----------

export type PlanLike = {
  id: string;
  name?: string | null;
  status?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  training_style?: string | null;
  training_focus?: string | null;
  difficulty?: string | null;
  required_access_level?: string | null;
  tags?: string[] | null;
};

export function groupPlans<T extends PlanLike>(rows: T[]): LibrarySection<T>[] {
  const lastTouch = (r: T) => r.updated_at ?? r.created_at ?? "";
  const recent = [...rows]
    .filter((r) => isRecentlyEdited(lastTouch(r)))
    .sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)))
    .slice(0, RECENT_LIMIT);

  const drafts = rows.filter((r) => (r.status ?? "Draft") === "Draft");
  const published = rows.filter((r) => r.status === "Published");
  const archived = rows.filter((r) => r.status === "Archived");

  const membership = rows.filter((r) =>
    String(r.required_access_level ?? "").toLowerCase().includes("member") ||
    hasTag(r.tags, "membership"),
  );
  const coaching = rows.filter((r) =>
    String(r.required_access_level ?? "").toLowerCase().includes("coach") ||
    hasTag(r.tags, "coaching"),
  );
  const beginner = rows.filter((r) =>
    String(r.difficulty ?? "").toLowerCase() === "beginner" ||
    hasTag(r.tags, "beginner"),
  );
  const bodybuilding = rows.filter((r) =>
    String(r.training_style ?? "").toLowerCase() === "bodybuilding" ||
    hasTag(r.tags, "bodybuilding"),
  );
  const glutes = rows.filter((r) =>
    String(r.training_focus ?? "").toLowerCase().includes("glute") ||
    hasTag(r.tags, "glute") ||
    nameIncludes(r.name, "glute"),
  );

  return [
    { id: "recent", label: "Recently edited", description: "Updated in the last 2 weeks", items: recent },
    { id: "drafts", label: "Drafts", description: "Not yet published", items: drafts },
    { id: "published", label: "Published", description: "Live for members", items: published },
    { id: "membership", label: "Membership", description: "Access tier or tagged for membership", items: membership },
    { id: "coaching", label: "Coaching", description: "Coaching access tier", items: coaching },
    { id: "beginner", label: "Beginner", description: "Beginner difficulty", items: beginner },
    { id: "bodybuilding", label: "Bodybuilding", description: "Training style: bodybuilding", items: bodybuilding },
    { id: "glutes", label: "Glute focused", description: "Focus or name mentions glutes", items: glutes },
    { id: "archived", label: "Archived", description: "Hidden from members", items: archived },
  ];
}

// ---------- recipes ----------

export type RecipeSectionId =
  | "recent"
  | "drafts"
  | "published"
  | "membership"
  | "coaching"
  | "breakfast"
  | "lunch"
  | "dinner"
  | "snacks"
  | "desserts"
  | "drinks"
  | "high_protein"
  | "low_calorie"
  | "keto"
  | "meal_prep"
  | "quick_meals"
  | "archived";

export type RecipeLike = {
  id: string;
  title?: string | null;
  category?: string | null;
  status?: string | null;
  access_scope?: string | null;
  tags?: string[] | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type RecipeSection<T> = {
  id: RecipeSectionId;
  label: string;
  description: string;
  items: T[];
};

export function groupRecipes<T extends RecipeLike>(rows: T[]): RecipeSection<T>[] {
  const lastTouch = (r: T) => r.updated_at ?? r.created_at ?? "";
  const active = rows.filter((r) => (r.status ?? "Draft") !== "Archived");

  const recent = [...active]
    .filter((r) => isRecentlyEdited(lastTouch(r)))
    .sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)))
    .slice(0, RECENT_LIMIT);

  const drafts = active.filter((r) => (r.status ?? "Draft") === "Draft");
  const published = active.filter((r) => r.status === "Published");
  const archived = rows.filter((r) => r.status === "Archived");

  const isCategory = (r: T, cat: string) =>
    String(r.category ?? "").toLowerCase() === cat.toLowerCase();

  const membership = active.filter(
    (r) =>
      String(r.access_scope ?? "").toLowerCase().includes("member") ||
      hasTag(r.tags, "membership"),
  );
  const coaching = active.filter(
    (r) =>
      String(r.access_scope ?? "").toLowerCase().includes("coaching") ||
      hasTag(r.tags, "coaching"),
  );

  const breakfast = active.filter((r) => isCategory(r, "Breakfast") || hasTag(r.tags, "breakfast"));
  const lunch = active.filter((r) => isCategory(r, "Lunch") || hasTag(r.tags, "lunch"));
  const dinner = active.filter((r) => isCategory(r, "Dinner") || hasTag(r.tags, "dinner"));
  const snacks = active.filter((r) => isCategory(r, "Snack") || hasTag(r.tags, "snack"));
  const desserts = active.filter((r) => isCategory(r, "Dessert") || hasTag(r.tags, "dessert"));
  const drinks = active.filter((r) => isCategory(r, "Drink") || hasTag(r.tags, "drink") || hasTag(r.tags, "beverage"));
  const mealPrep = active.filter((r) => isCategory(r, "Meal Prep") || hasTag(r.tags, "meal prep") || hasTag(r.tags, "meal-prep"));

  const highProtein = active.filter((r) => hasTag(r.tags, "high protein") || hasTag(r.tags, "high-protein"));
  const lowCalorie = active.filter((r) => hasTag(r.tags, "low calorie") || hasTag(r.tags, "low-calorie") || hasTag(r.tags, "low cal"));
  const keto = active.filter((r) => hasTag(r.tags, "keto") || hasTag(r.tags, "low carb") || hasTag(r.tags, "low-carb"));
  const quickMeals = active.filter((r) => hasTag(r.tags, "quick") || hasTag(r.tags, "quick meal") || hasTag(r.tags, "15 min") || hasTag(r.tags, "15-min"));

  return [
    { id: "recent", label: "Recently edited", description: "Updated in the last 2 weeks", items: recent },
    { id: "drafts", label: "Drafts", description: "Not yet published", items: drafts },
    { id: "published", label: "Published", description: "Live for the intended audience", items: published },
    { id: "membership", label: "Membership", description: "Visible to app members", items: membership },
    { id: "coaching", label: "Coaching", description: "Visible to coaching clients", items: coaching },
    { id: "breakfast", label: "Breakfast", description: "Breakfast recipes", items: breakfast },
    { id: "lunch", label: "Lunch", description: "Lunch recipes", items: lunch },
    { id: "dinner", label: "Dinner", description: "Dinner recipes", items: dinner },
    { id: "snacks", label: "Snacks", description: "Snack recipes", items: snacks },
    { id: "desserts", label: "Desserts", description: "Dessert recipes", items: desserts },
    { id: "drinks", label: "Drinks", description: "Drinks and beverages", items: drinks },
    { id: "high_protein", label: "High Protein", description: "Tagged high protein", items: highProtein },
    { id: "low_calorie", label: "Low Calorie", description: "Tagged low calorie", items: lowCalorie },
    { id: "keto", label: "Keto / Low Carb", description: "Tagged keto or low carb", items: keto },
    { id: "meal_prep", label: "Meal Prep", description: "Batch-friendly recipes", items: mealPrep },
    { id: "quick_meals", label: "Quick Meals", description: "Fast recipes", items: quickMeals },
    { id: "archived", label: "Archived", description: "Hidden from members", items: archived },
  ];
}