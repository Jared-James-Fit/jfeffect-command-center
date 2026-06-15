import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { HeroCta } from "@/components/sales/sales-hero";
import { CoachingHero, CoachingProcess, CoachingVsMembership } from "@/components/sales/coaching-hero";
import { IncludedNotIncluded } from "@/components/sales/included-not-included";
import { OptionsGrid } from "@/components/sales/options-grid";
import { HowItWorks } from "@/components/sales/how-it-works";
import { ProofWall } from "@/components/sales/proof-wall";
import { FaqAccordion } from "@/components/sales/faq-accordion";
import { FinalCta } from "@/components/sales/final-cta";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { OfferComparison } from "@/components/sales/offer-comparison";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { Reveal } from "@/components/sales/reveal";
import coachingHeroImg from "@/assets/coaching-hero-duo.jpg";

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
      { title: "Online Fitness & Powerlifting Coaching | JF Effect" },
      { name: "description", content: "Private online coaching with individualized training, nutrition guidance, weekly check-ins and direct coach support. By application only." },
      { property: "og:title", content: "Online Fitness & Powerlifting Coaching | JF Effect" },
      { property: "og:description", content: "Private online coaching: individualized training, nutrition guidance, weekly check-ins and direct coach support. By application." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/coaching" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Online Fitness & Powerlifting Coaching | JF Effect" },
      { name: "twitter:description", content: "Private online coaching: individualized training, nutrition guidance, weekly check-ins and direct coach support. By application." },
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

  const s = p?.sections ?? {};
  return (
    <SalesPageShell pageId="coaching">
      {p === undefined ? (
        <HeroSkeleton />
      ) : (
      <CoachingHero
        eyebrow="Private Online Coaching · By Application"
        headline={"Stop guessing. Get a plan built around you."}
        sub={"Private online coaching gives you individualized training, nutrition guidance, weekly accountability and direct support\u2014adjusted around your goals, schedule and progress."}
        image={coachingHeroImg}
        primary={<HeroCta onClick={handleApply}>Apply for Private Coaching</HeroCta>}
        secondary={
          <Link
            to="/membership"
            className="text-sm font-semibold text-white/70 underline-offset-4 hover:text-white hover:underline"
          >
            Prefer to Train Independently? View JF Membership →
          </Link>
        }
      />
      )}

      <Reveal><CoachingProcess /></Reveal>

      {Array.isArray(s.who_for) && s.who_for.length > 0 && (
        <Reveal as={Section}>
          <SectionTitle eyebrow="Who this is for" title="This is for you if:" />
          <div className="mx-auto grid max-w-3xl gap-2">
            {s.who_for.map((line: string, i: number) => (
              <Reveal key={line} delay={i * 60}>
              <Card className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                <span className="text-sm">{line}</span>
              </Card>
              </Reveal>
            ))}
          </div>
        </Reveal>
      )}

      <Reveal><IncludedNotIncluded
        includedTitle="What coaching includes"
        notIncludedTitle="What coaching is not"
        included={s.included ?? []}
        notIncluded={s.not_included ?? []}
      /></Reveal>

      {Array.isArray(s.options) && s.options.length > 0 && (
        <Reveal><OptionsGrid items={s.options} onApply={handleApply} /></Reveal>
      )}

      <Reveal><ProofWall
        testimonials={p?.testimonials ?? []}
        images={(p?.visuals ?? []).filter((v) => v.slot === "proof")}
      /></Reveal>

      {Array.isArray(s.how_it_works) && s.how_it_works.length > 0 && (
        <Reveal><HowItWorks items={s.how_it_works} /></Reveal>
      )}

      <Reveal><CoachingVsMembership onApply={handleApply} /></Reveal>

      <Reveal><OfferComparison accent="coaching" /></Reveal>

      <Reveal><FaqAccordion items={s.faq ?? []} /></Reveal>

      <div id="cta" />
      <Reveal><FinalCta
        headline={s.final_cta?.headline ?? "If you already know you need coaching, stop waiting."}
        primary={<Button size="lg" onClick={handleApply} className="h-12 px-6 text-base font-bold">{s.final_cta?.primary_label ?? "Apply for Private Coaching"}</Button>}
        secondary={
          <Link to={(s.final_cta?.secondary_href ?? "/membership") as any}>
            <Button size="lg" variant="outline" className="h-12 px-6 text-base">{s.final_cta?.secondary_label ?? "View JF Membership"}</Button>
          </Link>
        }
      /></Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={p?.primary_cta_label ?? "Apply for Private Coaching"} onClick={handleApply} />
    </SalesPageShell>
  );
}