import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, BadgeCheck, Dumbbell, Globe2, Medal, ShieldCheck, Trophy, Users } from "lucide-react";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { AboutTransformations } from "@/components/sales/about-transformations";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import coachingHero from "@/assets/coaching-hero.jpg";

const TITLE = "About Jared James | Team Canada Powerlifter & JF Effect Coach";
const DESCRIPTION = "Meet Jared James: Team Canada powerlifter, two-time international overall champion, Top 50 all-time at 66kg, and JF Effect coach to 100+ clients.";
const URL = "https://jfeffect.com/about";

type ResultRow = { date: string; result: string; event: string; location?: string; note?: string };
type ResultGroup = { title: string; summary: string; rows: ResultRow[]; note?: string };

const headlineCredentials = [
  { value: "100+", label: "Clients coached", detail: "Strength, performance and body composition", Icon: Users },
  { value: "🇨🇦 Team Canada", label: "International competitor", detail: "Representing Canada in powerlifting", Icon: Globe2 },
  { value: "2×", label: "International champion", detail: "Overall Total · NAPF + Commonwealth · 2026", Icon: Trophy },
  { value: "Top 50", label: "All-time in the world", detail: "66kg Class · 2026", Icon: Medal },
  { value: "5×", label: "Drug-tested athlete", detail: "Sanctioned drug-tested competition", Icon: ShieldCheck },
  { value: "3", label: "Professional certifications", detail: "GLPTI · DTS Level 1 · ISSA CPT", Icon: BadgeCheck },
];

