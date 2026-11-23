/**
 * The home page's coaching price reveal (price-reveal.ts has the rule for when
 * it's honest to show): Coaching Plus at its price first, then "Don't need the
 * private calls?", then Complete Online Coaching's price as the moment the
 * section builds to. Two real products, two real prices, the calls the one
 * difference, and nothing crossed out or called a saving.
 *
 * Motion is a reveal, not a gate. Everything is on the page from the first
 * paint (server-rendered, readable with no script); after the page is
 * interactive, a stage that's still below the screen is held back and eases
 * in the first time it's scrolled to. Nothing stops scrolling, nothing waits
 * on a timer, a stage already on screen (a jump to #pricing, a reload half
 * way down) is never hidden, and with reduced motion there's no motion at all.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { Video } from "lucide-react";
import { trackSite } from "@/lib/site-funnel";
import { APPLY_PATH } from "@/lib/coaching-packages/packages";
import type { PriceReveal } from "@/lib/coaching-packages/price-reveal";

/** The few words the reveal says; the names and prices come from the packages. */
export const REVEAL_WORDS = {
  anchorTitle: "Everything I do as your coach, plus time with me on video.",
  question: "Don't need the private calls?",
  answer: "Get the same coaching without them.",
  applyShort: "Apply for coaching",
  wantCalls: "Want the calls?",
  compare: "Compare every option",
} as const;

type Phase = "static" | "armed" | "shown";

/**
 * A stage that eases in the first time it's scrolled to: "static" (shown as
 * is: the server's render, reduced motion, or already on screen when the page
 * woke), "armed" (below the screen, held back) or "shown" (scrolled to).
 */
function useStage(threshold: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // already on screen, or above it: leave it exactly as it is
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setPhase("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPhase("shown");
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, phase] as const;
}

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** One element's part in a stage: where it starts while held back, and when it moves. */
function motion(
  phase: Phase,
  { delay = 0, y = 18, scale = 1, duration = 700, blur = 0 }: { delay?: number; y?: number; scale?: number; duration?: number; blur?: number } = {},
): CSSProperties | undefined {
  if (phase === "static") return undefined;
  const held = phase === "armed";
  return {
    opacity: held ? 0 : 1,
    transform: held ? `translate3d(0, ${y}px, 0) scale(${scale})` : "none",
    filter: blur ? (held ? `blur(${blur}px)` : "blur(0)") : undefined,
    transition: `opacity ${duration}ms ${EASE} ${delay}ms, transform ${duration}ms ${EASE} ${delay}ms${blur ? `, filter ${duration}ms ${EASE} ${delay}ms` : ""}`,
  };
}

