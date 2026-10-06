import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ClipboardCheck, MessageCircle, Target, Utensils, XCircle } from "lucide-react";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { CoachingHero } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { TRANSFORMATION_PHOTOS } from "@/components/sales/transformations-strip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Block, Group, Heading, IconTile, PrimaryCta, Rail, Surface, TextLink } from "@/components/sales/apple";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";

export const Route = createFileRoute("/coaching/")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "Online Fitness Coaching Selkirk & Winnipeg MB | Private 1:1 Coaching | JF Effect" },
      { name: "description", content: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared James Fit. Weekly check-ins, custom programming, and nutrition coaching. By application." },
      { property: "og:title", content: "Online Fitness Coaching Selkirk & Winnipeg MB | Private 1:1 Coaching | JF Effect" },
      { property: "og:description", content: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared James Fit. By application." },
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
          description: "Private 1:1 online fitness coaching serving Selkirk, Winnipeg, and all of Manitoba. Strength, fat loss, muscle building, and powerlifting coaching by Jared James Fit.",
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
  const faqItems: Array<{ q: string; a: string }> = Array.isArray(s.faq) && s.faq.length > 0 ? s.faq : [
    { q: "Is coaching customized?", a: "Yes. Everything is built around your goals, schedule and progress." },
    { q: "How do I start?", a: "Tap Apply for Coaching and follow the next steps." },
  ];
  const authority: Array<{ label: string }> = Array.isArray(s.authority) && s.authority.length > 0 ? s.authority : [
    { label: "100+ clients coached" },
    { label: "Coaching since 2019" },
    { label: "Built on competitive strength" },
  ];
  const ctaLabel = p?.primary_cta_label || "Apply for Coaching";

  return (
    <SalesPageShell pageId="coaching" floatingHeader>
      <CoachingHero
        eyebrow="Private coaching · By application"
        headline="Coaching for people who are done settling."
        sub="A plan built around your life. A coaching team that knows your numbers. Real progress, held to a standard."
        primary={<PrimaryCta to={APPLY_TO}>{ctaLabel}</PrimaryCta>}
        secondary={<TextLink href="#how">See how it works</TextLink>}
        note="Takes about a minute · No payment to apply"
      />

      {/* Quiet proof line */}
      <div className="mx-auto max-w-5xl px-5">
        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-y border-border/70 py-4 text-[13px] font-medium text-muted-foreground">
          {authority.map((it) => (
            <li key={it.label} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              {it.label}
            </li>
          ))}
        </ul>
      </div>

      {/* 1 — What happens next (the dummy-proof part) */}
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

      {/* 2 — What you get */}
      <Reveal>
        <Block tint narrow>
          <Heading eyebrow="What you get" title="Built for you. Run with you." />
          <Group>
            {[
              { Icon: Target, title: "A plan built for you", body: "Your body, your schedule, your training." },
              { Icon: ClipboardCheck, title: "Weekly check-ins", body: "Reviewed by your coach and adjusted around your progress." },
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

      {/* 3 — Proof */}
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
          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted-foreground">
            Results vary with starting point, consistency and effort and are not guaranteed.
          </p>
          <div className="mt-6 flex justify-center">
            <PrimaryCta to={APPLY_TO}>{ctaLabel}</PrimaryCta>
          </div>
        </Block>
      </Reveal>

      {/* 4 — Fit check */}
      <Reveal>
        <Block tint>
          <Heading eyebrow="Is it for you?" title="Selective by design." sub="Coaching works when both sides take it seriously." />
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

      {/* 5 — The coach */}
      <Reveal>
        <Block narrow>
          <Surface className="overflow-hidden">
            <img
              src={jaredAsset.url}
              alt="Jared James representing Canada in international powerlifting"
              loading="lazy"
              decoding="async"
              className="aspect-[4/3] w-full object-cover object-[center_20%]"
            />
            <div className="p-6">
              <div className="text-[13px] font-semibold text-primary">Your coach</div>
              <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">Jared James</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">Team Canada powerlifter · 2× International Champion</p>
              <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                JF Effect was built under real pressure on one belief: structure and standards outlast motivation. The same discipline behind Jared's own strength now runs through how the whole team coaches.
              </p>
              <div className="mt-4">
                <TextLink to="/about">Read Jared's story</TextLink>
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      {/* 6 — FAQ */}
      <Reveal>
        <Block tint narrow>
          <Heading eyebrow="Questions" title="Good to know." />
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

      {/* 7 — Final ask */}
      <Reveal>
        <Block narrow>
          <div id="cta" className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              {s.final_cta?.headline ?? "If you already know you need coaching, stop waiting."}
            </h2>
            <div className="mt-7 flex flex-col items-stretch gap-4 sm:items-center">
              <PrimaryCta to={APPLY_TO} className="sm:min-w-[280px]">{s.final_cta?.primary_label ?? ctaLabel}</PrimaryCta>
              <p className="text-[13px] text-muted-foreground">By application · Limited spots · No payment to apply</p>
              <p className="text-[15px] text-muted-foreground">
                Prefer to go self-guided?{" "}
                <Link to="/membership" className="font-medium text-primary hover:underline underline-offset-4">See JF Membership</Link>
              </p>
            </div>
          </div>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={ctaLabel} href={APPLY_TO} />
    </SalesPageShell>
  );
}
