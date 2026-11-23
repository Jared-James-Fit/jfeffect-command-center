/**
 * The home page's price story opens here (Nov 23 2026), right after the
 * promise and the proof, before the app is shown and priced:
 *
 *   1. What a personal trainer costs: a year of two sessions a week at a
 *      public rec centre's published rate (trainer-cost.ts).
 *   2. And online coaching: less than a trainer, and the higher-priced
 *      packages still run thousands a year (online-coaching-cost.ts).
 *   3. Three different things: a trainer, an online coach and an app, said
 *      plainly, then the question the rest of the page answers: what should
 *      the tools cost?
 *
 * Both numbers are examples, worked out in the open and labelled as examples:
 * the maths and every source are a tap away (collapsed by default), no
 * competing business is named or shown, and nothing here calls the coaching or
 * the app a discount on either. cost-anchors.ts decides when each belongs on
 * the page (only while it costs more than the coaching listed after it). Motion
 * is stage-motion.ts's: on the page from the first paint, easing in only what's
 * still below the screen, none at all with reduced motion.
 */
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { CostAnchors } from "@/lib/coaching-packages/cost-anchors";
import type { TrainerAnchor } from "@/lib/coaching-packages/trainer-cost";
import type { OnlineAnchor } from "@/lib/coaching-packages/online-coaching-cost";
import { motion, useSeen, useStage } from "@/components/landing/stage-motion";

/** The few words the story says; every number comes from the two examples. */
export const ANCHOR_WORDS = {
  trainerTitle: "What does a personal trainer cost?",
  onlineTitle: "And online coaching?",
  onlineLead: "Less than a trainer. The higher-priced packages still run",
  yearOr: "a year, or",
  aMonth: "a month, before tax.",
  trainerSources: "How this is worked out",
  onlineSources: "Where these numbers come from",
  trainerGyms: "Private gyms and independent trainers set their own prices.",
  onlineNote:
    "Prices from Canadian coaches' own websites, in Canadian dollars before tax. Every coach sets their own prices, so these are examples, not an average.",
  differentTitle: "Three different things.",
  trainerCardTitle: "A personal trainer",
  trainerCardBody: "Beside you for every rep of the sessions you book. What happens between sessions depends on the trainer.",
  coachCardTitle: "An online coach",
  coachCardBody: "Writes your program, reads your check-ins and reviews the sets you film. Not in the room with you.",
  appCardTitle: "An app",
  appCardBody: "The tools: your program, your training log, your progress and your nutrition. No coach comes with it.",
  closeMuted: "Most of what you pay a coach for is their time.",
  closeStrong: "So what should the tools cost?",
} as const;

/** A collapsed "where this comes from": native, so it opens with no script and reads to a screen reader as a disclosure. */
function Sources({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mx-auto mt-4 max-w-xl text-left" data-anchor-sources>
      <summary className="mx-auto flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-[14px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown className="h-4 w-4 transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="mt-3 space-y-3 rounded-2xl bg-muted/50 p-5 text-[14px] leading-relaxed text-muted-foreground ring-1 ring-border/60">
        {children}
      </div>
    </details>
  );
}

/** 1. A year of a personal trainer, as a worked example with its sources. */
function TrainerStage({ trainer }: { trainer: TrainerAnchor }) {
  const [ref, phase] = useStage(0.3);
  useSeen(ref, "cost_anchor_view", "home", 0.5);
  return (
    <div ref={ref} className="mx-auto max-w-3xl px-3 text-center" data-anchor-trainer data-reveal-stage={phase}>
      <h2
        className="mx-auto max-w-[18ch] text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[44px]"
        style={motion(phase)}
      >
        {ANCHOR_WORDS.trainerTitle}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-balance text-[16px] text-muted-foreground md:text-[18px]" style={motion(phase, { delay: 120 })}>
        {trainer.sessions}
      </p>
      <div className="mt-7" style={motion(phase, { delay: 280, y: 26 })}>
        <p className="font-semibold leading-none tracking-[-0.045em]" data-trainer-year>
          <span className="text-[76px] tabular-nums md:text-[112px]">{trainer.year}</span>
        </p>
        <p className="mt-3 text-[15px] text-muted-foreground md:text-[17px]" data-trainer-month>
          {ANCHOR_WORDS.yearOr} about {trainer.month} {ANCHOR_WORDS.aMonth}
        </p>
      </div>
      <div style={motion(phase, { delay: 440, y: 10 })}>
        <Sources summary={ANCHOR_WORDS.trainerSources}>
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
            Checked {trainer.checkedOn}. {ANCHOR_WORDS.trainerGyms}
          </p>
        </Sources>
      </div>
    </div>
  );
}

