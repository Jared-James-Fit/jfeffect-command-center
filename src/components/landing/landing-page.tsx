/**
 * jfeffect.com's front door (signed-out visitors on "/"): what JF Effect is,
 * why it's worth joining, that it's free, and one button to apply. Real app
 * screens (a made-up athlete, never a client: scripts/coaching-screenshots),
 * real numbers, Jared's own words. Coaching is offered, never pushed.
 *
 * Order follows how someone decides: what it is and the button; why listen;
 * what you get, shown on the real screens; the crew; free vs coaching; how
 * joining works (and why there's an application); who's behind it; their
 * questions; the button again.
 */
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck2, CheckCircle2, Dumbbell, Flame, MessageCircle, Trophy, Users } from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { PhoneShot } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { Block, Group, Heading, IconTile, PrimaryCta, Surface, TextLink } from "@/components/sales/apple";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { COACH_NAME } from "@/lib/social-links";
import { trackJoin } from "@/lib/join-funnel";
import { currentLaunchMode } from "@/lib/landing-launch";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";
import shotLog from "@/assets/landing/app-log.webp";
import shotWeek from "@/assets/landing/app-week.webp";
import shotInsights from "@/assets/landing/app-insights.webp";

export const JOIN_TO = "/join" as const;
const CTA = "Get started free";

/** What a member gets, each on the screen it lives on (the program screen is the hero's). */
const FEATURES: Array<{ title: string; body: string; src: string; alt: string }> = [
  {
    title: "Log every set in seconds",
    body: "Reps and RPE come from your program, so most sets only need a weight. Last time and a suggested weight sit right on the card.",
    src: shotLog,
    alt: "The workout logger: back squat, 4 × 5 at RPE 7, last time 290 lb × 5, three sets logged at 295 lb",
  },
  {
    title: "Proof it's working",
    body: "PRs, estimated maxes and volume, worked out for you from what you log. No spreadsheets, no guessing.",
    src: shotInsights,
    alt: "Training analytics: squat, bench and deadlift estimated maxes up 10 to 14 percent over 12 weeks",
  },
];

const HERO = {
  src: shotWeek,
  alt: "The Workouts screen: this week's calendar, today's lower body workout in progress, and the program at week 7 of 13",
};

const ALSO = [
  { icon: CalendarCheck2, title: "Programs that run your week", body: "Coach-written for your goal and level, or build your own. Workouts land on your training days." },
  { icon: Dumbbell, title: "2,000+ exercises", body: "Almost every one with a how-to video, so you know you're doing it right." },
  { icon: Flame, title: "Nutrition", body: "Set your calories and macros, and log what you eat." },
];

const CREW = [
  { icon: Users, title: "Share your wins", body: "Post a PR or a workout and the crew sees it. Follow the people you train with." },
  { icon: Trophy, title: "Monthly League", body: "Points for showing up and logging your training. See where you rank every month." },
  { icon: MessageCircle, title: "Copy what works", body: "Members share the programs they build. Save one and make it yours." },
];

