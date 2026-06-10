import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export function SalesHero({
  eyebrow, headline, sub, primary, secondary, image,
}: {
  eyebrow?: string;
  headline: string;
  sub: string;
  primary: ReactNode;
  secondary?: ReactNode;
  image?: string | null;
}) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
      <div className="container mx-auto grid gap-10 px-4 py-14 md:py-20 lg:grid-cols-2 lg:items-center">
        <div>
          {eyebrow && (
            <div className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3 w-3" />{eyebrow}
            </div>
          )}
          <h1 className="mt-4 text-4xl font-black tracking-tight md:text-6xl">{headline}</h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground md:text-lg">{sub}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            {primary}
            {secondary}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowRight className="h-3 w-3" />
            <span>Built inside the JF Effect app</span>
          </div>
        </div>
        <div className="relative">
          {image ? (
            <img src={image} alt="" loading="eager" className="w-full rounded-2xl border border-border shadow-2xl shadow-primary/10" />
          ) : (
            <div className="aspect-[4/3] rounded-2xl border border-border bg-gradient-to-br from-primary/20 via-card to-card grid place-items-center">
              <div className="text-center text-muted-foreground">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 grid place-items-center">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
                <div className="mt-2 text-xs">App preview</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function HeroCta({ children, ...props }: React.ComponentProps<typeof Button>) {
  return <Button size="lg" className="h-12 px-6 text-base font-bold" {...props}>{children}</Button>;
}

export function HeroCtaGhost({ children, ...props }: React.ComponentProps<typeof Button>) {
  return <Button size="lg" variant="outline" className="h-12 px-6 text-base" {...props}>{children}</Button>;
}