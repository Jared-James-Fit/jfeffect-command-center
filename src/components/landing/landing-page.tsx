/**
 * jfeffect.com's front door (signed-out visitors on "/"). JF Effect is a
 * coaching brand with its own app: the app is free to use (by application, no
 * card) and 1:1 online coaching with Jared is a paid service (by application).
 *
 * The page is told the way a product is launched (Nov 23 2026): the promise,
 * then the app shown screen by screen until it's clearly worth paying for,
 * then the reveal that it's free; then what a coach adds on top of the tools,
 * then the prices, then the proof, then one plain question: which one is you?
 * The app's own screens carry the page from top to bottom, so a visitor keeps
 * seeing the product rather than reading about it.
 *
 * Anchors are honest: the app is "the same app my coaching clients train in"
 * (true), and the recommended package says how much more it is than the next
 * package on the site (both listed prices, anchorLine). The coaching price is
 * revealed the way the iPad's was (PriceRevealSection, price-reveal.ts): the
 * coaching shown first, then Coaching Plus at its own price, then "Don't need
 * the private calls?" and Complete Online Coaching's price as the moment. Two
 * different products at their listed prices, the calls the only difference:
 * never a crossed-out price, a "worth" number or a fake discount. Prices are read from
 * coaching_packages (the one source of truth, edited in Sales → Coaching
 * packages, drawn by CoachingPackagesGrid), never typed here, and only what's
 * listed shows: a draft package never reaches this page.
 *
 * Words are Jared's: plain, short, first person, no fitness-marketing lines
 * (landing-free-vs-coaching.test.ts keeps them out). Coaching is online only.
 * Every claim is checked against the product and the database: 15 live JF
 * Effect programs (4 for beginners, 3 for home), 2,000+ exercises with a
 * how-to video for almost all of them, Jared's record as the About page
 * states it; client words and photos from the Coaching page. App screens are
 * a made-up athlete, never a client (scripts/coaching-screenshots).
 *
 * Measured anonymously (site-funnel.ts): the landing view, the pricing
 * section coming into view, which button was tapped and which package.
 */
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { Await, Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Dumbbell, Gauge, History, Quote, Users } from "lucide-react";
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
import { trackSite } from "@/lib/site-funnel";
import { currentLaunchMode } from "@/lib/landing-launch";
import { HOME_CTA_ZONES } from "@/lib/public-nav";
import { CoachingPackagesGrid } from "@/components/sales/coaching-packages";
import { PriceRevealSection } from "@/components/landing/price-reveal";
import { priceReveal } from "@/lib/coaching-packages/price-reveal";
import {
  costAnswer,
  decisionRows,
  listedPackages,
  paidPackages,
  type DecisionRow,
  type PublicPackage,
} from "@/lib/coaching-packages/packages";
import { cn } from "@/lib/utils";
import shotLog from "@/assets/landing/app-log.webp";
import shotHome from "@/assets/landing/app-home.webp";
import shotFocus from "@/assets/landing/app-focus.webp";
import shotWeek from "@/assets/landing/app-week.webp";
import shotInsights from "@/assets/landing/app-insights.webp";
import shotFood from "@/assets/landing/app-food.webp";
import shotBuild from "@/assets/landing/app-build.webp";
import shotImport from "@/assets/landing/app-import.webp";
import shotChat from "@/assets/coaching/app-coach-chat.webp";
import shotPlan from "@/assets/coaching/app-nutrition.webp";

export const JOIN_TO = "/join" as const;
/** Straight into the coaching application (seven questions, then a call). */
export const COACHING_APPLY_TO = "/coaching/apply" as const;
/** The full coaching page, for anyone who wants to read before applying. */
export const COACHING_TO = "/coaching" as const;
export const JOIN_CTA = "Get the free app";
export const COACHING_CTA = "Apply for coaching";
export const EXPLORE_CTA = "Explore coaching";
/** The hero's way down to the options, without saying a price before the app's been shown. */
export const PLANS_JUMP = "See plans and prices";

/** The options section's words; the cards themselves come from the packages. */
const PRICING = {
  eyebrow: "Plans and prices",
  title: "Start free. Add a coach when you want one.",
  sub: "Every coaching package includes the full app. Prices in Canadian dollars, plus applicable tax.",
  note: "Applying doesn't charge you. We talk on a short call first, and you only pay once we've agreed to start.",
  more: "How coaching works",
};

