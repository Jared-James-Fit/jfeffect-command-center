/**
 * The app screenshots on the public pages come in three widths (390, 585 and the 780 original,
 * src/assets/{landing,coaching}/app-*.webp), so a phone downloads the size it shows: on Nov 23
 * 2026 Lighthouse found every screenshot on jfeffect.com sent at 780 px to a ~200 px phone frame
 * (159 KiB too much on the landing page, the hero's 40 KB screenshot its largest paint). `srcSetFor`
 * maps the original's URL to its `srcset`; anything else gets none. The variants are made from
 * the originals by scripts/landing/resize-shots.py (re-run after a re-capture).
 */
const files = import.meta.glob<string>("/src/assets/{landing,coaching}/app-*.webp", { eager: true, import: "default" });

const SRCSETS: Record<string, string> = (() => {
  const byBase = new Map<string, Record<number, string>>();
  for (const [path, url] of Object.entries(files)) {
    const m = /\/(app-[a-z-]+?)(?:-(390|585))?\.webp$/.exec(path);
    if (!m) continue;
    const key = path.replace(/\/[^/]+$/, "/") + m[1];
    const widths = byBase.get(key) ?? {};
    widths[m[2] ? Number(m[2]) : 780] = url;
    byBase.set(key, widths);
  }
  const out: Record<string, string> = {};
  for (const widths of byBase.values()) {
    if (!widths[780] || !widths[390]) continue;
    out[widths[780]] = [390, 585, 780].filter((w) => widths[w]).map((w) => `${widths[w]} ${w}w`).join(", ");
  }
  return out;
})();

export function srcSetFor(src: string): string | undefined {
  return SRCSETS[src];
}
