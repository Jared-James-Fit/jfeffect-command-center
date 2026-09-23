import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  MapPin,
  ShieldCheck,
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

const clientSnapshots = [
  {
    name: "Colby",
    result: "Body Recomposition",
    role: "UGC Media Creator",
    quote: "Growing my glutes has been a struggle but i am FINALLY seeing progress",
    photos: [
      "https://jaredjamesfit.com/assets/colby-ladder-DwHbqFQw.jpg",
      "https://jaredjamesfit.com/assets/colby-3-0HpCACK6.jpg",
      "https://jaredjamesfit.com/assets/colby-9-CHIiO1aS.jpg",
      "https://jaredjamesfit.com/assets/colby-4-YCO5-hxp.jpg",
      "https://jaredjamesfit.com/assets/colby-5-C88QVzUB.jpg",
      "https://jaredjamesfit.com/assets/colby-6-CzUKtJsJ.jpg",
      "https://jaredjamesfit.com/assets/colby-7-acduIaH0.jpg",
      "https://jaredjamesfit.com/assets/colby-8-DfHfldnc.jpg",
    ],
  },
  {
    name: "Cedric",
    result: "Added lean muscle",
    role: "Model",
    quote: "thanks Jared",
    photos: [
      "https://jaredjamesfit.com/assets/cedric-1-CkNjKRpx.jpg",
      "https://jaredjamesfit.com/assets/cedric-7-C6rtBWUI.jpg",
      "https://jaredjamesfit.com/assets/cedric-3-DkU46smS.jpg",
      "https://jaredjamesfit.com/assets/cedric-6-DL40nzGW.jpg",
      "https://jaredjamesfit.com/assets/cedric-5-BOs600D4.jpg",
      "https://jaredjamesfit.com/assets/cedric-4-CquBv9du.jpg",
      "https://jaredjamesfit.com/assets/cedric-2-DWDg1LcR.jpg",
      "https://jaredjamesfit.com/assets/cedric-8-DbR5VA6R.jpg",
    ],
  },
  {
    name: "Madison",
    result: "-20lbs fat loss",
    role: "Navy Veteran",
    quote: "I'm also so grateful to have a coach that understands the rollercoaster of life and adapts my plan according to the season I'm in.",
    photos: [
      "https://jaredjamesfit.com/assets/madison-first-Bbke_YzO.jpg",
      "https://jaredjamesfit.com/assets/madison-6-BgpQHSMa.jpg",
      "https://jaredjamesfit.com/assets/madison-2-eE64EskD.jpg",
      "https://jaredjamesfit.com/assets/madison-7-DeC9jxc4.jpg",
      "https://jaredjamesfit.com/assets/madison-3-BBNwGben.jpg",
      "https://jaredjamesfit.com/assets/madison-4-BAlCAWPY.jpg",
      "https://jaredjamesfit.com/assets/madison-5-BsuWU0Nh.jpg",
    ],
  },
  {
    name: "Drew",
    result: "Fat Loss Transformation",
    role: "Security",
    quote: "I appreciate all the things that you've done to help me with my personal growth over the years.",
    photos: [
      "https://jaredjamesfit.com/assets/drew-1-Cu4zQ5CW.jpg",
      "https://jaredjamesfit.com/assets/drew-2-_saMUDrm.jpg",
      "https://jaredjamesfit.com/assets/drew-3-C_RBnnIP.jpg",
    ],
  },
  {
    name: "Kyrstin",
    result: "-35lbs fat burn",
    role: "Bartender & Artist",
    quote: "I feel better in myself, I feel better in my day to day, talking to people, my social confidence has gone up a lot and that's all thanks to Jared",
    photos: [
      "https://jaredjamesfit.com/assets/kyrstin-1-D5f3VBZ6.jpg",
      "https://jaredjamesfit.com/assets/kyrstin-3-BI_yvL36.jpg",
      "https://jaredjamesfit.com/assets/kyrstin-4-CC2DrfLV.jpg",
      "https://jaredjamesfit.com/assets/kyrstin-5-1xSzw870.jpg",
      "https://jaredjamesfit.com/assets/kyrstin-2-CqhY6uCd.jpg",
      "https://jaredjamesfit.com/assets/kyrstin-6-DHcNuMRc.jpg",
    ],
  },
  {
    name: "Dwayne",
    result: "Stage-Lean Transformation",
    role: "Banker",
    quote: "despite training for over a decade by myself he's helped me break through my plateau.",
    photos: [
      "https://jaredjamesfit.com/assets/dwayne-5-C_mfMQus.jpg",
      "https://jaredjamesfit.com/assets/dwayne-1-BTIsjX-L.jpg",
      "https://jaredjamesfit.com/assets/dwayne-3-dQRNGOLx.jpg",
      "https://jaredjamesfit.com/assets/dwayne-4-D2HiTmYz.jpg",
    ],
  },
  {
    name: "Shaina",
    result: "10lbs+ muscle",
    role: "Fitness Coach",
    quote: "very happy with the results today:) thank you @jaredjamesfit for helping me even in different cities",
    photos: [
      "https://jaredjamesfit.com/assets/shaina-3-Cr6i8f2C.jpg",
      "https://jaredjamesfit.com/assets/shaina-1-367--6JA.jpg",
      "https://jaredjamesfit.com/assets/shaina-2-8PaiTAJw.jpg",
      "https://jaredjamesfit.com/assets/shaina-4-B973bsgz.jpg",
      "https://jaredjamesfit.com/assets/shaina-5-DQA2A7Yb.jpg",
      "https://jaredjamesfit.com/assets/shaina-6-DGTgw6KX.jpg",
      "https://jaredjamesfit.com/assets/shaina-7-CLKMWEYC.jpg",
      "https://jaredjamesfit.com/assets/shaina-8-CgOu_8x7.jpg",
      "https://jaredjamesfit.com/assets/shaina-9-B0tZ52NJ.jpg",
    ],
  },
];

