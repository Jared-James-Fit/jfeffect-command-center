import type { ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { useClientNavBadges, markNavSeen } from "@/hooks/use-client-nav-badges";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
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
    "Command Center",
    "Coaching",
    "Scheduling",
    "Sales & Payments",
    "Agreements & Documents",
    "Business Tools",
    "Settings",
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

export function AppShell({ items, title, children }: { items: NavItem[]; title: string; children: ReactNode }) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navBadges = useClientNavBadges();

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

  const grouped = groupNavItems(items);
  const bottomItems = items.slice(0, 5);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <img src="/logo.png" alt="JF Effect" className="h-9 w-9 rounded-md shadow-glow object-cover" />
          <div className="leading-tight">
            <div className="text-sm font-black tracking-tight">JF EFFECT</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.label ?? "default"}>
                {group.label && (
                  <div className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = item.to === activeTo;
                    const Icon = item.icon;
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                            active
                              ? "bg-gradient-primary text-primary-foreground font-semibold shadow-glow"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-2 text-xs text-muted-foreground truncate">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex w-full flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="JF Effect" className="h-8 w-8 rounded-md object-cover" />
            <span className="text-sm font-black tracking-tight">{title}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        <main className="flex-1 overflow-x-hidden pb-[calc(110px+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>

        {/* Mobile bottom nav — fixed, app-like tab bar */}
        <nav
          className="fixed left-3 right-3 z-50 grid grid-cols-5 overflow-hidden rounded-2xl border border-border bg-card/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.55)] md:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
        >
          {bottomItems.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            const badge = navBadges[item.to];
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => markNavSeen(user?.id, item.to)}
                className={cn(
                  "relative flex min-h-[68px] flex-col items-center justify-center gap-1 px-1 pt-2 pb-2 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className="relative">
                  <Icon className={cn("h-6 w-6", active && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.6)]")} />
                  {badge?.count != null && badge.count > 0 && (
                    <span className="absolute -right-2 -top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground ring-2 ring-card">
                      {badge.count > 9 ? "9+" : badge.count}
                    </span>
                  )}
                  {badge?.dot && badge.count == null && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card" />
                  )}
                </div>
                <span className="w-full px-0.5 text-center text-[10px] leading-tight tracking-tight">{item.label}</span>
                {active && <span className="mt-0.5 h-0.5 w-5 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-gradient-to-b from-card to-background px-6 py-6 md:px-8">
      <div>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-black tracking-tight md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <NotificationBell />
      </div>
    </div>
  );
}