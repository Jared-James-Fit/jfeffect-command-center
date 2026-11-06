import { createContext, useContext, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * The exercise card's ⋯ menu (Tools, Undo / Redo, Reset, Swap, cues, help,
 * order, Remove). On a phone it's a bottom sheet, every action within a thumb's
 * reach above the home bar; on a wide screen a dropdown by the button. The
 * items are written once with CardMenuItem / CardMenuSeparator and work in
 * either: a dropdown taller than the room above a mid-screen ⋯ ran under the
 * Dynamic Island (the Tools row) and was cut off below (Move to position,
 * Remove).
 */
type CardMenuMode = { sheet: boolean; close: () => void };
const CardMenuContext = createContext<CardMenuMode | null>(null);

type SelectEvent = { preventDefault: () => void };

export function CardMenuItem({
  onSelect,
  disabled,
  className,
  children,
  ...rest
}: {
  /** Like a menu item's: call `e.preventDefault()` to keep the menu open (Undo / Redo). */
  onSelect?: (e: SelectEvent) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const mode = useContext(CardMenuContext);
  if (!mode?.sheet) {
    return (
      <DropdownMenuItem onSelect={onSelect} disabled={disabled} className={className} {...rest}>
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        let keepOpen = false;
        onSelect?.({ preventDefault: () => { keepOpen = true; } });
        if (!keepOpen) mode.close();
      }}
      className={cn(
        "relative flex min-h-11 w-full select-none items-center rounded-xl px-3 py-2 text-left text-[15px] outline-none transition-colors",
        "active:bg-secondary disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function CardMenuSeparator() {
  const mode = useContext(CardMenuContext);
  return mode?.sheet ? <div role="separator" className="mx-1 my-1.5 h-px bg-border" /> : <DropdownMenuSeparator />;
}

/** The round ⋯ on the card and its menu: a bottom sheet on a phone, a dropdown elsewhere. */
export function CardMenu({ name, buttonClassName, children }: { name: string; buttonClassName: string; children: ReactNode }) {
  const phone = useIsMobile();
  const [open, setOpen] = useState(false);
  const button = (props: Record<string, unknown> = {}) => (
    <Button type="button" size="sm" variant="ghost" data-no-swipe className={buttonClassName} aria-label={`More options for ${name}`} {...props}>
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  );

  if (phone) {
    return (
      <>
        {button({ onClick: () => setOpen(true), "aria-haspopup": "dialog", "aria-expanded": open })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            hideCloseButton
            data-card-menu-sheet
            className="max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2"
          >
            <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <SheetTitle className="truncate px-3 pb-1 text-base font-semibold">{name}</SheetTitle>
            <SheetDescription className="sr-only">Options for this exercise</SheetDescription>
            <CardMenuContext.Provider value={{ sheet: true, close: () => setOpen(false) }}>{children}</CardMenuContext.Provider>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button()}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl p-1.5"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
