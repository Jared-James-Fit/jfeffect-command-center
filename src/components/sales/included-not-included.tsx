import { Section } from "./sales-page-shell";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";

export function IncludedNotIncluded({
  includedTitle = "What's included",
  notIncludedTitle = "Not included",
  included = [],
  notIncluded = [],
}: {
  includedTitle?: string;
  notIncludedTitle?: string;
  included?: string[];
  notIncluded?: string[];
}) {
  return (
    <Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-6">
          <div className="text-xs font-bold uppercase tracking-widest text-emerald-300 mb-3">{includedTitle}</div>
          <ul className="space-y-2 text-sm">
            {included.map((x) => (
              <li key={x} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{x}</li>
            ))}
          </ul>
        </Card>
        <Card className="border-border p-6">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">{notIncludedTitle}</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {notIncluded.map((x) => (
              <li key={x} className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{x}</li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>
  );
}