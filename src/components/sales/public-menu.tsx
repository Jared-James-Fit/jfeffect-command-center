import type { RefObject } from "react";
import { Link } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PUBLIC_NAV } from "@/lib/public-nav";
import type { CtaChoice } from "@/lib/sticky-cta";
import { BrandLink, CtaLink, navTarget, useHomeTap } from "@/components/sales/public-header";

/**
 * The phone's menu on the public pages (public-header.tsx's menu button opens
 * it): the four places with a line each saying which is free and which is
 * paid, the page's own button and Sign in. Its own chunk, loaded on the first
 * tap (or in idle time), never with the page.
 */
export default function PublicMenuSheet({
  open,
  onOpenChange,
  active,
  choice,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: string | null;
  choice: CtaChoice | null;
  /** The menu button: focus goes back to it when the menu closes. */
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const close = () => onOpenChange(false);
  const homeTap = useHomeTap(close);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
        <Dialog.Content
          className="fixed inset-x-0 top-0 z-50 max-h-[100dvh] overflow-y-auto rounded-b-3xl bg-background pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top data-[state=closed]:duration-200 data-[state=open]:duration-300 focus:outline-none lg:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
          data-public-menu
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusTo.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <div className="mx-auto max-w-lg px-4">
            <div className="flex h-14 items-center justify-between">
              <BrandLink onDone={close} />
              <Dialog.Close
                className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-secondary"
                aria-label="Close menu"
              >
                <X className="h-[22px] w-[22px]" aria-hidden />
              </Dialog.Close>
            </div>

            <nav aria-label="Main" className="mt-2 divide-y divide-border/70">
              {PUBLIC_NAV.map((item) => {
                const on = active === item.key;
                return (
                  <Link
                    key={item.key}
                    {...(navTarget(item) as any)}
                    onClick={item.key === "home" ? homeTap : close}
                    activeProps={{}}
                    aria-current={on ? "page" : undefined}
                    className="flex min-h-[64px] items-center justify-between gap-4 py-3"
                    data-menu-link={item.key}
                  >
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-[20px] font-semibold leading-tight tracking-[-0.01em]",
                          !on && "text-foreground/85",
                        )}
                      >
                        {item.label}
                      </span>
                      {item.key !== "home" && (
                        <span className="mt-0.5 block text-[14px] leading-snug text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {on ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-foreground" aria-hidden />
                    ) : (
                      <ChevronRight
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 space-y-3">
              {choice && (
                <CtaLink
                  choice={choice}
                  className="flex h-[54px] w-full rounded-2xl text-[17px]"
                  data-menu-cta={choice.href}
                />
              )}
              <Link
                to="/auth"
                onClick={close}
                className="flex h-12 w-full items-center justify-center rounded-2xl text-[16px] font-medium text-muted-foreground transition hover:text-foreground"
                data-menu-signin
              >
                Already a member?{" "}
                <span className="ml-1 font-semibold text-foreground">Sign in</span>
              </Link>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
