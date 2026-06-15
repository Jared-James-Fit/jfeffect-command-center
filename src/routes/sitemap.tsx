import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { clientNav } from "@/lib/admin-nav";
import { useAuth } from "@/lib/auth";
import { useDashboardMode } from "@/lib/dashboard-mode";
import { buildInternalNav, resolveStaffRoleTag, WORKSPACE_ORDER } from "@/lib/internal-nav";
import type { NavItem } from "@/components/app-shell";

export const Route = createFileRoute("/sitemap")({
  head: () => ({ meta: [{ title: "Sitemap — JF Effect" }] }),
  component: SitemapPage,
});

function Section({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/50 hover:bg-primary/5"
          >
            <Icon className="h-4 w-4 text-primary" />
            <span className="flex-1">{label}</span>
            <code className="text-[10px] text-muted-foreground">{to}</code>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SitemapPage() {
  const { role } = useAuth();
  const [mode] = useDashboardMode();
  const roleTag = resolveStaffRoleTag(role);

  // Internal nav, scoped to the active role + dashboard mode and grouped
  // by workspace following the canonical WORKSPACE_ORDER. Empty groups
  // are omitted automatically because `buildInternalNav` only returns
  // entries the current role can see.
  const internalGroups = useMemo(() => {
    if (!roleTag) return [] as { label: string; items: NavItem[] }[];
    const items = buildInternalNav(roleTag, {
      mode: mode === "membership" ? "membership" : "coaching",
    });
    const byGroup = new Map<string, NavItem[]>();
    for (const it of items) {
      const key = (it.group as string) || "Other";
      const list = byGroup.get(key) || [];
      list.push(it);
      byGroup.set(key, list);
    }
    const ordered: { label: string; items: NavItem[] }[] = [];
    for (const key of WORKSPACE_ORDER) {
      const list = byGroup.get(key);
      if (list && list.length) {
        // de-dupe by `to` defensively
        const seen = new Set<string>();
        const unique = list.filter((i) => (seen.has(i.to) ? false : (seen.add(i.to), true)));
        ordered.push({ label: key, items: unique });
      }
      byGroup.delete(key);
    }
    for (const [label, list] of byGroup) {
      ordered.push({ label, items: list });
    }
    return ordered;
  }, [roleTag, mode]);

  const publicPages = [
    { to: "/", label: "Landing" },
    { to: "/membership", label: "Membership" },
    { to: "/coaching", label: "Private Coaching" },
    { to: "/auth", label: "Sign in / Sign up" },
    { to: "/sitemap", label: "Sitemap (this page)" },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight">All Pages</h1>
          <p className="text-sm text-muted-foreground">
            Quick access to every screen visible to your account. Listed pages
            follow your role and dashboard mode — switching modes refreshes
            this list. Other portals require the matching account type.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Public</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {publicPages.map((p) => (
              <Link
                key={p.to}
                to={p.to}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:border-primary/50 hover:bg-primary/5"
              >
                <span>{p.label}</span>
                <code className="text-[10px] text-muted-foreground">{p.to}</code>
              </Link>
            ))}
          </div>
        </section>

        {internalGroups.map((g) => (
          <Section key={g.label} title={g.label} items={g.items} />
        ))}
        {!roleTag && (
          <Section title="Client Portal" items={clientNav} />
        )}
      </div>
    </main>
  );
}