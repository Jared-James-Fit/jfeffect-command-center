import { useChargesTax } from "@/hooks/use-charges-tax";
import { cn } from "@/lib/utils";

/**
 * " + tax" after a price that's before tax (every product and payment
 * request), shown only while the business charges tax (`useChargesTax`).
 */
export function PlusTax({ className }: { className?: string }) {
  const on = useChargesTax();
  if (!on) return null;
  return <span className={cn("font-normal text-muted-foreground", className)} data-plus-tax> + tax</span>;
}
