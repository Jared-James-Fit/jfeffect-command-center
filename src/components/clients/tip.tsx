import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Small plain-English hover hint. Wrap any element: <Tip text="…"><span/></Tip>.
 * Must be inside a TooltipProvider (the client row provides one).
 */
export function Tip({
  text,
  children,
  side = "top",
}: {
  text: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-[260px] text-xs leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
