/**
 * A library program's coaching guide (pl_templates.notes: how it's designed,
 * what to trim first, swaps, the meet taper) for Edit with AI, so adapting
 * an assigned copy follows the program's own rules instead of rebuilding it.
 * A client's blocks point at the template they came from
 * (pl_blocks.source_template_id); a template edit reads its own notes.
 */

export const GUIDE_MAX_CHARS = 3500;

export type GuideSource = { name: string | null; notes: string | null };

export function programGuideText(sources: GuideSource[]): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of sources) {
    const notes = (s.notes ?? "").trim();
    if (!notes || seen.has(notes)) continue;
    seen.add(notes);
    parts.push(`From the library program "${(s.name ?? "").trim() || "Untitled"}":\n${notes}`);
  }
  if (!parts.length) return null;
  let text = parts.join("\n\n");
  if (text.length > GUIDE_MAX_CHARS) text = `${text.slice(0, GUIDE_MAX_CHARS).trimEnd()}\n(guide cut short)`;
  return `# THE PROGRAM'S COACHING GUIDE (its design and how to adapt it; follow it unless the coach says otherwise, and change only what the coach asks)\n${text}`;
}
