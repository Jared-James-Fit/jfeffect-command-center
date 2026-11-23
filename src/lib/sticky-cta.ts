/**
 * Which bottom button a public page's phone view shows, and when (pure,
 * tested in sticky-cta.test.ts; StickyMobileCta measures, this decides).
 *
 * - Hidden until the visitor has scrolled past the first screen half.
 * - Hidden while one of the page's own buttons (`data-inline-cta`) is on
 *   screen, so two buttons that do the same thing never sit together.
 * - Inside a section marked `data-cta-zone="<name>"` (its box covering the
 *   middle of the screen), the button is that zone's: on the landing page the
 *   coaching section's is "Apply for coaching", everywhere else "Get the free app".
 */
export type CtaChoice = { label: string; href: string };

export type StickyCtaInput = {
  scrollY: number;
  viewportHeight: number;
  /** Is any inline button with the same job on screen? */
  inlineVisible: boolean;
  /** The zones on the page and where they sit on screen (getBoundingClientRect). */
  zones: Array<{ name: string; top: number; bottom: number }>;
};

export type StickyCtaState = { visible: boolean; zone: string | null };

export function stickyCtaState(input: StickyCtaInput): StickyCtaState {
  const vh = input.viewportHeight || 800;
  const middle = vh / 2;
  const zone = input.zones.find((z) => z.top <= middle && z.bottom >= middle)?.name ?? null;
  const pastHero = input.scrollY > vh * 0.5;
  return { visible: pastHero && !input.inlineVisible, zone };
}

/** The zone's button, else the page's own. */
export function stickyCtaChoice(
  base: CtaChoice,
  zones: Record<string, CtaChoice> | undefined,
  zone: string | null,
): CtaChoice {
  return (zone && zones?.[zone]) || base;
}
