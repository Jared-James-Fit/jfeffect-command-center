import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { listMyBookingTypes } from "@/lib/booking.functions";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { cardAccent } from "@/lib/booking-cards";
import { cn } from "@/lib/utils";

/**
 * "Book" on the client's Schedule: the booking types their coach opened to
 * them. One tap opens the times; they're signed in, so there's no form.
 * Renders nothing when there's nothing to book.
 */
export function ClientBookCard({ className }: { className?: string }) {
  const pov = usePovArgs();
  const isPov = !!pov.viewAsClientId;
  const listFn = usePovFn(useServerFn(listMyBookingTypes));
  const { data: types = [] } = useQuery({
    queryKey: ["my-booking-types", pov.viewAsClientId ?? null],
    queryFn: () => listFn({ data: {} }),
    staleTime: 5 * 60_000,
  });
  if (!types.length) return null;

  return (
    <section className={cn("space-y-1.5", className)} aria-label="Book a time">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {types.map((t, i) => {
          const accent = cardAccent(t.color);
          const body = (
            <div className={cn("flex min-h-[52px] items-center gap-3 px-3.5 py-2.5 transition active:bg-secondary/40", i > 0 && "border-t border-border/60")}>
              <span className={cn("h-8 w-[3px] shrink-0 rounded-full", accent.bar)} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">Book {t.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.durationMin} min · {t.where}
                  {t.usesCredit ? " · uses a session" : ""}
                </div>
              </div>
              <span className="shrink-0 text-xs font-semibold text-primary">Pick a time</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          );
          return isPov ? (
            <div key={t.slug} className="pointer-events-none opacity-70" aria-disabled>
              {body}
            </div>
          ) : (
            <Link
              key={t.slug}
              to="/book/$slug"
              params={{ slug: t.slug }}
              search={{ name: "", email: "", phone: "", application_id: "", i: "" }}
              className="block"
            >
              {body}
            </Link>
          );
        })}
      </div>
      {isPov && (
        <p className="text-[11px] text-muted-foreground">
          Preview: the client taps one of these to pick a time.
        </p>
      )}
    </section>
  );
}
