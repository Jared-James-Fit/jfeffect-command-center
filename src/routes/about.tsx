import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, CheckCircle2, ChevronDown, MapPin, ShieldCheck, Users } from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { INQUIRY_DM_URL, SOCIAL_URLS } from "@/lib/social-links";
import { Reveal } from "@/components/sales/reveal";
import { Block, Group, Heading, IconTile, PrimaryCta, Rail, SocialLinks, Stat, Surface, TextLink } from "@/components/sales/apple";
import jaredAsset from "@/assets/athletes/jared-napf-2026.jpg.asset.json";
import phillipAsset from "@/assets/athletes/phillip.png.asset.json";
import dwayneAsset from "@/assets/athletes/dwayne.png.asset.json";
import frederickAsset from "@/assets/athletes/frederick.png.asset.json";
import elisaAsset from "@/assets/athletes/elisa.png.asset.json";

const jaredHeroImage = jaredAsset.url;
const phillipAthleteImage = phillipAsset.url;
const dwayneAthleteImage = dwayneAsset.url;
const frederickAthleteImage = frederickAsset.url;
const elisaAthleteImage = elisaAsset.url;

const TITLE = "About Jared McIntyre | Team Canada Powerlifter & JF Effect Founder";
const DESCRIPTION =
  "Meet Jared McIntyre, founder of JF Effect: Team Canada powerlifter, 2× international champion, Top 50 all-time 66 kg lifter, certified personal trainer, and coach to 100+ clients.";
const URL = "https://jfeffect.com/about";

type ResultRow = { primary: string; secondary: string };

const headlineStats = [
  ["100+", "Clients coached", "General fitness to international-level powerlifting"],
  ["🇨🇦 8", "International Medals", "Team Canada · 🥇 7 Gold · 🥈 1 Silver · 🥉 0 Bronze"],
  ["2×", "International Champion", "NAPF + Commonwealth · 2026"],
  ["Top 50", "All-Time World Ranking", "66 kg powerlifting · 2026"],
  ["5×", "Drug-Tested Athlete", "Sanctioned drug-tested competition"],
  ["3", "Professional Certifications", "GLPTI · DTS Level 1 · ISSA CPT"],
];

const internationalResults: ResultRow[] = [
  { primary: "Team Canada · International medal count", secondary: "8 total medals · 🥇 7 Gold · 🥈 1 Silver · 🥉 0 Bronze" },
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

const coachedAthletePhotos = [
  { name: "Phillip Bennett", achievement: "National Champion · IPF Worlds · Sub-Junior 105 kg", image: phillipAthleteImage },
  { name: "Dwayne Gordon", achievement: "Central Canadian Champion · Open 105 kg", image: dwayneAthleteImage },
  { name: "Frederick Callahan", achievement: "Ontario Provincial Champion 2023 · Junior 74 kg", image: frederickAthleteImage },
  { name: "Elisa Vena", achievement: "Western Championships · Powerlifting competitor", image: elisaAthleteImage },
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
  { year: "2017", title: "Professional Personal Trainer", body: "Began coaching clients in a commercial fitness facility, building hands-on experience with programming, technique, progression, and day-to-day accountability." },
  { year: "2018", title: "DTS Level 1 + bodybuilding champion", body: "Completed Darby Training Systems Level 1 and won the MABBA Men's Physique title." },
  { year: "2021", title: "JF Effect became the full-time path", body: "Built the coaching business around personalized training, nutrition structure, accountability, form review, and direct support." },
  { year: "2023", title: "ISSA Certified Personal Trainer", body: "Added the ISSA Personal Training Certification alongside practical coaching and competitive experience." },
  { year: "2026", title: "Team Canada · 2× International Champion", body: "Won the overall total at both the NAPF North American Championships and Commonwealth Championships, earning 8 international medals for Team Canada: 7 gold and 1 silver." },
];

const SCROLL_IMAGE_PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function ScrollImage({
  src,
  alt,
  className,
  eager = false,
}: {
  src: string;
  alt: string;
  className: string;
  eager?: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [shouldLoad, setShouldLoad] = useState(eager);

  useEffect(() => {
    if (eager || shouldLoad) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "900px 0px", threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager, shouldLoad]);


  return (
    <img
      ref={ref}
      src={shouldLoad ? src : SCROLL_IMAGE_PLACEHOLDER}
      alt={alt}
      className={`${className} bg-muted`}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "auto"}
    />
  );
}

function ResultList({ rows }: { rows: ResultRow[] }) {
  return (
    <div className="divide-y divide-border/70">
      {rows.map((row, index) => (
        <div key={`${row.primary}-${index}`} className="py-3 first:pt-0 last:pb-0">
          <div className="text-[15px] font-semibold leading-snug">{row.primary}</div>
          <div className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{row.secondary}</div>
        </div>
      ))}
    </div>
  );
}

/** iOS-style disclosure row. Native <details> so it works without JS. */
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
    <details open={defaultOpen} className="group overflow-hidden rounded-2xl bg-card ring-1 ring-border/70">
      <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 transition active:bg-muted/60 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-snug">{title}</div>
          <div className="mt-0.5 text-[14px] leading-snug text-muted-foreground">{summary}</div>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/70 px-5 py-4">{children}</div>
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
          "@id": URL + "#jared-mcintyre",
          name: "Jared McIntyre",
          jobTitle: "Personal Trainer, Online Fitness Coach & Strength Coach",
          url: URL,
          worksFor: { "@type": "Organization", name: "JF Effect", url: "https://jfeffect.com" },
          sameAs: SOCIAL_URLS,
          address: { "@type": "PostalAddress", addressLocality: "Selkirk", addressRegion: "MB", addressCountry: "CA" },
          knowsAbout: ["Personal Training", "Strength Training", "Powerlifting", "Bodybuilding", "Fat Loss Coaching", "Online Fitness Coaching", "Nutrition Coaching"],
          award: ["2026 NAPF North American Champion", "2026 Commonwealth Champion", "2022 MPA Male Athlete of the Year", "2018 MABBA Men's Physique Champion"],
        }),
      },
    ],
  }),
});

