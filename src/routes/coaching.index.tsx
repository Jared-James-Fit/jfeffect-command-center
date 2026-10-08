import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ClipboardCheck, Heart, MessageCircle, MessageSquare, Quote, Repeat, Target, Users, Utensils, XCircle, Eye } from "lucide-react";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { CoachingHero } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { TRANSFORMATION_PHOTOS } from "@/components/sales/transformations-strip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Block, Group, Heading, IconTile, PrimaryCta, Rail, SocialLinks, Stat, Surface, TextLink } from "@/components/sales/apple";
import { CLIENT_QUOTES } from "@/components/sales/client-quotes";
import { COACH_NAME, INQUIRY_DM_URL } from "@/lib/social-links";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";

export const Route = createFileRoute("/coaching/")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "Online Fitness Coaching Selkirk & Winnipeg MB | Private 1:1 Coaching | JF Effect" },
      { name: "description", content: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared McIntyre. Weekly check-ins, custom programming, and nutrition coaching. By application." },
      { property: "og:title", content: "Online Fitness Coaching Selkirk & Winnipeg MB | Private 1:1 Coaching | JF Effect" },
      { property: "og:description", content: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared McIntyre. By application." },
      { name: "geo.region", content: "CA-MB" },
      { name: "geo.placename", content: "Selkirk, Manitoba" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/coaching" },
      { property: "og:site_name", content: "JF Effect" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Private 1:1 Fitness Coaching by Application | JF Effect" },
      { name: "twitter:description", content: "Private 1:1 online fitness coaching for strength, fat loss, muscle, and powerlifting. A plan built around your life, weekly check-ins, and a coach who knows your numbers. By application." },
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

const APPLY_TO = "/coaching/apply";

// The questions people quietly ask themselves before they apply. Answered up front,
// in plain words, so nobody has to guess or feel talked into anything.
const OBJECTIONS: Array<{ q: string; a: string }> = [
  {
    q: "I've tried before and it didn't stick. Why would this be different?",
    a: "Most plans fail for two reasons: they're generic, and nobody is watching. Here your plan is built around your schedule and your life, a real coach reviews your check-ins every week, and the plan gets adjusted when life happens. That mix of structure and accountability is usually what's missing.",
  },
  {
    q: "I'm busy. Can I make this work?",
    a: "That's who it's built for. Your plan is designed around your real schedule, and when a week goes sideways we adjust it instead of letting one rough week turn into a lost month.",
  },
  {
    q: "I'm a beginner, or I'm out of shape. Is that okay?",
    a: "Yes, as long as you'll commit to the plan. You don't need to be fit to start. The plan begins where you are right now.",
  },
  {
    q: "Do I need a gym?",
    a: "No. The plan is built around your setup, whether that's a full gym or training at home.",
  },
  {
    q: "How is this different from an app or a PDF program?",
    a: "An app or a PDF gives you a plan. Coaching gives you a person: someone who looks at your numbers and check-ins, changes the plan when it needs changing, and holds the standard when motivation dips.",
  },
  {
    q: "What does it cost, and do I have to pay to apply?",
    a: "Applying is free and takes about a minute. There's no payment and no card. Coaching itself is a paid, application-only service, and we go over the options and pricing with you on your call, before you commit to anything.",
  },
  {
    q: "What if it isn't a good fit?",
    a: "Then we'll tell you honestly. We only take on people we're confident we can help. The call is to see if it's a fit, not a pressure pitch.",
  },
];
// Questions already covered by the list above (so editing the FAQ in admin never shows duplicates).
const COVERED = new Set(["can i start if i am busy?", "is coaching customized?"]);

function CoachingPage() {
  const fetchPage = useServerFn(getPublicSalesPage);
  const { data: p } = useQuery({
    queryKey: ["public-sales-page", "coaching"],
    queryFn: () => fetchPage({ data: { page_key: "coaching" } }),
    staleTime: 5 * 60_000,
  });

  const s = (p?.sections ?? {}) as Record<string, any>;

  const whoFor: string[] = Array.isArray(s.who_for) && s.who_for.length > 0 ? s.who_for : [
    "You want structure and will do the work",
    "You want accountability",
    "You are tired of guessing",
  ];
  const notFor: string[] = Array.isArray(s.not_for) && s.not_for.length > 0 ? s.not_for : [
    "You want a shortcut or a quick fix",
    "You won't follow a plan or check in",
    "You just want a generic PDF program",
  ];
  const steps: Array<{ step: number; title: string; body: string }> =
    Array.isArray(s.how_it_works) && s.how_it_works.length > 0
      ? s.how_it_works
      : [
          { step: 1, title: "Apply", body: "Tell us your goal. Takes about a minute." },
          { step: 2, title: "We read it ourselves", body: "A real person reviews every application." },
          { step: 3, title: "Strategy call", body: "We map the plan together and make sure it's a fit." },
          { step: 4, title: "Get set up in the app", body: "Training, nutrition, check-ins and messaging in one place." },
          { step: 5, title: "Start coaching", body: "Train, check in, adjust, repeat." },
        ];
  const cmsFaq: Array<{ q: string; a: string }> = Array.isArray(s.faq) ? s.faq : [];
  const faqItems = [...OBJECTIONS, ...cmsFaq.filter((f) => f?.q && !COVERED.has(String(f.q).trim().toLowerCase()))];
  const ctaLabel = p?.primary_cta_label || "Apply for Coaching";

  return (
    <SalesPageShell pageId="coaching" floatingHeader>
      <CoachingHero
        eyebrow="Private coaching · By application"
        headline="Coaching for people who are done settling."
        sub="A plan built around your life. A coach who actually reads your check-ins. Real progress, held to a standard."
        primary={<PrimaryCta to={APPLY_TO}>{ctaLabel}</PrimaryCta>}
        secondary={<TextLink href="#how">See how it works</TextLink>}
        note="Takes about a minute · No payment to apply · A real person reads every application"
      />

      {/* 1 — Credibility, fast: who is this person and why listen */}
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

      {/* 2 — Name the problem: empathy before the pitch */}
      <Reveal>
        <Block narrow>
          <Heading eyebrow="Sound familiar?" title="It's rarely a motivation problem." sub="Most people who come to me have tried hard, more than once. What was missing wasn't effort." />
          <Group>
            {[
              { Icon: Repeat, title: "You start strong, then it fades", body: "No plan survives a busy month without someone adjusting it with you." },
              { Icon: Eye, title: "You're guessing", body: "What to lift, what to eat, whether it's working. Guessing is exhausting." },
              { Icon: Users, title: "Nobody is watching the details", body: "Apps hand you numbers. They don't notice when things drift." },
              { Icon: Heart, title: "Life keeps getting in the way", body: "Work, family, travel, stress. A good plan bends without breaking." },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4 px-5 py-4">
                <IconTile><Icon className="h-5 w-5" aria-hidden /></IconTile>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </Group>
          <p className="mt-5 text-center text-[17px] font-medium leading-relaxed">
            That's a structure problem, and structure is exactly what coaching fixes.
          </p>
        </Block>
      </Reveal>

      {/* 3 — The solution */}
      <Reveal>
        <Block tint narrow>
          <Heading eyebrow="What you get" title="Built for you. Run with you." />
          <Group>
            {[
              { Icon: Target, title: "A plan built for you", body: "Your body, your schedule, your equipment. Not pulled from a library." },
              { Icon: ClipboardCheck, title: "Weekly check-ins", body: "Reviewed by your coach and adjusted around your real progress." },
              { Icon: Utensils, title: "Nutrition that fits your life", body: "Clear targets made to last, not a crash diet." },
              { Icon: MessageCircle, title: "A coach in your corner", body: "Direct messaging with your dedicated coach inside the app." },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="flex items-start gap-4 px-5 py-4">
                <IconTile><Icon className="h-5 w-5" aria-hidden /></IconTile>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </Group>
        </Block>
      </Reveal>

      {/* 4 — Proof: photos, then real words */}
      <Reveal>
        <Block>
          <Heading eyebrow="Real results" title="100+ clients coached." sub="Members and 1:1 clients who showed up and did the work. Swipe to see more." />
          <Rail label="Client transformations">
            {TRANSFORMATION_PHOTOS.slice(0, 12).map((photo, i) => (
              <div key={i} className="w-[68vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-2xl bg-muted ring-1 ring-border/70">
                <img
                  src={photo.url}
                  alt="Client transformation — before and after"
                  loading="lazy"
                  decoding="async"
                  width={400}
                  height={400}
                  className="aspect-square w-full scale-[1.18] object-cover object-top"
                />
              </div>
            ))}
          </Rail>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {CLIENT_QUOTES.map((c) => (
              <Surface key={c.name} className="flex flex-col p-5">
                <Quote className="h-5 w-5 text-primary" aria-hidden />
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
          <div className="mt-6 flex justify-center">
            <PrimaryCta to={APPLY_TO}>{ctaLabel}</PrimaryCta>
          </div>
        </Block>
      </Reveal>

      {/* 5 — The person behind it */}
      <Reveal>
        <Block tint narrow>
          <Surface className="overflow-hidden">
            <img
              src={jaredAsset.url}
              alt={`${COACH_NAME} representing Canada in international powerlifting`}
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover object-[center_20%]"
            />
            <div className="p-6">
              <div className="text-[13px] font-semibold text-primary">Your coach</div>
              <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{COACH_NAME}</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">Team Canada powerlifter · 2× International Champion</p>
              <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                I coach from both sides of the bar: responsible for other people's progress, and still competing under pressure myself. JF Effect is built on one belief: structure and standards outlast motivation.
              </p>
              <ul className="mt-4 space-y-2 text-[15px]">
                {[
                  "Personal trainer since 2017, full-time coaching since 2021",
                  "Certified: GLPTI, DTS Level 1, ISSA CPT",
                  "Drug-tested athlete. I hold myself to what I ask of clients",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                <TextLink to="/about">Read my full story</TextLink>
              </div>
              <div className="mt-4">
                <div className="mb-2 text-[13px] text-muted-foreground">See the work and how I coach:</div>
                <SocialLinks />
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      {/* 6 — Remove uncertainty: exactly what happens */}
      <Reveal>
        <Block id="how" narrow>
          <Heading eyebrow="How it works" title="Here's exactly what happens." sub="No pressure and no payment to apply. A real person reads every application." />
          <Group>
            {steps.map((st, i) => (
              <div key={st.step ?? i} className="flex items-start gap-4 px-5 py-4">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[14px] font-semibold text-primary-foreground">
                  {st.step ?? i + 1}
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

      {/* 7 — Objections, answered honestly */}
      <Reveal>
        <Block tint narrow>
          <Heading eyebrow="Still thinking it over?" title="Fair. Straight answers." sub="What people ask before they apply." />
          <Group>
            <Accordion type="single" collapsible>
              {faqItems.map((it, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-0 px-5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70">
                  <AccordionTrigger className="py-4 text-left text-[17px] font-medium hover:no-underline">{it.q}</AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{it.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* 8 — Honest fit check */}
      <Reveal>
        <Block>
          <Heading eyebrow="Is it for you?" title="Selective by design." sub="Coaching works when both sides take it seriously. Better to know now." />
          <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
            <Surface className="p-5">
              <div className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">This is for you if</div>
              <ul className="mt-3 space-y-3">
                {whoFor.map((line) => (
                  <li key={line} className="flex items-start gap-3 text-[15px]">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </Surface>
            <Surface className="p-5">
              <div className="text-[13px] font-semibold text-muted-foreground">This is not for you if</div>
              <ul className="mt-3 space-y-3">
                {notFor.map((line) => (
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

      {/* 9 — Low-risk final ask, with a softer path for people who aren't ready */}
      <Reveal>
        <Block narrow>
          <div id="cta" className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              {s.final_cta?.headline ?? "If you already know you need coaching, stop waiting."}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Your first step costs nothing and commits you to nothing.
            </p>
            <ul className="mx-auto mt-5 max-w-sm space-y-2.5 text-left text-[15px]">
              {[
                "Free to apply: no payment, no card",
                "A real person reads it, not an auto-reply",
                "A no-pressure call, and we only move forward if it's a fit",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-col items-stretch gap-4 sm:items-center">
              <PrimaryCta to={APPLY_TO} className="sm:min-w-[280px]">{s.final_cta?.primary_label ?? ctaLabel}</PrimaryCta>
              <p className="text-[13px] text-muted-foreground">By application · Limited spots</p>
            </div>

            <Surface className="mt-10 p-5 text-left">
              <div className="flex items-start gap-4">
                <IconTile><MessageSquare className="h-5 w-5" aria-hidden /></IconTile>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">Not ready to apply? Ask me first.</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">
                    Got a question before you decide? Send me a message on Instagram, or take a look at how I train and coach on YouTube.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                    <TextLink href={INQUIRY_DM_URL}>Message me on Instagram</TextLink>
                  </div>
                  <div className="mt-3"><SocialLinks /></div>
                </div>
              </div>
            </Surface>
            <p className="mt-6 text-[15px] text-muted-foreground">
              Prefer to go self-guided?{" "}
              <Link to="/membership" className="font-medium text-primary hover:underline underline-offset-4">See JF Membership</Link>
            </p>
          </div>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={ctaLabel} href={APPLY_TO} />
    </SalesPageShell>
  );
}
