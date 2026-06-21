import { createFileRoute, Link } from "@tanstack/react-router";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { TransformationsGallery } from "@/components/sales/transformations-gallery";
import { TransformationsStrip } from "@/components/sales/transformations-strip";
import { CoachTimelineSection } from "@/components/sales/coach-timeline-section";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  CheckCircle2, MapPin, Sparkles, HeartHandshake, Dumbbell, Users, Calendar,
  ShieldCheck, Scale, Trophy, Brain, Apple,
} from "lucide-react";
import { Reveal } from "@/components/sales/reveal";

const TITLE = "Personal Trainer Selkirk MB | JF Effect Coaching";
const DESCRIPTION =
  "Personal training in Selkirk, Manitoba for fat loss, strength, muscle building, powerlifting, and bodybuilding. Work with JF Effect online or in person at Iron Image Gym.";
const URL = "https://jfeffect.com/personal-trainer-selkirk";
const OG_IMAGE = "https://jfeffect.com/icon-1024.png";

const BOOK_HREF = "/coaching/apply?from=selkirk";
const EXTERNAL_HREF = "https://jaredjamesfit.com";

const faq = [
  { q: "Do you offer personal training in Selkirk?", a: "Yes. JF Effect offers one-on-one personal training in Selkirk, Manitoba for beginners through advanced lifters." },
  { q: "Where do sessions take place?", a: "In-person sessions are held at Iron Image Gym in Selkirk, Manitoba." },
  { q: "Do you offer online coaching too?", a: "Yes. If you can't train in person, JF Effect online coaching covers training, nutrition, and accountability from anywhere." },
  { q: "Can beginners work with JF Effect?", a: "Absolutely. Most clients start with little or no gym experience. The whole process is built to make beginners feel comfortable and confident." },
  { q: "Do you help with fat loss?", a: "Yes. Fat loss is one of the most common goals clients come in with, and coaching combines training, nutrition, and habits to make it sustainable." },
  { q: "Do you coach powerlifting and bodybuilding?", a: "Yes. Jared is a competitive powerlifter and coaches strength, powerlifting, and bodybuilding-focused clients alongside general fitness." },
  { q: "How much does personal training cost in Selkirk?", a: "Personal training sessions are $100 each. Package options are available — book a free consultation to find the right fit." },
  { q: "How do I get started?", a: "Apply through the form on this page. We'll reach out to book your free consultation and map out the plan." },
];

export const Route = createFileRoute("/personal-trainer-selkirk")({
  component: SelkirkPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:site_name", content: "JF Effect" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
      { name: "geo.region", content: "CA-MB" },
      { name: "geo.placename", content: "Selkirk, Manitoba" },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": ["LocalBusiness", "ProfessionalService", "HealthAndBeautyBusiness"],
          "@id": URL + "#business",
          name: "JF Effect — Personal Training Selkirk",
          image: OG_IMAGE,
          url: URL,
          telephone: "+1-204-229-4913",
          priceRange: "$100",
          address: {
            "@type": "PostalAddress",
            streetAddress: "Iron Image Gym",
            addressLocality: "Selkirk",
            addressRegion: "MB",
            addressCountry: "CA",
          },
          areaServed: [
            { "@type": "City", name: "Selkirk" },
            { "@type": "AdministrativeArea", name: "Manitoba" },
          ],
          serviceType: [
            "Personal Training",
            "Fitness Coaching",
            "Strength Coaching",
            "Fat Loss Coaching",
            "Powerlifting Coaching",
            "Bodybuilding Coaching",
            "Online Coaching",
          ],
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "Personal Training Services",
            itemListElement: [
              { "@type": "Offer", itemOffered: { "@type": "Service", name: "In-Person Personal Training (Selkirk, MB)" } },
              { "@type": "Offer", itemOffered: { "@type": "Service", name: "Online Coaching" } },
              { "@type": "Offer", itemOffered: { "@type": "Service", name: "Fat Loss Coaching" } },
              { "@type": "Offer", itemOffered: { "@type": "Service", name: "Strength & Powerlifting Coaching" } },
              { "@type": "Offer", itemOffered: { "@type": "Service", name: "Bodybuilding Coaching" } },
            ],
          },
          sameAs: ["https://jaredjamesfit.com"],
          description: DESCRIPTION,
          provider: {
            "@type": "Person",
            name: "Jared James",
            jobTitle: "Personal Trainer & Strength Coach",
            url: "https://jaredjamesfit.com",
            worksFor: { "@type": "Organization", name: "JF Effect" },
          },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
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
            { "@type": "ListItem", position: 3, name: "Personal Trainer Selkirk", item: URL },
          ],
        }),
      },
    ],
  }),
});

function PrimaryCta({ children = "Apply Now" }: { children?: React.ReactNode }) {
  return (
    <a href={BOOK_HREF}>
      <Button size="lg" className="h-14 w-full px-7 text-base font-bold sm:w-auto hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150">
        {children}
      </Button>
    </a>
  );
}

