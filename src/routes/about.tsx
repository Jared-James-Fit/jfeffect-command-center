import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Award,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
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

const TITLE = "About Jared James | Team Canada Powerlifter & JF Effect Founder";
const DESCRIPTION =
  "Meet Jared James, founder of JF Effect: Team Canada powerlifter, 2× international champion, Top 50 all-time 66 kg lifter, certified personal trainer, and coach to 100+ clients.";
const URL = "https://jfeffect.com/about";

type ResultRow = { primary: string; secondary: string };

const headlineStats = [
  ["100+", "Clients coached", "General fitness to international-level powerlifting"],
  ["🇨🇦", "Team Canada", "International powerlifting athlete"],
  ["2×", "International Champion", "NAPF + Commonwealth · 2026"],
  ["Top 50", "All-Time World Ranking", "66 kg powerlifting · 2026"],
  ["5×", "Drug-Tested Athlete", "Sanctioned drug-tested competition"],
  ["3", "Professional Certifications", "GLPTI · DTS Level 1 · ISSA CPT"],
];

const internationalResults: ResultRow[] = [
  { primary: "2026 · NAPF North American Championships", secondary: "Gold — Squat · Bench · Deadlift · Overall Total" },
  { primary: "2026 · Commonwealth Championships", secondary: "Gold — Squat · Bench · Overall Total · Silver — Deadlift" },
];

const nationalResults: ResultRow[] = [
  { primary: "2024 · Canadian Nationals", secondary: "5th Place · Summerside, PEI" },
  { primary: "2025 · Canadian Nationals", secondary: "4th Place · Moose Jaw, SK" },
  { primary: "2026 · Canadian Nationals", secondary: "2nd Place · 66 kg · St. John's, NL · 9/9 attempts · 27 white lights · 662.5 kg total" },
];

const regionalResults: ResultRow[] = [
  { primary: "2018 · Western Canadian Championships", secondary: "1st Place · Edmonton, AB" },
  { primary: "2023 · Central Canadian Championships", secondary: "1st Place · Saint-Hyacinthe, QC" },
  { primary: "2024 · Western Canadian Championships", secondary: "2nd Place · Moose Jaw, SK" },
];

const provincialResults: ResultRow[] = [
  { primary: "2020 · Manitoba Provincial Championships", secondary: "1st Place · Winnipeg, MB" },
  { primary: "2022 · Manitoba Provincial Championships", secondary: "1st Place · Winnipeg, MB" },
  { primary: "2023 · Ontario Provincial Championships", secondary: "1st Place · Bowmanville, ON" },
];

const localResults: ResultRow[] = [
  { primary: "2018 · Movement Powerlifting Classic", secondary: "1st Place" },
  { primary: "2019 · Brickhouse Power Challenge", secondary: "1st Place" },
  { primary: "2020 · Brickhouse Power Challenge", secondary: "1st Place" },
  { primary: "2020 · Movement Powerlifting Classic 3.0", secondary: "1st Place" },
  { primary: "2022 · Brickhouse Power Challenge", secondary: "1st Place" },
  { primary: "2022 · Nightmare Before Liftmass", secondary: "1st Place" },
  { primary: "2025 · MPA Summer Classic", secondary: "1st Place" },
];

const powerliftingRecords: ResultRow[] = [
  { primary: "02/02/2020 · MPA 66 kg Junior", secondary: "Squat · 187.5 kg" },
  { primary: "02/02/2020 · MPA 66 kg Junior", secondary: "Bench Press · 135.5 kg" },
  { primary: "02/02/2020 · MPA 66 kg Junior", secondary: "Deadlift · 240 kg" },
  { primary: "02/02/2020 · MPA 66 kg Junior", secondary: "Total · 563.5 kg" },
  { primary: "02/02/2020 · MPA 66 kg Junior", secondary: "Bench Press Only · 135.5 kg" },
  { primary: "02/02/2020 · MPA 66 kg Open", secondary: "Bench Press Only · 135.5 kg · set as a Junior" },
  { primary: "02/02/2020 · MPA 74 kg Junior", secondary: "Bench Press Only · 155 kg" },
  { primary: "08/08/2020 · MPA 74 kg Junior", secondary: "Bench Press · 155 kg" },
  { primary: "03/09/2022 · MPA 66 kg Open", secondary: "Squat · 240 kg" },
  { primary: "03/09/2022 · MPA 66 kg Open", secondary: "Total · 662.5 kg" },
  { primary: "03/26/2022 · MPA 74 kg Open", secondary: "Bench Press · 155.5 kg" },
  { primary: "08/13/2022 · MPA 66 kg Open", secondary: "Squat · 225 kg" },
  { primary: "08/13/2022 · MPA 66 kg Open", secondary: "Bench Press · 150 kg" },
  { primary: "08/13/2022 · MPA 66 kg Open", secondary: "Total · 630 kg" },
  { primary: "08/13/2022 · MPA", secondary: "Highest GL Points" },
  { primary: "03/08/2024 · OPA 74 kg Open", secondary: "Bench Press · 170 kg" },
  { primary: "03/08/2024 · OPA 74 kg Open", secondary: "Deadlift · 290 kg" },
  { primary: "03/08/2024 · OPA 74 kg Open", secondary: "Total · 720 kg" },
  { primary: "07/19/2025 · MPA 83 kg Open", secondary: "Total · 707.5 kg" },
  { primary: "07/19/2025 · MPA", secondary: "Ranked #1 · GL Points 100.40 · 3-Lift" },
  { primary: "07/19/2025 · MPA", secondary: "Ranked #1 · GL Points 103.71 · 3-Lift" },
];

