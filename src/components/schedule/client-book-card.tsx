import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
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
    <section className={cn("space-y-2", className)}>
      <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Book</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {types.map((t) => {
          const accent = cardAccent(t.color);
          const body = (
            <Card className="relative flex items-center gap-3 overflow-hidden p-3.5 pl-4 transition active:scale-[0.99]">
              <span className={cn("absolute inset-y-0 left-0 w-1", accent.bar)} />
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <CalendarPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.durationMin} min · {t.where}
                  {t.usesCredit ? " · uses a session" : ""}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Card>
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
