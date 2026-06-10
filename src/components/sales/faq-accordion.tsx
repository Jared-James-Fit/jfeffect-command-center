import { Section, SectionTitle } from "./sales-page-shell";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function FaqAccordion({ items }: { items: Array<{ q: string; a: string }> }) {
  if (!items?.length) return null;
  return (
    <Section>
      <SectionTitle eyebrow="FAQ" title="Frequently asked questions" />
      <Accordion type="single" collapsible className="mx-auto max-w-2xl">
        {items.map((it, i) => (
          <AccordionItem key={i} value={`item-${i}`}>
            <AccordionTrigger className="text-left text-sm font-semibold">{it.q}</AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground">{it.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Section>
  );
}