const bodybuildingResults: ResultRow[] = [
  { primary: "2018 · MABBA", secondary: "1st Place · Men's Physique" },
  { primary: "2019 · CPA Van Dijk Natural Classic", secondary: "3rd Place · Men's Physique" },
];

const athleteResults: ResultRow[] = [
  { primary: "2025 · Phillip Bennett", secondary: "6th Place · IPF World Championships · San José, Costa Rica" },
  { primary: "2024 · Laine Vandriel", secondary: "1st Place · Canadian Nationals · Summerside, PEI" },
  { primary: "2024 · Frederick Callahan", secondary: "3rd Place · Canadian Nationals · Summerside, PEI" },
  { primary: "2025 · Phillip Bennett", secondary: "1st Place · Canadian Nationals · Moose Jaw, SK" },
  { primary: "2025 · Sarah Anderson", secondary: "11th Place · Canadian Nationals · Moose Jaw, SK" },
  { primary: "2023 · Kenneth Morris", secondary: "3rd Place · Western Canadians · Brandon, MB" },
  { primary: "2023 · Shaina Sagar", secondary: "3rd Place · Western Canadians · Brandon, MB" },
  { primary: "2024 · Laine Vandriel", secondary: "3rd Place · Western Canadians · Moose Jaw, SK" },
  { primary: "2025 · Dwayne Gordon", secondary: "1st Place · Central Canadians · Québec City, QC" },
  { primary: "2025 · Shaina Sagar", secondary: "3rd Place · Eastern Canadians · Dartmouth, NS" },
  { primary: "2025 · Elisa Vena", secondary: "6th Place · Western Canadians · Nanaimo, BC" },
];

const timeline = [
  { year: "2014", title: "Started training", body: "The start of my own training journey and the years of learning that eventually became the foundation for coaching." },
  { year: "2017", title: "Personal trainer at GoodLife Fitness", body: "Worked in a real coaching environment managing clients, sessions, progression, and day-to-day accountability." },
  { year: "2018", title: "DTS Level 1 + bodybuilding champion", body: "Completed Darby Training Systems Level 1 and won the MABBA Men's Physique title." },
  { year: "2021", title: "JF Effect became the full-time path", body: "Built the coaching business around personalized training, nutrition structure, accountability, form review, and direct support." },
  { year: "2023", title: "ISSA Certified Personal Trainer", body: "Added the ISSA Personal Training Certification alongside practical coaching and competitive experience." },
  { year: "2026", title: "Team Canada · 2× International Champion", body: "Won the overall total at both the NAPF North American Championships and Commonwealth Championships." },
];

function ResultList({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="divide-y divide-border/70">
      {rows.map((row, index) => (
        <div key={`${row.primary}-${index}`} className="py-3 first:pt-0 last:pb-0">
          <div className="text-sm font-bold leading-snug">{row.primary}</div>
          <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.secondary}</div>
        </div>
      ))}
    </div>
  );
}

function CredentialAccordion({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="font-black">{title}</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{summary}</div>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-primary transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-5 py-4">{children}</div>
    </details>
  );
}

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
          worksFor: { "@type": "Organization", name: "JF Effect", url: "https://jfeffect.com" },
          address: { "@type": "PostalAddress", addressLocality: "Selkirk", addressRegion: "MB", addressCountry: "CA" },
          knowsAbout: ["Personal Training", "Strength Training", "Powerlifting", "Bodybuilding", "Fat Loss Coaching", "Online Fitness Coaching", "Nutrition Coaching"],
          award: ["2026 NAPF North American Champion", "2026 Commonwealth Champion", "2022 MPA Male Athlete of the Year", "2018 MABBA Men's Physique Champion"],
        }),
      },
    ],
  }),
});

