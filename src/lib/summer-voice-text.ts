/**
 * Text helpers for Cleo: which links she may hand out, how her replies are
 * split into renderable pieces, and what gets read aloud. Pure, so the same
 * rules hold in the chat, in voice and in tests.
 */

/** In-app admin paths only (no protocol, no host, no traversal). */
const INTERNAL_HREF = /^\/admin(?:[/?#][\w\-./?=&%#~:+,@]*)?$/;

export function isSafeInternalHref(href: string): boolean {
  return INTERNAL_HREF.test(href) && !href.includes("..") && !href.includes("//");
}

export function isSafeExternalHref(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; label: string; href: string; internal: boolean };

const INLINE = /(\*\*[^*]+\*\*|\[[^\]\n]{1,120}\]\([^)\s]{1,400}\))/g;

/** Bold and [label](href) links; unsafe links degrade to their label. */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push({ type: "bold", text: part.slice(2, -2) });
      continue;
    }
    const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m) {
      const [, label, href] = m;
      if (isSafeInternalHref(href)) out.push({ type: "link", label, href, internal: true });
      else if (isSafeExternalHref(href)) out.push({ type: "link", label, href, internal: false });
      else out.push({ type: "text", text: label });
      continue;
    }
    out.push({ type: "text", text: part });
  }
  return out;
}

/** Every link in a reply, in order (for the quick-open chips under it). */
export function extractLinks(text: string): Array<{ label: string; href: string; internal: boolean }> {
  const links: Array<{ label: string; href: string; internal: boolean }> = [];
  for (const line of text.split("\n")) {
    for (const t of tokenizeInline(line)) {
      if (t.type === "link" && !links.some((l) => l.href === t.href)) links.push({ label: t.label, href: t.href, internal: t.internal });
    }
  }
  return links;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 2026-10-01 → October 1, 2026 (a voice reads the ISO form digit by digit). */
function spokenDates(s: string): string {
  return s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => {
    const month = MONTHS[Number(mo) - 1];
    const day = Number(d);
    return month && day >= 1 && day <= 31 ? `${month} ${day}, ${y}` : m;
  });
}

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu;

/**
 * What Cleo says out loud: no markdown, no tables, no emojis, links read as
 * their label. Trimmed at a sentence boundary so speech never cuts mid-word.
 */
export function speechFromReply(text: string, maxChars = 700): string {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l)); // tables are for reading, not listening
  let s = lines
    .map((l) => l.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*([-*•]|\d+[.)])\s+/, ""))
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?:]$/.test(l) ? l : `${l}.`))
    .join(" ");
  s = s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(EMOJI, "")
    .replace(/\s&\s/g, " and ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  s = spokenDates(s);
  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > maxChars * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim();
}
