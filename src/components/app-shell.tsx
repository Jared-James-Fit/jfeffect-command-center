import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  LogOut, ChevronLeft, ChevronRight, ChevronDown, Search, Settings as SettingsIcon, ArrowLeft, MoreHorizontal, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { useClientNavBadges, markNavSeen } from "@/hooks/use-client-nav-badges";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { UserAvatar } from "@/components/user-avatar";
import { SettingsMenu } from "@/components/settings-menu";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
  /** Optional grouped sub-items shown on tap/long-press in the mobile bottom bar. */
  children?: NavItem[];
}

function groupNavItems(items: NavItem[]) {
  const hasGroups = items.some((i) => i.group);
  if (!hasGroups) return [{ label: undefined as string | undefined, items }];
  const map = new Map<string, NavItem[]>();
  for (const item of items) {
    const key = item.group || "Other";
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  const order = [
    "Core",
    "Communication",
    "Membership",
    "Programming",
    "Business",
    "Documents",
    "Team / Ops",
    "Account",
  ];
  const result: { label: string | undefined; items: NavItem[] }[] = [];
  for (const key of order) {
    if (map.has(key)) {
      result.push({ label: key, items: map.get(key)! });
      map.delete(key);
    }
  }
  for (const [key, list] of map) {
    result.push({ label: key, items: list });
  }
  return result;
}

type SidebarMode = "expanded" | "compact" | "collapsed";
const SIDEBAR_MODE_KEY = "jf-sidebar-mode";
const SIDEBAR_COLLAPSED_SECTIONS_KEY = "jf-sidebar-collapsed-sections";
const DEFAULT_COLLAPSED_SECTIONS = ["Documents", "Team / Ops"];

function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>("expanded");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_MODE_KEY) as SidebarMode | null;
      if (stored === "expanded" || stored === "compact" || stored === "collapsed") {
        setMode(stored);
      }
    } catch {}
  }, []);
  const update = (next: SidebarMode) => {
    setMode(next);
    try { localStorage.setItem(SIDEBAR_MODE_KEY, next); } catch {}
  };
  return [mode, update] as const;
}