function AboutJaredPage() {
  return (
    <SalesPageShell pageId="about-jared" floatingHeader>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
        <div className="container mx-auto grid gap-8 px-4 py-12 md:py-20 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
              About Jared James
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight md:text-6xl">Coach. Team Canada athlete. 2× International Champion.</h1>
            <p className="mt-4 max-w-2xl text-base font-bold text-primary md:text-lg">Top 50 all-time in the world · 66 kg powerlifting</p>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              I built JF Effect from both sides of the bar — as a coach responsible for other people's progress and as an athlete who still has to execute under pressure.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 font-bold"><Link to="/coaching/apply">Apply for Coaching</Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 font-bold"><Link to="/personal-trainer-selkirk">Train With Me In Person</Link></Button>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-lg">
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-primary/10 blur-2xl" />
            <img src={coachingHero} alt="Jared James, founder and coach at JF Effect" className="aspect-[4/5] w-full rounded-3xl object-cover object-top shadow-2xl ring-1 ring-border" loading="eager" />
          </div>
        </div>
      </section>

      <Reveal stagger={0}>
        <Section className="!pt-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {headlineStats.map(([value, label, detail]) => (
              <Card key={label} className="flex min-h-[132px] flex-col justify-center p-4 text-center sm:p-5">
                <div className="text-2xl font-black text-primary sm:text-3xl">{value}</div>
                <div className="mt-1 text-[11px] font-bold uppercase tracking-wider sm:text-xs">{label}</div>
                <div className="mt-2 text-[11px] leading-snug text-muted-foreground sm:text-xs">{detail}</div>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={1}>
        <Section>
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">The short version</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">I don't coach from theory alone.</h2>
            </div>
            <div className="space-y-4 text-base leading-relaxed text-muted-foreground md:text-lg">
              <p>My own training started in 2014. Since then I've competed in bodybuilding and powerlifting, represented Canada internationally, and coached more than 100 people across fat loss, muscle building, strength, bodybuilding, and powerlifting.</p>
              <p>I still compete because it keeps me accountable to the same standards I ask from clients: preparation, execution, honest feedback, and adjustment.</p>
            </div>
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={2}>
        <Section className="bg-card/30">
          <SectionTitle eyebrow="Complete competitive record" title="The highlights first. Every receipt underneath." sub="Open any section to see the full list without turning the page into a wall of trophies." />
          <div className="mx-auto max-w-5xl space-y-3">
            <CredentialAccordion title="International Championships" summary="2 overall international titles · NAPF + Commonwealth · 2026" defaultOpen>
              <ResultList rows={internationalResults} />
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">“2× International Champion” refers to the two overall-total championship wins. Individual lift medals are listed as results, not counted as additional championship titles.</p>
            </CredentialAccordion>
            <CredentialAccordion title="Canadian Nationals" summary="2024–2026 · 5th → 4th → 2nd"><ResultList rows={nationalResults} /></CredentialAccordion>
            <CredentialAccordion title="Regional Championships" summary="2 wins + 1 silver"><ResultList rows={regionalResults} /></CredentialAccordion>
            <CredentialAccordion title="Provincial Championships" summary="3 championship wins · Manitoba + Ontario"><ResultList rows={provincialResults} /></CredentialAccordion>
            <CredentialAccordion title="Local Meets" summary="7 sanctioned meet wins"><ResultList rows={localResults} /></CredentialAccordion>
            <CredentialAccordion title="Powerlifting Records & Rankings" summary="21 documented record / ranking entries"><ResultList rows={powerliftingRecords} /></CredentialAccordion>
            <CredentialAccordion title="Federation Awards & Recognition" summary="MPA Male Athlete of the Year">
              <ResultList rows={[{ primary: "2022 · Manitoba Powerlifting Association", secondary: "Male Athlete of the Year" }]} />
            </CredentialAccordion>
            <CredentialAccordion title="Bodybuilding" summary="Men's Physique · champion + natural podium"><ResultList rows={bodybuildingResults} /></CredentialAccordion>
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={3}>
        <Section>
          <SectionTitle eyebrow="Coaching proof" title="Results beyond my own platform." sub="Competitive athletes coached from provincial competition through Canadian Nationals and IPF Worlds." />
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["1", "IPF Worlds athlete", "Costa Rica · 2025"],
              ["3", "National champions", "Canadian Nationals gold"],
              ["11+", "Provincial golds", "MB + ON"],
              ["14+", "Provincial records", "Set + held by coached athletes"],
            ].map(([value, label, detail]) => (
              <Card key={label} className="p-4 text-center">
                <div className="text-2xl font-black text-primary">{value}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide">{label}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">{detail}</div>
              </Card>
            ))}
          </div>
          <div className="mx-auto mt-4 max-w-5xl">
            <CredentialAccordion title="View all athlete results" summary="Worlds · Nationals · Regional championships">
              <ResultList rows={athleteResults} />
            </CredentialAccordion>
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={4}>
        <Section className="bg-card/30">
          <SectionTitle eyebrow="Education + experience" title="Coaching credentials" sub="Formal education backed by years of hands-on coaching and competition." />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            {[
              ["GLPTI Certification", "Professional personal training certification", BadgeCheck],
              ["DTS Level 1 Certification", "Darby Training Systems · 2018", ShieldCheck],
              ["ISSA Personal Training Certification", "International Sports Sciences Association · 2023", BadgeCheck],
              ["100+ Clients Coached", "General fitness, body composition, bodybuilding and powerlifting", Users],
            ].map(([title, detail, Icon]) => {
              const IconComponent = Icon as typeof BadgeCheck;
              return (
                <Card key={title as string} className="flex items-start gap-4 p-5">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><IconComponent className="h-5 w-5" /></div>
                  <div><div className="font-black">{title as string}</div><div className="mt-1 text-sm leading-relaxed text-muted-foreground">{detail as string}</div></div>
                </Card>
              );
            })}
          </div>
          <div className="mx-auto mt-4 max-w-5xl space-y-3">
            <CredentialAccordion title="Coaching career" summary="Personal training → full-time JF Effect">
              <ResultList rows={[
                { primary: "May 2017 – July 2018 · GoodLife Fitness", secondary: "Personal Trainer" },
                { primary: "2018 · Darby Training Systems", secondary: "DTS Level 1 Certification" },
                { primary: "October 2021 – Present · JF Effect / JJT Powerlifting", secondary: "Founder · Online Fitness Coach · In-Person Personal Trainer · full-time self-employed coaching" },
                { primary: "2023 · International Sports Sciences Association", secondary: "Personal Training Certification" },
                { primary: "GLPTI", secondary: "Professional certification" },
              ]} />
            </CredentialAccordion>
            <CredentialAccordion title="Federation service & volunteering" summary="Giving back to sanctioned powerlifting">
              <p className="text-sm leading-relaxed text-muted-foreground">Volunteer support at sanctioned powerlifting meets from local events through provincial, regional, national and international-level competition.</p>
            </CredentialAccordion>
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={5}>
        <Section>
          <SectionTitle eyebrow="Timeline" title="How it got here" />
          <div className="mx-auto max-w-4xl space-y-3">
            {timeline.map((item) => (
              <Card key={item.year} className="grid gap-3 p-5 sm:grid-cols-[90px_1fr] sm:items-start">
                <div className="text-2xl font-black text-primary">{item.year}</div>
                <div><div className="font-black">{item.title}</div><p className="mt-1 text-sm leading-relaxed text-muted-foreground md:text-base">{item.body}</p></div>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={6}><CoachTimelineSection /></Reveal>

      <Reveal stagger={7}>
        <Section>
          <SectionTitle eyebrow="How I coach" title="Simple enough to execute. Detailed enough to work." />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            {[
              { title: "Build around the person", body: "Your schedule, equipment, training age, recovery, goals, and real life come first." },
              { title: "Track the right data", body: "Training performance, bodyweight, photos, recovery, adherence, and honest feedback tell us what to change." },
              { title: "Adjust before things break", body: "One rough week should not become a lost month. Coaching keeps the plan working as life changes." },
            ].map((item) => (
              <Card key={item.title} className="p-6"><CheckCircle2 className="h-6 w-6 text-primary" /><h3 className="mt-4 text-lg font-black">{item.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p></Card>
            ))}
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={8}>
        <Section className="bg-card/30">
          <div className="mx-auto max-w-4xl rounded-3xl border border-primary/20 bg-background p-7 md:p-10">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MapPin className="h-6 w-6" /></div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-primary">Selkirk, Manitoba</div>
                <h2 className="mt-2 text-2xl font-black md:text-4xl">Online or in person.</h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">I coach online through JF Effect and offer in-person personal training in Selkirk. Whether you're starting from zero or competing at a high level, the goal is the same: make the next step obvious and measurable.</p>
              </div>
            </div>
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={9}>
        <Section className="!pt-8">
          <div className="mx-auto max-w-3xl rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-8 text-center md:p-12">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Work with me</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">The credentials matter. The coaching has to prove itself.</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground md:text-lg">If you want a plan built around your actual life and a coach who will keep adjusting it with you, apply for private coaching.</p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-7 font-bold"><Link to="/coaching/apply">Apply for Coaching</Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-7 font-bold"><Link to="/coaching">See How Coaching Works</Link></Button>
            </div>
          </div>
        </Section>
      </Reveal>
    </SalesPageShell>
  );
}
