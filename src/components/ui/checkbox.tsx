import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { feedback, type FeedbackEvent } from "@/lib/feedback";
import { HapticTap } from "@/components/haptic-tap";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    /** What ticking it says (a task done is "complete"); unticking is always the plain toggle. */
    checkedFeedback?: FeedbackEvent;
  }
>(({ className, onCheckedChange, checkedFeedback = "toggle", ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "relative grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-muted-foreground/50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className,
    )}
    onCheckedChange={(checked) => { feedback(checked === true ? checkedFeedback : "toggle"); onCheckedChange?.(checked); }}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("grid place-content-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
    {/* the iPhone's tap on the finger's own touch (haptic-tap.tsx) */}
    {!props.disabled && <HapticTap />}
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