const athleteGroups: ResultGroup[] = [
  {
    title: "International championships",
    summary: "2 overall titles · 8 lift medals",
    note: "Two-time International Champion refers to two overall-total championship wins. Individual lift medals are listed results, not additional championship titles.",
    rows: [
      { date: "2026", result: "Total Gold · Squat Gold · Bench Gold · Deadlift Gold", event: "NAPF North American Championships" },
      { date: "2026", result: "Total Gold · Squat Gold · Bench Gold · Deadlift Silver", event: "Commonwealth Championships" },
    ],
  },
  {
    title: "National championships",
    summary: "3 appearances",
    rows: [
      { date: "2024", result: "5th Place", event: "National Canadian Championship", location: "Summerside, PEI" },
      { date: "2025", result: "4th Place", event: "National Canadian Championship", location: "Moose Jaw, SK" },
      { date: "2026", result: "2nd Place", event: "National Canadian Championship", location: "St. John's, NL" },
    ],
  },
  {
    title: "Regional championships",
    summary: "2 gold · 1 silver",
    rows: [
      { date: "2018", result: "1st Place", event: "Western Canadian Championship", location: "Edmonton, AB" },
      { date: "2023", result: "1st Place", event: "Central Canadian Championship", location: "Saint-Hyacinthe, QC" },
      { date: "2024", result: "2nd Place", event: "Western Canadian Championship", location: "Moose Jaw, SK" },
    ],
  },
  {
    title: "Provincial championships",
    summary: "3 gold",
    rows: [
      { date: "2020", result: "1st Place", event: "Manitoba Provincial Championship", location: "Winnipeg, MB" },
      { date: "2022", result: "1st Place", event: "Manitoba Provincial Championship", location: "Winnipeg, MB" },
      { date: "2023", result: "1st Place", event: "Ontario Provincial Championship", location: "Bowmanville, ON" },
    ],
  },
  {
    title: "Local meets",
    summary: "7 wins",
    rows: [
      { date: "2018", result: "1st", event: "Movement Powerlifting Classic" },
      { date: "2019", result: "1st", event: "Brickhouse Power Challenge" },
      { date: "2020", result: "1st", event: "Brickhouse Power Challenge" },
      { date: "2020", result: "1st", event: "Movement Powerlifting Classic 3.0" },
      { date: "2022", result: "1st", event: "Brickhouse Power Challenge" },
      { date: "2022", result: "1st", event: "Nightmare Before Liftmass" },
      { date: "2025", result: "1st", event: "MPA Summer Classic" },
    ],
  },
  {
    title: "Powerlifting records",
    summary: "21 entries",
    rows: [
      { date: "02/02/2020", result: "Squat · 187.5kg", event: "MPA · 66kg Jr" },
      { date: "02/02/2020", result: "Bench Press · 135.5kg", event: "MPA · 66kg Jr" },
      { date: "02/02/2020", result: "Deadlift · 240kg", event: "MPA · 66kg Jr" },
      { date: "02/02/2020", result: "Total · 563.5kg", event: "MPA · 66kg Jr" },
      { date: "02/02/2020", result: "Bench Press Only · 135.5kg", event: "MPA · 66kg Jr" },
      { date: "02/02/2020", result: "Bench Press Only · 135.5kg", event: "MPA · 66kg Open", note: "as a Jr." },
      { date: "02/02/2020", result: "Bench Press Only · 155kg", event: "MPA · 74kg Jr" },
      { date: "08/08/2020", result: "Bench Press · 155kg", event: "MPA · 74kg Jr" },
      { date: "03/09/2022", result: "Squat · 240kg", event: "MPA · 66kg Open" },
      { date: "03/09/2022", result: "Total · 662.5kg", event: "MPA · 66kg Open" },
      { date: "03/26/2022", result: "Bench Press · 155.5kg", event: "MPA · 74kg Open" },
      { date: "08/13/2022", result: "Squat · 225kg", event: "MPA · 66kg Open" },
      { date: "08/13/2022", result: "Bench Press · 150kg", event: "MPA · 66kg Open" },
      { date: "08/13/2022", result: "Total · 630kg", event: "MPA · 66kg Open" },
      { date: "08/13/2022", result: "Highest GL Points", event: "MPA · 66kg Open" },
      { date: "03/08/2024", result: "Bench Press · 170kg", event: "OPA · 74kg Open" },
      { date: "03/08/2024", result: "Deadlift · 290kg", event: "OPA · 74kg Open" },
      { date: "03/08/2024", result: "Total · 720kg", event: "OPA · 74kg Open" },
      { date: "07/19/2025", result: "Total · 707.5kg", event: "MPA · 83kg Open" },
      { date: "07/19/2025", result: "Ranked #1 · GL Points 100.40", event: "MPA · 3-Lift" },
      { date: "07/19/2025", result: "Ranked #1 · GL Points 103.71", event: "MPA · 3-Lift" },
    ],
  },
  {
    title: "Federation awards / recognition",
    summary: "1 award",
    rows: [{ date: "2022", result: "Male Athlete of the Year", event: "MPA" }],
  },
  {
    title: "Bodybuilding",
    summary: "Champion + podium finish",
    rows: [
      { date: "2018", result: "1st Place · Men's Physique", event: "MABBA Champion" },
      { date: "2019", result: "3rd Place · Men's Physique", event: "CPA Van Dijk Natural Classic" },
    ],
  },
  {
    title: "Coaching career & certifications",
    summary: "3 certifications · coaching since 2017",
    rows: [
      { date: "May 2017 – July 2018", result: "Personal Trainer", event: "GoodLife Fitness" },
      { date: "2018", result: "Level 1 Certification", event: "Darby Training Systems (DTS)" },
      { date: "October 2021 – Present", result: "Founder · Online Fitness Coach · In-Person Personal Trainer", event: "JF Effect / JJT Powerlifting", note: "Began self-employed full-time coaching in October 2021." },
      { date: "2023", result: "Personal Training Certification", event: "International Sports Sciences Association (ISSA)" },
      { date: "", result: "GLPTI Certification", event: "GoodLife Fitness" },
    ],
  },
  {
    title: "Federation service & volunteering",
    summary: "Local through international competition",
    rows: [{ date: "Ongoing", result: "Meet volunteer", event: "Sanctioned powerlifting competitions", note: "Helps at local, provincial, regional, national and international-level meets." }],
  },
];