/** The flagship's moment, counted once when half of it is on screen (with or without motion). */
function useRevealSeen(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          trackSite("price_reveal_view", "home");
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

export function PriceRevealSection({ reveal }: { reveal: PriceReveal }) {
  const { anchor, flagship } = reveal;
  const [anchorRef, anchorPhase] = useStage(0.3);
  const [bridgeRef, bridgePhase] = useStage(0.6);
  const [flagRef, flagPhase] = useStage(0.35);
  useRevealSeen(flagRef);
  const callChips = Math.min(reveal.calls, 4);

  return (
    <section
      id="coaching-price"
      aria-label={`${anchor.name} and ${flagship.name} prices`}
      className="scroll-mt-20 px-3 pb-4 pt-6 sm:px-5 md:pt-10"
      data-landing-price-reveal
    >
      {/* 1. The anchor: what Plus is, and its price, said plainly */}
      <div
        ref={anchorRef}
        className="mx-auto max-w-5xl rounded-[28px] bg-muted/50 px-6 py-14 text-center ring-1 ring-border/60 md:py-20"
        data-reveal-anchor
        data-reveal-stage={anchorPhase}
      >
        <p className="text-[13px] font-semibold text-muted-foreground" style={motion(anchorPhase)}>
          {anchor.name}
        </p>
        <h2
          className="mx-auto mt-3 max-w-[20ch] text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[44px]"
          style={motion(anchorPhase, { delay: 80 })}
        >
          {REVEAL_WORDS.anchorTitle}
        </h2>
        <div
          className="mt-7 flex flex-wrap items-center justify-center gap-2.5"
          aria-hidden
          style={motion(anchorPhase, { delay: 180 })}
        >
          {Array.from({ length: callChips }, (_, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 rounded-full bg-background px-4 py-2 text-[14px] font-medium ring-1 ring-border/70"
            >
              <Video className="h-4 w-4 text-muted-foreground" />
              {reveal.callMinutes} min call
            </span>
          ))}
        </div>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground" style={motion(anchorPhase, { delay: 180 })}>
          {reveal.callsSentence}
        </p>
        <div className="mt-10" style={motion(anchorPhase, { delay: 300, y: 24 })}>
          <p
            className="flex flex-wrap items-baseline justify-center gap-x-1.5 font-semibold leading-none tracking-[-0.045em]"
            data-reveal-anchor-price
          >
            <span className="text-[72px] tabular-nums md:text-[112px]">{reveal.anchorPrice}</span>
            <span className="text-[22px] font-medium tracking-normal text-muted-foreground md:text-[28px]">{reveal.per}</span>
          </p>
          <p className="mt-3 text-[13px] text-muted-foreground">{reveal.taxNote}</p>
        </div>
      </div>

      {/* 2. The turn */}
      <div
        ref={bridgeRef}
        className="mx-auto max-w-3xl px-3 py-16 text-center md:py-24"
        data-reveal-bridge
        data-reveal-stage={bridgePhase}
      >
        <p
          className="text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-muted-foreground md:text-[44px]"
          style={motion(bridgePhase)}
        >
          {REVEAL_WORDS.question}
        </p>
        <p
          className="text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[44px]"
          style={motion(bridgePhase, { delay: 350 })}
        >
          {REVEAL_WORDS.answer}
        </p>
      </div>

      {/* 3. The moment: the flagship's price, the largest thing on the page */}
      <div
        ref={flagRef}
        className="mx-auto max-w-5xl overflow-hidden rounded-[28px] bg-foreground px-6 py-16 text-center text-background md:py-24"
        data-reveal-flagship
        data-reveal-stage={flagPhase}
      >
        <p
          className="flex flex-wrap items-center justify-center gap-2 text-[14px] font-semibold text-background/70"
          style={motion(flagPhase, { y: 10, duration: 600 })}
        >
          {flagship.name}
          <span className="rounded-full bg-background/12 px-2.5 py-0.5 text-[12px] font-semibold text-background">
            Recommended
          </span>
        </p>
        <p
          className="mt-5 flex flex-wrap items-baseline justify-center gap-x-2 font-semibold leading-[0.9] tracking-[-0.055em]"
          style={motion(flagPhase, { delay: 220, y: 34, scale: 0.94, duration: 1000, blur: 8 })}
          data-reveal-flagship-price
        >
          <span className="text-[104px] tabular-nums sm:text-[140px] md:text-[200px]">{reveal.flagshipPrice}</span>
          <span className="text-[24px] font-medium tracking-normal text-background/60 md:text-[34px]">{reveal.per}</span>
        </p>
        <p className="mt-4 text-[13px] text-background/60" style={motion(flagPhase, { delay: 650, y: 8 })}>
          {reveal.taxNote}
        </p>
        <div style={motion(flagPhase, { delay: 780, y: 12 })}>
          <p className="mx-auto mt-7 max-w-xl text-balance text-[18px] leading-relaxed text-background/85 md:text-[21px]" data-reveal-difference>
            Everything in <span className="whitespace-nowrap">{anchor.name}</span> except the {reveal.callsWord} calls.
          </p>
          <div className="mt-9 flex flex-col items-center gap-4" data-inline-cta>
            <Link
              to={APPLY_PATH}
              search={{ package: flagship.slug, from: "reveal" } as never}
              onClick={() => trackSite("package_select", flagship.slug)}
              className="inline-flex h-[54px] w-full max-w-[340px] items-center justify-center whitespace-nowrap rounded-2xl bg-background px-8 text-[17px] font-semibold text-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:max-w-none"
              data-reveal-cta
            >
              {/* a phone's button keeps to one line: the package is named right above it, and the link picks it */}
              <span className="sm:hidden">{REVEAL_WORDS.applyShort}</span>
              <span className="hidden sm:inline">Apply for {flagship.name}</span>
            </Link>
            <div className="flex flex-col items-center gap-2.5 text-[15px] sm:flex-row sm:gap-5">
              <Link
                to={APPLY_PATH}
                search={{ package: anchor.slug, from: "reveal" } as never}
                onClick={() => trackSite("package_select", anchor.slug)}
                className="font-medium text-background/80 underline-offset-4 hover:text-background hover:underline"
                data-reveal-anchor-cta
              >
                {REVEAL_WORDS.wantCalls} Apply for {anchor.name}
              </Link>
              <a
                href="#pricing"
                onClick={() => trackSite("cta_coaching", "reveal-compare")}
                className="font-medium text-background/80 underline-offset-4 hover:text-background hover:underline"
              >
                {REVEAL_WORDS.compare}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
