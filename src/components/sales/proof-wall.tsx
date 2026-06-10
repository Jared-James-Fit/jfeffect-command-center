import { Section, SectionTitle } from "./sales-page-shell";
import { Card } from "@/components/ui/card";

export function ProofWall({
  testimonials = [],
  images = [],
}: {
  testimonials?: Array<{ name: string; quote: string; image_url?: string; visible?: boolean }>;
  images?: Array<{ url: string; alt?: string; visible?: boolean }>;
}) {
  const t = testimonials.filter((x) => x.visible !== false);
  const i = images.filter((x) => x.visible !== false);
  if (t.length === 0 && i.length === 0) return null;
  return (
    <Section>
      <SectionTitle eyebrow="Results" title="Real clients. Real progress." />
      {i.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
          {i.map((x, idx) => (
            <img key={idx} src={x.url} alt={x.alt ?? ""} loading="lazy" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
      )}
      {t.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {t.map((x, idx) => (
            <Card key={idx} className="p-5">
              <p className="text-sm leading-relaxed">"{x.quote}"</p>
              <div className="mt-3 flex items-center gap-2">
                {x.image_url ? <img src={x.image_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : <div className="h-8 w-8 rounded-full bg-muted" />}
                <div className="text-xs font-semibold">{x.name}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}