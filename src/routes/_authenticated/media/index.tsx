import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mediaDashboardSummary } from "@/lib/media-manager.functions";
import { Megaphone, Calendar, Image as ImageIcon, ExternalLink, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/media/")({
  component: MediaDashboard,
});

function MediaDashboard() {
  const fetchSummary = useServerFn(mediaDashboardSummary);
  const { data, isLoading } = useQuery({ queryKey: ["media-dashboard"], queryFn: () => fetchSummary() });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Media Dashboard</h1>
        <p className="text-sm text-muted-foreground">Today's media priorities and quick links.</p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <QuickLink to="/media/calendar" icon={Calendar} label="Content Calendar" />
        <QuickLink to="/media/inbox" icon={ImageIcon} label="Media Inbox" />
        <QuickLink to="/media/archives" icon={ImageIcon} label="Media Archives" />
        <QuickLink to="/media/sales/membership" icon={ExternalLink} label="JF Membership Preview" />
        <QuickLink to="/media/sales/coaching" icon={ExternalLink} label="Coaching Preview" />
        <QuickLink to="/media/promo-links" icon={Sparkles} label="Promo Links" />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <Megaphone className="h-4 w-4" /> My Drafts
          </h2>
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && (data?.myDrafts?.length ?? 0) === 0 && (
            <div className="text-sm text-muted-foreground">No drafts yet. <Link to="/media/broadcasts" className="underline">Create one</Link>.</div>
          )}
          <ul className="space-y-2">
            {data?.myDrafts?.map((d: any) => (
              <li key={d.id} className="flex items-center justify-between rounded border border-border p-2 text-sm">
                <Link to="/media/broadcasts" className="truncate hover:underline">{d.title || "Untitled"}</Link>
                <Badge variant={d.review_status === "needs_review" ? "default" : "outline"}>{d.review_status}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <Calendar className="h-4 w-4" /> Upcoming Events
          </h2>
          {(data?.upcomingEvents?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">No upcoming events.</div>
          ) : (
            <ul className="space-y-2">
              {data?.upcomingEvents?.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between rounded border border-border p-2 text-sm">
                  <span className="truncate">{e.name}</span>
                  <span className="text-xs text-muted-foreground">{e.event_date}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 md:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <ImageIcon className="h-4 w-4" /> Recent Marketing Media
          </h2>
          {(data?.recentMedia?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">
              No marketing-tagged media yet. Admin can tag media items with "marketing" or "public" visibility to make them appear here.
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {data?.recentMedia?.map((m: any) => (
                <li key={m.id} className="rounded border border-border p-2 text-sm">
                  <div className="truncate font-medium">{m.file_name || m.media_type}</div>
                  <div className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link to={to}>
      <Card className="flex items-center gap-3 p-4 hover:bg-accent">
        <Icon className="h-5 w-5 text-primary" />
        <span className="text-sm font-medium">{label}</span>
      </Card>
    </Link>
  );
}