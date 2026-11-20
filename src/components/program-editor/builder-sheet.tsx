import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * The program editors' bottom sheet (a member's builder and the coach's
 * editor alike): a grip that swipes down, a title with one quieter line,
 * Done at the top right, never a ✕.
 */
export function BuilderSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        swipeToClose
        className={cn(
          "max-h-[88dvh] gap-0 overflow-y-auto rounded-t-[24px] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 sm:mx-auto",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-start gap-3 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle className="break-words text-[18px] font-semibold leading-tight">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="mt-0.5 text-[13px]">{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Options</SheetDescription>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-mr-1 inline-flex h-10 shrink-0 items-center rounded-full px-3 text-[15px] font-semibold hover:bg-secondary"
          >
            Done
          </button>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}

