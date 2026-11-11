/**
 * A set's PRs, under the set: one small gold trophy chip ("5-rep ATPR", or
 * "2 PRs" when the set earned more than one) that opens in place to each
 * record and what it beat. The moment it's earned it pops in once (with the
 * PR sound the set row already plays); after that it just sits there quietly.
 */
import { useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { setPrSummary, type SetPrItem } from "@/lib/set-pr-items";

export function SetPrIndicator({ items, celebrate = false }: { items: SetPrItem[]; celebrate?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const summary = setPrSummary(items);
  return (
    <div className="px-2 pb-1.5" data-set-pr={items.length}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${summary}. ${open ? "Hide" : "Show"} the details`}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 pl-1.5 pr-2 text-[11px] font-semibold text-foreground transition active:scale-[0.97]",
          celebrate && "animate-in fade-in zoom-in-75 duration-500",
        )}
      >
        <Trophy className="h-3.5 w-3.5 text-warning" aria-hidden />
        <span className="tabular-nums">{summary}</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-1 text-[11px] leading-snug" data-set-pr-details>
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap gap-x-1.5">
              <span className="font-semibold text-foreground">{i.title}</span>
              <span className="tabular-nums text-muted-foreground">{i.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
