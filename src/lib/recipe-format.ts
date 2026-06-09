/**
 * Parses a pasted "Recipe Body" into structured sections so we can render
 * it cleanly on the client portal. Pure / no React.
 */

export type RecipeSection =
  | { kind: "field"; label: string; value: string }
  | { kind: "list"; label: string; items: string[]; ordered?: boolean }
  | { kind: "macros"; label: string; macros: { key: string; value: string }[] }
  | { kind: "paragraph"; label: string; text: string };

export type ParsedRecipe = {
  sections: RecipeSection[];
  /** Convenience lookups */
  title?: string;
  category?: string;
  servings?: string;
  videoUrl?: string;
};

const KNOWN_HEADERS = [
  "Recipe Title",
  "Title",
  "Category",
  "Servings",
  "Yield",
  "Prep Time",
  "Cook Time",
  "Total Time",
  "Ingredients",
  "Instructions",
  "Directions",
  "Steps",
  "Macros Per Serving",
  "Macros",
  "Nutrition",
  "Notes",
  "Tips",
  "Video Demo Link",
  "Video",
  "Video Link",
];

const HEADER_RE = new RegExp(
  `^\\s*(${KNOWN_HEADERS.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:\\-]?\\s*$`,
  "i",
);

const INLINE_RE = new RegExp(
  `^\\s*(${KNOWN_HEADERS.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:\\s*(.+)$`,
  "i",
);

function normalize(label: string) {
  const l = label.trim().toLowerCase();
  if (l === "title") return "Recipe Title";
  if (l === "directions" || l === "steps") return "Instructions";
  if (l === "macros" || l === "nutrition") return "Macros Per Serving";
  if (l === "video" || l === "video link") return "Video Demo Link";
  if (l === "yield") return "Servings";
  if (l === "tips") return "Notes";
  return label.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function isListSection(label: string) {
  return ["Ingredients", "Instructions", "Notes"].includes(label);
}

function isOrdered(label: string) {
  return label === "Instructions";
}

function isMacros(label: string) {
  return label === "Macros Per Serving";
}

function parseMacros(lines: string[]): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*[-*•]?\s*([A-Za-z][A-Za-z ]+?)\s*[:\-]\s*(.+)$/);
    if (m) out.push({ key: m[1].trim(), value: m[2].trim() });
  }
  return out;
}

function cleanListItem(raw: string): string {
  return raw
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
}

export function parseRecipeBody(body: string): ParsedRecipe {
  const text = (body ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { sections: [] };

  const lines = text.split("\n");
  type Block = { label: string; lines: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;

  const pushLine = (l: string) => {
    if (!current) current = { label: "", lines: [] };
    current.lines.push(l);
  };

  for (const raw of lines) {
    const header = raw.match(HEADER_RE);
    const inline = raw.match(INLINE_RE);
    if (header) {
      if (current) blocks.push(current);
      current = { label: normalize(header[1]), lines: [] };
      continue;
    }
    if (inline) {
      // Field-on-single-line e.g. "Category: Breakfast"
      if (current) blocks.push(current);
      const label = normalize(inline[1]);
      const rest = inline[2].trim();
      // For list-style sections inline content is treated as first item
      if (isListSection(label) || isMacros(label)) {
        current = { label, lines: rest ? [rest] : [] };
      } else {
        blocks.push({ label, lines: [rest] });
        current = null;
      }
      continue;
    }
    pushLine(raw);
  }
  if (current) blocks.push(current);

  const sections: RecipeSection[] = [];
  const parsed: ParsedRecipe = { sections };

  for (const b of blocks) {
    const trimmed = b.lines.map((l) => l.trim()).filter((l) => l.length > 0);
    if (!b.label) {
      if (trimmed.length) sections.push({ kind: "paragraph", label: "", text: trimmed.join("\n") });
      continue;
    }
    if (isListSection(b.label)) {
      const items = trimmed.map(cleanListItem).filter(Boolean);
      if (items.length) sections.push({ kind: "list", label: b.label, items, ordered: isOrdered(b.label) });
      continue;
    }
    if (isMacros(b.label)) {
      const macros = parseMacros(trimmed);
      if (macros.length) sections.push({ kind: "macros", label: b.label, macros });
      continue;
    }
    // Single-value fields
    if (["Recipe Title", "Category", "Servings", "Prep Time", "Cook Time", "Total Time", "Video Demo Link"].includes(b.label)) {
      const value = trimmed.join(" ").trim();
      if (!value) continue;
      sections.push({ kind: "field", label: b.label, value });
      if (b.label === "Recipe Title") parsed.title = value;
      if (b.label === "Category") parsed.category = value;
      if (b.label === "Servings") parsed.servings = value;
      if (b.label === "Video Demo Link") parsed.videoUrl = value;
      continue;
    }
    sections.push({ kind: "paragraph", label: b.label, text: trimmed.join("\n") });
  }

  return parsed;
}

export function recipePreview(body: string, max = 140): string {
  const parsed = parseRecipeBody(body);
  const ing = parsed.sections.find((s) => s.kind === "list" && s.label === "Ingredients") as
    | Extract<RecipeSection, { kind: "list" }>
    | undefined;
  const para = parsed.sections.find((s) => s.kind === "paragraph") as
    | Extract<RecipeSection, { kind: "paragraph" }>
    | undefined;
  const text = ing ? ing.items.slice(0, 3).join(" · ") : para?.text ?? (body || "");
  return text.length > max ? text.slice(0, max - 1).trim() + "…" : text;
}

/** Best-effort embeddable URL for YouTube/Vimeo. Returns null if not embeddable. */
export function getEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/youtu\.be$/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\//, "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (/youtube\.com$/i.test(u.hostname)) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      const m = u.pathname.match(/\/embed\/([\w-]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
    if (/vimeo\.com$/i.test(u.hostname)) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return null;
  }
  return null;
}

export const DEFAULT_RECIPE_PROMPT = `Format this recipe for my coaching app using this exact structure:

Recipe Title:
[title]

Category:
[Breakfast / Lunch / Dinner / Snack / Dessert / Meal Prep / Custom]

Servings:
[number]

Ingredients:
- ingredient
- ingredient
- ingredient

Instructions:
1. step
2. step
3. step

Macros Per Serving:
Protein:
Carbs:
Fats:
Calories:

Notes:
- note
- note

Video Demo Link:
[paste link if available]

Keep it clean, simple, and easy for clients to read.`;

export const RECIPE_CATEGORIES = [
  "Breakfast",
  "Lunch",
  "Dinner",
  "Snack",
  "Dessert",
  "Meal Prep",
  "Custom",
] as const;