/**
 * jfeffect.com/coaches: JF Effect for coaches. A separate journey from the
 * free app and from Jared's own coaching, for independent coaches who want
 * to run their business on JF Effect.
 *
 * It's early access and the page says so everywhere it asks for anything:
 * independent workspaces, inviting clients, platform billing and client
 * payments through a coach's own Stripe account are being built
 * (docs/COACHING_PLATFORM.md), so nothing here is sold as open. The tools it
 * shows exist today (they run JF Effect's own coaching), and the screens are
 * the client app's own screens (a made-up athlete, scripts/coaching-screenshots).
 *
 * The price is the owner's to publish: until he does (app_settings
 * 'coach_platform', coach_platform_public()), the page states only the
 * planned model (first client free, per client, no base fee) and says the
 * exact price comes before anyone pays. Once published, it shows his numbers
 * through seat-pricing.ts, never a price typed here.
 *
 * Words are Jared's: first person, plain, no fitness-marketing lines
 * (landing-free-vs-coaching.test.ts and coaches-page.test.ts keep them out).
 */
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  ClipboardCheck,
  Dumbbell,
  LinkIcon,
  MessageSquare,
  Salad,
  Users,
  Check,
  Lock,
} from "lucide-react";
import { SalesPageShell } from "@/components/sales/sales-page-shell";
import { PhoneShot } from "@/components/sales/coaching-hero";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Reveal } from "@/components/sales/reveal";
import { Block, Group, Heading, PrimaryCta } from "@/components/sales/apple";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  BILLABLE_DEFINITION,
  EXAMPLE_SIZES,
  cad,
  exampleLine,
  ordinal,
  type SeatPricing,
} from "@/lib/coach-platform/seat-pricing";
import { captureSource } from "@/lib/join-funnel";
import shotWeek from "@/assets/landing/app-week.webp";
import shotLog from "@/assets/landing/app-log.webp";
import shotChat from "@/assets/coaching/app-coach-chat.webp";
import shotNutrition from "@/assets/coaching/app-nutrition.webp";

export const COACHES_APPLY_TO = "/coaches/apply" as const;
export const COACHES_CTA = "Request early access";

const HERO = {
  eyebrow: "JF Effect for coaches · Early access",
  title: "You built the business. We built the platform.",
  body: "JF Effect is the app I run my own coaching business on: programs, nutrition, check-ins, film review and messages in one place, in an app your clients will want to open. I'm opening it to a small group of independent coaches first.",
};

/** Every tool here exists today and runs JF Effect's own coaching. */
const TOOLS: Array<{ icon: typeof Users; title: string; body: string }> = [
  {
    icon: Users,
    title: "Clients",
    body: "One list that tells you who needs you today: missed workouts, check-ins to read, programs about to end.",
  },
  {
    icon: Dumbbell,
    title: "Programs",
    body: "A builder that works like a spreadsheet. Every week written out, progress set across weeks in one go, templates you reuse.",
  },
  {
    icon: Salad,
    title: "Nutrition",
    body: "Targets, meal plans and a food log, with bodyweight trends that show whether the plan is working.",
  },
  {
    icon: ClipboardCheck,
    title: "Check-ins and forms",
    body: "Weekly check-ins and your own forms, answered in the app and waiting for you in the chat.",
  },
  {
    icon: MessageSquare,
    title: "Messages and film",
    body: "A client films a set and it lands in your chat with the weight, reps and RPE, plus the bar path and speed read from the video.",
  },
  {
    icon: BarChart3,
    title: "Progress",
    body: "PRs, estimated maxes, weekly volume and training load, worked out from what your clients log.",
  },
  {
    icon: LinkIcon,
    title: "Onboarding",
    body: "One link gets a client into the app with a password and nothing else to set up.",
  },
];

