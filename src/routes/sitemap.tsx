import { createFileRoute, Link } from "@tanstack/react-router";
import { adminNav, clientNav } from "@/lib/admin-nav";

export const Route = createFileRoute("/sitemap")({
  head: () => ({ meta: [{ title: "Sitemap — JF Effect" }] }),
  component: SitemapPage,
});

function Section({ title, items }: { title: string; items: typeof adminNav }) {
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
  const publicPages = [
    { to: "/", label: "Landing" },
    { to: "/auth", label: "Sign in / Sign up" },
    { to: "/sitemap", label: "Sitemap (this page)" },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight">All Pages</h1>
          <p className="text-sm text-muted-foreground">
            Quick access to every screen in the JF Effect platform. Admin pages require an admin
            account; portal pages require a client account.
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

        <Section title="Admin Command Center" items={adminNav} />
        <Section title="Client Portal" items={clientNav} />
      </div>
    </main>
  );
}