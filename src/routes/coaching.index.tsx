import { useEffect, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight, MessageSquare, Quote, XCircle } from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { CoachingHero, PhoneShot } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { TRANSFORMATION_PHOTOS } from "@/components/sales/transformations-strip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Block, Group, Heading, IconTile, PrimaryCta, Rail, SocialLinks, Stat, Surface, TextLink } from "@/components/sales/apple";
import { CLIENT_QUOTES } from "@/components/sales/client-quotes";
import { COACH_NAME, INQUIRY_DM_URL } from "@/lib/social-links";
import { APPLY_GOALS } from "@/lib/apply-form";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";
import shotOverview from "@/assets/coaching/app-overview.webp";
import shotProgram from "@/assets/coaching/app-program.webp";
import shotChat from "@/assets/coaching/app-coach-chat.webp";
import shotNutrition from "@/assets/coaching/app-nutrition.webp";
import { trackSite } from "@/lib/site-funnel";
import { shareMeta } from "@/lib/share-meta";
import { CoachingPackagesGrid } from "@/components/sales/coaching-packages";
import { getPublicPackages } from "@/lib/coaching-packages/packages.functions";
import { callsPolicy, costAnswer, listedPackages, paidPackages, type PublicPackage } from "@/lib/coaching-packages/packages";

/** The packages on the site, waited on for at most 2 s (the page never hangs on them). */
async function packagesForPage(): Promise<PublicPackage[]> {
  return Promise.race([
    getPublicPackages(),
    new Promise<PublicPackage[]>((resolve) => setTimeout(() => resolve([]), 2000)),
  ]);
}

/** Each listed coaching package as a schema.org Offer (price in CAD before tax). */
function offersLd(packages: readonly PublicPackage[]) {
  return paidPackages(listedPackages(packages))
    .filter((p) => p.priceCents)
    .map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: ((p.priceCents ?? 0) / 100).toFixed(2),
      priceCurrency: p.currency || "CAD",
      url: `https://jfeffect.com/coaching/apply?package=${p.slug}`,
      ...(p.interval === "month"
        ? { priceSpecification: { "@type": "UnitPriceSpecification", price: ((p.priceCents ?? 0) / 100).toFixed(2), priceCurrency: p.currency || "CAD", unitCode: "MON", valueAddedTaxIncluded: false } }
        : {}),
    }));
}

const DESCRIPTION =
  "1:1 online coaching for strength, fat loss, muscle and powerlifting with Jared McIntyre, Team Canada powerlifter. Your program, nutrition and a weekly check-in, run through the JF Effect app wherever you train. By application.";

export const Route = createFileRoute("/coaching/")({
  component: CoachingPage,
  loader: async () => ({ packages: await packagesForPage() }),
  staleTime: 5 * 60_000,
  head: ({ loaderData }) => ({
    meta: [
      { title: "Online Coaching with Jared McIntyre | Strength, Muscle, Fat Loss, Powerlifting | JF Effect" },
      { name: "description", content: DESCRIPTION },
      ...shareMeta({
        title: "JF Effect Coaching",
        description: "1:1 online coaching with Jared McIntyre: your program, nutrition and a weekly check-in, all in the JF Effect app.",
        path: "/coaching",
      }),
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaching" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Service",
          name: "JF Effect Online Coaching",
          serviceType: ["Online Fitness Coaching", "Online Strength Coaching", "Powerlifting Coaching", "Nutrition Coaching"],
          provider: { "@type": "Organization", "@id": "https://jfeffect.com/#organization", name: "JF Effect", url: "https://jfeffect.com" },
          areaServed: "Worldwide",
          availableChannel: { "@type": "ServiceChannel", serviceUrl: "https://jfeffect.com/coaching/apply" },
          ...(offersLd(loaderData?.packages ?? []).length ? { offers: offersLd(loaderData?.packages ?? []) } : {}),
          url: "https://jfeffect.com/coaching",
          description: DESCRIPTION,
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://jfeffect.com/" },
            { "@type": "ListItem", position: 2, name: "Coaching", item: "https://jfeffect.com/coaching" },
          ],
        }),
      },
    ],
  }),
});

const APPLY_TO = "/coaching/apply" as const;
const CTA = "Apply for coaching";

/*
 * The online coaching page. Its words live here, not in Sales → Sales pages:
 * that editor's coaching copy had gone stale, and one place to change the page
 * is easier to keep honest. Coaching is online only on every public page.
 *
 * Order follows how someone decides: what it is and the one button, proof,
 * why it hasn't worked before, what's included (shown with real app screens),
 * how it starts, who's coaching them, who it's for, their questions, then the
 * first question of the application itself. Every button here is the
 * application; the free app is only an answer in the questions.
 */

