/**
 * Cookbook: the recipe list and a recipe, inside one full-height sheet over
 * Nutrition. Back on a recipe returns to the list where it was; Back on the
 * list closes the sheet. The recipes load only once it's opened.
 *
 * `/portal/nutrition-targets?cookbook=1` opens it (where /portal/recipes now
 * lands), `?recipe=<id>` opens it on that recipe.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { ToolRow, ToolTile } from "./tool-tile";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BookOpen, ChevronLeft, Loader2 } from "lucide-react";

export type CookbookViewer = "member" | "client";

/** `?cookbook=1` / `?recipe=<id>` on the Nutrition page: open the Cookbook (once), then tidy the address. */
function useCookbookLink(open: (recipeId: string | null) => void) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const recipe = url.searchParams.get("recipe");
    if (!url.searchParams.has("cookbook") && !recipe) return;
    open(recipe && /^[0-9a-f-]{36}$/i.test(recipe) ? recipe : null);
    url.searchParams.delete("cookbook");
    url.searchParams.delete("recipe");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // once, on the first render of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useCookbookState() {
  const [open, setOpen] = useState(false);
  const [startRecipe, setStartRecipe] = useState<string | null>(null);
  useCookbookLink((recipe) => {
    setStartRecipe(recipe);
    setOpen(true);
  });
  return { open, setOpen, startRecipe };
}

/**
 * The Cookbook as a plain tool row (the member's Nutrition page). Loads nothing
 * by itself. "Open Cookbook" is the label the Try it Thursday post names.
 */
export function CookbookEntryCard({ viewer }: { viewer: CookbookViewer }) {
  const { open, setOpen, startRecipe } = useCookbookState();
  return (
    <>
      <ToolRow icon={BookOpen} title="Open Cookbook" hint="Simple high-protein meals, most in 10 minutes" onClick={() => setOpen(true)} />
      {open && <CookbookSheet viewer={viewer} open={open} onOpenChange={setOpen} startRecipe={startRecipe} />}
    </>
  );
}

/** The Cookbook as one of Nutrition Tools' tiles (the client's Nutrition page). */
export function CookbookToolTile({ viewer }: { viewer: CookbookViewer }) {
  const { open, setOpen, startRecipe } = useCookbookState();
  return (
    <>
      <ToolTile icon={BookOpen} title="Open Cookbook" onClick={() => setOpen(true)} />
      {open && <CookbookSheet viewer={viewer} open={open} onOpenChange={setOpen} startRecipe={startRecipe} />}
    </>
  );
}

const CookbookBody = lazyWithRetry(() => import("./CookbookContent"));

export function CookbookSheet({
  viewer,
  open,
  onOpenChange,
  startRecipe = null,
}: {
  viewer: CookbookViewer;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startRecipe?: string | null;
}) {
  const [recipeId, setRecipeId] = useState<string | null>(startRecipe);
  const scroller = useRef<HTMLDivElement | null>(null);
  const listTop = useRef(0);

  const openRecipe = (id: string) => {
    listTop.current = scroller.current?.scrollTop ?? 0;
    setRecipeId(id);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0 }));
  };
  const back = () => {
    if (!recipeId) {
      onOpenChange(false);
      return;
    }
    setRecipeId(null);
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: listTop.current }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={scroller}
        side="bottom"
        hideCloseButton
        onEscapeKeyDown={(e) => {
          // Escape on a recipe goes back to the list first
          if (recipeId) {
            e.preventDefault();
            back();
          }
        }}
        className="h-[100dvh] max-w-3xl overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-0 sm:mx-auto sm:h-[92vh] sm:rounded-t-2xl sm:px-6"
      >
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-border bg-background px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.75rem)] dark:bg-card sm:-mx-6 sm:px-6 sm:pt-4">
          <button
            type="button"
            onClick={back}
            aria-label={recipeId ? "Back to recipes" : "Back to nutrition"}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
          >
            <ChevronLeft className="h-4 w-4" />
            {recipeId ? "Recipes" : "Back"}
          </button>
          <SheetTitle className="min-w-0 flex-1 truncate text-lg font-semibold">Cookbook</SheetTitle>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          {open && <CookbookBody viewer={viewer} recipeId={recipeId} onOpenRecipe={openRecipe} />}
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