const transformationProof = [
  { name: "Sarah", result: "Fat Loss Recomp · Toned and beach-ready", image: "https://jaredjamesfit.com/assets/client-sarah-front-BftNcK0b.png" },
  { name: "Madison", result: "-20 lb fat loss · Leaner and stronger", image: "https://jaredjamesfit.com/assets/client-madison-front-yvUrLdnU.png" },
  { name: "Samantha", result: "Fat Loss Recomp · Core defined and leaned out", image: "https://jaredjamesfit.com/assets/client-samantha-front-vectZqwI.png" },
  { name: "Ashtyn", result: "Lean Recomp · From soft to sculpted", image: "https://jaredjamesfit.com/assets/client-ashtyn-front-CIV-Wo3_.png" },
  { name: "Colby", result: "Body Recomp · Leaner and more sculpted", image: "https://jaredjamesfit.com/assets/client-colby-front-BRYqRzpR.png" },
  { name: "Shaina", result: "10+ lb muscle · Curves built and shape developed", image: "https://jaredjamesfit.com/assets/shaina-side-featured-BCqrcR05.jpg" },
  { name: "Cedric", result: "Lean Muscle Build · From average to athletic", image: "https://jaredjamesfit.com/assets/cedric-front-C6nR1LtL.jpg" },
  { name: "Landon", result: "Lean Bulk Recomp · From soft to shredded", image: "https://jaredjamesfit.com/assets/client-landon-front-C7p3lWAr.png" },
  { name: "Drew", result: "Fat Loss Transformation · Dramatic fat loss", image: "https://jaredjamesfit.com/assets/client-drew-front-CI7ZiSsI.png" },
  { name: "Dwayne", result: "Body Recomp · From soft to stage-lean", image: "https://jaredjamesfit.com/assets/dwayne-side-W5YYB7cP.jpg" },
  { name: "Reece", result: "-35 lb shred · Lean and defined", image: "https://jaredjamesfit.com/assets/client-reece-front-DzLoaVqW.png" },
  { name: "Thomas", result: "Weight Loss Progress · First real standard shift", image: "https://jaredjamesfit.com/assets/thomas-front-pzh_FHkD.jpg" },
  { name: "Jonathan", result: "Weight Loss Phase · Belly reduced and tightened", image: "https://jaredjamesfit.com/assets/client-jonathan-side-RJvnZnyG.png" },
  { name: "Mike", result: "Lean Muscle Build · Shredded and defined", image: "https://jaredjamesfit.com/assets/client-mike-front-DxJ62TQC.png" },
  { name: "Daniel", result: "Lean Cut · Midsection pulled in", image: "https://jaredjamesfit.com/assets/client-daniel-side-DjJtQ64r.png" },
  { name: "Branden", result: "Muscle Build · From skinny to stacked", image: "https://jaredjamesfit.com/assets/client-branden-front-CSvWkc5M.png" },
  { name: "Sarwar", result: "Body Recomp · Major fat loss and muscle gain", image: "https://jaredjamesfit.com/assets/client-sarwar-front-D_QmESQd.png" },
  { name: "Coach Jared", result: "Long-Term Recomp · Built over years", image: "https://jaredjamesfit.com/assets/client-coach-jared-front-1-Dk4eNuoA.png", crop: "object-[center_35%] scale-[1.38]" },
  { name: "Tyler", result: "Lean Transformation · Leaner and more athletic", image: "https://jaredjamesfit.com/assets/leveled-up-5-BIqnV8nJ.png", crop: "object-[center_35%] scale-[1.38]" },
  { name: "Camryn", result: "Body Recomp · Tightened and toned", image: "https://jaredjamesfit.com/assets/client-camryn-front-eEwinvFm.png" },
  { name: "Erick", result: "Fat Loss Recomp · Leaner and sharper", image: "https://jaredjamesfit.com/assets/client-erick-front-DdH-Vzin.png" },
  { name: "Icah", result: "Fat Loss Transformation · Midsection tightened", image: "https://jaredjamesfit.com/assets/client-icah-front-ERK6G0Of.png" },
  { name: "Jasmine", result: "Body Recomp · Midsection tightened and toned", image: "https://jaredjamesfit.com/assets/client-jasmine-front-DrcRPRYO.png" },
  { name: "Jennifer", result: "Fat Loss Recomp · Leaner and more confident", image: "https://jaredjamesfit.com/assets/client-jennifer-front-DILRPyfm.png" },
  { name: "Kailey", result: "Body Recomp · Leaner and more toned", image: "https://jaredjamesfit.com/assets/client-kailey-front-CDo4_ARW.png" },
  { name: "Karen", result: "Weight Loss Transformation · Major fat loss", image: "https://jaredjamesfit.com/assets/client-karen-front-DARTt-xR.png" },
  { name: "Karina", result: "Fat Loss Recomp · Midsection tightened", image: "https://jaredjamesfit.com/assets/client-karina-front-4nuWP27u.png" },
  { name: "Kyrstin", result: "-35 lb fat loss · Leaner and more defined", image: "https://jaredjamesfit.com/assets/client-kyrstin-front-Dh2_oclg.png" },
  { name: "Romelyn", result: "Body Recomp · Leaner and more sculpted", image: "https://jaredjamesfit.com/assets/client-romelyn-front-C1lSPKXi.png" },
];

