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
  | "glutes";

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

  return [
    { id: "recent", label: "Recently edited", description: "Updated in the last 2 weeks", items: recent },
    { id: "drafts", label: "Drafts", description: "Not yet published", items: drafts },
    { id: "published", label: "Published", description: "Live for the intended audience", items: published },
    { id: "membership", label: "Membership", description: "Access tier or tagged for membership", items: membership },
    { id: "coaching", label: "Coaching", description: "Coach-owned or coaching-tier", items: coaching },
    { id: "beginner", label: "Beginner", description: "Beginner difficulty", items: beginner },
    { id: "bodybuilding", label: "Bodybuilding", description: "Training style: bodybuilding", items: bodybuilding },
    { id: "glutes", label: "Glute focused", description: "Focus or name mentions glutes", items: glutes },
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
    { id: "drafts" as any, label: "Archived", description: "Hidden from members", items: archived },
  ];
}