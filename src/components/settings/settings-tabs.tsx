import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Shared header for the consolidated Admin/Coach Settings workspace.
 *
 * Tabs are real routes (not query params) so OAuth callbacks, deep links,
 * and existing settings forms keep working. Visibility is role-aware.
 */
type Tab = { to: string; label: string; roles: Array<"admin" | "coach"> };

const TABS: Tab[] = [
  { to: "/admin/account",       label: "Account",      roles: ["admin", "coach"] },
  { to: "/admin/settings",      label: "Workspace",    roles: ["admin"] },
  { to: "/admin/apps",          label: "Integrations", roles: ["admin"] },
  { to: "/admin/legal",         label: "Legal & Disclaimers", roles: ["admin"] },
  { to: "/admin/floating-bar",  label: "Floating Bar", roles: ["admin", "coach"] },
  { to: "/admin/faqs",          label: "FAQ",          roles: ["admin", "coach"] },
  { to: "/admin/archives",      label: "Archive",      roles: ["admin"] },
  { to: "/admin/automations",   label: "Automations",  roles: ["admin"] },
  { to: "/admin/sops",          label: "SOPs",         roles: ["admin"] },
];

export function SettingsTabs() {
  const { role } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const r = role === "coach" ? "coach" : "admin";
  const visible = TABS.filter((t) => t.roles.includes(r));
  return (
    <div className="border-b border-border bg-card/50">
      <div className="mx-auto max-w-7xl flex items-center gap-1 overflow-x-auto px-4 md:px-6">
        {visible.map((t) => {
          const active = pathname === t.to || pathname.startsWith(t.to + "/");
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "shrink-0 border-b-2 px-3 py-3 text-sm transition-colors",
                active
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}