/** What's included, each shown with the screen it lives on. Screenshots: a demo athlete, no client data. */
const OFFER: Array<{ title: string; body: string; src: string; alt: string }> = [
  {
    title: "A program written for you",
    body: "Built around your goal, your schedule and the equipment you have, with my notes on the exercises that need them. Every set you log feeds your PRs and estimated maxes, so we both see what's working.",
    src: shotProgram,
    alt: "A coach-written workout in the app: back squat, 4 × 5 at RPE 7, the coach's note to keep the same weight for all four sets, three sets logged at 295 lb",
  },
  {
    title: "Weekly check-ins",
    body: "You check in from the app. I read it with your numbers, tell you what's changing and why, and adjust the plan.",
    src: shotChat,
    alt: "A weekly check-in and the coach's reply in the app's chat",
  },
  {
    title: "Nutrition",
    body: "Calories and macros for training and rest days, and a meal plan built around the food you eat. No crash diets.",
    src: shotNutrition,
    alt: "The Nutrition screen: a training-day meal plan with each meal's foods and macros",
  },
];

/** The application's goals, most asked-for first ("Other" is the "Something else" link). */
const GOAL_ORDER = ["fat_loss", "build_muscle", "powerlifting", "general_fitness"] as const;

const ALSO_INCLUDED = [
  "Video feedback on your lifts in our chat",
  "Message me in the app. I usually reply within a day",
  "Meet prep and weight class planning if you compete",
  "Your PRs, bodyweight and progress photos in one place",
];

const STEPS: Array<{ title: string; body: string }> = [
  { title: "Apply", body: "Seven questions about you and your goal. Free, no card." },
  { title: "Book a call", body: "Pick a time right after you apply. We talk about your goal and how I'd coach you, before you commit to anything." },
  { title: "Start training", body: "If we're a fit, you're set up in the app with your program, your nutrition and your first check-in." },
];

const FOR_YOU = [
  "You'll follow a plan when it's written for you",
  "You want someone checking your progress every week",
  "You're tired of guessing and starting over",
];
const NOT_FOR_YOU = [
  "You want a quick fix",
  "You won't check in or follow the plan",
  "You only want a PDF program",
];