const STEPS = [
  { title: "Apply in about a minute", body: "Your goal, your experience, and the best way to reach you. No account, no card." },
  { title: "Jared reads it", body: "Usually within a day. He might send you a quick message to say hi. No call needed unless you want one." },
  { title: "You get your invite", body: "Tap the link, set a password, and pick your first program." },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Is it really free?",
    a: "Yes. Programs, logging, progress, nutrition and the Crew are free. No card, no trial that turns into a charge.",
  },
  {
    q: "Why do I have to apply?",
    a: "I read every application myself. It keeps the Crew made of people who actually train, and it lets me point you to the right program from day one. It takes about a minute.",
  },
  {
    q: "How long until I'm in?",
    a: "Usually within a day. You'll get an email with your link, and I might message you first to say hi.",
  },
  {
    q: "I'm a beginner. Is this for me?",
    a: "Yes. There are programs built for people who are brand new, and the app tells you exactly what to do each day.",
  },
  {
    q: "Do I need a gym?",
    a: "No. There are programs for a full gym and for training at home, and you can build your own around what you have.",
  },
  {
    q: "What's the difference between free and coaching?",
    a: "Free gets you the app and the Crew, and you run your own training. Coaching is paid and optional: I write your program and nutrition, read your weekly check-in and review your lifts.",
  },
];

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5 text-[15px]">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function LandingPage() {
  useEffect(() => {
    // a signed-in launch renders this hidden for a moment: only real visitors count
    if (currentLaunchMode() === "landing") trackJoin("landing_view");
  }, []);

  return (
    <SalesPageShell pageId="landing" joinCta>
      {/* 1. What it is, and the one button */}
      <section className="mx-auto grid max-w-5xl gap-10 px-5 pb-12 pt-6 md:pb-16 md:pt-14 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
        <div className="jf-auth-rise text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-[13px] font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            Free to join · No card
          </div>
          <h1 className="mx-auto mt-4 max-w-[15ch] text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] md:text-[60px] lg:mx-0">
            Train with a plan. Watch it work.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[18px] leading-relaxed text-muted-foreground md:text-[19px] lg:mx-0">
            JF Effect is a free training app and crew, built by Team Canada powerlifter {COACH_NAME}. Real programs, a log
            that tracks every set and PR, and people who notice when you hit one.
          </p>
          <div className="mt-7 flex flex-col items-stretch sm:items-center lg:items-start">
            <PrimaryCta to={JOIN_TO} className="sm:min-w-[280px]">
              {CTA}
            </PrimaryCta>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">About a minute to apply · Jared reads every one</p>
        </div>
        <div className="relative mx-auto w-full max-w-[290px] md:max-w-[320px]">
          <PhoneShot src={HERO.src} alt={HERO.alt} priority className="relative z-10" />
          <div aria-hidden className="pointer-events-none absolute -right-24 top-16 hidden w-[230px] opacity-90 lg:block">
            <PhoneShot src={shotInsights} alt="" />
          </div>
        </div>
      </section>

      {/* 2. Why listen */}
      <div className="mx-auto max-w-5xl px-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-border/70 md:grid-cols-4">
          {[
            ["Team Canada", "2× international champion", "Powerlifting · 2026"],
            ["100+", "Athletes coached", "Fat loss to world level"],
            ["13,000+", "Sets logged in the app", "And counting"],
            ["$0", "To join", "No card, no trial"],
          ].map(([value, label, detail]) => (
            <div key={label} className="bg-card px-4 py-5 text-center">
              <div className="text-[24px] font-semibold leading-none tracking-[-0.02em] md:text-[30px]">{value}</div>
              <div className="mt-2 text-[13px] font-semibold">{label}</div>
              <div className="mt-1 text-[12px] leading-snug text-muted-foreground">{detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. What you get, on the real screens */}
      <Reveal>
        <Block id="features">
          <Heading
            eyebrow="What you get"
            title="Everything you need to get stronger."
            sub="One app for your program, your log and your progress. Here's what it looks like."
          />
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-auto md:grid md:max-w-3xl md:grid-cols-2 md:gap-10 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {FEATURES.map((f) => (
              <div key={f.title} className="w-[78vw] max-w-[320px] shrink-0 snap-start md:w-auto md:max-w-none">
                <PhoneShot src={f.src} alt={f.alt} className="max-w-[230px]" />
                <h3 className="mt-5 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-10 grid max-w-4xl gap-3 md:grid-cols-3">
            {ALSO.map(({ icon: Icon, title, body }) => (
              <Surface key={title} className="flex items-start gap-3 p-4">
                <IconTile>
                  <Icon className="h-5 w-5" aria-hidden />
                </IconTile>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{title}</div>
                  <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">{body}</p>
                </div>
              </Surface>
            ))}
          </div>
        </Block>
      </Reveal>

      {/* 4. The crew */}
      <Reveal>
        <Block tint>
          <Heading
            eyebrow="The Crew"
            title="You don't have to train alone."
            sub="Everyone here is chasing something. Show up, log it, and people notice."
          />
          <Group className="mx-auto max-w-2xl">
            {CREW.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4 px-5 py-4">
                <IconTile>
                  <Icon className="h-5 w-5" aria-hidden />
                </IconTile>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </Group>
        </Block>
      </Reveal>

      {/* 5. Free vs coaching */}
      <Reveal>
        <Block>
          <Heading eyebrow="Free, or coached" title="Start free. Get a coach if you want one." />
          <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
            <Surface className="flex flex-col p-6 ring-2 ring-foreground/15">
              <div className="flex items-baseline justify-between">
                <div className="text-[17px] font-semibold">Free membership</div>
                <div className="text-[22px] font-semibold tracking-[-0.02em]">$0</div>
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">You run your training. The app keeps you honest.</p>
              <div className="mt-4 flex-1">
                <CheckList
                  items={[
                    "Coach-written programs, or build your own",
                    "Log every set, PR and estimated max",
                    "Progress and analytics",
                    "Nutrition targets and a food log",
                    "The Crew and the monthly League",
                  ]}
                />
              </div>
              <PrimaryCta to={JOIN_TO} full className="mt-6">
                {CTA}
              </PrimaryCta>
            </Surface>
            <Surface className="flex flex-col p-6">
              <div className="flex items-baseline justify-between">
                <div className="text-[17px] font-semibold">1:1 Coaching</div>
                <div className="text-[14px] font-medium text-muted-foreground">Paid · optional</div>
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">Jared runs your training with you.</p>
              <div className="mt-4 flex-1">
                <CheckList
                  items={[
                    "Everything in free",
                    "Training written for you, adjusted every week",
                    "Nutrition and a meal plan you can follow",
                    "A weekly check-in Jared reads and answers",
                    "Lift video reviews in your chat",
                  ]}
                />
              </div>
              <div className="mt-6 text-center">
                <TextLink to="/coaching">Learn about coaching</TextLink>
              </div>
            </Surface>
          </div>
          <p className="mt-5 text-center text-[13px] text-muted-foreground">Coaching is never required. Most people start free.</p>
        </Block>
      </Reveal>

      {/* 6. How joining works, and why there's an application */}
      <Reveal>
        <Block id="how" tint narrow>
          <Heading eyebrow="How joining works" title="Three steps, and you're training." />
          <Group>
            {STEPS.map((st, i) => (
              <div key={st.title} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-[14px] font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{st.title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{st.body}</p>
                </div>
              </div>
            ))}
          </Group>
          <p className="mx-auto mt-5 max-w-lg text-center text-[15px] leading-relaxed text-muted-foreground">
            Why an application? I read every one and say hi to the people who join. It keeps the Crew real.
          </p>
        </Block>
      </Reveal>

      {/* 7. Who's behind it */}
      <Reveal>
        <Block>
          <Surface className="mx-auto max-w-4xl overflow-hidden md:grid md:grid-cols-2">
            <div className="relative md:min-h-[420px]">
              <img
                src={jaredAsset.url}
                alt={`${COACH_NAME} deadlifting for Team Canada at an IPF competition`}
                loading="lazy"
                decoding="async"
                width={1536}
                height={1536}
                className="aspect-square h-auto w-full object-cover object-[center_31%] md:absolute md:inset-0 md:aspect-auto md:h-full"
              />
            </div>
            <div className="p-6 md:self-center md:p-8">
              <div className="text-[13px] font-semibold text-muted-foreground">Built by</div>
              <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{COACH_NAME}</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">Team Canada powerlifter · 2× international champion</p>
              <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                I've coached 100+ people, from their first workout to world championships, and I still compete myself. JF Effect is
                everything I use to coach, built so you can use it too. Structure and standards beat motivation every time.
              </p>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
                <TextLink to="/about">Read my story</TextLink>
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      {/* 8. Their questions */}
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
                  <AccordionTrigger className="py-4 text-left text-[17px] font-medium hover:no-underline">{it.q}</AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{it.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* 9. The button again */}
      <Reveal>
        <Block narrow>
          <div className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              Done guessing? Start here.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Free to join. About a minute to apply. Jared reads every one.
            </p>
            <div className="mt-7 flex justify-center">
              <PrimaryCta to={JOIN_TO} className="w-full sm:w-auto sm:min-w-[280px]">
                {CTA}
              </PrimaryCta>
            </div>
            <p className="mt-4 text-[14px] text-muted-foreground">
              Already a member?{" "}
              <Link to="/auth" className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={CTA} href={JOIN_TO} />
    </SalesPageShell>
  );
}