const coachedAthleteGroups: ResultGroup[] = [
  {
    title: "IPF Worlds",
    summary: "1 athlete",
    rows: [{ date: "2025", result: "Phillip Bennett · 6th Place", event: "IPF Worlds", location: "San José, Costa Rica" }],
  },
  {
    title: "Nationals",
    summary: "4 results · 2 podiums",
    rows: [
      { date: "2024", result: "Laine Vandriel · 1st Place", event: "Nationals", location: "Summerside, PEI" },
      { date: "2024", result: "Frederick Callahan · 3rd Place", event: "Nationals", location: "Summerside, PEI" },
      { date: "2025", result: "Phillip Bennett · 1st Place", event: "Nationals", location: "Moose Jaw, SK" },
      { date: "2025", result: "Sarah Anderson · 11th Place", event: "Nationals", location: "Moose Jaw, SK" },
    ],
  },
  {
    title: "Regionals",
    summary: "6 results",
    rows: [
      { date: "2023", result: "Kenneth Morris · 3rd", event: "Western Canadians", location: "Brandon, MB" },
      { date: "2023", result: "Shaina Sagar · 3rd", event: "Western Canadians", location: "Brandon, MB" },
      { date: "2024", result: "Laine Vandriel · 3rd", event: "Western Canadians", location: "Moose Jaw, SK" },
      { date: "2025", result: "Dwayne Gordon · 1st", event: "Central Canadians", location: "Québec City, QC" },
      { date: "2025", result: "Shaina Sagar · 3rd", event: "Eastern Canadians", location: "Dartmouth, NS" },
      { date: "2025", result: "Elisa Vena · 6th", event: "Western Canadians", location: "Nanaimo, BC" },
    ],
  },
  {
    title: "Provincial achievements & records",
    summary: "11+ golds · 14+ records",
    rows: [
      { date: "Multiple years", result: "11+ Provincial Golds", event: "Coached athletes", location: "Manitoba · Ontario" },
      { date: "Multiple years", result: "14+ Provincial Records", event: "Set and held by coached athletes", location: "Manitoba · Ontario" },
    ],
  },
];

