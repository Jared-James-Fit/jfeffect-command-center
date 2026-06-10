import { Section, SectionTitle } from "./sales-page-shell";
import { Smartphone } from "lucide-react";

export function AppPreviewGrid({
  title, sub, items,
}: {
  title: string;
  sub?: string;
  items: Array<{ label: string; url?: string }>;
}) {
  return (
    <Section className="!py-10">
      <SectionTitle eyebrow="Inside the app" title={title} sub={sub} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="group overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/10">
            <div className="aspect-[4/5] overflow-hidden bg-gradient-to-br from-muted/50 via-card to-card">
              {it.url ? (
                <img src={it.url} alt={it.label} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
              ) : (
                <div className="grid h-full w-full place-items-center">
                  <Smartphone className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="px-3 py-2 text-center text-xs font-semibold">{it.label}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}