function SelkirkPage() {
  return (
    <SalesPageShell pageId="personal-trainer-selkirk" hideMarketingNav>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/15 via-background to-background" />
        <div className="container mx-auto px-4 py-12 md:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <MapPin className="h-3 w-3" /> Selkirk, Manitoba · Iron Image Gym
            </div>
            <h1 className="mt-5 text-4xl font-black tracking-tight md:text-6xl">
              Personal Training in Selkirk for Beginners Who Want Real Results
            </h1>
            <p className="mt-5 text-base text-muted-foreground md:text-xl">
              You don't need to be fit to start.
            </p>
            <p className="mt-3 text-base text-muted-foreground md:text-lg">
              Whether your goal is fat loss, building muscle, getting stronger, powerlifting, bodybuilding, or just learning
              how to use a gym the right way, Jared James makes personal training in Selkirk simple, structured, and built
              around you — in person or online.
            </p>
            <p className="mt-4 text-sm font-semibold md:text-base">
              At Iron Image Gym in Selkirk, Manitoba. Sessions from $100. Packages available.
            </p>
            <div className="mt-7 flex justify-center">
              <PrimaryCta />
            </div>
          </div>
        </div>
      </section>

      {/* Early social proof — transformations right under the hero */}
      <Reveal stagger={0}>
        <TransformationsStrip
          eyebrow="Selkirk results"
          headline="Real people. Real progress."
          sub="Clients from Selkirk and beyond who started where you are."
          ctaLabel="Apply Now"
          ctaHref={BOOK_HREF}
        />
      </Reveal>

      {/* SECTION 2 — Nervous */}
      <Reveal stagger={1}><Section>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">Nervous About The Gym?</h2>
        </div>
        <div className="mx-auto mt-8 max-w-2xl space-y-4 text-base leading-relaxed text-muted-foreground md:text-lg">
          <p className="font-semibold text-foreground">You're not the only one.</p>
          <p>Most people don't struggle because they're lazy. They struggle because nobody ever showed them where to start.</p>
          <p>The internet contradicts itself. The equipment looks confusing. And walking in that first time feels intimidating.</p>
          <p className="font-semibold text-foreground">So the first goal isn't getting you in shape. It's getting you comfortable.</p>
          <p>You'll learn what to do, how to do it, and why — every step.</p>
          <p>No guessing. No random workouts. No feeling lost.</p>
        </div>
      </Section></Reveal>

      {/* SECTION 3 — Who this is for */}
      <Reveal stagger={2}><Section className="bg-card/30">
        <SectionTitle title="Who This Is Perfect For" />
        <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
            "Never set foot in a gym",
            "Starting over after years away",
            "Want to lose weight",
            "Want more confidence",
            "Want to build muscle",
            "Want accountability",
            "Busy professionals",
            "Men and women, every level",
            "Strength and powerlifting athletes",
          ].map((label) => (
            <Card key={label} className="flex items-start gap-3 p-5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <span className="text-base font-semibold">{label}</span>
            </Card>
          ))}
        </div>
      </Section></Reveal>

      {/* SECTION 4 — First session */}
      <Reveal stagger={3}><Section>
        <SectionTitle eyebrow="What to expect" title="What Your First Session Looks Like" />
        <div className="mx-auto grid max-w-4xl gap-3 md:grid-cols-5">
          {[
            { t: "Talk through your goals", b: "A real conversation about what you actually want." },
            { t: "Check your starting point", b: "A simple assessment so we know where we're beginning." },
            { t: "Learn the equipment", b: "I'll show you how to use it correctly and safely." },
            { t: "Build your plan", b: "Designed around your schedule and your life." },
            { t: "Leave with a plan", b: "You'll know exactly what to do next." },
          ].map((s, i) => (
            <Card key={s.t} className="p-5">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary text-sm font-black">
                {i + 1}
              </div>
              <div className="mt-3 text-sm font-bold">{s.t}</div>
              <p className="mt-1 text-xs text-muted-foreground">{s.b}</p>
            </Card>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-base font-semibold md:text-lg">
          No pressure. No judgment. No experience needed.
        </p>
      </Section></Reveal>

      {/* SECTION 5 — Why Jared */}
      <Reveal stagger={4}><Section className="bg-card/30">
        <SectionTitle eyebrow="About your coach" title="Why Beginners Work With Jared" />
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
          <Card className="p-6">
            <ul className="space-y-3">
              {[
                "Coaching since 2019, full-time since 2022",
                "100+ clients helped",
                "A coaching approach built for beginners",
                "Strength and physique specialist",
                "Competitive powerlifter",
                "Coaching made personal",
                "Local to Selkirk",
                "Training at Iron Image Gym",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm md:text-base">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <HeartHandshake className="h-8 w-8 text-primary" />
            <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
              Most trainers are great with people who already know what they're doing.
            </p>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground md:text-lg">
              The real skill is taking someone from overwhelmed and unsure to confident and consistent.
            </p>
            <p className="mt-3 text-base font-semibold md:text-lg">That's what Jared does best.</p>
          </Card>
        </div>
      </Section></Reveal>

      <Reveal stagger={4}><TransformationsGallery eyebrow="Results" title="100+ lives changed" /></Reveal>
      <Reveal stagger={4}><CoachTimelineSection /></Reveal>

      {/* SECTION 6 — Pricing */}
      <Reveal stagger={4}><Section>
        <div className="mx-auto max-w-2xl rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-8 text-center md:p-12">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Personal Training Pricing</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Simple.</h2>
          <div className="mt-5 text-5xl font-black md:text-6xl">
            $100<span className="text-base font-semibold text-muted-foreground"> / session</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Bulk packages available. Book a free consultation and we'll find the right fit for your goals.
          </p>
          <div className="mt-6 flex justify-center">
            <PrimaryCta />
          </div>
        </div>
      </Section></Reveal>

      {/* SECTION 7 — Goals */}
      <Reveal stagger={4}><Section className="bg-card/30">
        <SectionTitle title="What Clients Come For" />
        <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { Icon: Scale, label: "Weight Loss" },
            { Icon: Dumbbell, label: "Build Muscle" },
            { Icon: Sparkles, label: "More Confidence" },
            { Icon: Brain, label: "Learning the Equipment" },
            { Icon: Trophy, label: "Strength Training" },
            { Icon: ShieldCheck, label: "Powerlifting Coaching" },
            { Icon: Apple, label: "Better Habits" },
            { Icon: Users, label: "Accountability" },
          ].map(({ Icon, label }) => (
            <Card key={label} className="flex flex-col items-center p-5 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary">
                <Icon className="h-6 w-6" />
              </div>
              <div className="mt-3 text-sm font-bold md:text-base">{label}</div>
            </Card>
          ))}
        </div>
      </Section></Reveal>

      {/* SECTION 8 — In person or online */}
      <Reveal stagger={4}><Section>
        <SectionTitle title="Train In Person Or Online" />
        <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
          <Card className="p-6">
            <MapPin className="h-7 w-7 text-primary" />
            <h3 className="mt-3 text-xl font-bold">In-Person Personal Training in Selkirk</h3>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              One-on-one coaching at Iron Image Gym in Selkirk, Manitoba. Strength, fat loss, muscle building, powerlifting, and bodybuilding clients welcome.
            </p>
            <div className="mt-5">
              <a href={BOOK_HREF}>
                <Button className="w-full">Apply Now</Button>
              </a>
            </div>
          </Card>
          <Card className="p-6">
            <Calendar className="h-7 w-7 text-primary" />
            <h3 className="mt-3 text-xl font-bold">Online Fitness Coaching</h3>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Train from anywhere with JF Effect online coaching: custom programming, nutrition guidance, weekly accountability, and the full app experience. <Link to="/coaching" className="underline underline-offset-4">Learn more about coaching →</Link>
            </p>
            <div className="mt-5">
              <a href={EXTERNAL_HREF} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="w-full">Visit JaredJamesFit.com</Button>
              </a>
            </div>
          </Card>
        </div>
      </Section></Reveal>

      {/* SECTION 9 — FAQ */}
      <Reveal stagger={4}><Section className="bg-card/30">
        <SectionTitle eyebrow="FAQ" title="Frequently asked questions" />
        <Accordion type="single" collapsible className="mx-auto max-w-2xl">
          {faq.map((it, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-base font-semibold">{it.q}</AccordionTrigger>
              <AccordionContent className="text-base text-muted-foreground">{it.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section></Reveal>

      {/* FINAL CTA */}
      <Reveal stagger={4}><Section className="!pt-6">
        <div className="mx-auto max-w-3xl rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-8 text-center md:p-12">
          <h2 className="text-3xl font-black tracking-tight md:text-5xl">Ready To Feel Comfortable In The Gym?</h2>
          <p className="mt-4 text-base text-muted-foreground md:text-lg">
            You don't need to be in shape to start. You just need a plan.
          </p>
          <p className="mt-2 text-base font-semibold md:text-lg">Book your free consultation today.</p>
          <div className="mt-6 flex justify-center">
            <PrimaryCta />
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Serving Selkirk, Manitoba and surrounding areas · Personal trainer · Fitness coach · Weight loss coach · Strength coach
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            More from JF Effect:{" "}
            <Link to="/coaching" className="underline underline-offset-4">Private Coaching</Link>
            {" · "}
            <Link to="/join" className="underline underline-offset-4">Self-Guided Membership</Link>
          </p>
        </div>
      </Section>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label="Apply Now" href={BOOK_HREF} />
    </SalesPageShell>
  );
}
