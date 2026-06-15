import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

/**
 * Shared "Which option is right for you?" comparison block.
 *
 * Rendered near the bottom of /membership and /coaching. Frames the two
 * products as solving different levels of need — neither is the "bad"
 * option. The `accent` prop controls which card is emphasized so the
 * comparison feels native to whichever page it appears on.
 */
export function OfferComparison({ accent = "membership" }: { accent?: "membership" | "coaching" }) {
  const memberHighlighted = accent === "membership";
  return (
    <section className="container mx-auto px-4 py-16 md:py-24">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
          Two products, one system
        </div>
        <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          Which option is right for you?
        </h2>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">
          They solve different levels of need. Pick the one that fits where you are right now.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
        <OfferCard
          eyebrow="JF Membership · $29/month USD"
          title="Choose Membership if:"
          bullets={[
            "You want structured workouts without direct coaching",
            "You are comfortable training independently",
            "You want app access, resources and tracking",
            "You want the lowest-cost way to use the JF Effect system",
          ]}
          ctaLabel="Start Membership"
          ctaHref="/membership"
          highlighted={memberHighlighted}
        />
        <OfferCard
          eyebrow="Private Coaching · By application"
          title="Choose Private Coaching if:"
          bullets={[
            "You want a plan built specifically for you",
            "You need accountability and regular adjustments",
            "You want nutrition guidance",
            "You want direct access to a coach",
            "You are prepared to invest more for personalized support",
          ]}
          ctaLabel="Apply for Coaching"
          ctaHref="/coaching/apply"
          highlighted={!memberHighlighted}
        />
      </div>
    </section>
  );
}

function OfferCard({
  eyebrow, title, bullets, ctaLabel, ctaHref, highlighted,
}: {
  eyebrow: string;
  title: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted: boolean;
}) {
  return (
    <div
      className={
        highlighted
          ? "rounded-2xl border-2 border-primary/60 bg-gradient-to-br from-primary/10 via-card to-card p-6 shadow-xl shadow-primary/10"
          : "rounded-2xl border border-border bg-card/60 p-6"
      }
    >
      <div className={`text-[11px] font-bold uppercase tracking-widest ${highlighted ? "text-primary" : "text-muted-foreground"}`}>
        {eyebrow}
      </div>
      <div className="mt-1 text-xl font-black tracking-tight md:text-2xl">{title}</div>
      <ul className="mt-4 space-y-2 text-sm">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${highlighted ? "text-primary" : "text-muted-foreground"}`} />
            <span className={highlighted ? "text-foreground" : "text-muted-foreground"}>{b}</span>
          </li>
        ))}
      </ul>
      <Link to={ctaHref as any} className="mt-6 block">
        <Button
          className="h-11 w-full font-bold"
          variant={highlighted ? "default" : "outline"}
        >
          {ctaLabel}
        </Button>
      </Link>
    </div>
  );
}