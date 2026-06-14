import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSalesPage } from "@/lib/sales-pages.functions";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { HeroCta, HeroCtaGhost } from "@/components/sales/sales-hero";
import { CoachingHero, CoachingProcess, CoachingVsMembership } from "@/components/sales/coaching-hero";
import { IncludedNotIncluded } from "@/components/sales/included-not-included";
import { OptionsGrid } from "@/components/sales/options-grid";
import { HowItWorks } from "@/components/sales/how-it-works";
import { ProofWall } from "@/components/sales/proof-wall";
import { FaqAccordion } from "@/components/sales/faq-accordion";
import { FinalCta } from "@/components/sales/final-cta";
import { StickyMobileCta } from "@/components/sales/sticky-mobile-cta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { Reveal } from "@/components/sales/reveal";
import coachingHeroImg from "@/assets/coaching-hero.jpg";

export const Route = createFileRoute("/coaching")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "Apply for Private Coaching — JF Effect" },
      { name: "description", content: "Application-only 1:1 coaching with custom training, nutrition, weekly check-ins, plan adjustments, and direct coach feedback inside the JF Effect app." },
      { property: "og:title", content: "JF Effect — Private Coaching" },
      { property: "og:description", content: "Application-based 1:1 coaching. Personalized plan, weekly check-ins, direct support." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/coaching" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "JF Effect — Private Coaching" },
      { name: "twitter:description", content: "Application-based 1:1 coaching. Personalized plan, weekly check-ins, direct support." },
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
    <SalesPageShell>
      <CoachingHero
        eyebrow="Private Coaching · By application"
        headline={p?.hero_headline ?? "1:1 coaching for people who are done guessing."}
        sub={p?.hero_subheadline ?? "A coach builds your program, reviews your check-ins every week, and adjusts the plan based on your data. Inside the JF Effect app."}
        image={p?.hero_image_url ?? coachingHeroImg}
        primary={<HeroCta onClick={handleApply}>{p?.primary_cta_label ?? "Apply for Private Coaching"}</HeroCta>}
        secondary={
          <Link to={(p?.secondary_cta_href ?? "/join") as any}>
            <HeroCtaGhost>{p?.secondary_cta_label ?? "Prefer self-guided? Explore Membership"}</HeroCtaGhost>
          </Link>
        }
      />

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

      <Reveal><FaqAccordion items={s.faq ?? []} /></Reveal>

      <div id="cta" />
      <Reveal><FinalCta
        headline={s.final_cta?.headline ?? "If you already know you need coaching, stop waiting."}
        primary={<Button size="lg" onClick={handleApply} className="h-12 px-6 text-base font-bold">{s.final_cta?.primary_label ?? "Apply for Private Coaching"}</Button>}
        secondary={
          <Link to={(s.final_cta?.secondary_href ?? "/join") as any}>
            <Button size="lg" variant="outline" className="h-12 px-6 text-base">{s.final_cta?.secondary_label ?? "Explore Membership Instead"}</Button>
          </Link>
        }
      /></Reveal>

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={p?.primary_cta_label ?? "Apply for Private Coaching"} onClick={handleApply} />
    </SalesPageShell>
  );
}