/** 2. A year of higher-priced online coaching, as examples with no names. */
function OnlineStage({ online, alone }: { online: OnlineAnchor; alone: boolean }) {
  const [ref, phase] = useStage(0.3);
  useSeen(ref, "cost_anchor_view", "home", 0.5);
  return (
    <div
      ref={ref}
      className={alone ? "mx-auto max-w-3xl px-3 text-center" : "mx-auto mt-20 max-w-3xl px-3 text-center md:mt-28"}
      data-anchor-online
      data-reveal-stage={phase}
    >
      <h2
        className="mx-auto max-w-[18ch] text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] md:text-[44px]"
        style={motion(phase)}
      >
        {ANCHOR_WORDS.onlineTitle}
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-balance text-[16px] text-muted-foreground md:text-[18px]" style={motion(phase, { delay: 120 })}>
        {ANCHOR_WORDS.onlineLead}
      </p>
      <div className="mt-7" style={motion(phase, { delay: 280, y: 26 })}>
        <p
          className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 font-semibold leading-none tracking-[-0.045em]"
          data-online-year
        >
          <span className="text-[60px] tabular-nums sm:text-[72px] md:text-[96px]">{online.yearLow}</span>
          {/* "to" stays with the second number, so a phone reads "$3,480" over "to $4,800" */}
          <span className="inline-flex items-baseline gap-x-3 whitespace-nowrap">
            <span className="text-[22px] font-medium tracking-normal text-muted-foreground md:text-[28px]">to</span>
            <span className="text-[60px] tabular-nums sm:text-[72px] md:text-[96px]">{online.yearHigh}</span>
          </span>
        </p>
        <p className="mt-3 text-[15px] text-muted-foreground md:text-[17px]" data-online-month>
          {ANCHOR_WORDS.yearOr} {online.monthRange}, before tax.
        </p>
      </div>
      <div style={motion(phase, { delay: 440, y: 10 })}>
        <Sources summary={ANCHOR_WORDS.onlineSources}>
          <p className="font-medium text-foreground">{online.maths}</p>
          <ul className="space-y-2.5">
            {online.examples.map((e) => (
              <li key={e.who}>
                <span className="font-medium text-foreground">
                  {e.who}, {e.price}.
                </span>{" "}
                {e.what}
              </li>
            ))}
          </ul>
          {online.lowerTiers && <p>{online.lowerTiers}</p>}
          <p>
            Checked {online.checkedOn}. {ANCHOR_WORDS.onlineNote}
          </p>
        </Sources>
      </div>
    </div>
  );
}

/** 3. They're not the same thing: what each one is, then the question the app answers. */
function DifferentStage() {
  const [ref, phase] = useStage(0.35);
  const cards: Array<[string, string]> = [
    [ANCHOR_WORDS.trainerCardTitle, ANCHOR_WORDS.trainerCardBody],
    [ANCHOR_WORDS.coachCardTitle, ANCHOR_WORDS.coachCardBody],
    [ANCHOR_WORDS.appCardTitle, ANCHOR_WORDS.appCardBody],
  ];
  return (
    <div ref={ref} className="mx-auto mt-20 max-w-5xl px-3 md:mt-28" data-anchor-different data-reveal-stage={phase}>
      <h3
        className="text-center text-balance text-[26px] font-semibold leading-[1.12] tracking-[-0.02em] md:text-[34px]"
        style={motion(phase)}
      >
        {ANCHOR_WORDS.differentTitle}
      </h3>
      <div className="mt-7 grid gap-3 md:grid-cols-3" style={motion(phase, { delay: 160, y: 14 })}>
        {cards.map(([title, body]) => (
          <div key={title} className="rounded-[22px] bg-card p-5 ring-1 ring-border/70">
            <p className="text-[13px] font-semibold text-muted-foreground">{title}</p>
            <p className="mt-1.5 text-[15px] leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-16 max-w-2xl text-center md:mt-20">
        <p
          className="text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-muted-foreground md:text-[40px]"
          style={motion(phase, { delay: 320 })}
        >
          {ANCHOR_WORDS.closeMuted}
        </p>
        <p
          className="text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[40px]"
          style={motion(phase, { delay: 620 })}
        >
          {ANCHOR_WORDS.closeStrong}
        </p>
      </div>
    </div>
  );
}

export function CostAnchorsSection({ anchors }: { anchors: CostAnchors }) {
  const { trainer, online } = anchors;
  return (
    <section
      id="what-help-costs"
      aria-label="What a personal trainer and online coaching usually cost"
      className="scroll-mt-20 px-3 pb-4 pt-20 sm:px-5 md:pt-28"
      data-landing-anchors
    >
      {trainer && <TrainerStage trainer={trainer} />}
      {online && <OnlineStage online={online} alone={!trainer} />}
      <DifferentStage />
    </section>
  );
}
