import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold cursor-pointer transition-colors active:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border bg-background hover:bg-accent hover:text-accent-foreground dark:bg-secondary/50 dark:hover:bg-secondary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * The button's work is running (a mutation's `isPending`, a save in flight):
   * it's disabled at once (no second submit), says so to screen readers, and its
   * icon gives way to a spinner that only fades in after a beat (`.btn-spinner`),
   * so an instant answer never flashes one. The label stays, so nothing jumps.
   */
  loading?: boolean;
  /** What the label says while `loading` ("Saving…"); defaults to the label itself. */
  loadingText?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingText, disabled, children, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size, className }));
    if (asChild) {
      return (
        <Slot
          className={classes}
          ref={ref}
          aria-busy={loading || undefined}
          data-loading={loading ? "" : undefined}
          {...({ disabled: disabled || loading || undefined, ...props } as React.HTMLAttributes<HTMLElement>)}
        >
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(classes, loading && "[&>svg:not([data-btn-spinner])]:hidden")}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading ? "" : undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 data-btn-spinner aria-hidden className="btn-spinner" />
            {size === "icon" ? <span className="sr-only">Working…</span> : loadingText ?? children}
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
