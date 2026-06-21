import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { HeroCta } from "@/components/sales/sales-hero";
import { CoachingHero, CoachingVsMembership } from "@/components/sales/coaching-hero";
import { HowItWorks } from "@/components/sales/how-it-works";
import { ProofWall } from "@/components/sales/proof-wall";
import { FaqAccordion } from "@/components/sales/faq-accordion";
import { FinalCta } from "@/components/sales/final-cta";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, TrendingUp, Sparkles, Repeat as RepeatIcon, ShieldCheck,
  Target, ClipboardCheck, Utensils, MessageCircle,
} from "lucide-react";
import { Reveal } from "@/components/sales/reveal";
import { TransformationsStrip } from "@/components/sales/transformations-strip";
import { CoachTimelineSection } from "@/components/sales/coach-timeline-section";

function HeroSkeleton() {
  return (
    <section className="container mx-auto grid gap-10 px-4 py-14 md:py-20 lg:grid-cols-2 lg:items-center">
      <div className="space-y-4">
        <div className="h-6 w-48 rounded-full bg-muted/50 animate-pulse" />
        <div className="h-12 w-full max-w-xl rounded-md bg-muted/50 animate-pulse" />
        <div className="h-12 w-3/4 rounded-md bg-muted/50 animate-pulse" />
        <div className="h-5 w-full max-w-md rounded-md bg-muted/40 animate-pulse" />
        <div className="h-12 w-48 rounded-md bg-muted/50 animate-pulse" />
      </div>
      <div className="aspect-[4/3] rounded-2xl bg-muted/40 animate-pulse" />
    </section>
  );
}

export const Route = createFileRoute("/coaching/")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "Private 1:1 Fitness Coaching by Application | JF Effect" },
      { name: "description", content: "Private 1:1 online fitness coaching for strength, fat loss, muscle, and powerlifting. A plan built around your life, weekly check-ins, and a coach who knows your numbers. By application." },
      { property: "og:title", content: "Private 1:1 Fitness Coaching by Application | JF Effect" },
      { property: "og:description", content: "Private 1:1 online fitness coaching for strength, fat loss, muscle, and powerlifting. A plan built around your life, weekly check-ins, and a coach who knows your numbers. By application." },
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
          name: "JF Effect Private Coaching",
          serviceType: "Online Fitness Coaching",
          provider: {
            "@type": "Organization",
            name: "JF Effect",
            url: "https://jfeffect.com",
          },
          areaServed: { "@type": "Country", name: "Canada" },
          url: "https://jfeffect.com/coaching",
          description: "Private 1:1 online fitness coaching for strength, fat loss, muscle, and powerlifting.",
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

function CoachingPage() {
  const fetchPage = useServerFn(getPublicSalesPage);
  const { data: p } = useQuery({
    queryKey: ["public-sales-page", "coaching"],
    queryFn: () => fetchPage({ data: { page_key: "coaching" } }),
  });

  const handleApply = () => {
    window.location.href = "/coaching/apply";
  };

  const s = (p?.sections ?? {}) as Record<string, any>;

  const whoFor: string[] = Array.isArray(s.who_for) && s.who_for.length > 0 ? s.who_for : [
    "For driven people who want structure and will do the work.",
  ];
  const notFor: string[] = Array.isArray(s.not_for) && s.not_for.length > 0 ? s.not_for : [
    "Not for shortcuts, or anyone who won't follow a plan.",
  ];
  const howItWorks = Array.isArray(s.how_it_works) && s.how_it_works.length > 0 ? s.how_it_works : [
    { step: 1, title: "Apply", body: "A few minutes." },
    { step: 2, title: "Strategy call", body: "We map the plan together." },
    { step: 3, title: "Onboarding", body: "Training and nutrition, dialed in." },
    { step: 4, title: "Your plan", body: "Clear, every step." },
    { step: 5, title: "Coaching", body: "Weekly check-ins and adjustments." },
    { step: 6, title: "Results", body: "Built to last." },
  ];
  const faqItems = Array.isArray(s.faq) && s.faq.length > 0 ? s.faq : [
    { q: "Beginner?", a: "Yes — if you'll commit to the plan." },
    { q: "Need a gym?", a: "No. Built around your setup." },
    { q: "Home training?", a: "Yes." },
    { q: "Strength focus?", a: "Yes — it's where we come from." },
    { q: "Track calories?", a: "Targets that fit you." },
    { q: "Travel often?", a: "The plan adapts." },
    { q: "Failed before?", a: "You've never had a real plan and real accountability together. That changes here." },
  ];
  const authority: Array<{ label: string }> = Array.isArray(s.authority) && s.authority.length > 0 ? s.authority : [
    { label: "100+ clients coached" },
    { label: "Coaching since 2019" },
    { label: "A team built on competitive strength" },
  ];

  return (
    <SalesPageShell pageId="coaching" floatingHeader>
      {p === undefined ? (
        <HeroSkeleton />
      ) : (
      <CoachingHero
        eyebrow="Private Coaching · By Application"
        headline={"Coaching for people who are done settling."}
        sub={"A plan built around your life. A coaching team that knows your numbers. Real progress, held to a standard."}
        primary={<HeroCta onClick={handleApply}>Apply for Coaching</HeroCta>}
        secondary={
          <Link
            to="/membership"
            className="text-sm font-semibold text-white/70 underline-offset-4 hover:text-white hover:underline"
          >
            Explore the Membership →
          </Link>
        }
      />
      )}

      {/* 2. Authority bar */}
      <Reveal stagger={0}><AuthorityBar items={authority} /></Reveal>

      {/* Early social proof — transformations above the fold */}
      <Reveal stagger={1}>
        <TransformationsStrip
          eyebrow="REAL RESULTS"
          headline="100+ clients coached. Real transformations."
          sub="Members and 1:1 clients who showed up and did the work."
          ctaLabel="Apply for Coaching"
          onCta={handleApply}
        />
      </Reveal>

      {/* 3. Why most people fail */}
      <Reveal stagger={1}><WhyMostFail /></Reveal>

      {/* 4. Who this is for / not for */}
      <Reveal stagger={2}><WhoForNotFor whoFor={whoFor} notFor={notFor} /></Reveal>

      {/* 5. What coaching includes */}
      <Reveal stagger={3}><WhatCoachingIncludes /></Reveal>

      {/* 6. How it works */}
      <Reveal stagger={4}><HowItWorks items={howItWorks} /></Reveal>

      {/* 7. Proof wall */}
      <Reveal stagger={4}><ProofWall
        testimonials={p?.testimonials ?? []}
        images={(p?.visuals ?? []).filter((v) => v.slot === "proof")}
      /></Reveal>

      <Reveal stagger={4}><CoachTimelineSection /></Reveal>

      {/* 8. Coaching vs Membership */}
      <Reveal stagger={4}><CoachingVsMembership onApply={handleApply} /></Reveal>

      {/* 9. The Jared story */}
      <Reveal stagger={4}><JaredStory /></Reveal>

      {/* 10. FAQ */}
      <Reveal stagger={4}><FaqAccordion items={faqItems} /></Reveal>

      <div id="cta" />
      {/* 11. Final CTA */}
      <Reveal stagger={4}><FinalCta
        headline={s.final_cta?.headline ?? "Raise the standard."}
        primary={
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" onClick={handleApply} className="h-12 px-6 text-base font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150">
              {s.final_cta?.primary_label ?? "Apply for Coaching"}
            </Button>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              By application · Limited spots
            </p>
          </div>
        }
      /></Reveal>

      <div className="pb-24 md:pb-0" />
      {/* 12. Sticky mobile CTA */}
      <StickyMobileCta label={p?.primary_cta_label ?? "Apply for Coaching"} onClick={handleApply} />
    </SalesPageShell>
  );
}

