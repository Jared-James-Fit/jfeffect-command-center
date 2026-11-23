/**
 * The home page's coaching price story (price-reveal.ts has the rule for when
 * it's honest to show, trainer-cost.ts the trainer example and its sources):
 *
 *   1. What a personal trainer costs: a worked example from a published
 *      public rate, before tax, with the maths and every source a tap away.
 *   2. The honest difference: a trainer coaches the hours you book, in the
 *      room; I coach the whole week, online, and I'm not in the room.
 *   3. Coaching Plus at its price, the calls shown.
 *   4. "Don't need the private calls?"
 *   5. Complete Online Coaching's price, the moment the section builds to.
 *
 * Real prices only: the trainer example is labelled as one, the two coaching
 * prices come from the packages, the calls are the one difference between
 * them, and nothing is crossed out or called a saving. Motion is
 * stage-motion.ts's: on the page from the first paint, easing in only what's
 * still below the screen, none at all with reduced motion.
 */
import { Link } from "@tanstack/react-router";
import { ChevronDown, Video } from "lucide-react";
import { trackSite } from "@/lib/site-funnel";
import { APPLY_PATH } from "@/lib/coaching-packages/packages";
import type { PriceReveal } from "@/lib/coaching-packages/price-reveal";
import { trainerAnchor, type TrainerAnchor } from "@/lib/coaching-packages/trainer-cost";
import { PRICE_SETTLE, motion, useSeen, useStage } from "@/components/landing/stage-motion";

/** The few words the story says; the names and prices come from the packages and the trainer example. */
export const REVEAL_WORDS = {
  trainerTitle: "What does a personal trainer cost?",
  trainerSources: "Where these numbers come from",
  trainerGyms: "Private gyms and independent trainers set their own prices.",
  differenceMuted: "A trainer is with you for the hours you book.",
  differenceStrong: "I coach your whole week.",
  trainerCardTitle: "A personal trainer",
  trainerCardBody: "Beside you for every rep of the sessions you book. What happens between sessions depends on the trainer.",
  onlineCardTitle: "Online coaching with me",
  onlineCardBody: "I'm not in the room. I write every session, read your check-ins and review the sets you film.",
  anchorTitle: "Everything I do as your coach, plus time with me on video.",
  question: "Don't need the private calls?",
  answer: "Get the same coaching without them.",
  applyShort: "Apply for coaching",
  wantCalls: "Want the calls?",
  compare: "Compare every option",
} as const;

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

