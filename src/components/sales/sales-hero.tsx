import { Button } from "@/components/ui/button";
import { Smartphone, ArrowRight } from "lucide-react";
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
      <div
        className="container mx-auto grid gap-10 px-4 py-14 md:py-20 lg:grid-cols-2 lg:items-center motion-safe:[animation:fade-in_600ms_ease-out_both]"
      >
        <div>
          {eyebrow && (
            <div className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
              {eyebrow}
            </div>
          )}
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">{headline}</h1>
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
            <img src={image} alt="" loading="eager" className="w-full rounded-2xl border border-border" />
          ) : (
            <div className="aspect-[4/3] rounded-2xl border border-border bg-card grid place-items-center">
              <div className="text-center text-muted-foreground">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-muted grid place-items-center">
                  <Smartphone className="h-7 w-7 text-muted-foreground" />
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
  return <Button size="lg" className="h-12 px-6 text-base font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform duration-150" {...props}>{children}</Button>;
}

export function HeroCtaGhost({ children, ...props }: React.ComponentProps<typeof Button>) {
  return <Button size="lg" variant="outline" className="h-12 px-6 text-base" {...props}>{children}</Button>;
}