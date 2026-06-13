import * as React from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type SearchableOption = {
  value: string;
  label: string;
  /** Optional secondary label (e.g. PR value) shown muted on the right. */
  hint?: string;
  /** Optional group/section name. */
  group?: string;
  /** Extra text included in search matching (synonyms, abbreviations). */
  keywords?: string[];
  /** Optional dot color to render alongside the row. */
  color?: string;
};

interface Props {
  options: SearchableOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  triggerClassName?: string;
  contentClassName?: string;
  /** Optional render override for the trigger label. */
  renderTrigger?: (selected: SearchableOption | undefined) => React.ReactNode;
  ariaLabel?: string;
}

/**
 * Reusable, mobile-friendly searchable selector used across analytics.
 * - Built on cmdk (Command) + Radix Popover so it renders above bottom nav.
 * - Local instant filtering, case-insensitive, supports grouping.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  triggerClassName,
  contentClassName,
  renderTrigger,
  ariaLabel,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  // Group options preserving insertion order; ungrouped fall under "".
  const grouped = React.useMemo(() => {
    const map = new Map<string, SearchableOption[]>();
    for (const o of options) {
      const k = o.group ?? "";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(o);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            "h-10 w-full justify-between gap-2 truncate text-left text-sm font-semibold",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.color && (
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: selected.color }}
              />
            )}
            <span className="truncate">
              {renderTrigger
                ? renderTrigger(selected)
                : selected?.label ?? placeholder}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          // High z so it floats above sticky headers and bottom nav.
          "z-[60] w-[--radix-popover-trigger-width] min-w-[260px] p-0",
          contentClassName,
        )}
      >
        <Command
          filter={(itemValue, search, keywords) => {
            const q = search.trim().toLowerCase();
            if (!q) return 1;
            const hay = `${itemValue} ${(keywords ?? []).join(" ")}`.toLowerCase();
            return hay.includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty className="px-3 py-6 text-center text-sm text-muted-foreground">
              <Search className="mx-auto mb-2 h-4 w-4 opacity-50" />
              {emptyText}
            </CommandEmpty>
            {grouped.map(([group, items]) => (
              <CommandGroup
                key={group || "_"}
                heading={group || undefined}
              >
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.label}
                    keywords={[
                      o.value,
                      o.label,
                      ...(o.keywords ?? []),
                      ...(o.hint ? [o.hint] : []),
                    ]}
                    onSelect={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    {o.color ? (
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: o.color }}
                      />
                    ) : (
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          value === o.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {o.hint}
                      </span>
                    )}
                    {o.color && value === o.value && (
                      <Check className="ml-1 h-4 w-4 shrink-0 opacity-80" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Small clear button used next to selectors. */
export function ClearButton({
  onClick,
  label = "Clear",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-9 gap-1 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
    >
      <X className="h-3.5 w-3.5" /> {label}
    </Button>
  );
}