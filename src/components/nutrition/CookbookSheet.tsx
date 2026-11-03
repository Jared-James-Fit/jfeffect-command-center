/**
 * Cookbook — client-facing recipe browser.
 *
 * Replaces the always-mounted recipe feed on the Nutrition page with a small
 * entry card. The recipe library is fetched ONLY once the Cookbook is opened,
 * in batches of 12 with "Load more". Read-only: recipe permissions and data
 * are untouched (RLS + Published filter as before).
 */

import { Suspense, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { ToolRow, ToolTile } from "./tool-tile";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BookOpen, ChefHat, ChevronLeft, Loader2 } from "lucide-react";

export type CookbookViewer = "member" | "client";

/**
 * The Cookbook as a plain tool row (the member's Nutrition page). Loads nothing
 * by itself. "Open Cookbook" is the label the Try it Thursday post names.
 */
export function CookbookEntryCard({ viewer }: { viewer: CookbookViewer }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToolRow icon={BookOpen} title="Open Cookbook" hint="Easy meals: air fryer, microwave, no-cook & store-bought" onClick={() => setOpen(true)} />
      {open && <CookbookSheet viewer={viewer} open={open} onOpenChange={setOpen} />}
    </>
  );
}

/** The Cookbook as one of Nutrition Tools' tiles (the client's Nutrition page). */
export function CookbookToolTile({ viewer }: { viewer: CookbookViewer }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToolTile icon={BookOpen} title="Open Cookbook" hint="Easy meals, no-cook & store-bought" onClick={() => setOpen(true)} />
      {open && <CookbookSheet viewer={viewer} open={open} onOpenChange={setOpen} />}
    </>
  );
}

const CookbookBody = lazyWithRetry(() => import("./CookbookContent"));

export function CookbookSheet({
  viewer,
  open,
  onOpenChange,
}: {
  viewer: CookbookViewer;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="h-[100dvh] max-w-3xl overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:h-[92vh] sm:mx-auto sm:rounded-t-2xl sm:pt-6"
      >
        <div className="flex min-h-12 items-center gap-3">
          <SheetClose
            aria-label="Back to nutrition"
            className="inline-flex h-12 min-w-[92px] shrink-0 touch-manipulation items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 text-base font-semibold text-foreground shadow-sm transition active:scale-[0.98] hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <ChevronLeft className="h-5 w-5" />
            <span>Back</span>
          </SheetClose>
          <SheetTitle className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-bold">
            <ChefHat className="h-6 w-6 shrink-0 text-primary" />
            <span className="truncate">Cookbook</span>
          </SheetTitle>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          {open && <CookbookBody viewer={viewer} />}
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}

