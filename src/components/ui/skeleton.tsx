import { cn } from "@/lib/utils";

/**
 * A placeholder in the shape of what's coming: neutral grey with one soft light
 * sweeping across (`jf-skeleton`, styles.css; still under reduced motion), never
 * a tinted pulse.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("jf-skeleton rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
