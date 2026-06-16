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
  CheckCircle2, XCircle, Map as MapIcon, Repeat, Flame, ShieldCheck,
  Target, ClipboardCheck, Utensils, MessageCircle,
} from "lucide-react";
import { Reveal } from "@/components/sales/reveal";

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

export const Route = createFileRoute("/coaching")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "1:1 Coaching for High-Performing Men | JF Effect" },
      { name: "description", content: "Private coaching for ambitious men who are done starting over. Built-for-you training, nutrition, weekly accountability and direct coach access. By application." },
      { property: "og:title", content: "1:1 Coaching for High-Performing Men | JF Effect" },
      { property: "og:description", content: "Private coaching for ambitious men who are done starting over. Built-for-you training, nutrition, weekly accountability and direct coach access. By application." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/coaching" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "1:1 Coaching for High-Performing Men | JF Effect" },
      { name: "twitter:description", content: "Private coaching for ambitious men who are done starting over. Built-for-you training, nutrition, weekly accountability and direct coach access. By application." },
    ],
    links: [{ rel: "canonical", href: "https://jfeffect.com/coaching" }],
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
    "You're driven everywhere else and tired of your body being the exception",
    "You want structure, not another pep talk",
    "You're done restarting and want something that actually compounds",
    "You're willing to be coached and do the work",
    "You hold yourself to a high standard and want a plan that matches it",
  ];
  const notFor: string[] = Array.isArray(s.not_for) && s.not_for.length > 0 ? s.not_for : [
    "You want a shortcut or a quick fix",
    "You need to be motivated every single day",
    "You're not willing to be held accountable",
    "You'll quit the first hard week",
    "You want to argue with the plan instead of running it",
  ];
  const howItWorks = Array.isArray(s.how_it_works) && s.how_it_works.length > 0 ? s.how_it_works : [
    { step: 1, title: "Apply", body: "Tell me your goals, your history, and what's been stopping you. About 3 minutes." },
    { step: 2, title: "Strategy Call", body: "If it's a fit, we get on a call and map the plan together. No pressure, no script." },
    { step: 3, title: "Onboarding", body: "We set up your training, nutrition, and check-ins so day one is clear." },
    { step: 4, title: "Your Custom Plan", body: "Built for your body and your schedule. You always know exactly what to do next." },
    { step: 5, title: "Coaching & Accountability", body: "Weekly check-ins, real adjustments, and direct access to me the whole way." },
    { step: 6, title: "Results", body: "The work compounds because, for once, you actually stuck to one plan." },
  ];
  const faqItems = Array.isArray(s.faq) && s.faq.length > 0 ? s.faq : [
    { q: "Can total beginners join?", a: "Yes. A beginner who'll follow a plan beats an \"advanced\" lifter who program-hops every month. I'll meet you where you are." },
    { q: "Do I need a gym?", a: "A gym makes things easier, but no. Tell me your equipment in the application and I'll build around it." },
    { q: "Can I train at home?", a: "Yes — plenty of clients do. The plan gets built around what you actually have access to." },
    { q: "Can I train for powerlifting?", a: "Yes. It's my background and my sport. If strength is the goal, you're in the right place." },
    { q: "Do I have to track calories?", a: "Not obsessively. I'll give you targets that fit how you eat. The goal is something you'll actually keep doing." },
    { q: "What if I travel a lot?", a: "The plan flexes. We build around your real schedule, not a fantasy one." },
    { q: "What if I've failed before?", a: "Then you've probably never had a real plan and real accountability at the same time. That's the whole point of coaching — that's not a reason to skip it, it's the reason to start." },
  ];
  const authority: Array<{ label: string }> = Array.isArray(s.authority) && s.authority.length > 0 ? s.authority : [
    { label: "Team Canada Powerlifter" },
    { label: "Total @ bodyweight" },
    { label: "Nationals result" },
    { label: "Clients coached" },
    { label: "Coaching since" },
  ];

  return (
    <SalesPageShell pageId="coaching">
      {p === undefined ? (
        <HeroSkeleton />
      ) : (
      <CoachingHero
        eyebrow="Private 1:1 Coaching · By Application"
        headline={"You already know what to do. You just stopped doing it."}
        sub={"Private coaching for men and women who are done starting over. A plan built around your life, a coach who actually looks at your numbers, and accountability that doesn't let you quietly slip. This isn't another app — it's me, in your corner."}
        primary={<HeroCta onClick={handleApply}>Apply for Private Coaching</HeroCta>}
        secondary={
          <Link
            to="/membership"
            className="text-sm font-semibold text-white/70 underline-offset-4 hover:text-white hover:underline"
          >
            Not ready for 1:1 yet? Start with the Membership →
          </Link>
        }
      />
      )}

      {/* 2. Authority bar */}
      <Reveal><AuthorityBar items={authority} /></Reveal>

      {/* 3. Why most people fail */}
      <Reveal><WhyMostFail /></Reveal>

      {/* 4. Who this is for / not for */}
      <Reveal><WhoForNotFor whoFor={whoFor} notFor={notFor} /></Reveal>

      {/* 5. What coaching includes */}
      <Reveal><WhatCoachingIncludes /></Reveal>

      {/* 6. How it works */}
      <Reveal><HowItWorks items={howItWorks} /></Reveal>

      {/* 7. Proof wall */}
      <Reveal><ProofWall
        testimonials={p?.testimonials ?? []}
        images={(p?.visuals ?? []).filter((v) => v.slot === "proof")}
      /></Reveal>

      {/* 8. Coaching vs Membership */}
      <Reveal><CoachingVsMembership onApply={handleApply} /></Reveal>

      {/* 9. The Jared story */}
      <Reveal><JaredStory /></Reveal>

      {/* 10. FAQ */}
      <Reveal><FaqAccordion items={faqItems} /></Reveal>

      <div id="cta" />
      {/* 11. Final CTA */}
      <Reveal><FinalCta
        headline={s.final_cta?.headline ?? "Stop starting over."}
        primary={
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" onClick={handleApply} className="h-12 px-6 text-base font-bold">
              {s.final_cta?.primary_label ?? "Apply for Private Coaching"}
            </Button>
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Application only · Limited client capacity
            </p>
          </div>
        }
      /></Reveal>

      <div className="pb-24 md:pb-0" />
      {/* 12. Sticky mobile CTA */}
      <StickyMobileCta label={p?.primary_cta_label ?? "Apply for Private Coaching"} onClick={handleApply} />
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
    { Icon: MapIcon, title: "No plan", body: "You're working hard with no map. Effort without a plan just gets you tired, not better." },
    { Icon: Repeat, title: "Program-hopping", body: "New program every few weeks, so nothing ever compounds. You restart instead of progress." },
    { Icon: Flame, title: "Chasing motivation", body: "Motivation shows up when it feels like it. Standards show up every day. You've been relying on the wrong one." },
    { Icon: ShieldCheck, title: "No accountability", body: "Nobody's checking. So the day you \"don't feel like it\" wins, and then it keeps winning." },
  ];
  return (
    <Section>
      <SectionTitle eyebrow="The real reason you keep stalling" title="It's not effort. It's structure." />
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
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground md:text-base">
        Coaching fixes all four at once — a real plan, built for you, with someone watching the numbers and holding the standard when you don't feel like it.
      </p>
    </Section>
  );
}

