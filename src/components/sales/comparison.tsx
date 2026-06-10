import { Section, SectionTitle } from "./sales-page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Side = { title: string; body: string; cta_label: string; cta_href: string };

export function ComparisonCard({ left, right }: { left: Side; right: Side }) {
  return (
    <Section>
      <SectionTitle title="Which one is for you?" />
      <div className="grid gap-4 md:grid-cols-2">
        {[left, right].map((s, i) => (
          <Card key={i} className={i === 0 ? "border-primary/40 bg-primary/5 p-6" : "border-border p-6"}>
            <div className="text-sm font-bold">{s.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            <a href={s.cta_href} className="mt-4 inline-block">
              <Button variant={i === 0 ? "default" : "outline"}>{s.cta_label}</Button>
            </a>
          </Card>
        ))}
      </div>
    </Section>
  );
}