const HERO = {
  title: "Train like you have a coach.",
  body: "Follow my programs, build your own, or upload a plan you already have. Log every set in seconds and see what's working. It's the same app my coaching clients train in.",
};

/** Who's behind it, in numbers that are true and easy to check. */
const PROOF: Array<[string, string, string]> = [
  ["8", "International medals", "Team Canada, 7 of them gold"],
  ["2×", "International champion", "NAPF and Commonwealth, 2026"],
  ["100+", "People coached", "Beginners to IPF Worlds"],
  ["15", "Programs in the app", "Strength, muscle, running, home"],
];

/** The app, one capability at a time, each on its own screen. */
const CHAPTERS: Array<{ eyebrow: string; title: string; body: string; src: string; alt: string }> = [
  {
    eyebrow: "Programs",
    title: "Your program, on the days you train.",
    body: "Follow one of my 15 programs or build your own. The workouts land on your training days, and when your week changes, you move them.",
    src: shotWeek,
    alt: "The Workouts screen: this week's calendar, today's lower body workout in progress, the program at week 7 of 13 and this month's progress",
  },
  {
    eyebrow: "Logging",
    title: "Log a set in seconds.",
    body: "Reps and RPE come filled in from the program. Type the weight and it's logged, with last time on the same card.",
    src: shotLog,
    alt: "The workout logger: back squat, 4 × 5 at RPE 7, last time 290 lb × 5, three sets logged at 295 lb",
  },
  {
    eyebrow: "Progress",
    title: "See what's working.",
    body: "Estimated maxes, PRs, volume and consistency, worked out from every set you log.",
    src: shotInsights,
    alt: "Training analytics: the back squat's estimated max climbing to 374 lb over 12 weeks, up 44 lb",
  },
  {
    eyebrow: "Nutrition",
    title: "Eat for your goal.",
    body: "Get your calories and macros, build a meal plan from foods you like, and log what you eat.",
    src: shotFood,
    alt: "The Nutrition screen: a 1,980 calorie meal plan with protein, carbs and fat, and breakfast's foods and amounts",
  },
];

/** Your own program: built in the app, or brought in from a file. Both are in the free app today. */
const OWN: Array<{ title: string; body: string; note: string; src: string; alt: string }> = [
  {
    title: "Build your own",
    body: "Pick how many weeks and days, add exercises from the library, and set the sets, reps, RPE and load. Change one week or every week at once.",
    note: "Save it, start it, and it lands on your calendar like any of mine.",
    src: shotBuild,
    alt: "The program builder: a 12 week upper and lower program, day 1's exercises with their sets, reps, RPE and rest, and the weeks along the bottom",
  },
  {
    title: "Upload one you already have",
    body: "A spreadsheet, a Word doc, a PDF or photos of it. It comes in with its weeks, days and numbers, matched to the exercise library, and you check every line before it's saved.",
    note: "Most files come in within seconds. PDFs and photos take a little longer. What you upload stays private to you.",
    src: shotImport,
    alt: "An imported program being checked: read from a spreadsheet, 8 weeks, 4 days a week, one exercise left to pick from the library",
  },
];

/** The rest of the free app, one line each. Each is something a member has today. */
const FREE: Array<{ icon: typeof Dumbbell; text: string }> = [
  { icon: Dumbbell, text: "2,000+ exercises, almost all with a how-to video" },
  { icon: Gauge, text: "Bar speed on any set, if you train with a velocity tracker" },
  { icon: History, text: "Pause or switch programs and pick up where you left off" },
  { icon: Users, text: "The Crew, and a League that resets every month" },
];

/** The reveal: everything above, said in one line, then the price. */
const REVEAL = {
  lead: "Programs. Logging. Progress. Nutrition. The Crew.",
  title: "The JF Effect app is free.",
  body: "No card, and nothing turns into a charge later. It's the same app my coaching clients train in.",
};

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
    body: "Film a set and I see it with its weight, reps and RPE, plus the bar path and speed the app reads from the video. Ask me anything in our chat. I usually reply within a day.",
  },
  {
    title: "Meet prep",
    body: "If you compete, we plan your season, your peak and your weight class together.",
  },
];

