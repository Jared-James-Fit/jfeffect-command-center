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
import shotProgress from "@/assets/coaching/app-analytics-progress.webp";
import shotPrs from "@/assets/coaching/app-analytics-prs.webp";
import shotChat from "@/assets/coaching/app-coach-chat.webp";
import shotNutrition from "@/assets/coaching/app-nutrition.webp";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/coaching/")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "Online Fitness Coaching Selkirk & Winnipeg MB | Private 1:1 Coaching | JF Effect" },
      { name: "description", content: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared McIntyre. Weekly check-ins, custom programming, and nutrition coaching. By application." },
      ...shareMeta({
        title: "JF Effect Coaching",
        description: "Private 1:1 coaching for strength, fat loss, muscle and powerlifting. A plan built around your life, weekly check-ins, and a coach who knows your numbers.",
        path: "/coaching",
      }),
      { name: "geo.region", content: "CA-MB" },
      { name: "geo.placename", content: "Selkirk, Manitoba" },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaching" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Service",
          name: "JF Effect Private Online Fitness Coaching",
          serviceType: ["Online Fitness Coaching", "Personal Training", "Powerlifting Coaching", "Nutrition Coaching"],
          provider: {
            "@type": "LocalBusiness",
            "@id": "https://jfeffect.com/#business",
            name: "JF Effect",
            url: "https://jfeffect.com",
            address: { "@type": "PostalAddress", addressLocality: "Selkirk", addressRegion: "MB", addressCountry: "CA" },
          },
          areaServed: [
            { "@type": "City", name: "Selkirk", containedInPlace: { "@type": "State", name: "Manitoba" } },
            { "@type": "City", name: "Winnipeg", containedInPlace: { "@type": "State", name: "Manitoba" } },
            { "@type": "Country", name: "Canada" },
          ],
          url: "https://jfeffect.com/coaching",
          description: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared McIntyre.",
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
 * The coaching sales page. Its words live here, not in Sales → Sales pages:
 * that editor's coaching copy had gone stale (FAQs still sold "JF
 * Membership"), and one place to change the page is easier to keep honest.
 *
 * Order follows how someone decides: what it is and the one button, proof,
 * why it hasn't worked before, exactly what they get (shown with real app
 * screens), how it starts, who's coaching them, who it's for, their questions,
 * then the first question of the application itself.
 */

/** What you get, each shown with the screen it lives on. Screenshots: a demo athlete, no client data. */
const OFFER: Array<{ title: string; body: string; src: string; alt: string }> = [
  {
    title: "A program written for you",
    body: "Built around your goal, your schedule and the equipment you have. Every set you log counts, so your PRs and estimated maxes are tracked for you and you can see it working.",
    src: shotPrs,
    alt: "Recent PRs in the app's training analytics: each lift's new estimated max and the best it beat",
  },
  {
    title: "A coach who reads your check-in",
    body: "You check in from the app every week. Your coach reads it, tells you what's changing and why, and adjusts the plan. Questions in between? Message anytime.",
    src: shotChat,
    alt: "A weekly check-in and the coach's reply in the app's chat",
  },
  {
    title: "Nutrition you can actually follow",
    body: "Calories and macros for training and rest days, plus a simple meal plan you can shop for and prep. No crash diets.",
    src: shotNutrition,
    alt: "The Nutrition screen: a training-day meal plan with each meal's foods and macros",
  },
];

/** The application's goals, most asked-for first ("Other" is the "Something else" link). */
const GOAL_ORDER = ["fat_loss", "build_muscle", "powerlifting", "general_fitness"] as const;

const ALSO_INCLUDED = [
  "Lift video reviews in the chat",
  "How-to videos for your exercises",
  "PRs, bodyweight and progress photos in one place",
  "The JF Effect Crew: train alongside other athletes",
];

const STEPS: Array<{ title: string; body: string }> = [
  { title: "Apply", body: "Seven quick questions about you and your goal. Free, no card." },
  { title: "Book your call", body: "Pick a time right after you apply. We talk through your goal and whether coaching is the right fit. No pressure." },
  { title: "Start training", body: "If it's a fit, you're set up in the app with your program, your nutrition and your first check-in." },
];

const FOR_YOU = [
  "You'll follow a plan if someone builds it for you",
  "You want someone checking your progress every week",
  "You're done guessing and starting over",
];
const NOT_FOR_YOU = [
  "You want a quick fix",
  "You won't check in or follow the plan",
  "You only want a PDF program",
];