/** What your clients use: the client app's own screens. */
const SCREENS: Array<{ title: string; src: string; alt: string }> = [
  { title: "Their week", src: shotWeek, alt: "The client's Workouts screen: this week's calendar and today's workout" },
  { title: "Logging a set", src: shotLog, alt: "The workout logger: back squat with last time and the sets logged" },
  { title: "Your chat", src: shotChat, alt: "A weekly check-in and the coach's reply in the client's chat" },
  { title: "Their nutrition", src: shotNutrition, alt: "The client's nutrition targets and meal plan" },
];

/** What's in the app now, and what early access is waiting on. Kept honest on purpose. */
const READY = [
  "Every coaching tool on this page. It runs my own coaching business.",
  "The app your clients get: programs, logging, PRs, nutrition and check-ins.",
];
const COMING = [
  "Your own private workspace. Only you and your clients see your clients.",
  "Inviting your clients, and bringing over the ones you coach now.",
  "Billing for the platform, with every price shown before you confirm it.",
  "Later: taking payments from your clients through your own Stripe account.",
];

const STEPS: Array<{ title: string; body: string }> = [
  { title: "Apply", body: "Eight quick questions, about two minutes. Free, and it doesn't commit you to anything." },
  { title: "We talk", body: "I read every application. If you're a fit for the first group, I'll email you to set up a short call." },
  { title: "Your workspace", body: "The first group gets a private workspace set up with their first client, and helps shape what comes next." },
];

/** How workspaces are being built, and what the coach agreement will say. */
const YOURS = [
  "Your workspace is private. Other coaches, and my own coaching business, never see your clients.",
  "I never contact your clients to sell them coaching.",
  "Your clients' training history is theirs. If they move on, it goes with them, and nobody else gets access to it.",
];

function faq(pricing: SeatPricing | null): Array<{ q: string; a: string }> {
  return [
    {
      q: "Is it open now?",
      a: "Not yet. It's in early access, starting with a small group of independent coaches. Applying is free and doesn't commit you to anything.",
    },
    {
      q: "What will it cost?",
      a: pricing
        ? `${firstFreeLine(pricing)} ${afterLine(pricing)} In Canadian dollars, plus applicable tax. You only pay for clients you're coaching now, and nothing is charged until you confirm a price.`
        : "Your first client is free. After that it's a monthly fee for each client you coach, with no base fee and no contract. The exact price is confirmed before early access opens, and nothing is charged until you agree to it.",
    },
    { q: "Do my clients pay JF Effect?", a: "No. The app is free for them." },
    {
      q: "Can I take payments from my clients through the app?",
      a: "Not at first. Keep billing your clients the way you do now. Taking payments through your own Stripe account is planned for later, and when it comes, the money goes to your account.",
    },
    {
      q: "Can I bring the programs I already use?",
      a: "Yes. The app reads programs from spreadsheets, Word docs, PDFs and photos into its builder, and you check every line before it's saved. Only bring programs you wrote or have permission to use.",
    },
    {
      q: "I coach with a team. Does that work?",
      a: "Tell me in the application. Teams with more than one coach come after the first group of independent coaches.",
    },
    {
      q: "What happens to my clients if I stop?",
      a: "They keep their own accounts and training history, and you'll be able to take a copy of your records first.",
    },
  ];
}

const firstFreeLine = (p: SeatPricing) =>
  p.freeClients === 0 ? "" : p.freeClients === 1 ? "Your first client is free." : `Your first ${p.freeClients} clients are free.`;

const afterLine = (p: SeatPricing) =>
  `Then ${cad(p.perClientCents)} a month for each client${p.volume ? `, ${cad(p.volume.perClientCents)} from your ${ordinal(p.volume.fromClient)}` : ""}. No base fee.`;

/** The quiet second way in: same size as the primary, never red. */
function SecondaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-[54px] items-center justify-center gap-1.5 rounded-2xl px-7 text-[17px] font-semibold text-foreground ring-1 ring-inset ring-foreground/20 transition hover:bg-secondary active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-[200px]"
    >
      {children}
    </a>
  );
}

