import { Section } from "./sales-page-shell";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export function FinalCta({
  headline, primary, secondary,
}: {
  headline: string;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <Section className="!pt-6">
      <div className="mx-auto max-w-3xl rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-8 text-center md:p-12">
        <h2 className="text-2xl font-black tracking-tight md:text-4xl">{headline}</h2>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primary}
          {secondary}
        </div>
      </div>
    </Section>
  );
}

export { Button };