/* -------- Who this is for / not for -------- */
function WhoForNotFor({ whoFor, notFor }: { whoFor: string[]; notFor: string[] }) {
  return (
    <Section>
      <SectionTitle eyebrow="Is this you?" title="Who this is — and isn't — for." />
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
    { Icon: Target, title: "A Plan Built for You", body: "Built for your body, your schedule, your gym — not pulled from a library and slapped on you." },
    { Icon: ClipboardCheck, title: "Weekly Check-Ins & Adjustments", body: "Every week I look at your numbers and adjust. You're never guessing whether it's working." },
    { Icon: Utensils, title: "Nutrition That Fits Your Life", body: "Real targets built around how you actually eat — no spreadsheets you'll abandon in a week." },
    { Icon: MessageCircle, title: "Direct Access to Me", body: "Message me directly. Not a chatbot, not a junior coach — me." },
  ];
  return (
    <Section>
      <SectionTitle eyebrow="What coaching includes" title="Built for you. Run with you." />
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
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Why I coach the way I coach</div>
          <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
            I built this under pressure. That's exactly why it works.
          </h2>
        </div>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted-foreground md:text-base">
          <p>
            I didn't come from a perfect setup. I built JF Effect from scratch while I was the one paying the bills — supporting my girlfriend through dental hygiene school, moving provinces, figuring it out with real weight on my shoulders. No safety net, no excuses available.
          </p>
          <p>
            At the same time I was competing as a powerlifter at the national level. Not theory. Reps under a loaded bar with consequences.
          </p>
          <p>
            Here's what those years taught me: motivation is useless and information is everywhere. What people actually lack is structure and a standard they can't quietly negotiate away. That's the whole job. I build the plan, I hold the line, and I don't let driven people keep folding under pressure they're fully capable of carrying.
          </p>
          <p>
            Most clients don't come to me for another workout. They come because they were tired of not trusting themselves. That's the thing I actually fix.
          </p>
        </div>
      </div>
    </Section>
  );
}
