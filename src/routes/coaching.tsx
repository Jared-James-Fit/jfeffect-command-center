import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSalesPage, type SalesPageRow } from "@/lib/sales-pages.functions";
import { SalesPageShell, Section, SectionTitle } from "@/components/sales/sales-page-shell";
import { SalesHero, HeroCta, HeroCtaGhost } from "@/components/sales/sales-hero";
import { AppPreviewGrid } from "@/components/sales/app-preview-grid";
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

export const Route = createFileRoute("/coaching")({
  component: CoachingPage,
  head: () => ({
    meta: [
      { title: "Apply for Private Coaching — JF Effect" },
      { name: "description", content: "Custom training, nutrition, weekly check-ins, plan adjustments, and direct coach feedback inside the JF Effect coaching system." },
      { property: "og:title", content: "JF Effect Private Coaching" },
      { property: "og:description", content: "For people who are done guessing. Structure, accountability, and direct support." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://jfeffect.com/coaching" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "JF Effect Private Coaching" },
      { name: "twitter:description", content: "Structure, accountability, and direct support." },
    ],
  }),
});

function CoachingPage() {
  const fetchPage = useServerFn(getPublicSalesPage);
  const navigate = useNavigate();
  const { data: p } = useQuery({
    queryKey: ["public-sales-page", "coaching"],
    queryFn: () => fetchPage({ data: { page_key: "coaching" } }),
  });

  const handleApply = () => {
    window.open("https://jaredjamesfit.com", "_blank", "noopener");
  };

  const previewItems = (p?.visuals ?? [])
    .filter((v) => v.slot === "app_preview" && v.visible !== false)
    .map((v) => ({ label: v.alt || "Preview", url: v.url }));

  const previewFallback = [
    "Training plan", "Nutrition targets", "Check-ins", "Messaging",
    "Lift reviews", "Progress tracking", "Client dashboard", "Recipes",
  ].map((label) => ({ label }));

  const s = p?.sections ?? {};
  return (
    <SalesPageShell>
      <SalesHero
        eyebrow="Private Coaching"
        headline={p?.hero_headline ?? "Private Coaching for people who are done guessing."}
        sub={p?.hero_subheadline ?? "Get structure, accountability, training, nutrition, check-ins, adjustments, and direct support inside the JF Effect coaching system."}
        image={p?.hero_image_url ?? null}
        primary={<HeroCta onClick={handleApply}>{p?.primary_cta_label ?? "Apply for Coaching"}</HeroCta>}
        secondary={
          <Link to={(p?.secondary_cta_href ?? "/join") as any}>
            <HeroCtaGhost>{p?.secondary_cta_label ?? "Not ready for coaching? Join JF Membership"}</HeroCtaGhost>
          </Link>
        }
      />

      <AppPreviewGrid
        title="See the system you're getting"
        sub="Everything organized in one app."
        items={previewItems.length > 0 ? previewItems : previewFallback}
      />

      {Array.isArray(s.who_for) && s.who_for.length > 0 && (
        <Section>
          <SectionTitle eyebrow="Who this is for" title="This is for you if:" />
          <div className="mx-auto grid max-w-3xl gap-2">
            {s.who_for.map((line: string) => (
              <Card key={line} className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                <span className="text-sm">{line}</span>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <IncludedNotIncluded
        includedTitle="What coaching includes"
        notIncludedTitle="What coaching is not"
        included={s.included ?? []}
        notIncluded={s.not_included ?? []}
      />

      {Array.isArray(s.options) && s.options.length > 0 && (
        <OptionsGrid items={s.options} onApply={handleApply} />
      )}

      <ProofWall
        testimonials={p?.testimonials ?? []}
        images={(p?.visuals ?? []).filter((v) => v.slot === "proof")}
      />

      {Array.isArray(s.how_it_works) && s.how_it_works.length > 0 && (
        <HowItWorks items={s.how_it_works} />
      )}

      <FaqAccordion items={s.faq ?? []} />

      <div id="cta" />
      <FinalCta
        headline={s.final_cta?.headline ?? "If you already know you need coaching, stop waiting."}
        primary={<Button size="lg" onClick={handleApply} className="h-12 px-6 text-base font-bold">{s.final_cta?.primary_label ?? "Apply for Coaching"}</Button>}
        secondary={
          <Link to={(s.final_cta?.secondary_href ?? "/join") as any}>
            <Button size="lg" variant="outline" className="h-12 px-6 text-base">{s.final_cta?.secondary_label ?? "Join JF Membership Instead"}</Button>
          </Link>
        }
      />

      <div className="pb-24 md:pb-0" />
      <StickyMobileCta label={p?.primary_cta_label ?? "Apply for Coaching"} onClick={handleApply} />
    </SalesPageShell>
  );
}