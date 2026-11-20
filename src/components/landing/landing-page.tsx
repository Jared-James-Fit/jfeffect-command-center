/**
 * jfeffect.com's front door (signed-out visitors on "/"). Two products, said
 * apart from the first screen: the app is free (by application, no card) and
 * 1:1 coaching with Jared is paid (by application, priced on a call).
 *
 * Order follows how someone decides: who's behind it, what it is and what
 * costs money, with both ways in; why listen; the two side by side; the free
 * app on its real screens; coaching and its real results; their questions;
 * both ways in again.
 *
 * Every claim is checked against the product and the database (Nov 20 2026):
 * 15 published JF Effect programs (strength, muscle, running, home; 4 for
 * beginners, 3 for home), 2,050
 * exercises (1,969 with a how-to video), 13,730 sets logged; Jared's record
 * and credentials as the About and Coaching pages state them; client words
 * and photos from the Coaching page. App screens are a made-up athlete, never
 * a client (scripts/coaching-screenshots).
 */
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Quote } from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { PhoneShot } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { TRANSFORMATION_PHOTOS } from "@/components/sales/transformations-strip";
import { CLIENT_QUOTES } from "@/components/sales/client-quotes";
import { Block, Group, Heading, PrimaryCta, Rail, Surface, TextLink } from "@/components/sales/apple";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { COACH_NAME } from "@/lib/social-links";
import { trackJoin } from "@/lib/join-funnel";
import { currentLaunchMode } from "@/lib/landing-launch";
import { cn } from "@/lib/utils";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";
import jaredFace from "@/assets/landing/jared-face.jpg";
import shotLog from "@/assets/landing/app-log.webp";
import shotWeek from "@/assets/landing/app-week.webp";
import shotInsights from "@/assets/landing/app-insights.webp";

export const JOIN_TO = "/join" as const;
/** Straight into the coaching application (seven questions, then a call). */
export const COACHING_APPLY_TO = "/coaching/apply" as const;
/** The full coaching page, for anyone who wants to read before applying. */
export const COACHING_TO = "/coaching" as const;
export const JOIN_CTA = "Join free";
export const COACHING_CTA = "Apply for coaching";

/** Who's behind it, in numbers that are true and easy to check. */
const PROOF: Array<[string, string, string]> = [
  ["8", "International medals", "For Team Canada, 7 of them gold"],
  ["2×", "International champion", "NAPF + Commonwealth, 2026"],
  ["100+", "People coached", "First workout to world level"],
  ["13,000+", "Sets logged in the app", "And counting"],
];

/** What the free app is. Each line is a feature a member has today. */
const FREE: string[] = [
  "15 full programs: strength, muscle, running and home",
  "Or build your own, week by week",
  "A log that fills in your reps and remembers last time",
  "PRs, estimated maxes and progress, worked out for you",
  "Nutrition targets and a food log",
  "The Crew, and a League that resets every month",
];

/** What coaching adds. Each line is something a coaching client gets today. */
const COACHING: string[] = [
  "Everything in the app",
  "Training written for you and adjusted as you go",
  "Nutrition and a meal plan you can actually prep",
  "A weekly check-in I read and answer myself",
  "Film a set and get feedback in your chat",
  "Message me directly, and book a call when you need one",
  "Online from anywhere, or in person in Selkirk, MB",
];

