import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Award,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  Dumbbell,
  MapPin,
  Medal,
  ShieldCheck,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { CoachTimelineSection } from "@/components/sales/coach-timeline-section";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/sales/reveal";
import coachingHero from "@/assets/coaching-hero.jpg";

const TITLE = "About Jared James | Coach, Powerlifter & JF Effect Founder";
const DESCRIPTION =
  "Meet Jared James, founder of JF Effect: personal trainer, online coach, competitive powerlifter, 2026 Commonwealth Champion, ISSA Certified Personal Trainer, and coach to 100+ clients.";
const URL = "https://jfeffect.com/about";

const credentials = [
  {
    title: "ISSA Personal Training Certification",
    detail: "International Sports Sciences Association · 2023",
    Icon: BadgeCheck,
  },
  {
    title: "DTS Level 1 Certification",
    detail: "Darby Training Systems · 2018",
    Icon: ShieldCheck,
  },
  {
    title: "100+ Clients Coached",
    detail: "From first-time gym members to Team Canada powerlifting athletes",
    Icon: Users,
  },
  {
    title: "Coaching Since 2019",
    detail: "Full-time coaching since 2022",
    Icon: Target,
  },
];

const competition = [
  {
    label: "2026 Commonwealth Champion",
    detail: "Represented Canada in Winnipeg at the Commonwealth Championships.",
    Icon: Trophy,
  },
  {
    label: "2026 NAPF North American Championships",
    detail: "Represented Canada internationally at the North American Championships.",
    Icon: Medal,
  },
  {
    label: "2026 Canadian Nationals",
    detail: "66 kg class · 9/9 attempts · 27 white lights · 662.5 kg total.",
    Icon: Award,
  },
  {
    label: "720 kg Total at 74 kg",
    detail: "Previous competition best total before moving down to the 66 kg class.",
    Icon: Dumbbell,
  },
];

const timeline = [
  {
    year: "2014",
    title: "Started from zero",
    body: "The beginning of my own training journey. Years before coaching became the career, I was learning what actually moves the needle.",
  },
  {
    year: "2018",
    title: "DTS Level 1",
    body: "Completed Darby Training Systems Level 1 and started building a more technical foundation for coaching movement and strength.",
  },
  {
    year: "2019",
    title: "Started coaching",
    body: "Began coaching clients and founded Strong Culture Athletics, learning how to build a brand and serve people beyond a single training session.",
  },
  {
    year: "2021",
    title: "JF Effect began",
    body: "Built the coaching business that became JF Effect, combining personalized training, nutrition structure, accountability, and strength coaching.",
  },
  {
    year: "2022",
    title: "Went full-time",
    body: "Coaching became the full-time focus. The roster grew across general fitness, body composition, bodybuilding, and competitive powerlifting.",
  },
  {
    year: "2023",
    title: "ISSA Certified Personal Trainer",
    body: "Added the ISSA Personal Training Certification to years of practical coaching and competitive experience.",
  },
  {
    year: "2026",
    title: "Back-to-back international competition",
    body: "Competed for Canada at the NAPF North American Championships and the Commonwealth Championships, finishing the stretch as a Commonwealth Champion.",
  },
];

export const Route = createFileRoute("/about")({
  component: AboutJaredPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "profile" },
      { property: "og:url", content: URL },
      { property: "og:site_name", content: "JF Effect" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Person",
          "@id": URL + "#jared-james",
          name: "Jared James",
          jobTitle: "Personal Trainer, Online Fitness Coach & Strength Coach",
          url: URL,
          worksFor: {
            "@type": "Organization",
            name: "JF Effect",
            url: "https://jfeffect.com",
          },
          address: {
            "@type": "PostalAddress",
            addressLocality: "Selkirk",
            addressRegion: "MB",
            addressCountry: "CA",
          },
          knowsAbout: [
            "Personal Training",
            "Strength Training",
            "Powerlifting",
            "Bodybuilding",
            "Fat Loss Coaching",
            "Online Fitness Coaching",
            "Nutrition Coaching",
          ],
          award: [
            "2026 Commonwealth Champion",
            "2026 Canadian Nationals — 9/9 attempts, 27 white lights",
          ],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://jfeffect.com/" },
            { "@type": "ListItem", position: 2, name: "About Jared", item: URL },
          ],
        }),
      },
    ],
  }),
});

