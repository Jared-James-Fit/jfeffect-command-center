import { Section, SectionTitle } from "./sales-page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function OptionsGrid({
  items, onApply,
}: {
  items: Array<{ title: string; body: string; badge?: string; cta_label: string }>;
  onApply: () => void;
}) {
  return (
    <Section>
      <SectionTitle title="Coaching options" />
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((o) => (
          <Card key={o.title} className="border-border p-6 transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/10">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-bold">{o.title}</div>
              {o.badge && <Badge variant="outline">{o.badge}</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{o.body}</p>
            <Button className="mt-4" onClick={onApply}>{o.cta_label}</Button>
          </Card>
        ))}
      </div>
    </Section>
  );
}