/** Its answer comes from the packages on the site (costAnswer), these words only while they load. */
const COST_QUESTION = "What does coaching cost?";

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What's free?",
    a: "The app: my programs, building or uploading your own, the training log, your PRs and progress, calories and macros, a meal plan you build, the food log and the Crew. No card, and nothing turns into a charge later.",
  },
  {
    q: "Why do I have to apply for a free app?",
    a: "I read every application myself. It keeps the Crew to people who train, and I can point you to the right program on day one. Most people are in within a day.",
  },
  {
    q: "Can I bring a program I already follow?",
    a: "Yes. Upload the spreadsheet, Word doc, PDF or photos, or paste it in. You check it before it's saved and it stays private to you. Reading a PDF or photos uses some of your free monthly credits. Only upload programs you wrote or have permission to use.",
  },
  {
    q: "How does online coaching work?",
    a: "Everything runs through the app: your program, your nutrition, weekly check-ins, video feedback and our chat. It works wherever you train, at home or in a gym.",
  },
  {
    q: COST_QUESTION,
    a: "Applying is free. We talk on a short call before you commit to anything.",
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

/** A client's words as they wrote them, starting with a capital (as quoted in print). */
function sentenceStart(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The quiet second way in: same size as the primary, never red. */
function SecondaryCta({
  href,
  children,
  className,
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(
        "inline-flex h-[54px] items-center justify-center gap-1.5 rounded-2xl px-7 text-[17px] font-semibold text-foreground ring-1 ring-inset ring-foreground/20 transition hover:bg-secondary active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** The packages, whether they came with the page or are still on their way (they never hold the page up). */
type PackagesIn = Promise<PublicPackage[]> | readonly PublicPackage[] | undefined;

function WithPackages({ packages, fallback = null, children }: { packages: PackagesIn; fallback?: ReactNode; children: (list: readonly PublicPackage[]) => ReactNode }) {
  if (!packages) return <>{fallback}</>;
  if (Array.isArray(packages)) return <>{children(packages as readonly PublicPackage[])}</>;
  return (
    <Suspense fallback={fallback}>
      <Await promise={packages as Promise<PublicPackage[]>}>{(list) => <>{children(list)}</>}</Await>
    </Suspense>
  );
}

/** Counts the pricing section once, the first time it's half on screen. */
function usePricingSeen() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          trackSite("pricing_view", "home");
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/**
 * Two of the app's screens, one in front of the other: the hero's product
 * shot. The back phone hides on the smallest phones, where one screen reads
 * better than two half-screens.
 */
function HeroDevices() {
  return (
    <div className="relative mx-auto w-full max-w-[340px] pb-6 sm:max-w-[420px] lg:max-w-[460px]">
      <div className="absolute left-0 top-[9%] hidden w-[52%] -rotate-[5deg] min-[380px]:block">
        <PhoneShot src={shotHome} alt="Home in the JF Effect app: today's workout on the calendar and a bodyweight trend" />
      </div>
      <div className="relative ml-auto w-[64%] min-[380px]:w-[60%]">
        <PhoneShot
          src={shotFocus}
          priority
          alt="A workout in Focus mode: Romanian deadlift, 3 × 8 at RPE 7, the first set logged at 235 lb"
          className="shadow-[0_40px_80px_-36px_rgba(0,0,0,0.6)]"
        />
      </div>
    </div>
  );
}

/** One capability: the words on one side, its screen on the other (alternating on wide screens). */
function Chapter({ c, flip }: { c: (typeof CHAPTERS)[number]; flip: boolean }) {
  return (
    <Reveal>
      <div className="grid items-center gap-8 md:grid-cols-2 md:gap-14" data-landing-chapter>
        <div className={cn("text-center md:text-left", flip && "md:order-2")}>
          <p className="text-[13px] font-semibold text-muted-foreground">{c.eyebrow}</p>
          <h3 className="mt-2 text-balance text-[30px] font-semibold leading-[1.08] tracking-[-0.025em] md:text-[40px]">
            {c.title}
          </h3>
          <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground md:mx-0">{c.body}</p>
        </div>
        <div className={cn(flip && "md:order-1")}>
          <PhoneShot src={c.src} alt={c.alt} className="max-w-[250px] md:max-w-[280px]" />
        </div>
      </div>
    </Reveal>
  );
}

/** "Which one is you?": each way in as one row, the recommended one marked. */
function DecisionList({ rows }: { rows: DecisionRow[] }) {
  return (
    <div className="overflow-hidden rounded-[24px] bg-card ring-1 ring-border/70" data-landing-decide>
      {rows.map((r, i) => {
        const to = r.kind === "free" ? JOIN_TO : COACHING_APPLY_TO;
        const search = r.kind === "free" ? undefined : r.slug === "coaching" ? { from: "decide" } : { package: r.slug, from: "decide" };
        return (
          <Link
            key={r.slug}
            to={to}
            search={search as never}
            onClick={() => (r.kind === "free" ? trackSite("cta_free", "decide") : trackSite("package_select", r.slug))}
            className={cn(
              "group flex items-center gap-4 px-5 py-5 transition hover:bg-secondary/60 sm:px-6",
              i > 0 && "border-t border-border/70",
            )}
            data-decide-row={r.slug}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold leading-snug">{r.line || r.name}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground">
                <span className="font-medium text-foreground">{r.name}</span>
                {/* the price never wraps away from its dot, and the badge stays beside it */}
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{r.price}</span>
                  {r.recommended && (
                    <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">Recommended</span>
                  )}
                </span>
              </p>
            </div>
            <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}

/** Before the packages have loaded (or if they can't be read): the two ways in. */
const FALLBACK_DECISION: DecisionRow[] = [
  { slug: "free", kind: "free", name: "Free app", line: "You want to train on your own.", price: "Free", recommended: false, cta: JOIN_CTA },
  { slug: "coaching", kind: "subscription", name: "Online coaching", line: "You want me to run your training and your nutrition.", price: "By application", recommended: false, cta: COACHING_CTA },
];

export function LandingPage({ packages }: { packages?: PackagesIn } = {}) {
  useEffect(() => {
    // a signed-in launch renders this hidden for a moment: only real visitors count
    if (currentLaunchMode() === "landing") trackJoin("landing_view");
  }, []);
  const pricingRef = usePricingSeen();

  return (
    <SalesPageShell pageId="landing" ctaZones={HOME_CTA_ZONES}>
      {/* A. The promise, the product, and both ways in */}
      <section
        className="mx-auto grid max-w-5xl gap-10 px-5 pb-14 pt-6 md:pt-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-10 lg:pb-20"
        data-landing-hero
      >
        <div className="jf-auth-rise text-center lg:text-left">
          <p className="text-[13px] font-semibold text-muted-foreground">
            {COACH_NAME} · Team Canada powerlifter
          </p>
          <h1 className="mx-auto mt-3 max-w-[14ch] text-balance text-[42px] font-semibold leading-[1.03] tracking-[-0.035em] md:text-[62px] lg:mx-0">
            {HERO.title}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[18px] leading-relaxed text-muted-foreground md:text-[19px] lg:mx-0">
            {HERO.body}
          </p>
          <div
            className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start"
            data-inline-cta
          >
            <PrimaryCta to={JOIN_TO} className="sm:min-w-[210px]" onClick={() => trackSite("cta_free", "hero")}>
              {JOIN_CTA}
            </PrimaryCta>
            <SecondaryCta href="#coaching" className="sm:min-w-[210px]" onClick={() => trackSite("cta_coaching", "hero")}>
              {EXPLORE_CTA}
            </SecondaryCta>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Free, by application. About a minute to apply. No card.
          </p>
          <a
            href="#pricing"
            onClick={() => trackSite("cta_coaching", "hero-plans")}
            className="mt-4 inline-flex items-center gap-1 text-[15px] font-medium text-foreground underline-offset-4 hover:underline"
            data-landing-jump
          >
            {PLANS_JUMP}
            <ChevronDown className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <HeroDevices />
      </section>

      {/* Why listen */}
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

      {/* B. The app, shown before it's priced */}
      <section id="app" className="scroll-mt-20" data-landing-app>
        <div className="mx-auto max-w-5xl px-5 pb-6 pt-16 md:pt-24">
          <Heading eyebrow="The JF Effect app" title="Everything your training needs, in one app." />
          <div className="mt-4 space-y-20 md:space-y-28">
            {CHAPTERS.map((c, i) => (
              <Chapter key={c.title} c={c} flip={i % 2 === 1} />
            ))}
          </div>
        </div>
      </section>

      {/* B, continued: your own program */}
      <Reveal>
        <Block id="own">
          <Heading
            eyebrow="Your own program"
            title="Build one, or bring the one you have."
            sub="Either way it's tracked like my programs: every set, PR and week."
          />
          <div className="mx-auto grid max-w-4xl gap-12 md:grid-cols-2 md:gap-10" data-landing-own>
            {OWN.map((o) => (
              <div key={o.title} className="flex flex-col items-center text-center md:items-start md:text-left">
                <PhoneShot src={o.src} alt={o.alt} className="max-w-[230px]" />
                <h3 className="mt-5 text-[20px] font-semibold leading-snug tracking-[-0.01em]">{o.title}</h3>
                <p className="mt-1.5 max-w-md text-[15px] leading-relaxed text-muted-foreground">{o.body}</p>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">{o.note}</p>
              </div>
            ))}
          </div>
          <ul
            className="mx-auto mt-14 grid max-w-3xl gap-x-8 gap-y-3.5 text-[15px] sm:grid-cols-2"
            data-landing-free
          >
            {FREE.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </Block>
      </Reveal>

      {/* B, the reveal */}
      <Reveal>
        <section className="px-3 pb-6 sm:px-5" data-landing-reveal>
          <div className="mx-auto max-w-5xl rounded-[28px] bg-muted/50 px-6 py-14 text-center ring-1 ring-border/60 md:py-20">
            <p className="mx-auto max-w-xl text-balance text-[15px] font-medium text-muted-foreground md:text-[17px]">
              {REVEAL.lead}
            </p>
            <h2 className="mx-auto mt-4 max-w-[16ch] text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[64px]">
              {REVEAL.title}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[17px] leading-relaxed text-muted-foreground">{REVEAL.body}</p>
            <div className="mt-8 flex justify-center" data-inline-cta>
              <PrimaryCta to={JOIN_TO} className="w-full sm:w-auto sm:min-w-[260px]" onClick={() => trackSite("cta_free", "reveal")}>
                {JOIN_CTA}
              </PrimaryCta>
            </div>
          </div>
        </section>
      </Reveal>

      {/* C. What a coach adds, then the prices, then what it's done for people */}
      <div data-cta-zone="coaching">
        <Reveal>
          <div className="mx-auto max-w-2xl px-5 pb-2 pt-16 text-center md:pt-24" data-landing-contrast>
            <p className="text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[40px]">
              The app gives you the tools.
            </p>
            <p className="text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-muted-foreground md:text-[40px]">
              Coaching gives you a coach.
            </p>
          </div>
        </Reveal>

        <Reveal>
          <section id="coaching" className="scroll-mt-20 px-3 py-10 sm:px-5 md:py-14">
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

                  <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center" data-inline-cta>
                    <WithPackages
                      packages={packages}
                      fallback={
                        <Link
                          to={COACHING_APPLY_TO}
                          onClick={() => trackSite("cta_coaching", "coaching")}
                          className="inline-flex h-[54px] items-center justify-center rounded-2xl bg-background px-8 text-[17px] font-semibold text-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {COACHING_CTA}
                        </Link>
                      }
                    >
                      {(list) =>
                        paidPackages(listedPackages(list)).length ? (
                          <a
                            href="#pricing"
                            onClick={() => trackSite("cta_coaching", "see_packages")}
                            className="inline-flex h-[54px] items-center justify-center rounded-2xl bg-background px-8 text-[17px] font-semibold text-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            See the packages
                          </a>
                        ) : (
                          <Link
                            to={COACHING_APPLY_TO}
                            onClick={() => trackSite("cta_coaching", "coaching")}
                            className="inline-flex h-[54px] items-center justify-center rounded-2xl bg-background px-8 text-[17px] font-semibold text-foreground transition active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {COACHING_CTA}
                          </Link>
                        )
                      }
                    </WithPackages>
                    <Link
                      to={COACHING_TO}
                      className="text-center text-[15px] font-medium text-background/80 underline-offset-4 hover:text-background hover:underline"
                    >
                      How coaching works
                    </Link>
                  </div>
                </div>

                {/* Coaching, on the screens it happens on: the check-in and the plan I write */}
                <div className="mx-auto w-full max-w-[300px] lg:max-w-[340px]">
                  <div className="relative pb-[18%]">
                  <div className="w-[76%]">
                    <PhoneShot
                      src={shotChat}
                      alt="A weekly check-in in the JF Effect app and the coach's reply: calories stay the same, the squat moves up to 295, and a request for a video of the first set"
                      className="ring-white/15"
                    />
                  </div>
                  <div className="absolute bottom-0 right-0 w-[52%] rotate-[4deg]">
                    <PhoneShot
                      src={shotPlan}
                      alt="A coach-written meal plan: training and rest days, five meals with each meal's foods and macros"
                      className="ring-white/15"
                    />
                  </div>
                  </div>
                  <p className="mt-6 text-center text-[13px] leading-snug text-background/60 lg:text-left">
                    A week of coaching: the check-in, my reply, and the plan I write.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </Reveal>

        {/* C, the price: Coaching Plus at its price, "Don't need the private
            calls?", then Complete Online Coaching's price as the moment
            (price-reveal.ts: only while both are listed and Plus says it's
            Complete plus calls; otherwise the page goes straight on). */}
        <WithPackages packages={packages}>
          {(list) => {
            const reveal = priceReveal(list);
            return reveal ? <PriceRevealSection reveal={reveal} /> : null;
          }}
        </WithPackages>

        {/* Proof at the moment it matters: someone who had the tools, then a coach */}
        <Reveal>
          <figure className="mx-auto max-w-3xl px-5 py-8 text-center md:py-12" data-landing-pullquote>
            <Quote className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <blockquote className="mt-4 text-balance text-[22px] font-medium leading-snug tracking-[-0.01em] md:text-[28px]">
              “{sentenceStart(CLIENT_QUOTES[1].quote)}”
            </blockquote>
            <figcaption className="mt-4 text-[14px] text-muted-foreground">
              {CLIENT_QUOTES[1].name} · {CLIENT_QUOTES[1].role} · coaching client
            </figcaption>
          </figure>
        </Reveal>

        {/* D. Every way in, side by side: the free app and each coaching package,
            read from the packages on the site, never typed here. The hero's
            "See plans and prices" and the nav's Pricing land here. */}
        <div ref={pricingRef} id="pricing" className="scroll-mt-20" data-landing-pricing>
          <WithPackages packages={packages}>
            {(list) =>
              paidPackages(listedPackages(list)).length ? (
                <Reveal>
                  <Block className="!pt-6 xl:max-w-6xl">
                    <Heading eyebrow={PRICING.eyebrow} title={PRICING.title} sub={PRICING.sub} />
                    <div data-inline-cta>
                      <CoachingPackagesGrid packages={list} from="home" calls={false} free />
                    </div>
                    <p className="mx-auto mt-8 max-w-md text-center text-[13px] leading-relaxed text-muted-foreground">
                      {PRICING.note}{" "}
                      <Link to={COACHING_TO} className="font-medium text-foreground underline-offset-4 hover:underline">
                        {PRICING.more}
                      </Link>
                    </p>
                  </Block>
                </Reveal>
              ) : null
            }
          </WithPackages>
        </div>

        {/* E. What it's done for people */}
        <Reveal>
          <Block className="!pt-6">
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
            <div className="-mx-5 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
              {CLIENT_QUOTES.filter((_, i) => i !== 1).map((c) => (
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

      {/* Questions */}
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
                    {it.q === COST_QUESTION ? (
                      <WithPackages packages={packages} fallback={it.a}>
                        {(list) => costAnswer(list) ?? it.a}
                      </WithPackages>
                    ) : (
                      it.a
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* F. The decision, made plain */}
      <Reveal>
        <Block narrow>
          <div className="text-center">
            <h2 className="text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] md:text-[44px]">
              Which one is you?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Start free with the app, or let me coach you. Applying takes about a minute and I read every one.
            </p>
          </div>
          <div className="mx-auto mt-8 max-w-xl" data-inline-cta>
            <WithPackages packages={packages} fallback={<DecisionList rows={FALLBACK_DECISION} />}>
              {(list) => {
                const rows = decisionRows(list);
                return <DecisionList rows={rows.length > 1 ? rows : FALLBACK_DECISION} />;
              }}
            </WithPackages>
          </div>
          <p className="mt-8 text-center text-[14px] text-muted-foreground">
            Already a member?{" "}
            <Link to="/auth" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={JOIN_CTA} href={JOIN_TO} zones={HOME_CTA_ZONES} hideWhenInline />
    </SalesPageShell>
  );
}

/** For the tests: what the page promises, kept with the page. */
export const LANDING_COPY = { HERO, FREE, COACHING, FAQ, PROOF, CHAPTERS, OWN, REVEAL, PRICING } as const;