// The questions people ask themselves before they apply.
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "I've tried before and it didn't stick. Why would this be different?",
    a: "Most plans fail because they're generic and nobody is checking. Yours is built around your schedule, I read your check-in every week, and the plan changes when your life does.",
  },
  {
    q: "Is it all online?",
    a: "Yes. Your program, nutrition, check-ins, video feedback and our chat all live in the JF Effect app, so it works wherever you live and train. When something is easier to talk through, we do it on a video call.",
  },
  {
    q: "I'm busy. Can I make this work?",
    a: "Yes. The plan fits the days and time you have, and when a week goes sideways we adjust it so one rough week doesn't turn into a lost month.",
  },
  {
    q: "I'm a beginner, or out of shape. Is that okay?",
    a: "Yes. The plan starts where you are now.",
  },
  {
    q: "Do I need a gym?",
    a: "No. I build the plan around your setup, whether that's a full gym or a few dumbbells at home.",
  },
  {
    q: "What does it cost?",
    a: "Applying is free and there's no card. Coaching is a paid service, and we talk on your call before you commit to anything.",
  },
  {
    q: "Is there a free option?",
    a: "Yes. The JF Effect app is free: my programs, the training log, your progress and the Crew. A lot of people start there and move to coaching later, and their training history comes with them.",
  },
  {
    q: "What if it isn't a good fit?",
    a: "Then I'll tell you on the call. I only take on people I'm confident I can help.",
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

/** Counts the page view once, and the pricing section the first time it's on screen. */
function useCoachingSeen() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    trackSite("coaching_view");
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          trackSite("pricing_view", "coaching");
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

function CoachingPage() {
  const { packages } = Route.useLoaderData();
  const pricingRef = useCoachingSeen();
  const pricing = paidPackages(listedPackages(packages)).length > 0;
  const cost = costAnswer(packages);
  // a package with calls on the site gets its own answer: the allowance, the 24-hour rule, no rollover
  const callsAnswers = listedPackages(packages)
    .map((p) => ({ q: `How do the ${p.name} calls work?`, a: callsPolicy(p) }))
    .filter((x): x is { q: string; a: string } => !!x.a);
  const faq = [...FAQ.slice(0, 6), ...callsAnswers, ...FAQ.slice(6)];
  return (
    <SalesPageShell pageId="coaching">
      {/* 1. What it is, and the one button */}
      <CoachingHero
        eyebrow="Online coaching with Jared McIntyre"
        headline="I'll coach you, wherever you train."
        sub="I write your training and nutrition, read your check-in every week, and change the plan when it needs changing. It all runs through the JF Effect app."
        primary={
          <div data-inline-cta className="flex flex-col items-stretch sm:items-center lg:items-start">
            <PrimaryCta to={APPLY_TO} onClick={() => trackSite("cta_coaching", "coaching_hero")}>{CTA}</PrimaryCta>
          </div>
        }
        note="Free to apply. Seven questions, then pick a time for a call."
        image={{ src: shotOverview, alt: "Training analytics in the JF Effect app: squat, bench and deadlift estimated maxes up 44, 25 and 49 lb, 27 of 27 planned workouts done, 55 sets a week" }}
      />

      {/* 2. Why listen */}
      <div className="mx-auto max-w-5xl px-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-border/70 md:grid-cols-4">
          {[
            ["100+", "People coached", "Beginners to IPF Worlds"],
            ["8", "International medals", "Team Canada, 7 of them gold"],
            ["2×", "International champion", "NAPF and Commonwealth, 2026"],
            ["Top 50", "All-time world ranking", "66 kg powerlifting"],
          ].map(([value, label, detail]) => (
            <div key={label} className="bg-card">
              <Stat value={value} label={label} detail={detail} />
            </div>
          ))}
        </div>
      </div>

      {/* 3. Proof first */}
      <Reveal>
        <Block>
          <Heading eyebrow="Client results" title="Some of the people I've coached." sub="Fat loss, muscle and strength. Swipe for more." />
          <Rail label="Client results">
            {TRANSFORMATION_PHOTOS.slice(0, 12).map((photo, i) => (
              <div key={i} className="w-[68vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-2xl bg-muted ring-1 ring-border/70">
                <img
                  src={photo.url}
                  alt="Client before and after"
                  loading="lazy"
                  decoding="async"
                  width={400}
                  height={400}
                  className="aspect-square w-full scale-[1.18] object-cover object-top"
                />
              </div>
            ))}
          </Rail>
          <div className="-mx-5 mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {CLIENT_QUOTES.map((c) => (
              <Surface key={c.name} className="flex w-[82vw] max-w-[340px] shrink-0 snap-start flex-col p-5 md:w-auto md:max-w-none">
                <Quote className="h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="mt-3 flex-1 text-[15px] leading-relaxed">“{c.quote}”</p>
                <div className="mt-4 border-t border-border/70 pt-3">
                  <div className="text-[15px] font-semibold">{c.name}</div>
                  <div className="text-[13px] text-muted-foreground">{c.result} · {c.role}</div>
                </div>
              </Surface>
            ))}
          </div>
          <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Results vary with starting point, consistency and effort and are not guaranteed.
          </p>
        </Block>
      </Reveal>

      {/* 4. Why it hasn't worked yet, in one breath */}
      <Reveal>
        <Block tint narrow>
          <div className="text-center">
            <h2 className="text-balance text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] md:text-[40px]">
              Most people I coach tried on their own first.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
              They put the effort in. What they didn't have was a plan written for them and someone
              checking every week whether it was working. That's the part I take on.
            </p>
          </div>
        </Block>
      </Reveal>

      {/* 5. What's included, shown on the real screens */}
      <Reveal>
        <Block id="what-you-get">
          <Heading eyebrow="What's included" title="Everything runs through the app." sub="Your plan, your check-ins and our chat, in one place on your phone." />
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {OFFER.map((o) => (
              <div key={o.title} className="w-[78vw] max-w-[320px] shrink-0 snap-start md:w-auto md:max-w-none">
                <PhoneShot src={o.src} alt={o.alt} className="max-w-[230px]" sizes="230px" />
                <h3 className="mt-5 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{o.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{o.body}</p>
              </div>
            ))}
          </div>
          <Surface className="mx-auto mt-10 max-w-3xl p-5 md:p-6">
            <div className="text-[15px] font-semibold">Also included</div>
            <div className="mt-3 grid gap-x-8 gap-y-2.5 md:grid-cols-2">
              <CheckList items={ALSO_INCLUDED.slice(0, 2)} />
              <CheckList items={ALSO_INCLUDED.slice(2)} />
            </div>
          </Surface>
          {!pricing && (
            <div className="mt-8 flex justify-center" data-inline-cta>
              <PrimaryCta to={APPLY_TO} className="w-full sm:w-auto sm:min-w-[280px]">{CTA}</PrimaryCta>
            </div>
          )}
        </Block>
      </Reveal>

      {/* 5b. What it costs: the packages on the site (coaching_packages), never typed here */}
      <div ref={pricingRef}>
      {pricing && (
        <Reveal>
          <Block id="pricing" className="!pt-0">
            <Heading
              eyebrow="What it costs"
              title="What coaching costs."
              sub="Every package includes the full app. In Canadian dollars, plus applicable tax. Applying is free and doesn't commit you to anything."
            />
            <div data-inline-cta>
              <CoachingPackagesGrid packages={packages} from="coaching" />
            </div>
            <p className="mx-auto mt-8 max-w-md text-center text-[13px] leading-relaxed text-muted-foreground">
              Applying doesn't charge you. We talk on a short call first, and you only pay once we've agreed to start.
            </p>
          </Block>
        </Reveal>
      )}
      </div>

      {/* 6. How it starts */}
      <Reveal>
        <Block id="how" tint narrow>
          <Heading eyebrow="How it starts" title="Three steps." sub="Applying takes about a minute." />
          <Group>
            {STEPS.map((st, i) => (
              <div key={st.title} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-[14px] font-semibold text-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{st.title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{st.body}</p>
                </div>
              </div>
            ))}
          </Group>
        </Block>
      </Reveal>

      {/* 7. The person behind it */}
      <Reveal>
        <Block>
          {/* The photo is a 4:5 portrait: shown square from 31% down it keeps the Canada
              Powerlifting / IPF banner and the whole lift, head to plates to feet. From md up
              it sits beside the words and fills the card's height (the words set it), so the
              square never becomes a page-tall block. */}
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
              <div className="text-[13px] font-semibold text-muted-foreground">Your coach</div>
              <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{COACH_NAME}</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">Team Canada powerlifter · 2× international champion</p>
              <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                I've coached since 2017 and full-time since 2021, from people's first workouts to
                IPF Worlds. I still compete, so I hold myself to the standard I ask of my clients.
              </p>
              <div className="mt-4">
                <CheckList
                  items={[
                    "Certified: GLPTI, DTS Level 1, ISSA CPT",
                    "Drug-tested athlete",
                    "100+ people coached since 2017",
                  ]}
                />
              </div>
              <div className="mt-5">
                <TextLink to="/about">My full story and results</TextLink>
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      {/* 8. Honest fit check */}
      <Reveal>
        <Block tint>
          <Heading eyebrow="Is it for you?" title="It works when we both take it seriously." />
          <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
            <Surface className="p-5">
              <div className="mb-3 text-[15px] font-semibold">This is for you if</div>
              <CheckList items={FOR_YOU} />
            </Surface>
            <Surface className="p-5">
              <div className="mb-3 text-[15px] font-semibold text-muted-foreground">This is not for you if</div>
              <ul className="space-y-2.5">
                {NOT_FOR_YOU.map((line) => (
                  <li key={line} className="flex items-start gap-3 text-[15px] text-muted-foreground">
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </Surface>
          </div>
        </Block>
      </Reveal>

      {/* 9. Their questions */}
      <Reveal>
        <Block narrow>
          <Heading eyebrow="Questions" title="What people ask before they apply." />
          <Group>
            <Accordion type="single" collapsible>
              {faq.map((it, i) => (
                <AccordionItem key={it.q} value={`faq-${i}`} className="border-0 px-5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70">
                  <AccordionTrigger className="py-4 text-left text-[17px] font-medium hover:no-underline">{it.q}</AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">
                    {it.q === "What does it cost?" && cost ? cost : it.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* 10. The application's first question, right here */}
      <Reveal>
        <Block id="start" tint narrow>
          <div className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              What do you want help with?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Pick one to start your application. It takes about a minute.
            </p>
          </div>
          <div className="mx-auto mt-7 grid max-w-md gap-3 sm:grid-cols-2" data-inline-cta>
            {GOAL_ORDER.map((v) => APPLY_GOALS.find((g) => g.v === v)!).map((g) => (
              <Link
                key={g.v}
                to={`${APPLY_TO}?goal=${g.v}` as typeof APPLY_TO}
                className="flex h-14 items-center justify-between rounded-2xl bg-card px-5 text-[17px] font-semibold ring-1 ring-border/70 transition hover:ring-foreground/30 active:scale-[0.985]"
              >
                {g.l}
                <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
          <div className="mt-4 text-center">
            <Link to={APPLY_TO} className="text-[15px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Something else
            </Link>
          </div>
          <div className="mx-auto mt-8 max-w-sm">
            <CheckList
              items={[
                "Free to apply, no card",
                "I read every application myself",
                "A short call first, and we only start if it's a fit",
              ]}
            />
          </div>
          <p className="mt-6 text-center text-[13px] text-muted-foreground">By application. I keep my client list small.</p>

          <Surface className="mt-10 p-5">
            <div className="flex items-start gap-4">
              <IconTile><MessageSquare className="h-5 w-5" aria-hidden /></IconTile>
              <div className="min-w-0">
                <div className="text-[17px] font-semibold leading-snug">Want to ask something first?</div>
                <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">
                  Message me on Instagram, or see how I train and coach on YouTube.
                </p>
                <div className="mt-3"><TextLink href={INQUIRY_DM_URL}>Message me on Instagram</TextLink></div>
                <div className="mt-3"><SocialLinks /></div>
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={CTA} href={APPLY_TO} hideWhenInline />
    </SalesPageShell>
  );
}