function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(DEFAULT_COLLAPSED_SECTIONS));
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_COLLAPSED_SECTIONS_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw)));
    } catch {}
  }, []);
  const toggle = (label: string, allLabels?: string[]) => {
    setCollapsed((prev) => {
      const isCollapsed = prev.has(label);
      if (allLabels && isCollapsed) {
        // Accordion: open this section, collapse all others
        const next = new Set(allLabels.filter((l) => l !== label));
        try { localStorage.setItem(SIDEBAR_COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(next))); } catch {}
        return next;
      }
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      try { localStorage.setItem(SIDEBAR_COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };
  return [collapsed, toggle] as const;
}

export function AppShell({ items, bottomItems: customBottomItems, title, children }: { items: NavItem[]; bottomItems?: NavItem[]; title: string; children: ReactNode }) {
  useKeyboardOpen();
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navBadges = useClientNavBadges();
  const [mode, setMode] = useSidebarMode();
  const [collapsedSections, toggleSection] = useCollapsedSections();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreQuery, setMoreQuery] = useState("");
  const [moreOpenGroup, setMoreOpenGroup] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Allow other components (e.g. the dashboard search card) to open the palette.
  useEffect(() => {
    const onOpen = () => setPaletteOpen(true);
    window.addEventListener("open-command-palette", onOpen as EventListener);
    return () => window.removeEventListener("open-command-palette", onOpen as EventListener);
  }, []);

  const { data: me } = useQuery({
    queryKey: ["app-shell-me", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: profile }, { data: coach }, { data: client }] = await Promise.all([
        supabase.from("profiles").select("full_name, avatar_url").eq("id", user!.id).maybeSingle(),
        supabase.from("coaches").select("full_name, profile_picture_url").eq("user_id", user!.id).maybeSingle(),
        supabase.from("clients").select("full_name, profile_picture_url").eq("user_id", user!.id).maybeSingle(),
      ]);
      const name = coach?.full_name || client?.full_name || profile?.full_name || user!.email || "";
      const pic =
        coach?.profile_picture_url ||
        client?.profile_picture_url ||
        profile?.avatar_url ||
        null;
      return { name, pic };
    },
  });

  const activeTo = items.reduce<string | null>((best, item) => {
    const matches =
      pathname === item.to || pathname.startsWith(item.to + "/");
    if (!matches) return best;
    if (best === null || item.to.length > best.length) return item.to;
    return best;
  }, null);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  const grouped = useMemo(() => groupNavItems(items), [items]);
  const allGroupLabels = useMemo(() => grouped.map((g) => g.label).filter(Boolean) as string[], [grouped]);
  const bottomItems = customBottomItems ?? items.slice(0, 5);
  // Sections that contain the currently active route should auto-open.
  const activeGroupLabel = useMemo(() => {
    for (const g of grouped) {
      if (g.label && g.items.some((i) => i.to === activeTo)) return g.label;
    }
    return null;
  }, [grouped, activeTo]);
  const accountHref =
    items.find((i) => i.to.endsWith("/account") || i.to.endsWith("/account-settings"))?.to ??
    "/admin/account";

  const isCollapsed = mode === "collapsed";
  const isCompact = mode === "compact";
  const sidebarWidthClass = isCollapsed ? "w-14" : isCompact ? "w-52" : "w-60";
  const rowPadding = isCollapsed
    ? "justify-center px-0 py-2"
    : isCompact
    ? "px-2.5 py-1.5 gap-2.5"
    : "px-3 py-2 gap-3";
  const rowText = isCompact ? "text-[13px]" : "text-sm";

  const cycleMode = () => {
    setMode(mode === "expanded" ? "compact" : mode === "compact" ? "collapsed" : "expanded");
  };

  // Open the active group when the More sheet opens, or when route changes.
  useEffect(() => {
    if (moreOpen) setMoreOpenGroup(activeGroupLabel);
  }, [moreOpen, activeGroupLabel]);

  const moreFiltered = useMemo(() => {
    const q = moreQuery.trim().toLowerCase();
    if (!q) return null;
    const results: { item: NavItem; group: string }[] = [];
    for (const g of grouped) {
      for (const it of g.items) {
        if (it.label.toLowerCase().includes(q)) {
          results.push({ item: it, group: g.label ?? "" });
        }
      }
    }
    return results;
  }, [moreQuery, grouped]);

  return (
    <TooltipProvider delayDuration={250}>
    <div className="flex min-h-screen w-full overflow-x-hidden bg-background text-foreground">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex transition-[width] duration-200",
          sidebarWidthClass,
        )}
      >
        {/* Logo header */}
        <div className={cn(
          "flex items-center gap-2 border-b border-sidebar-border",
          isCollapsed ? "justify-center px-2 py-3" : "px-3.5 py-3",
        )}>
          <img src="/logo.png" alt="JF Effect" className="h-8 w-8 rounded-md object-cover" />
          {!isCollapsed && (
            <div className="leading-tight min-w-0">
              <div className="text-[13px] font-black tracking-tight">JF EFFECT</div>
              <div className="truncate text-[9px] uppercase tracking-widest text-muted-foreground">{title}</div>
            </div>
          )}
        </div>

        {/* Account / Sign out / Density (moved up from footer) */}
        <div className={cn("border-b border-sidebar-border", isCollapsed ? "p-1.5" : "p-2")}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-1">
              <SettingsMenu
                items={items}
                meName={me?.name ?? user?.email ?? ""}
                mePic={me?.pic ?? null}
                onSignOut={handleSignOut}
                align="start"
                trigger={
                  <button type="button" className="rounded-full" aria-label="Account menu">
                    <UserAvatar src={me?.pic ?? null} name={me?.name ?? user?.email ?? ""} size={28} ring expandable={false} />
                  </button>
                }
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSignOut}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-destructive"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sign out</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={cycleMode}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    aria-label="Expand sidebar"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <SettingsMenu
                items={items}
                meName={me?.name ?? user?.email ?? ""}
                mePic={me?.pic ?? null}
                onSignOut={handleSignOut}
                align="start"
                trigger={
                  <button type="button" className="shrink-0 rounded-full" aria-label="Account menu">
                    <UserAvatar src={me?.pic ?? null} name={me?.name ?? user?.email ?? ""} size={28} ring expandable={false} />
                  </button>
                }
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-semibold leading-tight">{me?.name || user?.email}</div>
                {!isCompact && (
                  <div className="truncate text-[9px] text-muted-foreground leading-tight">{user?.email}</div>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={cycleMode}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                    aria-label="Toggle sidebar density"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {mode === "expanded" ? "Compact" : mode === "compact" ? "Collapse" : "Expand"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleSignOut}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-destructive"
                    aria-label="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Sign out</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Keyword search / Cmd+K trigger */}
        <div className={cn("border-b border-sidebar-border", isCollapsed ? "p-1.5" : "p-2")}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-primary ring-1 ring-primary/40 hover:bg-primary/10"
                  aria-label="Search keywords"
                >
                  <Search className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Search keywords (⌘K)</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-2 text-left text-xs font-semibold text-foreground shadow-sm hover:bg-primary/10"
            >
              <Search className="h-3.5 w-3.5 text-primary" />
              <span className="flex-1 truncate">Search keywords…</span>
              <kbd className="rounded border border-primary/40 bg-card px-1 py-0.5 text-[9px] font-mono text-primary">⌘K</kbd>
            </button>
          )}
        </div>

        <nav className={cn("flex-1 overflow-y-auto", isCollapsed ? "p-1.5" : "p-2")}>
          <div className={isCollapsed ? "space-y-2" : "space-y-2.5"}>
            {grouped.map((group) => {
              const containsActive = group.label === activeGroupLabel;
              const sectionCollapsed = group.label
                ? collapsedSections.has(group.label) && !containsActive
                : false;
              return (
                <div key={group.label ?? "default"}>
                  {group.label && !isCollapsed && (
                    <button
                      onClick={() => toggleSection(group.label!, allGroupLabels)}
                      className="group flex w-full items-center justify-between rounded px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      <span>{group.label}</span>
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 transition-transform",
                          sectionCollapsed && "-rotate-90",
                        )}
                      />
                    </button>
                  )}
                  {group.label && isCollapsed && (
                    <div className="my-1 mx-2 h-px bg-sidebar-border/60" />
                  )}
                  {(!sectionCollapsed || isCollapsed) && (
                    <ul className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = item.to === activeTo;
                        const Icon = item.icon;
                        const link = (
                          <Link
                            to={item.to}
                            className={cn(
                              "flex items-center rounded-md transition-colors",
                              rowPadding,
                              rowText,
                              active
                                ? "bg-primary/15 text-primary font-semibold border-l-2 border-primary"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border-l-2 border-transparent",
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {!isCollapsed && <span className="truncate">{item.label}</span>}
                          </Link>
                        );
                        return (
                          <li key={item.to}>
                            {isCollapsed ? (
                              <Tooltip>
                                <TooltipTrigger asChild>{link}</TooltipTrigger>
                                <TooltipContent side="right">{item.label}</TooltipContent>
                              </Tooltip>
                            ) : link}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="JF Effect" className="h-8 w-8 rounded-md object-cover" />
            <span className="text-sm font-black tracking-tight">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search keywords"
              className="h-8 gap-1.5 border-primary/40 bg-primary/5 px-2 text-xs font-semibold text-foreground hover:bg-primary/10"
            >
              <Search className="h-3.5 w-3.5 text-primary" />
              Search
            </Button>
            <SettingsMenu
              items={items}
              meName={me?.name ?? user?.email ?? ""}
              mePic={me?.pic ?? null}
              onSignOut={handleSignOut}
              trigger={
                <Button variant="ghost" size="sm" aria-label="Settings">
                  <SettingsIcon className="h-4 w-4" />
                </Button>
              }
            />
            <SettingsMenu
              items={items}
              meName={me?.name ?? user?.email ?? ""}
              mePic={me?.pic ?? null}
              onSignOut={handleSignOut}
              trigger={
                <button type="button" aria-label="Account menu" className="rounded-full">
                  <UserAvatar src={me?.pic ?? null} name={me?.name ?? user?.email ?? ""} size={28} ring expandable={false} />
                </button>
              }
            />
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden pb-[calc(140px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>

        {/* Mobile bottom nav — fixed, app-like tab bar */}
        {(() => {
          const visible = bottomItems.slice(0, 5);
          const cols = visible.length + 1; // + More
          const gridCols = cols === 6 ? "grid-cols-6" : cols === 5 ? "grid-cols-5" : "grid-cols-4";
          return (
        <nav
          data-mobile-bottom-nav
          className={cn(
            "fixed left-3 right-3 z-50 grid overflow-hidden rounded-2xl border border-border bg-card/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] md:hidden",
            gridCols,
          )}
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
        >
          {visible.map((item) => (
            <BottomNavSlot
              key={(item.children ? "g:" : "") + item.to + ":" + item.label}
              item={item}
              pathname={pathname}
              navBadges={navBadges}
              onNavigate={(to) => markNavSeen(user?.id, to)}
            />
          ))}
          <MoreNavSlot
            active={moreOpen}
            onOpenMore={() => setMoreOpen(true)}
          />
        </nav>
          );
        })()}
      </div>

      {/* Mobile "More" sheet — full grouped menu + search */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="h-[88vh] overflow-hidden p-0 md:hidden">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-left text-sm font-black tracking-tight">All sections</SheetTitle>
          </SheetHeader>
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={moreQuery}
                onChange={(e) => setMoreQuery(e.target.value)}
                placeholder="Search pages…"
                className="h-9 pl-8"
              />
            </div>
          </div>
          <div className="h-[calc(88vh-7.5rem)] overflow-y-auto px-2 py-2">
            {moreFiltered ? (
              <ul className="space-y-1">
                {moreFiltered.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>
                )}
                {moreFiltered.map(({ item, group }) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => { setMoreOpen(false); setMoreQuery(""); }}
                        className="flex min-h-[52px] items-center gap-3 rounded-md px-3 py-3.5 text-base hover:bg-sidebar-accent"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{item.label}</div>
                          {group && <div className="truncate text-[12px] text-muted-foreground">{group}</div>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="space-y-1.5">
                {grouped.map((group) => {
                  if (!group.label) return null;
                  const isOpen = moreOpenGroup === group.label;
                  return (
                    <div key={group.label} className="rounded-md border border-border/60">
                      <button
                        type="button"
                        onClick={() => setMoreOpenGroup(isOpen ? null : group.label!)}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                      >
                        <span>{group.label}</span>
                        <ChevronDown className={cn("h-4 w-4 transition-transform", !isOpen && "-rotate-90")} />
                      </button>
                      {isOpen && (
                        <ul className="border-t border-border/60 p-1">
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            const active = item.to === activeTo;
                            return (
                              <li key={item.to}>
                                <Link
                                  to={item.to}
                                  onClick={() => setMoreOpen(false)}
                                  className={cn(
                                    "flex min-h-[52px] items-center gap-3 rounded-md px-3 py-3.5 text-base font-medium",
                                    active
                                      ? "bg-primary/15 font-semibold text-primary"
                                      : "hover:bg-sidebar-accent",
                                  )}
                                >
                                  <Icon className="h-5 w-5 shrink-0" />
                                  <span className="truncate">{item.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Command palette */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Search keywords — type to jump to any page…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {grouped.map((group) => (
            <CommandGroup key={group.label ?? "all"} heading={group.label}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.to}
                    value={`${group.label ?? ""} ${item.label} ${item.to}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      navigate({ to: item.to });
                    }}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => { setPaletteOpen(false); handleSignOut(); }}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </CommandItem>
            <CommandItem onSelect={() => { setPaletteOpen(false); cycleMode(); }}>
              <SettingsIcon className="mr-2 h-4 w-4" /> Toggle sidebar density
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
    </TooltipProvider>
  );
}

export interface Crumb {
  label: ReactNode;
  to?: string;
}

// ------- Mobile bottom-nav helpers (grouped item + long-press) -------
/**
 * Hold-to-open + drag-to-select gesture for the floating bar.
 *
 * - Long-press (~260ms) opens the popover.
 * - While still pressed, the option directly under the finger is highlighted
 *   live and selected on release.
 * - Short tap is treated as a normal click (caller decides what that does).
 * - The trigger button itself never gets a press highlight — we suppress
 *   the OS tap-highlight and don't toggle classes during the press.
 */
function useHoldDragSelect({
  enabled, onOpen, onSelect, onShortTap, longMs = 260,
}: {
  enabled: boolean;
  onOpen: () => void;
  onSelect: (id: string) => void;
  onShortTap: () => void;
  longMs?: number;
}) {
  const timer = useRef<number | null>(null);
  const pressed = useRef(false);
  const dragging = useRef(false);
  const highlightRef = useRef<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const elementToOption = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const opt = el?.closest("[data-bar-option]") as HTMLElement | null;
    return opt?.dataset.barOption ?? null;
  };

  const cleanup = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pressed.current = false;
    dragging.current = false;
    highlightRef.current = null;
    setHighlight(null);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging.current) return;
    const id = elementToOption(e.clientX, e.clientY);
    if (id !== highlightRef.current) {
      highlightRef.current = id;
      setHighlight(id);
    }
  };
  const onUp = (e: PointerEvent) => {
    const wasDragging = dragging.current;
    const id = wasDragging ? elementToOption(e.clientX, e.clientY) : null;
    cleanup();
    if (wasDragging && id) onSelect(id);
  };
  const onCancel = () => cleanup();

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    pressed.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!pressed.current) return;
      dragging.current = true;
      onOpen();
      // Seed highlight with whatever's under the finger right now (could be the trigger).
      const id = elementToOption(e.clientX, e.clientY);
      highlightRef.current = id;
      setHighlight(id);
    }, longMs);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragging.current) { e.preventDefault(); return; }
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    onShortTap();
  };

  return { onPointerDown, onClick, highlight };
}

function navBadgeFor(item: NavItem, navBadges: Record<string, { count?: number; dot?: boolean }>) {
  if (!item.children) return navBadges[item.to];
  let count = 0;
  let dot = false;
  for (const c of item.children) {
    const b = navBadges[c.to];
    if (!b) continue;
    if (b.count) count += b.count;
    if (b.dot) dot = true;
  }
  return count > 0 ? { count } : dot ? { dot: true } : undefined;
}

function BottomNavBadge({ badge }: { badge?: { count?: number; dot?: boolean } }) {
  if (!badge) return null;
  if (badge.count != null && badge.count > 0) {
    return (
      <span className="absolute -right-2 -top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground ring-2 ring-card">
        {badge.count > 9 ? "9+" : badge.count}
      </span>
    );
  }
  if (badge.dot) {
    return <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" />;
  }
  return null;
}

function BottomNavSlot({ item, pathname, navBadges, onNavigate }: {
  item: NavItem;
  pathname: string;
  navBadges: Record<string, { count?: number; dot?: boolean }>;
  onNavigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const Icon = item.icon;
  const badge = navBadgeFor(item, navBadges);

  if (!item.children) {
    const active = pathname === item.to;
    return (
      <Link
        to={item.to}
        onClick={() => onNavigate(item.to)}
        style={{ WebkitTapHighlightColor: "transparent" }}
        className={cn(
          "relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 px-0.5 pt-2 pb-2 text-[10px] font-medium transition-colors touch-manipulation select-none",
          active ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <div className="relative">
          <Icon className={cn("h-5 w-5", active && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]")} />
          <BottomNavBadge badge={badge} />
        </div>
        <span className="w-full px-0.5 text-center text-[9.5px] leading-tight tracking-tight">{item.label}</span>
        {active && <span className="mt-0.5 h-0.5 w-5 rounded-full bg-primary" />}
      </Link>
    );
  }

  const childActive = item.children.some((c) => pathname === c.to || pathname.startsWith(c.to + "/"));
  const childCount = item.children.length;
  const gesture = useHoldDragSelect({
    enabled: true,
    onOpen: () => setOpen(true),
    onSelect: (id) => {
      setOpen(false);
      onNavigate(id);
      navigate({ to: id });
    },
    onShortTap: () => setOpen((o) => !o),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={gesture.onPointerDown}
          onClick={gesture.onClick}
          onContextMenu={(e) => e.preventDefault()}
          style={{ WebkitTapHighlightColor: "transparent" }}
          className={cn(
            "relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 px-0.5 pt-2 pb-2 text-[10px] font-medium select-none touch-manipulation",
            childActive ? "text-primary" : "text-muted-foreground",
          )}
          aria-label={item.label}
        >
          <div className="relative">
            <Icon className={cn("h-5 w-5", childActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]")} />
            <BottomNavBadge badge={badge} />
            {/* multi-option indicator dots */}
            <span className="pointer-events-none absolute -top-1 left-1/2 flex -translate-x-1/2 gap-[2px]">
              {Array.from({ length: Math.min(3, childCount) }).map((_, i) => (
                <span key={i} className={cn("h-[3px] w-[3px] rounded-full", childActive ? "bg-primary/80" : "bg-muted-foreground/60")} />
              ))}
            </span>
          </div>
          <span className="w-full px-0.5 text-center text-[9.5px] leading-tight tracking-tight">{item.label}</span>
          {childActive && <span className="mt-0.5 h-0.5 w-5 rounded-full bg-primary" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-52 p-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</div>
        <ul className="flex flex-col gap-0.5">
          {item.children.map((c) => {
            const CIcon = c.icon;
            const active = pathname === c.to || pathname.startsWith(c.to + "/");
            const cb = navBadges[c.to];
            const highlighted = gesture.highlight === c.to;
            return (
              <li key={c.to}>
                <Link
                  to={c.to}
                  data-bar-option={c.to}
                  onClick={() => { onNavigate(c.to); setOpen(false); }}
                  style={{ WebkitTapHighlightColor: "transparent" }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm font-medium transition-colors select-none",
                    active
                      ? "bg-primary/15 text-primary"
                      : highlighted
                      ? "bg-accent text-accent-foreground scale-[1.01]"
                      : "hover:bg-accent",
                  )}
                >
                  <div className="relative">
                    <CIcon className="h-4 w-4" />
                    <BottomNavBadge badge={cb} />
                  </div>
                  <span className="flex-1 truncate">{c.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function MoreNavSlot({ active, onOpenMore }: { active: boolean; onOpenMore: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenMore}
      style={{ WebkitTapHighlightColor: "transparent" }}
      className={cn(
        "relative flex min-h-[64px] flex-col items-center justify-center gap-0.5 px-0.5 pt-2 pb-2 text-[10px] font-medium transition-colors touch-manipulation select-none",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
      aria-label="More"
    >
      <MoreHorizontal className="h-5 w-5" />
      <span className="w-full px-0.5 text-center text-[9.5px] leading-tight tracking-tight">More</span>
    </button>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  backTo,
  backLabel,
  breadcrumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Parent route fallback if no in-app history is available. */
  backTo?: string;
  /** Label shown on the back button. Defaults to "Back". */
  backLabel?: string;
  /** Optional compact breadcrumb trail (hidden on mobile). */
  breadcrumbs?: Crumb[];
}) {
  const navigate = useNavigate();
  const handleBack = () => {
    // Prefer in-app history when present, otherwise fall back to parent route.
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    if (backTo) navigate({ to: backTo });
  };
  const showBack = !!backTo;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gradient-to-b from-card to-background px-4 py-2.5 md:px-6 md:py-3">
      <div className="min-w-0 flex-1">
        {showBack && (
          <div className="mb-1 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
              onClick={handleBack}
              aria-label={backLabel || "Back"}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-xs font-medium">{backLabel || "Back"}</span>
            </Button>
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground md:flex">
                {breadcrumbs.map((c, i) => (
                  <span key={i} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground/60">/</span>}
                    {c.to ? (
                      <Link to={c.to} className="truncate hover:text-foreground">{c.label}</Link>
                    ) : (
                      <span className="truncate">{c.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            )}
          </div>
        )}
        <h1 className="flex flex-wrap items-center gap-3 text-lg font-black tracking-tight md:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <NotificationBell />
      </div>
    </div>
  );
}