/**
 * jfeffect.com's front door (signed-out visitors on "/"). JF Effect is a
 * coaching brand with its own app: the app is free to use (by application, no
 * card) and 1:1 online coaching with Jared is a paid service (by application,
 * priced on a call). The page sells the free app first and coaching as its own
 * premium offer, never as a row in a price table.
 *
 * Order: who built it and both ways in; why listen; the app on its real
 * screens; online coaching (what Jared does for you, shown in the chat where
 * it happens) and client results; questions; one last way in.
 *
 * Words are Jared's: plain, short, first person, no fitness-marketing lines
 * (landing-free-vs-coaching.test.ts keeps them out). Coaching is online only
 * on every public page. Every claim is checked against the product and the
 * database (Nov 20 2026): 15 live JF Effect programs (4 for beginners, 3 for
 * home), 2,000+ exercises with a how-to video for almost all of them, Jared's
 * record as the About page states it; client words and photos from the
 * Coaching page. App screens are a made-up athlete, never a client
 * (scripts/coaching-screenshots).
 */
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Apple, Dumbbell, PencilLine, Quote, Users } from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { PhoneShot } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { TRANSFORMATION_PHOTOS } from "@/components/sales/transformations-strip";
import { CLIENT_QUOTES } from "@/components/sales/client-quotes";
import { Block, Group, Heading, PrimaryCta, Rail, Surface } from "@/components/sales/apple";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { COACH_NAME } from "@/lib/social-links";
import { trackJoin } from "@/lib/join-funnel";
import { currentLaunchMode } from "@/lib/landing-launch";
import { HOME_CTA_ZONES } from "@/lib/public-nav";
import { cn } from "@/lib/utils";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";
import shotLog from "@/assets/landing/app-log.webp";
import shotWeek from "@/assets/landing/app-week.webp";
import shotInsights from "@/assets/landing/app-insights.webp";
import shotChat from "@/assets/coaching/app-coach-chat.webp";

export const JOIN_TO = "/join" as const;
/** Straight into the coaching application (seven questions, then a call). */
export const COACHING_APPLY_TO = "/coaching/apply" as const;
/** The full coaching page, for anyone who wants to read before applying. */
export const COACHING_TO = "/coaching" as const;
export const JOIN_CTA = "Join free";
export const COACHING_CTA = "Apply for coaching";

const HERO = {
  title: "Train in the same app my clients use.",
  body: "My programs, a log that keeps every set and PR, and a crew to train with. Use it free, or hire me to coach you online.",
};

/** Who's behind it, in numbers that are true and easy to check. */
const PROOF: Array<[string, string, string]> = [
  ["8", "International medals", "Team Canada, 7 of them gold"],
  ["2×", "International champion", "NAPF and Commonwealth, 2026"],
  ["100+", "People coached", "Beginners to IPF Worlds"],
  ["15", "Programs in the app", "Strength, muscle, running, home"],
];

/** The free app on its real screens. */
const SCREENS: Array<{ title: string; body: string; src: string; alt: string }> = [
  {
    title: "Your program, on your calendar",
    body: "Pick one of my programs and the workouts land on the days you train. If your week changes, move them.",
    src: shotWeek,
    alt: "The Workouts screen: this week's calendar, today's lower body workout in progress, and the program at week 7 of 13",
  },
  {
    title: "Log a set in seconds",
    body: "Reps and RPE are filled in from the program. Type the weight and it's logged, with last time on the same card.",
    src: shotLog,
    alt: "The workout logger: back squat, 4 × 5 at RPE 7, last time 290 lb × 5, three sets logged at 295 lb",
  },
  {
    title: "See what's working",
    body: "PRs, estimated maxes and weekly volume, worked out from what you log.",
    src: shotInsights,
    alt: "Training analytics: squat, bench and deadlift estimated maxes up 10 to 14 percent over 12 weeks",
  },
];