// The questions people quietly ask themselves before they apply, answered straight.
const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "I've tried before and it didn't stick. Why would this be different?",
    a: "Most plans fail for two reasons: they're generic, and nobody is watching. Here your plan is built around your schedule and your life, your coach reads your check-in every week, and the plan changes when life happens.",
  },
  {
    q: "I'm busy. Can I make this work?",
    a: "That's who it's built for. Your plan fits the days and time you actually have, and when a week goes sideways we adjust it instead of letting one rough week turn into a lost month.",
  },
  {
    q: "I'm a beginner, or out of shape. Is that okay?",
    a: "Yes. You don't need to be fit to start. The plan starts where you are right now.",
  },
  {
    q: "Do I need a gym?",
    a: "No. The plan is built around your setup, whether that's a full gym or training at home.",
  },
  {
    q: "How is this different from an app or a PDF program?",
    a: "An app or a PDF gives you a plan. Coaching gives you a person: someone who looks at your numbers and check-ins, changes the plan when it needs changing, and holds you to it when motivation dips.",
  },
  {
    q: "What does it cost?",
    a: "Applying is free and there's no card. Coaching is a paid service, and we go over the options and the price on your call, before you commit to anything.",
  },
  {
    q: "What if it isn't a good fit?",
    a: "Then we'll tell you. We only take on people we're confident we can help. The call is to find that out, not a pressure pitch.",
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

function CoachingPage() {
  return (
    <SalesPageShell pageId="coaching">
      {/* 1 — What it is, and the one button */}
      <CoachingHero
        eyebrow="1:1 online coaching · By application"
        headline="Get stronger and leaner without guessing what to do."
        sub="Training and nutrition written for you, a coach who reads your check-in every week, and one app that holds it all."
        primary={<PrimaryCta to={APPLY_TO}>{CTA}</PrimaryCta>}
        note="Free · 7 quick questions · Pick your call time right after"
        image={{ src: shotProgress, alt: "Training analytics in the JF Effect app: an athlete's back squat estimated max climbing week by week over 12 weeks" }}
      />

      {/* 2 — Why listen */}
      <div className="mx-auto max-w-5xl px-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-border/70 md:grid-cols-4">
          {[
            ["100+", "Clients coached", "Fat loss to powerlifting"],
            ["8", "International medals", "Team Canada · 7 gold, 1 silver"],
            ["2×", "International champion", "NAPF + Commonwealth · 2026"],
            ["Top 50", "All-time world ranking", "66 kg powerlifting"],
          ].map(([value, label, detail]) => (
            <div key={label} className="bg-card">
              <Stat value={value} label={label} detail={detail} />
            </div>
          ))}
        </div>
      </div>

      {/* 3 — Proof first */}
      <Reveal>
        <Block>
          <Heading eyebrow="Real results" title="People who did the work." sub="A few of the 100+ people I've coached. Swipe to see more." />
          <Rail label="Client transformations">
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

      {/* 4 — Why it hasn't worked yet, in one breath */}
      <Reveal>
        <Block tint narrow>
          <div className="text-center">
            <div className="text-[13px] font-semibold text-muted-foreground">Why it hasn't stuck</div>
            <h2 className="mt-1.5 text-balance text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] md:text-[40px]">
              You don't need more motivation.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
              Most people who come to me have tried hard, more than once. What they were missing was a plan made for them, someone adjusting it as they go, and someone who notices when they slip.
            </p>
            <p className="mx-auto mt-3 max-w-xl text-[17px] font-medium leading-relaxed">That's what coaching is.</p>
          </div>
        </Block>
      </Reveal>

      {/* 5 — Exactly what they get, shown on the real screens */}
      <Reveal>
        <Block id="what-you-get">
          <Heading eyebrow="What you get" title="Here's exactly what you get." sub="All of it lives in the JF Effect app, on your phone." />
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {OFFER.map((o) => (
              <div key={o.title} className="w-[78vw] max-w-[320px] shrink-0 snap-start md:w-auto md:max-w-none">
                <PhoneShot src={o.src} alt={o.alt} className="max-w-[230px]" />
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
          <div className="mt-8 flex justify-center">
            <PrimaryCta to={APPLY_TO} className="w-full sm:w-auto sm:min-w-[280px]">{CTA}</PrimaryCta>
          </div>
        </Block>
      </Reveal>

      {/* 6 — How it starts */}
      <Reveal>
        <Block id="how" tint narrow>
          <Heading eyebrow="How it works" title="Three steps to start." sub="Applying takes about a minute." />
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

      {/* 7 — The person behind it */}
      <Reveal>
        <Block narrow>
          <Surface className="overflow-hidden">
            <img
              src={jaredAsset.url}
              alt={`${COACH_NAME} representing Canada in international powerlifting`}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover object-[center_20%]"
            />
            <div className="p-6">
              <div className="text-[13px] font-semibold text-muted-foreground">Your coach</div>
              <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{COACH_NAME}</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">Team Canada powerlifter · 2× International Champion</p>
              <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                I coach from both sides of the bar: responsible for other people's progress, and still competing under pressure myself. JF Effect is built on one belief: structure and standards outlast motivation.
              </p>
              <div className="mt-4">
                <CheckList
                  items={[
                    "Personal trainer since 2017, full-time coaching since 2021",
                    "Certified: GLPTI, DTS Level 1, ISSA CPT",
                    "Drug-tested athlete. I hold myself to what I ask of clients",
                  ]}
                />
              </div>
              <div className="mt-5">
                <TextLink to="/about">Read my full story</TextLink>
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      {/* 8 — Honest fit check */}
      <Reveal>
        <Block tint>
          <Heading eyebrow="Is it for you?" title="Coaching isn't for everyone." sub="It works when both sides take it seriously. Better to know now." />
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

      {/* 9 — Their questions, answered straight */}
      <Reveal>
        <Block narrow>
          <Heading eyebrow="Questions" title="Straight answers." sub="What people ask before they apply." />
          <Group>
            <Accordion type="single" collapsible>
              {FAQ.map((it, i) => (
                <AccordionItem key={it.q} value={`faq-${i}`} className="border-0 px-5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70">
                  <AccordionTrigger className="py-4 text-left text-[17px] font-medium hover:no-underline">{it.q}</AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{it.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* 10 — The application's first question, right here */}
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
          <div className="mx-auto mt-7 grid max-w-md gap-3 sm:grid-cols-2">
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
                "Free to apply: no payment, no card",
                "A real person reads it, not an auto-reply",
                "A no-pressure call, and we only start if it's a fit",
              ]}
            />
          </div>
          <p className="mt-6 text-center text-[13px] text-muted-foreground">By application · Spots are limited</p>

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
      <StickyMobileCta label={CTA} href={APPLY_TO} />
    </SalesPageShell>
  );
}