function ResultRows({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="divide-y divide-border border-t border-border">
      {rows.map((row, index) => (
        <div key={`${row.date}-${row.result}-${index}`} className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <div className="text-xs font-bold tabular-nums text-primary">{row.date || "Credential"}</div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground">{row.result}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {row.event}{row.location ? ` · ${row.location}` : ""}{row.note ? ` · ${row.note}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsAccordion({ groups, defaultOpen }: { groups: ResultGroup[]; defaultOpen?: string }) {
  return (
    <Accordion type="single" collapsible defaultValue={defaultOpen} className="overflow-hidden rounded-lg border border-border bg-card px-4 sm:px-6">
      {groups.map((group, index) => (
        <AccordionItem key={group.title} value={`group-${index}`}>
          <AccordionTrigger className="gap-4 py-5 no-underline hover:no-underline">
            <span className="min-w-0">
              <span className="block text-sm font-black sm:text-base">{group.title}</span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">{group.summary} · View all</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {group.note ? <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{group.note}</p> : null}
            <ResultRows rows={group.rows} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
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
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org", "@type": "Person", "@id": `${URL}#jared-james`,
        name: "Jared James", jobTitle: "Personal Trainer, Online Fitness Coach & Strength Coach", url: URL,
        worksFor: { "@type": "Organization", name: "JF Effect", url: "https://jfeffect.com" },
        address: { "@type": "PostalAddress", addressLocality: "Selkirk", addressRegion: "MB", addressCountry: "CA" },
        knowsAbout: ["Personal Training", "Strength Training", "Powerlifting", "Bodybuilding", "Fat Loss Coaching", "Online Fitness Coaching"],
        award: ["2026 NAPF North American Overall Total Champion", "2026 Commonwealth Overall Total Champion", "2022 MPA Male Athlete of the Year"],
      }),
    }],
  }),
});

function AboutJaredPage() {
  return (
    <SalesPageShell pageId="about-jared" floatingHeader>
      <section className="relative min-h-[38rem] overflow-hidden border-b border-border sm:min-h-[42rem]">
        <img src={coachingHero} alt="Jared James, Team Canada powerlifter and founder of JF Effect" className="absolute inset-0 h-full w-full object-cover object-top" loading="eager" />
        <div className="absolute inset-0 bg-background/80" />
        <div className="container relative mx-auto flex min-h-[38rem] items-end px-4 py-12 sm:min-h-[42rem] sm:py-16">
          <div className="max-w-3xl">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-primary">About Jared James</div>
            <h1 className="mt-4 text-balance text-4xl font-black sm:text-5xl md:text-7xl">Team Canada · 2× International Champion</h1>
            <p className="mt-4 text-lg font-bold text-foreground sm:text-xl">Top 50 All-Time in the World · 66kg</p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              JF Effect was built by a coach who still competes at the highest level—and applies the same preparation, measurement and honest adjustment to every client.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 font-bold"><Link to="/coaching/apply">Apply for Coaching</Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 font-bold"><Link to="/personal-trainer-selkirk">Train In Person</Link></Button>
            </div>
          </div>
        </div>
      </section>

      <Section className="!py-8 md:!py-12">
        <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {headlineCredentials.map(({ value, label, detail, Icon }) => (
            <div key={label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 bg-card p-4 sm:p-5">
              <Icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xl font-black text-primary sm:text-2xl">{value}</div>
                <div className="mt-0.5 text-xs font-black uppercase tracking-[0.12em]">{label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section className="!pt-6">
        <SectionTitle eyebrow="Athlete record" title="Built on the platform, proven on it" sub="International titles first. Every championship, placing, record and credential remains available below." />
        <div className="mx-auto max-w-4xl"><ResultsAccordion groups={athleteGroups} defaultOpen="group-0" /></div>
      </Section>

      <section className="border-y border-border bg-card/40">
        <Section>
          <SectionTitle eyebrow="Coaching results" title="Athletes prepared for the biggest platforms" sub="From provincial records to Canadian titles and an IPF Worlds appearance." />
          <div className="mx-auto grid max-w-5xl gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["1", "IPF Worlds Athlete", "Sub-Junior 105kg · Costa Rica 2025"],
              ["3", "National Champions", "Gold at Canadian Nationals"],
              ["11+", "Provincial Golds", "MB · ON across multiple years"],
              ["14+", "Provincial Records", "Set & held by coached athletes"],
            ].map(([value, label, detail]) => (
              <div key={label} className="bg-background p-5">
                <div className="text-3xl font-black text-primary">{value}</div>
                <div className="mt-1 text-sm font-black">{label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-6 max-w-4xl">
            <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">View all athlete results</h3>
            <ResultsAccordion groups={coachedAthleteGroups} />
          </div>
        </Section>
      </section>

      <Section>
        <SectionTitle eyebrow="Client transformations" title="Results beyond the platform" sub="Fat loss, muscle gain and lasting progress from JF Effect clients." />
        <div className="mx-auto max-w-6xl"><AboutTransformations /></div>
      </Section>

      <Section className="!pt-6">
        <div className="mx-auto max-w-3xl border-y border-border py-10 text-center">
          <Dumbbell className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
          <h2 className="mt-4 text-3xl font-black sm:text-4xl">Put proven coaching behind your next result.</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">Get a plan built around your goals, schedule and real-world progress.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-7 font-bold"><Link to="/coaching/apply">Apply for Coaching</Link></Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-7 font-bold"><Link to="/coaching">See How Coaching Works</Link></Button>
          </div>
        </div>
      </Section>
    </SalesPageShell>
  );
}