function AboutJaredPage() {
  return (
    <SalesPageShell pageId="about-jared" floatingHeader>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
        <div className="container mx-auto grid gap-8 px-4 py-12 md:py-20 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
              About Jared James
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight md:text-6xl">
              Coach. Powerlifter. Builder.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              I built JF Effect from both sides of the bar — as a coach responsible for other people's progress and as an athlete who still has to execute under pressure.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Today I coach everyone from people walking into a gym for the first time to Team Canada powerlifting athletes. The standard stays the same: build the right plan, track what matters, and adjust based on reality.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 font-bold">
                <Link to="/coaching/apply">Apply for Coaching</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 font-bold">
                <Link to="/personal-trainer-selkirk">Train With Me In Person</Link>
              </Button>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-lg">
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-primary/10 blur-2xl" />
            <img
              src={coachingHero}
              alt="Jared James, founder and coach at JF Effect"
              className="aspect-[4/5] w-full rounded-3xl object-cover object-top shadow-2xl ring-1 ring-border"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* QUICK AUTHORITY */}
      <Reveal stagger={0}>
        <Section className="!pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["100+", "Clients coached"],
              ["2019", "Coaching since"],
              ["2026", "Commonwealth Champion"],
              ["2", "Professional certifications"],
            ].map(([value, label]) => (
              <Card key={label} className="p-5 text-center">
                <div className="text-3xl font-black text-primary">{value}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      {/* STORY */}
      <Reveal stagger={1}>
        <Section>
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">The short version</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
                I don't coach from theory alone.
              </h2>
            </div>
            <div className="space-y-4 text-base leading-relaxed text-muted-foreground md:text-lg">
              <p>
                My own training started in 2014. Coaching came later, but the obsession was already there: understand why something works, test it, track it, and make it repeatable.
              </p>
              <p>
                I started coaching in 2019 and moved into it full-time in 2022. Since then I've coached more than 100 people across fat loss, muscle building, strength, bodybuilding, and powerlifting.
              </p>
              <p>
                I still compete because it keeps me accountable to the same thing I ask from clients: preparation, execution, honest feedback, and adjustment. Coaching should work when life is busy and when the stakes are high — not only when everything is perfect.
              </p>
            </div>
          </div>
        </Section>
      </Reveal>

      {/* CREDENTIALS */}
      <Reveal stagger={2}>
        <Section className="bg-card/30">
          <SectionTitle
            eyebrow="Credentials"
            title="Education + coaching experience"
            sub="The formal education matters. So does what you've actually done with it."
          />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            {credentials.map(({ title, detail, Icon }) => (
              <Card key={title} className="flex items-start gap-4 p-5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-black">{title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</div>
                </div>
              </Card>
            ))}
          </div>

          <div className="mx-auto mt-5 max-w-5xl">
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <BriefcaseBusiness className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-black">Built in the real coaching environment</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:text-base">
                    Before JF Effect became the full-time focus, I worked as a personal trainer at GoodLife Fitness, managing a roster of 40+ monthly clients. I later built JF Effect around personalized training, nutrition structure, accountability, form review, and direct coaching support.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </Section>
      </Reveal>

      {/* COMPETITIVE TRACK RECORD */}
      <Reveal stagger={3}>
        <Section>
          <SectionTitle
            eyebrow="Athlete"
            title="Competitive powerlifting"
            sub="I still compete. The pressure, preparation, and execution are part of how I coach."
          />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            {competition.map(({ label, detail, Icon }) => (
              <Card key={label} className="p-5">
                <div className="flex items-start gap-4">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-black">{label}</div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      {/* TIMELINE */}
      <Reveal stagger={4}>
        <Section className="bg-card/30">
          <SectionTitle
            eyebrow="Timeline"
            title="How it got here"
            sub="The credentials make more sense when you see the years behind them."
          />
          <div className="mx-auto max-w-4xl space-y-3">
            {timeline.map((item) => (
              <Card key={item.year} className="grid gap-3 p-5 sm:grid-cols-[90px_1fr] sm:items-start">
                <div className="text-2xl font-black text-primary">{item.year}</div>
                <div>
                  <div className="font-black">{item.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground md:text-base">{item.body}</p>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      {/* EXISTING VISUAL TIMELINE */}
      <Reveal stagger={5}>
        <CoachTimelineSection />
      </Reveal>

      {/* METHOD */}
      <Reveal stagger={6}>
        <Section>
          <SectionTitle
            eyebrow="How I coach"
            title="Simple enough to execute. Detailed enough to work."
          />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            {[
              {
                title: "Build around the person",
                body: "Your schedule, equipment, training age, recovery, goals, and real life come first. The plan has to fit the person using it.",
              },
              {
                title: "Track the right data",
                body: "Training performance, bodyweight, photos, recovery, adherence, and honest feedback tell us what to change — not guesswork.",
              },
              {
                title: "Adjust before things break",
                body: "One rough week should not become a lost month. Coaching is the process of making the plan keep working as life changes.",
              },
            ].map((item) => (
              <Card key={item.title} className="p-6">
                <CheckCircle2 className="h-6 w-6 text-primary" />
                <h3 className="mt-4 text-lg font-black">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      {/* LOCAL */}
      <Reveal stagger={7}>
        <Section className="bg-card/30">
          <div className="mx-auto max-w-4xl rounded-3xl border border-primary/20 bg-background p-7 md:p-10">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <MapPin className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-primary">Selkirk, Manitoba</div>
                <h2 className="mt-2 text-2xl font-black md:text-4xl">Online or in person.</h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                  I coach online through JF Effect and offer in-person personal training in Selkirk. Whether you're starting from zero or competing at a high level, the goal is the same: make the next step obvious and measurable.
                </p>
              </div>
            </div>
          </div>
        </Section>
      </Reveal>

      {/* CTA */}
      <Reveal stagger={8}>
        <Section className="!pt-8">
          <div className="mx-auto max-w-3xl rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-8 text-center md:p-12">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Work with me</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
              The credentials matter. The coaching has to prove itself.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
              If you want a plan built around your actual life and a coach who will keep adjusting it with you, apply for private coaching.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-7 font-bold">
                <Link to="/coaching/apply">Apply for Coaching</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-7 font-bold">
                <Link to="/coaching">See How Coaching Works</Link>
              </Button>
            </div>
          </div>
        </Section>
      </Reveal>
    </SalesPageShell>
  );
}