const JUMP_LINKS = [
  ["#story", "Story"],
  ["#results", "Client results"],
  ["#athletes", "Athletes"],
  ["#record", "My record"],
  ["#credentials", "Credentials"],
] as const;

function AboutJaredPage() {
  return (
    <SalesPageShell pageId="about-jared" floatingHeader>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]"
          style={{ background: "radial-gradient(60% 100% at 50% 0%, color-mix(in oklab, var(--primary) 10%, transparent), transparent 100%)" }}
        />
        <div className="mx-auto grid max-w-5xl gap-10 px-5 pb-12 pt-24 md:pt-32 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
          <div className="jf-auth-rise text-center lg:text-left">
            <div className="inline-flex items-center rounded-full bg-primary/10 px-3.5 py-1.5 text-[13px] font-semibold text-primary">About Jared McIntyre</div>
            <h1 className="mx-auto mt-5 max-w-[18ch] text-balance text-[38px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[56px] lg:mx-0">
              Coach. Team Canada athlete. 2× International Champion.
            </h1>
            <p className="mt-4 text-[17px] font-semibold text-primary">Top 50 all-time in the world · 66 kg powerlifting</p>
            <p className="mx-auto mt-4 max-w-xl text-[19px] leading-relaxed text-muted-foreground lg:mx-0">
              I built JF Effect from both sides of the bar: as a coach responsible for other people's progress, and as an athlete who still has to execute under pressure.
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-center lg:justify-start">
              <PrimaryCta to="/coaching/apply">Apply for Coaching</PrimaryCta>
              <TextLink to="/personal-trainer-selkirk">Train with me in person</TextLink>
            </div>
            <div className="mt-6 flex flex-col items-center gap-2 lg:items-start">
              <div className="text-[13px] text-muted-foreground">Follow along</div>
              <SocialLinks />
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <ScrollImage
              src={jaredHeroImage}
              alt="Jared McIntyre representing Canada in international powerlifting competition"
              className="aspect-[4/5] w-full rounded-[28px] object-cover object-center shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] ring-1 ring-border/70"
              eager
            />
          </div>
        </div>
      </section>

      {/* Headline numbers */}
      <div className="mx-auto max-w-5xl px-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-border/70 lg:grid-cols-3">
          {headlineStats.map(([value, label, detail]) => (
            <div key={label} className="bg-card">
              <Stat value={value} label={label} detail={detail} />
            </div>
          ))}
        </div>
        {/* Jump links — long page, one tap to the part you care about */}
        <nav aria-label="On this page" className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:justify-center">
          {JUMP_LINKS.map(([href, label]) => (
            <a key={href} href={href} className="shrink-0 rounded-full bg-muted px-4 py-2 text-[14px] font-medium transition active:scale-[0.97] hover:bg-muted/70">
              {label}
            </a>
          ))}
        </nav>
      </div>

      {/* Story */}
      <Reveal>
        <Block id="story" narrow>
          <Heading align="left" eyebrow="The short version" title="I don't coach from theory alone." />
          <div className="space-y-4 text-[17px] leading-relaxed text-muted-foreground">
            <p>My own training started in 2014. Since then I've competed in bodybuilding and powerlifting, represented Canada internationally, and coached more than 100 people across fat loss, muscle building, strength, bodybuilding, and powerlifting.</p>
            <p>I still compete because it keeps me accountable to the same standards I ask from clients: preparation, execution, honest feedback, and adjustment.</p>
          </div>
        </Block>
      </Reveal>

      {/* How I coach */}
      <Reveal>
        <Block tint narrow>
          <Heading eyebrow="How I coach" title="Simple enough to execute. Detailed enough to work." />
          <Group>
            {[
              { title: "Build around the person", body: "Your schedule, equipment, training age, recovery, goals, and real life come first." },
              { title: "Track the right data", body: "Training performance, bodyweight, photos, recovery, adherence, and honest feedback tell us what to change." },
              { title: "Adjust before things break", body: "One rough week should not become a lost month. Coaching keeps the plan working as life changes." },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4 px-5 py-4">
                <IconTile><CheckCircle2 className="h-5 w-5" aria-hidden /></IconTile>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{item.title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
            ))}
          </Group>
        </Block>
      </Reveal>

      {/* Straight talk: honesty builds the trust that gets people to apply */}
      <Reveal>
        <Block narrow>
          <Heading eyebrow="What to expect" title="Straight talk, up front." sub="So you know exactly who you'd be working with." />
          <Group>
            {[
              { title: "Honest about what's realistic", body: "Results depend on your starting point, consistency and effort. I don't promise overnight changes, and I won't sell you a shortcut." },
              { title: "Standards, not hype", body: "I hold clients to the same standards I hold myself to: preparation, execution, honest feedback and adjustment." },
              { title: "A real person, every time", body: "Your check-ins are read and your plan is adjusted by a coach who knows your numbers, not an auto-reply." },
              { title: "If I'm not the right fit, I'll say so", body: "I only take on people I'm confident I can help. A no-pressure call comes before any commitment." },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-4 px-5 py-4">
                <IconTile><CheckCircle2 className="h-5 w-5" aria-hidden /></IconTile>
                <div className="min-w-0">
                  <div className="text-[17px] font-semibold leading-snug">{item.title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
            ))}
          </Group>
        </Block>
      </Reveal>

      {/* Client results */}
      <Reveal>
        <Block id="results">
          <Heading eyebrow="Client transformations" title="Real coaching. Visible proof." sub="Fat loss, muscle gain and body recomposition from JF Effect clients. Swipe to see more." />
          <Rail label="Client transformations">
            {transformationProof.map((item) => (
              <Surface key={item.name} className="w-[72vw] max-w-[300px] shrink-0 snap-start overflow-hidden">
                <div className="aspect-square overflow-hidden bg-muted">
                  <ScrollImage
                    src={item.image}
                    alt={`${item.name} JF Effect client transformation`}
                    className={`h-full w-full object-cover object-top ${item.crop ?? "scale-[1.18]"}`}
                  />
                </div>
                <div className="p-4">
                  <div className="text-[17px] font-semibold">{item.name}</div>
                  <div className="mt-0.5 text-[14px] leading-snug text-muted-foreground">{item.result}</div>
                </div>
              </Surface>
            ))}
          </Rail>
          <div className="mt-4 space-y-3">
            <CredentialAccordion title="More transformation angles" summary="Front · side · back progress comparisons">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {multiAngleProof.map(([label, image]) => (
                  <figure key={label} className="overflow-hidden rounded-xl bg-background ring-1 ring-border/70">
                    <div className="aspect-square overflow-hidden bg-muted">
                      <ScrollImage src={image} alt={`${label} transformation comparison`} className="h-full w-full scale-[1.18] object-cover object-top" />
                    </div>
                    <figcaption className="p-3 text-[13px] font-medium">{label}</figcaption>
                  </figure>
                ))}
              </div>
            </CredentialAccordion>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
            Client transformations reflect individual experiences. Results vary based on starting point, consistency, effort, adherence, lifestyle and other individual factors; results are not guaranteed.
          </p>
        </Block>
      </Reveal>

      {/* Natural moment to ask: they just saw proof */}
      <Reveal>
        <Block narrow className="!py-2 md:!py-4">
          <div className="text-center">
            <p className="text-[17px] text-muted-foreground">Like what you see? Your result could be next.</p>
            <div className="mt-4 flex flex-col items-stretch gap-3 sm:items-center">
              <PrimaryCta to="/coaching/apply" className="sm:min-w-[280px]">Apply for Coaching</PrimaryCta>
              <p className="text-[13px] text-muted-foreground">Takes about a minute · No payment to apply</p>
            </div>
          </div>
        </Block>
      </Reveal>

      {/* Client stories */}
      <Reveal>
        <Block tint>
          <Heading eyebrow="Client stories" title="The people behind the results." sub="Swipe through each client's photos." />
          <div className="mx-auto max-w-4xl space-y-5">
            {clientSnapshots.map((client) => (
              <Surface key={client.name} className="overflow-hidden">
                <div className="overflow-x-auto snap-x snap-mandatory [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex w-max gap-2 p-3">
                    {client.photos.map((photo, index) => (
                      <ScrollImage
                        key={photo}
                        src={photo}
                        alt={`${client.name} client snapshot ${index + 1}`}
                        className="h-[300px] w-[225px] shrink-0 snap-start rounded-xl object-cover sm:h-[380px] sm:w-[285px]"
                      />
                    ))}
                  </div>
                </div>
                <div className="border-t border-border/70 p-5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h3 className="text-[20px] font-semibold tracking-[-0.01em]">{client.name}</h3>
                    <span className="text-[14px] font-semibold text-primary">{client.result}</span>
                    <span className="text-[13px] text-muted-foreground">{client.role}</span>
                  </div>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">“{client.quote}”</p>
                </div>
              </Surface>
            ))}
          </div>
        </Block>
      </Reveal>

      {/* Coached athletes */}
      <Reveal>
        <Block id="athletes">
          <Heading eyebrow="Coached athletes" title="Athlete results under JF Effect." sub="Competitive achievements earned by athletes I coach, separate from my own résumé." />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/70 ring-1 ring-border/70 lg:grid-cols-5">
            {[
              ["1", "IPF Worlds athlete", "Costa Rica · 2025"],
              ["3", "National champions", "Canadian Nationals gold"],
              ["11+", "Provincial golds", "MB + ON"],
              ["14+", "Provincial records", "Set + held by coached athletes"],
              ["1+", "Athlete of the Year", "Federation athlete recognition"],
            ].map(([value, label, detail]) => (
              <div key={label} className="bg-card last:col-span-2 lg:last:col-span-1">
                <Stat value={value} label={label} detail={detail} />
              </div>
            ))}
          </div>
          <div className="mt-6">
            <Rail label="Coached athletes">
              {coachedAthletePhotos.map((athlete) => (
                <Surface key={athlete.name} className="w-[72vw] max-w-[280px] shrink-0 snap-start overflow-hidden">
                  <ScrollImage
                    src={athlete.image}
                    alt={`${athlete.name} JF Effect coached powerlifting athlete`}
                    className="aspect-square w-full bg-black object-contain"
                  />
                  <div className="p-4">
                    <div className="text-[17px] font-semibold">{athlete.name}</div>
                    <div className="mt-0.5 text-[14px] leading-snug text-muted-foreground">{athlete.achievement}</div>
                  </div>
                </Surface>
              ))}
            </Rail>
          </div>
          <div className="mt-3">
            <CredentialAccordion title="All coached athlete results" summary="Worlds · Nationals · Regionals · provincial titles · records · awards">
              <ResultList rows={athleteResults} />
            </CredentialAccordion>
          </div>
        </Block>
      </Reveal>

      {/* My competitive record */}
      <Reveal>
        <Block id="record" tint narrow>
          <Heading eyebrow="My competitive record" title="Championships, records and rankings." sub="My own results, kept separate from the athletes I coach." />
          <div className="space-y-3">
            <CredentialAccordion title="International Championships" summary="2 overall international titles · NAPF + Commonwealth · 2026" defaultOpen>
              <ResultList rows={internationalResults} />
              <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">“2× International Champion” refers to the two overall-total championship wins. Individual lift medals are listed as results, not counted as additional championship titles.</p>
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
        </Block>
      </Reveal>

      {/* Credentials */}
      <Reveal>
        <Block id="credentials" narrow>
          <Heading eyebrow="Education + experience" title="Coaching credentials" sub="Formal education backed by years of hands-on coaching and competition." />
          <Group>
            {[
              ["GoodLife Personal Training Institute (GLPTI)", "Professional personal training certification", BadgeCheck],
              ["DTS Level 1 Certification", "Darby Training Systems · 2018", ShieldCheck],
              ["ISSA Personal Training Certification", "International Sports Sciences Association · 2023", BadgeCheck],
              ["100+ Clients Coached", "General fitness, body composition, bodybuilding and powerlifting", Users],
            ].map(([title, detail, Icon]) => {
              const IconComponent = Icon as typeof BadgeCheck;
              return (
                <div key={title as string} className="flex items-start gap-4 px-5 py-4">
                  <IconTile><IconComponent className="h-5 w-5" aria-hidden /></IconTile>
                  <div className="min-w-0">
                    <div className="text-[17px] font-semibold leading-snug">{title as string}</div>
                    <div className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">{detail as string}</div>
                  </div>
                </div>
              );
            })}
          </Group>
          <div className="mt-4 space-y-3">
            <CredentialAccordion title="Coaching career" summary="Personal training → full-time JF Effect">
              <ResultList rows={[
                { primary: "May 2017 – July 2018 · Professional Personal Trainer", secondary: "Commercial fitness facility · coached clients through programming, technique, progression and accountability" },
                { primary: "2018 · Darby Training Systems", secondary: "DTS Level 1 Certification" },
                { primary: "October 2021 – Present · JF Effect / JJT Powerlifting", secondary: "Founder · Online Fitness Coach · In-Person Personal Trainer · full-time self-employed coaching" },
                { primary: "2023 · International Sports Sciences Association", secondary: "Personal Training Certification" },
                { primary: "GLPTI", secondary: "Professional certification" },
              ]} />
            </CredentialAccordion>
            <CredentialAccordion title="Federation service & volunteering" summary="Giving back to sanctioned powerlifting">
              <p className="text-[15px] leading-relaxed text-muted-foreground">Volunteer support at sanctioned powerlifting meets from local events through provincial, regional, national and international-level competition.</p>
            </CredentialAccordion>
          </div>
        </Block>
      </Reveal>

      {/* Timeline */}
      <Reveal>
        <Block tint narrow>
          <Heading eyebrow="Timeline" title="How it got here." />
          <Group>
            {timeline.map((item) => (
              <div key={item.year} className="grid gap-1 px-5 py-4 sm:grid-cols-[72px_1fr] sm:gap-4">
                <div className="text-[20px] font-semibold tracking-[-0.01em] text-primary">{item.year}</div>
                <div>
                  <div className="text-[17px] font-semibold leading-snug">{item.title}</div>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
            ))}
          </Group>
        </Block>
      </Reveal>

      {/* Online or in person */}
      <Reveal>
        <Block narrow>
          <Surface className="p-6 md:p-8">
            <div className="flex items-start gap-4">
              <IconTile><MapPin className="h-5 w-5" aria-hidden /></IconTile>
              <div>
                <div className="text-[13px] font-semibold text-primary">Selkirk, Manitoba</div>
                <h2 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em]">Online or in person.</h2>
                <p className="mt-2 text-[16px] leading-relaxed text-muted-foreground">
                  I coach online through JF Effect and offer in-person personal training in Selkirk. Whether you're starting from zero or competing at a high level, the goal is the same: make the next step obvious and measurable.
                </p>
                <div className="mt-3">
                  <TextLink to="/personal-trainer-selkirk">In-person training in Selkirk</TextLink>
                </div>
              </div>
            </div>
          </Surface>
        </Block>
      </Reveal>

      {/* Final ask */}
      <Reveal>
        <Block narrow className="pt-0 md:pt-0">
          <div className="text-center">
            <div className="text-[13px] font-semibold text-primary">Work with me</div>
            <h2 className="mt-1.5 text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              The credentials matter. The coaching has to prove itself.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
              Want a plan built around your actual life, and a coach who keeps adjusting it with you? Apply for private coaching.
            </p>
            <div className="mt-7 flex flex-col items-stretch gap-4 sm:items-center">
              <PrimaryCta to="/coaching/apply" className="sm:min-w-[280px]">Apply for Coaching</PrimaryCta>
              <p className="text-[13px] text-muted-foreground">Takes about a minute · No payment to apply</p>
              <TextLink to="/coaching">See how coaching works</TextLink>
            </div>
            <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-5 text-center ring-1 ring-border/70">
              <div className="text-[17px] font-semibold">Not ready to apply? Ask me first.</div>
              <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                Questions before you decide are welcome. Send me a message, or follow along to see how I train and coach.
              </p>
              <div className="mt-3 flex justify-center"><TextLink href={INQUIRY_DM_URL}>Message me on Instagram</TextLink></div>
              <div className="mt-3 flex justify-center"><SocialLinks /></div>
            </div>
          </div>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label="Apply for Coaching" href="/coaching/apply" />
    </SalesPageShell>
  );
}