/** The free app on its real screens. */
const SCREENS: Array<{ title: string; body: string; src: string; alt: string }> = [
  {
    title: "Your week, planned",
    body: "Pick a program and the workouts land on the days you train. Busy Tuesday? Move it.",
    src: shotWeek,
    alt: "The Workouts screen: this week's calendar, today's lower body workout in progress, and the program at week 7 of 13",
  },
  {
    title: "Log a set in seconds",
    body: "Your reps and RPE are already filled in. Type the weight and you're done, with last time right on the card.",
    src: shotLog,
    alt: "The workout logger: back squat, 4 × 5 at RPE 7, last time 290 lb × 5, three sets logged at 295 lb",
  },
  {
    title: "Proof it's working",
    body: "PRs, estimated maxes and volume, worked out from what you log. No spreadsheet.",
    src: shotInsights,
    alt: "Training analytics: squat, bench and deadlift estimated maxes up 10 to 14 percent over 12 weeks",
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What's actually free?",
    a: "The whole app: programs, the log, your PRs and progress, nutrition targets, the food log and the Crew. No card, no trial, nothing that turns into a charge later.",
  },
  {
    q: "What does coaching cost?",
    a: "It depends on what you need: online, in person in Selkirk, or both. Apply, and we'll go over the options and the price on a call before you commit to anything.",
  },
  {
    q: "Why do I have to apply for a free app?",
    a: "I read every application myself. It keeps the Crew made of people who actually train, and it means I can point you to the right program on day one. Most people are in within a day.",
  },
  {
    q: "I'm new to lifting. Is this for me?",
    a: "Yes. Four of the programs are built for beginners, and the app tells you exactly what to do each day.",
  },
  {
    q: "Do I need a gym?",
    a: "No. Three programs are built for home: bodyweight only, one pair of dumbbells, or a basic home setup.",
  },
  {
    q: "Can I start free and get coaching later?",
    a: "Yes, and it's a good way to do it. Your training history stays, so when you move to coaching I start from everything you've already logged.",
  },
];

