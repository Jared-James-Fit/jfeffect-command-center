import { Section, SectionTitle } from "./sales-page-shell";

export function HowItWorks({ items }: { items: Array<{ step: number; title: string; body: string }> }) {
  return (
    <Section>
      <SectionTitle eyebrow="How it works" title="From application to first session" />
      <ol className="grid gap-3 md:grid-cols-5">
        {items.map((s) => (
          <li key={s.step} className="rounded-xl border border-border bg-card p-4">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary text-sm font-black">{s.step}</div>
            <div className="mt-2 text-sm font-bold">{s.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.body}</div>
          </li>
        ))}
      </ol>
    </Section>
  );
}