/* -------- Authority bar -------- */
function AuthorityBar({ items }: { items: Array<{ label: string; value?: string }> }) {
  return (
    <section className="border-b border-white/10 bg-[#0a0a0a] text-white">
      <div className="container mx-auto px-4 py-4 md:py-5">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-3 text-center sm:grid-cols-3 md:grid-cols-5">
          {items.map((it, i) => (
            <li key={i} className="min-w-0">
              {it.value && (
                <div className="truncate text-base font-black text-white md:text-lg">{it.value}</div>
              )}
              <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 md:text-[11px]">
                {it.label}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* -------- Why most people fail -------- */
function WhyMostFail() {
  const cards = [
    { Icon: TrendingUp, title: "Strength that compounds", body: "One plan, run long enough to actually add up." },
    { Icon: Sparkles, title: "A body you've worked for", body: "Built deliberately — not chased in week-long sprints." },
    { Icon: RepeatIcon, title: "Habits that hold", body: "Routines that survive the busy weeks, not just the easy ones." },
    { Icon: ShieldCheck, title: "Accountability that's real", body: "Someone watching the numbers and holding the standard." },
  ];
  return (
    <Section>
      <SectionTitle eyebrow="The standard" title="Built for a higher standard." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ Icon, title, body }) => (
          <Card key={title} className="p-5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div className="mt-3 text-base font-bold">{title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* -------- Who this is for / not for -------- */
function WhoForNotFor({ whoFor, notFor }: { whoFor: string[]; notFor: string[] }) {
  return (
    <Section>
      <SectionTitle eyebrow="Who it's for" title="Selective by design." />
      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">This is for you if</div>
          <ul className="mt-4 space-y-3">
            {whoFor.map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">This is NOT for you if</div>
          <ul className="mt-4 space-y-3">
            {notFor.map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-muted-foreground">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

/* -------- What coaching includes -------- */
function WhatCoachingIncludes() {
  const items = [
    { Icon: Target, title: "A plan built for you", body: "Your body, your schedule, your training." },
    { Icon: ClipboardCheck, title: "Weekly check-ins", body: "Reviewed and adjusted around your progress." },
    { Icon: Utensils, title: "Nutrition that fits your life", body: "Clear targets, made to last." },
    { Icon: MessageCircle, title: "A coach in your corner", body: "Your dedicated coach, direct access, always." },
  ];
  return (
    <Section>
      <SectionTitle eyebrow="What you get" title="Built for you. Run with you." />
      <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ Icon, title, body }) => (
          <Card key={title} className="p-5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm font-bold">{title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* -------- Jared story -------- */
function JaredStory() {
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">The story</div>
          <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
            How JF Effect started.
          </h2>
        </div>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted-foreground md:text-base">
          <p>
            JF Effect was built from the ground up, under real pressure — founded by Jared James out of a simple belief: structure and standards outlast motivation. The same discipline that took his own strength training to the competitive level now runs through how the whole team coaches. After [X] years and [100+] clients, that belief hasn't changed. We build the plan, and we hold the line.
          </p>
        </div>
      </div>
    </Section>
  );
}