/** The rest of the free app, one line each. Each is something a member has today. */
const FREE: Array<{ icon: typeof Dumbbell; text: string }> = [
  { icon: Dumbbell, text: "2,000+ exercises, almost all with a how-to video" },
  { icon: PencilLine, text: "Write your own program, week by week" },
  { icon: Apple, text: "Nutrition targets and a food log" },
  { icon: Users, text: "The Crew, and a League that resets every month" },
];

/** What Jared does as an online coach. Each line is something a coaching client gets today. */
const COACHING: Array<{ title: string; body: string }> = [
  {
    title: "Your program",
    body: "Written for your goal, your schedule and your equipment, and changed as you progress.",
  },
  {
    title: "Weekly check-ins",
    body: "You check in from the app. I go through it with your numbers and tell you what's changing and why.",
  },
  {
    title: "Nutrition",
    body: "Calories, macros and a meal plan built around the food you eat, updated as your bodyweight moves.",
  },
  {
    title: "Technique and questions",
    body: "Film a set or ask me something in our chat. I usually reply within a day.",
  },
  {
    title: "Meet prep",
    body: "If you compete, we plan your season, your peak and your weight class together.",
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What's free?",
    a: "The app: my programs, the training log, your PRs and progress, nutrition targets, the food log and the Crew. No card, and nothing turns into a charge later.",
  },
  {
    q: "Why do I have to apply for a free app?",
    a: "I read every application myself. It keeps the Crew to people who train, and I can point you to the right program on day one. Most people are in within a day.",
  },
  {
    q: "How does online coaching work?",
    a: "Everything runs through the app: your program, your nutrition, weekly check-ins, video feedback and our chat. It works wherever you train, at home or in a gym.",
  },
  {
    q: "What does coaching cost?",
    a: "It depends on what you need. Apply, and we'll go over the options and the price on a short call before you commit to anything.",
  },
  {
    q: "I'm new to lifting. Is this for me?",
    a: "Yes. Four of my programs are written for beginners, and the app shows you what to do each day. Three are for training at home.",
  },
  {
    q: "Can I start with the app and get coaching later?",
    a: "Yes. Your training history stays, so when you move to coaching I start from everything you've already logged.",
  },
];

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
    <SalesPageShell pageId="landing" ctaZones={HOME_CTA_ZONES}>
      {/* 1. Who built it, and both ways in */}
      <section
        className="mx-auto grid max-w-5xl gap-12 px-5 pb-14 pt-6 md:pt-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-10 lg:pb-20"
        data-landing-hero
      >
        <div className="jf-auth-rise text-center lg:text-left">
          <p className="text-[13px] font-semibold text-muted-foreground">
            {COACH_NAME} · Team Canada powerlifter
          </p>
          <h1 className="mx-auto mt-3 max-w-[16ch] text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[58px] lg:mx-0">
            {HERO.title}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[18px] leading-relaxed text-muted-foreground md:text-[19px] lg:mx-0">
            {HERO.body}
          </p>
          <div
            className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start"
            data-inline-cta
          >
            <PrimaryCta to={JOIN_TO} className="sm:min-w-[200px]">
              {JOIN_CTA}
            </PrimaryCta>
            <SecondaryCta to={COACHING_TO} className="sm:min-w-[200px]">
              Online coaching
            </SecondaryCta>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            About a minute to apply. No card.
          </p>
        </div>

        {/* The athlete, and the app he built */}
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

      {/* 3. The app: free, on its real screens */}
      <Reveal>
        <Block id="app" tint>
          <Heading eyebrow="The app" title="Here's what you get, free." />
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
          <ul
            className="mx-auto mt-10 grid max-w-3xl gap-x-8 gap-y-3.5 text-[15px] sm:grid-cols-2"
            data-landing-free
          >
            {FREE.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-background ring-1 ring-border/70">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-col items-center" data-inline-cta>
            <PrimaryCta to={JOIN_TO} className="w-full sm:w-auto sm:min-w-[260px]">
              {JOIN_CTA}
            </PrimaryCta>
          </div>
        </Block>
      </Reveal>

      {/* 4. Online coaching: what I do for you, then what it's done for people */}
      <div data-cta-zone="coaching">
        <Reveal>
          <section id="coaching" className="scroll-mt-20 px-3 py-14 sm:px-5 md:py-20">
            <div
              className="mx-auto max-w-5xl overflow-hidden rounded-[28px] bg-foreground text-background"
              data-landing-coaching
            >
              <div className="grid gap-10 px-6 py-10 sm:px-8 md:py-14 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:gap-12 lg:px-14">
                <div>
                  <p className="text-[13px] font-semibold text-background/60">
                    Online coaching with {COACH_NAME}
                  </p>
                  <h2 className="mt-2 text-balance text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] md:text-[48px]">
                    I'll run your training.
                  </h2>
                  <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-background/75">
                    I write your program and nutrition around your goal, your schedule and your
                    equipment. Every week I read your check-in, go through what you logged, and
                    decide what changes. Your job is to train and report back.
                  </p>

                  <dl className="mt-8 divide-y divide-background/15 border-y border-background/15">
                    {COACHING.map((c) => (
                      <div
                        key={c.title}
                        className="grid gap-0.5 py-3.5 sm:grid-cols-[170px_1fr] sm:gap-5"
                      >
                        <dt className="text-[15px] font-semibold">{c.title}</dt>
                        <dd className="text-[15px] leading-relaxed text-background/70">{c.body}</dd>
                      </div>
                    ))}
                  </dl>

                  <div
                    className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center"
                    data-inline-cta
                  >
                    <Link
                      to={COACHING_APPLY_TO}
                      className="inline-flex h-[54px] items-center justify-center rounded-2xl bg-background px-8 text-[17px] font-semibold text-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {COACHING_CTA}
                    </Link>
                    <Link
                      to={COACHING_TO}
                      className="text-center text-[15px] font-medium text-background/80 underline-offset-4 hover:text-background hover:underline"
                    >
                      How coaching works
                    </Link>
                  </div>
                  <p className="mt-4 text-[13px] leading-relaxed text-background/60">
                    It's by application. We'll go over price on a quick call before you commit to
                    anything. I keep my client list small so every check-in gets my full attention.
                  </p>
                </div>

                <div className="mx-auto w-full max-w-[230px] lg:max-w-[280px]">
                  <PhoneShot
                    src={shotChat}
                    alt="A weekly check-in in the JF Effect app and the coach's reply: calories stay the same, the squat moves up to 295, and a request for a video of the first set"
                    className="ring-white/15"
                  />
                  <p className="mt-4 text-center text-[13px] leading-snug text-background/60">
                    A week of coaching: check-in, adjustments, a set to film.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </Reveal>

        <Reveal>
          <Block className="!pt-0">
            <Heading
              eyebrow="Coaching clients"
              title="Some of the people I've coached."
              sub="Fat loss, muscle and strength. Swipe for more."
            />
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
              Coaching clients. Results depend on where you start and the work you put in.
            </p>
          </Block>
        </Reveal>
      </div>

      {/* 5. Questions */}
      <Reveal>
        <Block narrow tint>
          <Heading title="Questions" />
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

      {/* 6. One last way in */}
      <Reveal>
        <Block narrow>
          <div className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              Start with the app.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              It's free, and applying takes about a minute. I read every one.
            </p>
            <div className="mx-auto mt-7 flex max-w-md flex-col items-center gap-4" data-inline-cta>
              <PrimaryCta to={JOIN_TO} className="w-full sm:w-auto sm:min-w-[260px]">
                {JOIN_CTA}
              </PrimaryCta>
              <Link
                to={COACHING_APPLY_TO}
                className="text-[15px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Looking for coaching? Apply here
              </Link>
            </div>
            <p className="mt-6 text-[14px] text-muted-foreground">
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
      <StickyMobileCta label={JOIN_CTA} href={JOIN_TO} zones={HOME_CTA_ZONES} hideWhenInline />
    </SalesPageShell>
  );
}

/** For the tests: what the page promises, kept with the page. */
export const LANDING_COPY = { HERO, FREE, COACHING, FAQ, PROOF, SCREENS } as const;
