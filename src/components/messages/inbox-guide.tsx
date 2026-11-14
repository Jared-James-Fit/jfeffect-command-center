import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { UNREAD_DOT } from "@/components/messages/chat-list-row";
import {
  FILTER_HELP, GUIDE_BADGE, GUIDE_FILTERS_NOTE, GUIDE_ROW, type InboxFilterKey,
} from "@/lib/inbox-guide";

/** A filter as its chip shows it: its name and, when it counts, its badge's own colours. */
export type GuideFilter = { key: Exclude<InboxFilterKey, "Inbox">; label: string; badge?: string };

/** The ? beside the search: opens "How Messages works". */
export function InboxGuideButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onClick}
      className="h-10 w-10 shrink-0 text-muted-foreground"
      aria-label="How Messages works"
      title="How Messages works"
      data-inbox-guide-open
    >
      <HelpCircle className="h-5 w-5" />
    </Button>
  );
}

/**
 * "How Messages works": the badge, what a row says, and every filter in a
 * sentence, from the same words as the line under the filters (inbox-guide.ts).
 */
export function InboxGuideSheet({
  open, onOpenChange, filters,
}: { open: boolean; onOpenChange: (open: boolean) => void; filters: GuideFilter[] }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[24px] p-0 pb-[max(env(safe-area-inset-bottom),1rem)] sm:mx-auto sm:max-w-[520px]"
        data-inbox-guide
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="px-5 pb-2 pt-4">
          <SheetTitle className="text-[20px] font-semibold">How Messages works</SheetTitle>
          <SheetDescription className="mt-1 text-[15px] leading-5">
            Messages is for talking with your clients. Everything else waiting on you has its own filter.
          </SheetDescription>
        </div>

        <section className="px-5 py-3" data-guide-badge>
          <h3 className="flex items-center gap-2 text-[16px] font-semibold">
            <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[12px] font-bold text-white", UNREAD_DOT)}>2</span>
            The number on Messages
          </h3>
          <p className="mt-1 text-[15px] leading-5 text-muted-foreground">{GUIDE_BADGE}</p>
        </section>

        <section className="px-5 py-3">
          <h3 className="text-[16px] font-semibold">Reading the list</h3>
          <ul className="mt-2 space-y-3">
            {GUIDE_ROW.map((r) => (
              <li key={r.title}>
                <div className="text-[15px] font-semibold leading-5">{r.title}</div>
                <p className="text-[15px] leading-5 text-muted-foreground">{r.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="px-5 py-3" data-guide-filters>
          <h3 className="text-[16px] font-semibold">Filters</h3>
          <p className="mt-1 text-[15px] leading-5 text-muted-foreground">{GUIDE_FILTERS_NOTE}</p>
          <ul className="mt-2 space-y-3">
            {filters.map((f) => (
              <li key={f.key} data-guide-filter={f.key}>
                <div className="flex items-center gap-1.5 text-[15px] font-semibold leading-5">
                  {f.label}
                  {f.badge && (
                    <span aria-hidden className={cn("inline-block h-5 min-w-5 rounded-full px-1.5 text-center text-[12px] font-bold leading-5", f.badge)}>2</span>
                  )}
                </div>
                <p className="text-[15px] leading-5 text-muted-foreground">{FILTER_HELP[f.key]}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="px-5 pt-2">
          <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
