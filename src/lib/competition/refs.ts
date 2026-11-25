/**
 * Cleo cites evidence by id inside its sentences ("… on the platform (CV-SQ)").
 * The ids come out of the words and sit after them as quiet tags, so the
 * sentence reads cleanly; only a bracket whose every token is a known id goes.
 */
export function splitRefs(text: string, known: Set<string>): { text: string; refs: string[] } {
  const refs: string[] = [];
  const out = text.replace(/\s*\(([^()]{1,80})\)/g, (whole, inner: string) => {
    const tokens = inner
      .split(/\s*(?:,|;|\bto\b|\band\b|&)\s*/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!tokens.length || !tokens.every((t) => known.has(t))) return whole;
    for (const t of tokens) if (!refs.includes(t)) refs.push(t);
    return "";
  });
  return { text: out.replace(/\s+([.,;:])/g, "$1").trim(), refs };
}