/** 1. What an hour with a trainer costs, as a worked example with its sources. */
function TrainerStage({ trainer }: { trainer: TrainerAnchor }) {
  const [ref, phase] = useStage(0.3);
  const hours = `${COUNT[trainer.perWeek] ?? trainer.perWeek} ${trainer.perWeek === 1 ? "hour" : "hours"} a week, at ${trainer.rate} an hour.`;
  return (
    <div
      ref={ref}
      className="mx-auto max-w-3xl px-3 pb-6 text-center"
      data-reveal-trainer
      data-reveal-stage={phase}
    >
      <h2
        className="mx-auto max-w-[18ch] text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[44px]"
        style={motion(phase)}
      >
        {REVEAL_WORDS.trainerTitle}
      </h2>
      <p className="mt-3 text-[16px] text-muted-foreground md:text-[18px]" style={motion(phase, { delay: 120 })}>
        {hours}
      </p>
      <div className="mt-8" style={motion(phase, { delay: 260, y: 24 })}>
        <p
          className="flex flex-wrap items-baseline justify-center gap-x-1.5 font-semibold leading-none tracking-[-0.045em]"
          data-trainer-month
        >
          <span className="text-[64px] tabular-nums md:text-[96px]">{trainer.month}</span>
          <span className="text-[20px] font-medium tracking-normal text-muted-foreground md:text-[26px]">/month</span>
        </p>
        <p className="mt-3 text-[15px] text-muted-foreground" data-trainer-year>
          {trainer.year} a year, before tax.
        </p>
      </div>
      <div style={motion(phase, { delay: 420, y: 10 })}>
        <p className="mx-auto mt-5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {trainer.sourceLine}
        </p>
        <details className="group mx-auto mt-3 max-w-xl text-left" data-trainer-sources>
          <summary className="mx-auto flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-[14px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {REVEAL_WORDS.trainerSources}
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
          </summary>
          <div className="mt-3 space-y-3 rounded-2xl bg-muted/50 p-5 text-[14px] leading-relaxed text-muted-foreground ring-1 ring-border/60">
            <p className="font-medium text-foreground">{trainer.maths}</p>
            <p>{trainer.otherFrequencies}</p>
            <ul className="space-y-2.5">
              {[trainer.source, ...trainer.others].map((s) => (
                <li key={s.provider}>
                  <span className="font-medium text-foreground">{s.provider}.</span> {s.detail}{" "}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="whitespace-nowrap font-medium text-foreground underline underline-offset-4"
                  >
                    See their rates
                  </a>
                </li>
              ))}
            </ul>
            <p>
              Checked {trainer.checkedOn}. {REVEAL_WORDS.trainerGyms}
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}

/** 2. The honest difference: what each gives you and what it doesn't. */
function DifferenceStage() {
  const [ref, phase] = useStage(0.4);
  return (
    <div ref={ref} className="mx-auto max-w-3xl px-3 pb-14 pt-12 md:pb-20 md:pt-16" data-reveal-honest data-reveal-stage={phase}>
      <div className="text-center">
        <p
          className="text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-muted-foreground md:text-[40px]"
          style={motion(phase)}
        >
          {REVEAL_WORDS.differenceMuted}
        </p>
        <p
          className="text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[40px]"
          style={motion(phase, { delay: 300 })}
        >
          {REVEAL_WORDS.differenceStrong}
        </p>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2" style={motion(phase, { delay: 520, y: 14 })}>
        <div className="rounded-[22px] bg-card p-5 ring-1 ring-border/70">
          <p className="text-[13px] font-semibold text-muted-foreground">{REVEAL_WORDS.trainerCardTitle}</p>
          <p className="mt-1.5 text-[15px] leading-relaxed">{REVEAL_WORDS.trainerCardBody}</p>
        </div>
        <div className="rounded-[22px] bg-card p-5 ring-1 ring-border/70">
          <p className="text-[13px] font-semibold text-muted-foreground">{REVEAL_WORDS.onlineCardTitle}</p>
          <p className="mt-1.5 text-[15px] leading-relaxed">{REVEAL_WORDS.onlineCardBody}</p>
        </div>
      </div>
    </div>
  );
}

export function PriceRevealSection({ reveal }: { reveal: PriceReveal }) {
  const { anchor, flagship } = reveal;
  const trainer = trainerAnchor(reveal);
  const [anchorRef, anchorPhase] = useStage(0.3);
  const [bridgeRef, bridgePhase] = useStage(0.6);
  const [flagRef, flagPhase] = useStage(0.35);
  useSeen(flagRef, "price_reveal_view", "home");
  const callChips = Math.min(reveal.calls, 4);

  return (
    <section
      id="coaching-price"
      aria-label={`What coaching costs: ${anchor.name} and ${flagship.name}`}
      className="scroll-mt-20 px-3 pb-4 pt-10 sm:px-5 md:pt-16"
      data-landing-price-reveal
    >
      {trainer && (
        <>
          <TrainerStage trainer={trainer} />
          <DifferenceStage />
        </>
      )}

      {/* 3. Coaching Plus: what it is, and its price, said plainly */}
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

      {/* 4. The turn */}
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

      {/* 5. The moment: the flagship's price, the largest thing on the page */}
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
          style={motion(flagPhase, PRICE_SETTLE)}
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
