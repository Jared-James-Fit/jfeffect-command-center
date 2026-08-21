import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export type { WorkspaceTab };

interface ClientWorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  heading?: string;
}

/**
 * Compact client navigation intentionally preserves every existing client tab.
 * Primary coaching workflows stay one tap away; lower-frequency setup and
 * account tools remain discoverable under More without rebuilding any panel.
 */
export function ClientWorkspaceTabs({ activeTab, onChange, heading }: ClientWorkspaceTabsProps) {
  const activeMore = CLIENT_WORKSPACE_MORE_TABS.find((item) => item.value === activeTab);

  return (
    <div className="mb-5 space-y-2">
      {heading ? (
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {heading}
        </div>
      ) : null}
      <nav
        aria-label="Client workspace"
        className="overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
      >
        <div className="flex min-w-max items-center gap-1 rounded-xl border border-border bg-card/80 p-1 shadow-sm">
          {CLIENT_WORKSPACE_PRIMARY_TABS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onChange(item.value)}
                className={[
                  "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                ].join(" ")}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={activeMore ? "secondary" : "ghost"}
                size="sm"
                className="min-h-10 gap-1.5 rounded-lg px-3 text-sm font-semibold"
                aria-label="Open additional client workspace sections"
              >
                <MoreHorizontal className="h-4 w-4" />
                {activeMore ? activeMore.label : "More"}
              </Button>
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