const multiAngleProof = [
  ["Jared · Fat Loss", "https://jaredjamesfit.com/assets/leveled-up-12-Dvp868jE.png"],
  ["Jared · Fat Loss Side", "https://jaredjamesfit.com/assets/client-jared-side-BazJEXkY.png"],
  ["Jared · Fat Loss Back", "https://jaredjamesfit.com/assets/client-jared-back-Baz7-tAA.png"],
  ["Coach Jared · Long-Term Recomp", "https://jaredjamesfit.com/assets/leveled-up-4-DWlPm4Gd.png"],
  ["Coach Jared · Long-Term Recomp Back", "https://jaredjamesfit.com/assets/client-coach-jared-back-vPzp-iOL.png"],
  ["Tyler · Side", "https://jaredjamesfit.com/assets/client-tyler-side-CwekuRs8.png"],
  ["Tyler · Back", "https://jaredjamesfit.com/assets/client-tyler-back-hN_DvyPt.png"],
  ["Camryn · Side", "https://jaredjamesfit.com/assets/client-camryn-side-DizI9SpV.png"],
  ["Camryn · Back", "https://jaredjamesfit.com/assets/client-camryn-back-CcYXPGfi.png"],
  ["Erick · Side", "https://jaredjamesfit.com/assets/client-erick-side-Bjp9hhqS.png"],
  ["Erick · Back", "https://jaredjamesfit.com/assets/client-erick-back-BfhJOrOm.png"],
  ["Icah · Side", "https://jaredjamesfit.com/assets/client-icah-side-B91Uukzk.png"],
  ["Icah · Back", "https://jaredjamesfit.com/assets/client-icah-back-C6TK9Rpl.png"],
  ["Jasmine · Side", "https://jaredjamesfit.com/assets/client-jasmine-side-BxHU9YN5.png"],
  ["Jasmine · Back", "https://jaredjamesfit.com/assets/client-jasmine-back-Dpwgb4nn.png"],
  ["Jennifer · Side", "https://jaredjamesfit.com/assets/client-jennifer-side-Dgeh1qnN.png"],
  ["Kailey · Side", "https://jaredjamesfit.com/assets/client-kailey-side-Bbu9DFWJ.png"],
  ["Kailey · Back", "https://jaredjamesfit.com/assets/client-kailey-back-Bm3koxV5.png"],
  ["Karen · Side", "https://jaredjamesfit.com/assets/client-karen-side-B5HMwXgT.png"],
  ["Karen · Back", "https://jaredjamesfit.com/assets/client-karen-back-BSztvFaH.png"],
  ["Karina · Side", "https://jaredjamesfit.com/assets/client-karina-side-BzudAiAM.png"],
  ["Karina · Back", "https://jaredjamesfit.com/assets/client-karina-back-HXHFN9N3.png"],
  ["Kyrstin · Back", "https://jaredjamesfit.com/assets/client-kyrstin-back-D5IKY3VK.png"],
  ["Romelyn · Side", "https://jaredjamesfit.com/assets/client-romelyn-side-BOQmt44A.png"],
  ["Romelyn · Back", "https://jaredjamesfit.com/assets/client-romelyn-back-CApkI_Jq.png"],
] as const;

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
  children: ReactNode;
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
          <SectionTitle eyebrow="Jared · Athlete achievements" title="My competitive record." sub="My own championships, records, rankings and federation recognition. Kept separate from the athletes I coach." />
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
          <SectionTitle eyebrow="Coached athlete achievements" title="Athlete results under JF Effect." sub="Competitive achievements earned by athletes I coach — separate from my own athlete résumé." />
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              ["1", "IPF Worlds athlete", "Costa Rica · 2025"],
              ["3", "National champions", "Canadian Nationals gold"],
              ["11+", "Provincial golds", "MB + ON"],
              ["14+", "Provincial records", "Set + held by coached athletes"],
              ["1+", "Athlete of the Year", "Federation athlete recognition"],
            ].map(([value, label, detail]) => (
              <Card key={label} className="p-4 text-center">
                <div className="text-2xl font-black text-primary">{value}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide">{label}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">{detail}</div>
              </Card>
            ))}
          </div>
          <div className="mx-auto mt-4 max-w-5xl">
            <CredentialAccordion title="View coached athlete achievements" summary="Worlds · Nationals · Regionals · provincial titles · records · awards">
              <ResultList rows={athleteResults} />
            </CredentialAccordion>
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={4}>
        <Section>
          <SectionTitle
            eyebrow="Client snapshots"
            title="The people behind the results."
            sub="The same live client photo sets featured on Jared James Fit. Swipe each client and each photo row on mobile."
          />
          <div className="mx-auto max-w-6xl space-y-5">
            {clientSnapshots.map((client) => (
              <Card key={client.name} className="overflow-hidden">
                <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                  <div className="flex w-max gap-2 p-3">
                    {client.photos.map((photo, index) => (
                      <img
                        key={photo}
                        src={photo}
                        alt={`${client.name} client snapshot ${index + 1}`}
                        className="h-[320px] w-[240px] shrink-0 rounded-xl object-cover sm:h-[380px] sm:w-[285px]"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </div>
                <div className="border-t border-border p-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-xl font-black">{client.name}</h3>
                    <span className="text-sm font-bold text-primary">{client.result}</span>
                    <span className="text-xs text-muted-foreground">{client.role}</span>
                  </div>
                  <p className="mt-3 text-sm italic leading-relaxed text-muted-foreground">“{client.quote}”</p>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      </Reveal>

      <Reveal stagger={5}>
        <Section className="bg-card/30">
          <SectionTitle
            eyebrow="Client transformations"
            title="Real coaching. Visible proof."
            sub="Fat loss, muscle gain and body recomposition results from JF Effect clients. Swipe horizontally on mobile."
          />
          <div className="mx-auto max-w-6xl overflow-x-auto pb-4 [-webkit-overflow-scrolling:touch]">
            <div className="flex w-max gap-4">
              {transformationProof.map((item) => (
                <Card key={item.name} className="w-[78vw] max-w-[340px] shrink-0 overflow-hidden">
                  <div className="aspect-square overflow-hidden bg-muted"><img src={item.image} alt={`${item.name} JF Effect client transformation`} className={`h-full w-full object-cover object-top ${item.crop ?? "scale-[1.18]"}`} loading="lazy" /></div>
                  <div className="p-4">
                    <div className="font-black">{item.name}</div>
                    <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.result}</div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
          <div className="mx-auto mt-4 max-w-5xl">
            <CredentialAccordion title="View additional transformation angles" summary="Front · side · back progress comparisons">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {multiAngleProof.map(([label, image]) => (
                  <figure key={label} className="overflow-hidden rounded-xl border border-border bg-background">
                    <div className="aspect-square overflow-hidden bg-muted"><img src={image} alt={`${label} transformation comparison`} className="h-full w-full scale-[1.18] object-cover object-top" loading="lazy" /></div>
                    <figcaption className="p-3 text-xs font-bold">{label}</figcaption>
                  </figure>
                ))}
              </div>
            </CredentialAccordion>
          </div>
          <p className="mx-auto mt-5 max-w-4xl text-xs leading-relaxed text-muted-foreground">
            Client transformations reflect individual experiences. Results vary based on starting point, consistency, effort, adherence, lifestyle and other individual factors; results are not guaranteed.
          </p>
        </Section>
      </Reveal>

      <Reveal stagger={6}>
        <Section className="bg-card/30">
          <SectionTitle eyebrow="Education + experience" title="Coaching credentials" sub="Formal education backed by years of hands-on coaching and competition." />
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            {[
              ["GoodLife Personal Training Institute (GLPTI)", "Professional personal training certification", BadgeCheck],
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

      <Reveal stagger={7}>
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

      <Reveal stagger={8}><CoachTimelineSection /></Reveal>

      <Reveal stagger={9}>
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

      <Reveal stagger={10}>
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

      <Reveal stagger={11}>
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
