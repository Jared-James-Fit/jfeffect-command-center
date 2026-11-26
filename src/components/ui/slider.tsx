import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

/**
 * `tone="neutral"` is a settings slider (a volume): the text colour on a muted
 * track with a thumb big enough for a thumb, since red is a screen's one main
 * action (the design system), not a level.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { tone?: "primary" | "neutral" }
>(({ className, tone = "primary", ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", tone === "neutral" && "py-3", className)}
    {...props}
  >
    <SliderPrimitive.Track className={cn("relative h-1.5 w-full grow overflow-hidden rounded-full", tone === "neutral" ? "bg-muted" : "bg-primary/20")}>
      <SliderPrimitive.Range className={cn("absolute h-full", tone === "neutral" ? "bg-foreground" : "bg-primary")} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        "block rounded-full border bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        tone === "neutral" ? "h-5 w-5 border-border" : "h-4 w-4 border-primary/50",
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
