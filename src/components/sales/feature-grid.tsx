import { Section, SectionTitle } from "./sales-page-shell";
import { CheckCircle2 } from "lucide-react";

export function FeatureGrid({ title, items }: { title: string; items: Array<{ title: string; body: string }> }) {
  return (
    <Section>
      <SectionTitle title={title} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/10">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm font-bold">{f.title}</div>
            <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{f.body}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}