export function CoachesPage({ pricing }: { pricing: SeatPricing | null }) {
  useEffect(() => {
    captureSource();
  }, []);
  const questions = faq(pricing);

  return (
    <SalesPageShell pageId="coaches">
      {/* 1. What it is, and that it's early access */}
      <section className="mx-auto max-w-4xl px-5 pb-12 pt-8 text-center md:pt-16" data-coaches-hero>
        <p className="text-[13px] font-semibold text-muted-foreground">{HERO.eyebrow}</p>
        <h1 className="mx-auto mt-3 max-w-[18ch] text-balance text-[40px] font-semibold leading-[1.04] tracking-[-0.035em] md:text-[60px]">
          {HERO.title}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-[18px] leading-relaxed text-muted-foreground md:text-[19px]">
          {HERO.body}
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center" data-inline-cta>
          <PrimaryCta to={COACHES_APPLY_TO} className="sm:min-w-[220px]">
            {COACHES_CTA}
          </PrimaryCta>
          <SecondaryCta href="#tools">See the tools</SecondaryCta>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">Free to apply. Not open to everyone yet.</p>
      </section>

      {/* 2. The tools: everything here exists today */}
      <Reveal>
        <Block id="tools" tint>
          <Heading
            eyebrow="The tools"
            title="Everything you need to coach. Nothing you don't."
            sub="The same tools I use with my own clients every day."
          />
          <ul className="mx-auto grid max-w-4xl gap-x-10 gap-y-7 sm:grid-cols-2" data-coaches-tools>
            {TOOLS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-background ring-1 ring-border/70">
                  <Icon className="h-[19px] w-[19px]" aria-hidden />
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold leading-snug">{title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Block>
      </Reveal>

      {/* 3. What your clients use */}
      <Reveal>
        <Block>
          <Heading
            eyebrow="Your clients' app"
            title="An app your clients will open."
            sub="Their program, their sets, their nutrition and your chat, on their phone."
          />
          <div className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-5 px-5 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-4 md:gap-6 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {SCREENS.map((s) => (
              <div key={s.title} className="w-[58vw] max-w-[220px] shrink-0 snap-start md:w-auto md:max-w-none">
                <PhoneShot src={s.src} alt={s.alt} className="max-w-[200px]" />
                <p className="mt-4 text-center text-[15px] font-medium">{s.title}</p>
              </div>
            ))}
          </div>
        </Block>
      </Reveal>

      {/* 4. The price */}
      <Reveal>
        <section className="px-3 py-6 sm:px-5 md:py-10" data-coaches-pricing>
          <div className="mx-auto max-w-4xl overflow-hidden rounded-[28px] bg-foreground px-6 py-12 text-center text-background sm:px-10 md:py-16">
            <p className="text-[15px] font-medium text-background/60">And the price?</p>
            <h2 className="mx-auto mt-3 max-w-[16ch] text-balance text-[38px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[56px]">
              {pricing ? firstFreeLine(pricing) || afterLine(pricing) : "Your first client is free."}
            </h2>
            {pricing ? (
              <>
                {firstFreeLine(pricing) && (
                  <p className="mx-auto mt-4 max-w-xl text-[19px] leading-relaxed text-background/80" data-coaches-price>
                    {afterLine(pricing)}
                  </p>
                )}
                <ul className="mx-auto mt-8 max-w-xs divide-y divide-background/15 text-left text-[15px]" data-coaches-examples>
                  {EXAMPLE_SIZES.map((n) => {
                    const [who, cost] = exampleLine(n, pricing).split(": ");
                    return (
                      <li key={n} className="flex items-baseline justify-between py-2.5">
                        <span className="text-background/70">{who}</span>
                        <span className="font-semibold tabular-nums">{cost === "free" ? "Free" : cost}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mx-auto mt-6 max-w-xl text-[13px] leading-relaxed text-background/60">
                  In Canadian dollars, plus applicable tax. {BILLABLE_DEFINITION}
                </p>
              </>
            ) : (
              <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-background/75" data-coaches-price-planned>
                After that, a small monthly fee for each client you coach. No base fee and no contract. The exact
                price is set before early access opens, and you'll see it before you're ever charged.
              </p>
            )}
            <p className="mt-8 text-[17px] font-semibold">Start with one client. Grow on your terms.</p>
          </div>
        </section>
      </Reveal>

      {/* 5. What's ready, and what isn't yet */}
      <Reveal>
        <Block>
          <Heading eyebrow="Where it stands" title="What's ready, and what's next." />
          <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2" data-coaches-status>
            <Group className="p-6">
              <h3 className="text-[17px] font-semibold">In the app today</h3>
              <ul className="mt-4 space-y-3">
                {READY.map((t) => (
                  <li key={t} className="flex gap-3 text-[15px] leading-relaxed">
                    <Check className="mt-0.5 h-[18px] w-[18px] shrink-0 text-success" aria-hidden />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Group>
            <Group className="p-6">
              <h3 className="text-[17px] font-semibold">Being built for early access</h3>
              <ul className="mt-4 space-y-3">
                {COMING.map((t) => (
                  <li key={t} className="flex gap-3 text-[15px] leading-relaxed text-muted-foreground">
                    <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full border border-muted-foreground/60" aria-hidden />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Group>
          </div>
        </Block>
      </Reveal>

      {/* 6. Your clients stay yours */}
      <Reveal>
        <Block tint>
          <Heading
            eyebrow="Your business"
            title="Your clients. Your coaching. Your business."
            sub="How workspaces are being built, and what the coach agreement will say."
          />
          <ul className="mx-auto max-w-2xl space-y-4" data-coaches-yours>
            {YOURS.map((t) => (
              <li key={t} className="flex gap-3 text-[16px] leading-relaxed">
                <Lock className="mt-1 h-[17px] w-[17px] shrink-0 text-muted-foreground" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Block>
      </Reveal>

      {/* 7. How early access works */}
      <Reveal>
        <Block>
          <Heading eyebrow="Early access" title="How it works." />
          <ol className="mx-auto grid max-w-4xl gap-4 md:grid-cols-3" data-coaches-steps>
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-card p-6 ring-1 ring-border/70">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-[14px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-[17px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </Block>
      </Reveal>

      {/* 8. Questions */}
      <Reveal>
        <Block narrow tint>
          <Heading title="Questions" />
          <Group>
            <Accordion type="single" collapsible>
              {questions.map((it, i) => (
                <AccordionItem
                  key={it.q}
                  value={`faq-${i}`}
                  className="border-0 px-5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border/70"
                >
                  <AccordionTrigger className="py-4 text-left text-[17px] font-medium hover:no-underline">
                    {it.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">{it.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Group>
        </Block>
      </Reveal>

      {/* 9. One last way in */}
      <Reveal>
        <Block narrow>
          <div className="text-center">
            <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">
              Start with one client.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Applying takes about two minutes. I read every one.
            </p>
            <div className={cn("mx-auto mt-7 flex max-w-md flex-col items-center gap-4")} data-inline-cta>
              <PrimaryCta to={COACHES_APPLY_TO} className="w-full sm:w-auto sm:min-w-[260px]">
                {COACHES_CTA}
              </PrimaryCta>
              <Link
                to="/join"
                className="text-[15px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Want to try the app yourself first? It's free
              </Link>
            </div>
          </div>
        </Block>
      </Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={COACHES_CTA} href={COACHES_APPLY_TO} hideWhenInline />
    </SalesPageShell>
  );
}

/** For the tests: what the page promises, kept with the page. */
export const COACHES_COPY = { HERO, TOOLS, READY, COMING, STEPS, YOURS, faq } as const;
