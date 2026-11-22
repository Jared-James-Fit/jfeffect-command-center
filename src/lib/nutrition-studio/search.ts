/**
 * Finding a food in the Studio: the person's own foods, the built-in staples
 * and the cookbook's recipes in one ranked list. Word order, plurals and a
 * half-typed word don't matter ("chick bre", "bananas", "rice cooked"); a word
 * that matches nothing drops a food. Pure.
 */
import type { StudioFood } from "@/lib/nutrition-studio/foods";

const STOP = new Set(["of", "and", "the", "a", "with", "in"]);

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[%/]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

const ORDER: Record<StudioFood["source"], number> = { label: 0, recipe: 2, usda: 1 };

/** Foods for a query, best first. An empty query lists the person's own foods, then everything by category. */
export function searchFoods(query: string, foods: StudioFood[], limit = 40): StudioFood[] {
  const q = words(query);
  if (!q.length) return foods.slice().sort((a, b) => ORDER[a.source] - ORDER[b.source] || a.name.localeCompare(b.name)).slice(0, limit);
  const scored: Array<{ f: StudioFood; s: number }> = [];
  for (const f of foods) {
    const name = words(f.name);
    const extra = [...words(f.lineName), ...(f.aliases ?? []).flatMap(words)];
    let s = 0;
    let ok = true;
    for (const w of q) {
      if (name.includes(w)) s += 10;
      else if (name.some((n) => n.startsWith(w))) s += 6;
      else if (extra.includes(w)) s += 5;
      else if (extra.some((n) => n.startsWith(w))) s += 3;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const full = f.name.toLowerCase();
    if (full === query.trim().toLowerCase()) s += 50;
    else if (full.startsWith(query.trim().toLowerCase())) s += 12;
    if (f.source === "label") s += 4;
    // a recipe is a whole dish: an ingredient that matches as well comes first
    if (f.source === "recipe") s -= 4;
    s -= name.length * 0.3;
    scored.push({ f, s });
  }
  return scored
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))
    .slice(0, limit)
    .map((x) => x.f);
}
