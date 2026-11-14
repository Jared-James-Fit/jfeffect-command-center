import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CLIENT_WORKSPACE_MORE_TABS,
  CLIENT_WORKSPACE_PRIMARY_TABS,
  type WorkspaceTab,
} from "@/components/clients/client-workspace-tab-model";
import { cn } from "@/lib/utils";

export type { WorkspaceTab };

interface ClientWorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  heading?: string;
}

/**
 * The client's sections as one row of plain tabs, Instagram's profile way:
 * words only, the one you're on in the foreground with a line under it, a
 * hairline under the row, no box, no icons, no blur. On a phone the row
 * scrolls sideways and keeps the tab you're on in view (so Billing, last in
 * the row, never sits off the edge). Every existing tab stays: the work you
 * do with a client in the row, profile and setup pages under More.
 */
export function ClientWorkspaceTabs({ activeTab, onChange, heading }: ClientWorkspaceTabsProps) {
  const activeMore = CLIENT_WORKSPACE_MORE_TABS.find((item) => item.value === activeTab);
  const rowRef = useRef<HTMLDivElement>(null);

  // Keep the tab you're on in view (centred when the row scrolls), without moving the page.
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    const left = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [activeTab]);

  return (
    <div className="mb-4 bg-background" data-client-tabs>
      {heading ? (
        <div className="pb-1 text-[12px] font-medium text-muted-foreground">{heading}</div>
      ) : null}
      <nav aria-label="Client workspace" className="border-b border-border">
        <div
          ref={rowRef}
          className="-mb-px flex items-stretch overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {CLIENT_WORKSPACE_PRIMARY_TABS.map((item) => {
            const isActive = activeTab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onChange(item.value)}
                className={cn(
                  "relative flex h-11 shrink-0 items-center whitespace-nowrap px-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={isActive ? "page" : undefined}
                data-client-tab={item.value}
              >
                {item.label}
                <span
                  aria-hidden
                  className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full", isActive ? "bg-foreground" : "bg-transparent")}
                />
              </button>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative flex h-11 shrink-0 items-center gap-1 whitespace-nowrap px-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  activeMore ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={activeMore ? "page" : undefined}
                aria-label="Open additional client workspace sections"
              >
                {activeMore ? activeMore.label : "More"}
                <ChevronDown className="h-4 w-4" />
                <span
                  aria-hidden
                  className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full", activeMore ? "bg-foreground" : "bg-transparent")}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Client workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CLIENT_WORKSPACE_MORE_TABS.map((item) => (
                <DropdownMenuItem
                  key={item.value}
                  onSelect={() => onChange(item.value)}
                  className={activeTab === item.value ? "bg-secondary font-semibold" : undefined}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </div>
  );
}