function Ticks({ items, tone = "default" }: { items: string[]; tone?: "default" | "inverse" }) {
  return (
    <ul className="space-y-2.5 text-[15px] leading-snug">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-3">
          <Check
            className={cn(
              "mt-0.5 h-[18px] w-[18px] shrink-0",
              tone === "inverse" ? "text-background/70" : "text-success",
            )}
            strokeWidth={2.5}
            aria-hidden
          />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** The quiet second way in: same size as the primary, never red. */
function SecondaryCta({
  to,
  children,
  className,
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to as any}
      className={cn(
        "inline-flex h-[54px] items-center justify-center gap-1.5 rounded-2xl px-7 text-[17px] font-semibold text-foreground ring-1 ring-inset ring-foreground/20 transition hover:bg-secondary active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function LandingPage() {
  useEffect(() => {
    // a signed-in launch renders this hidden for a moment: only real visitors count
    if (currentLaunchMode() === "landing") trackJoin("landing_view");
  }, []);

  return (
    <SalesPageShell pageId="landing" joinCta>
      {/* 1. Who's behind it, what it is, what costs money, and both ways in */}
      <section
        className="mx-auto grid max-w-5xl gap-12 px-5 pb-14 pt-6 md:pt-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-10 lg:pb-20"
        data-landing-hero
      >
        <div className="jf-auth-rise text-center lg:text-left">
          <p className="text-[13px] font-semibold text-muted-foreground">
            {COACH_NAME} · Team Canada powerlifter
          </p>
          <h1 className="mx-auto mt-3 max-w-[13ch] text-balance text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] md:text-[64px] lg:mx-0">
            Structure beats motivation.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[18px] leading-relaxed text-muted-foreground md:text-[19px] lg:mx-0">
            JF Effect is the app I coach in. Real programs, a log that remembers every set, and a
            crew that notices your PRs.
          </p>
          <p
            className="mx-auto mt-3 max-w-xl text-[18px] font-semibold leading-snug md:text-[19px] lg:mx-0"
            data-landing-split
          >
            The app is free. Coaching with me is the paid part.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <PrimaryCta to={JOIN_TO} className="sm:min-w-[200px]">
              {JOIN_CTA}
            </PrimaryCta>
            <SecondaryCta to={COACHING_TO} className="sm:min-w-[200px]">
              Coaching with Jared
            </SecondaryCta>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Joining takes about a minute. No card.
          </p>
        </div>

        {/* The athlete, and the app he coaches in */}
        <div className="relative mx-auto w-full max-w-[380px] pb-10 lg:max-w-[440px] lg:pb-12">
          <img
            src={jaredAsset.url}
            alt={`${COACH_NAME} deadlifting for Team Canada at an IPF competition`}
            width={1536}
            height={1536}
            decoding="async"
            fetchPriority="high"
            className="aspect-[4/5] w-[86%] rounded-3xl object-cover object-[center_28%] ring-1 ring-border/70"
          />
          <div className="absolute bottom-0 right-0 w-[42%]">
            <PhoneShot src={shotWeek} alt="" />
          </div>
        </div>
      </section>

      {/* 2. Why listen */}
      <div className="mx-auto max-w-5xl px-5">
        <div
          className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-border/70 md:grid-cols-4"
          data-landing-proof
        >
          {PROOF.map(([value, label, detail]) => (
            <div key={label} className="bg-card px-4 py-5 text-center">
              <div className="text-[24px] font-semibold leading-none tracking-[-0.02em] md:text-[30px]">
                {value}
              </div>
              <div className="mt-2 text-[13px] font-semibold">{label}</div>
              <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. The two, side by side */}
      <Reveal>
        <Block id="choose">
          <Heading
            eyebrow="Two ways to train"
            title="Same app. Different level of help."
            sub="Everyone trains in the same app. Coaching adds me: your plan, your nutrition, and someone checking your work every week."
          />
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2 md:gap-5">
            <div
              className="flex flex-col rounded-2xl bg-card p-6 ring-1 ring-border/70 md:p-7"
              data-landing-plan="free"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[19px] font-semibold tracking-[-0.01em]">The app</h3>
                <div className="text-[26px] font-semibold tracking-[-0.02em]">Free</div>
              </div>
              <p className="mt-1.5 text-[15px] text-muted-foreground">
                You run your training. The app keeps you honest.
              </p>
              <div className="mt-5 flex-1">
                <Ticks items={FREE} />
              </div>
              <PrimaryCta to={JOIN_TO} full className="mt-7">
                {JOIN_CTA}
              </PrimaryCta>
              <p className="mt-2.5 text-center text-[13px] text-muted-foreground">
                About a minute to apply. No card.
              </p>
            </div>

            <div
              className="flex flex-col rounded-2xl bg-foreground p-6 text-background md:p-7"
              data-landing-plan="coaching"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[19px] font-semibold tracking-[-0.01em]">1:1 coaching</h3>
                <div className="text-[26px] font-semibold tracking-[-0.02em]">Paid</div>
              </div>
              <p className="mt-1.5 text-[15px] text-background/70">
                I write it, check it every week, and change it when it needs changing.
              </p>
              <div className="mt-5 flex-1">
                <Ticks items={COACHING} tone="inverse" />
              </div>
              <Link
                to={COACHING_APPLY_TO}
                className="mt-7 inline-flex h-[54px] w-full items-center justify-center rounded-2xl bg-background text-[17px] font-semibold text-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {COACHING_CTA}
              </Link>
              <p className="mt-2.5 text-center text-[13px] text-background/70">
                Free to apply. We talk price before you commit.
              </p>
            </div>
          </div>
        </Block>
      </Reveal>

      {/* 4. The free app, on its real screens */}
      <Reveal>
        <Block id="app" tint>
          <Heading
            eyebrow="The free app"
            title="Free doesn't mean watered down."
            sub="It's the same app my coaching clients train in. Over 2,000 exercises, almost every one with a how-to video."
          />
          <div className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {SCREENS.map((s) => (
              <div
                key={s.title}
                className="w-[70vw] max-w-[280px] shrink-0 snap-start md:w-auto md:max-w-none"
              >
                <PhoneShot src={s.src} alt={s.alt} className="max-w-[230px]" />
                <h3 className="mt-5 text-[18px] font-semibold leading-snug tracking-[-0.01em]">
                  {s.title}
                </h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-center">
            <PrimaryCta to={JOIN_TO} className="w-full sm:w-auto sm:min-w-[260px]">
              {JOIN_CTA}
            </PrimaryCta>
          </div>
        </Block>
      </Reveal>

      {/* 5. Coaching, and what it's done for people */}
      <Reveal>
        <Block id="coaching">
          <div className="mx-auto max-w-2xl text-center">
            <div className="flex items-center justify-center gap-3">
              <img
                src={jaredFace}
                alt=""
                width={256}
                height={256}
                loading="lazy"
                decoding="async"
                className="h-11 w-11 rounded-full object-cover ring-1 ring-border/70"
              />
              <div className="text-left">
                <div className="text-[15px] font-semibold leading-tight">Coaching with {COACH_NAME.split(" ")[0]}</div>
                <div className="text-[13px] text-muted-foreground">Training people since 2017 · Drug-tested athlete</div>
              </div>
            </div>
            <h2 className="mt-6 text-balance text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] md:text-[40px]">
              The app tells you what to do. I tell you what to change.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
              Most people who come to me have already tried hard, more than once. What they were
              missing was a plan built for them and someone watching it every week.
            </p>
          </div>

          <div className="mt-10">
            <Rail label="Coaching client results">
              {TRANSFORMATION_PHOTOS.slice(0, 8).map((photo, i) => (
                <div
                  key={i}
                  className="w-[58vw] max-w-[240px] shrink-0 snap-start overflow-hidden rounded-2xl bg-muted ring-1 ring-border/70"
                >
                  <img
                    src={photo.url}
                    alt="A coaching client's before and after"
                    loading="lazy"
                    decoding="async"
                    width={400}
                    height={400}
                    className="aspect-square w-full scale-[1.18] object-cover object-top"
                  />
                </div>
              ))}
            </Rail>
          </div>

          <div className="-mx-5 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {CLIENT_QUOTES.map((c) => (
              <Surface
                key={c.name}
                className="flex w-[80vw] max-w-[330px] shrink-0 snap-start flex-col p-5 md:w-auto md:max-w-none"
              >
                <Quote className="h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="mt-3 flex-1 text-[15px] leading-relaxed">“{c.quote}”</p>
                <div className="mt-4 border-t border-border/70 pt-3">
                  <div className="text-[15px] font-semibold">{c.name}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {c.result} · {c.role}
                  </div>
                </div>
              </Surface>
            ))}
          </div>
          <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Real coaching clients. Results depend on where you start and the work you put in.
          </p>

          <div className="mt-9 flex flex-col items-center gap-4">
            <SecondaryCta to={COACHING_APPLY_TO} className="w-full sm:w-auto sm:min-w-[260px]">
              {COACHING_CTA}
            </SecondaryCta>
            <TextLink to={COACHING_TO}>How coaching works</TextLink>
          </div>
        </Block>
      </Reveal>

      {/* 6. Their questions */}
      <Reveal>
        <Block narrow tint>
          <Heading eyebrow="Questions" title="Straight answers." />
          <Group>
            <Accordion type="single" collapsible>
              {FAQ.map((it, i) => (
                <AccordionItem
                  key={it.q}
                  value={`faq-${i}`}
                  className="border-0 px-5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70"
                >
                  <AccordionTrigger className="py-4 text-left text-[17px] font-medium hover:no-underline">
                    {it.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">
                    {it.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* 7. Both ways in, once more */}
      <Reveal>
        <Block narrow>
          <div className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              Start with the app. Or start with me.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Either way, I read your application.
            </p>
            <div className="mx-auto mt-7 flex max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
              <PrimaryCta to={JOIN_TO} className="sm:min-w-[220px]">
                {JOIN_CTA}
              </PrimaryCta>
              <SecondaryCta to={COACHING_APPLY_TO} className="sm:min-w-[220px]">
                {COACHING_CTA}
              </SecondaryCta>
            </div>
            <p className="mt-5 text-[14px] text-muted-foreground">
              Already a member?{" "}
              <Link
                to="/auth"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={JOIN_CTA} href={JOIN_TO} />
    </SalesPageShell>
  );
}

/** For the tests: what the page promises, kept with the page. */
export const LANDING_COPY = { FREE, COACHING, FAQ, PROOF } as const;

