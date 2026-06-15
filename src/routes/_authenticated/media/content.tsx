import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TasksPage as SharedTasksPage } from "@/components/tasks/tasks-page";
import { ShareToolbar } from "@/components/sales/share-toolbar";
import { ExternalLink, FolderOpen, Sparkles, Upload } from "lucide-react";

const TABS = ["inbox", "tasks", "campaigns", "pages", "library", "resources", "testimonials", "archive"] as const;
type Tab = typeof TABS[number];

export const Route = createFileRoute("/_authenticated/media/content")({
  validateSearch: (s) => z.object({ tab: z.enum(TABS).optional() }).parse(s),
  component: ContentWorkspace,
});

function ContentWorkspace() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const active: Tab = tab ?? "inbox";
  const setTab = (t: Tab) => navigate({ to: "/media/content", search: { tab: t }, replace: true });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Content</h1>
        <p className="text-sm text-muted-foreground">Marketing media, tasks, campaigns, and resources.</p>
      </header>
      <Tabs value={active} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="testimonials">Testimonials</TabsTrigger>
          <TabsTrigger value="archive">Archive</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4"><InboxTab /></TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <SharedTasksPage title="Tasks" subtitle="Media work to do." storagePrefix="jf-media" scope="media" />
        </TabsContent>
        <TabsContent value="campaigns" className="mt-4"><CampaignsTab /></TabsContent>
        <TabsContent value="pages" className="mt-4"><PagesTab /></TabsContent>
        <TabsContent value="library" className="mt-4"><LibraryTab /></TabsContent>
        <TabsContent value="resources" className="mt-4"><ResourcesTab /></TabsContent>
        <TabsContent value="testimonials" className="mt-4"><TestimonialsTab /></TabsContent>
        <TabsContent value="archive" className="mt-4"><ArchiveTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function InboxTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-inbox-mm"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_items")
        .select("id, file_name, media_type, created_at, thumbnail_url, drive_url, marketing_visibility")
        .in("marketing_visibility", ["marketing", "public"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Files tagged marketing or public.</p>
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && (data ?? []).length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">No marketing media yet.</Card>
      )}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {(data ?? []).map((m: any) => (
          <Card key={m.id} className="p-3">
            {m.thumbnail_url && <img src={m.thumbnail_url} alt="" className="mb-2 h-32 w-full rounded object-cover" />}
            <div className="truncate font-medium text-sm">{m.file_name || m.media_type}</div>
            <div className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString()}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CampaignsTab() {
  return (
    <div className="space-y-3">
      <Card className="p-4 text-sm text-muted-foreground">
        Active promo campaigns. Connects to sales pages and broadcast drafts.
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" /> Promo Links</h3>
          <p className="text-xs text-muted-foreground">Public share links for /membership and /coaching.</p>
          <ShareToolbar slug="join" />
          <ShareToolbar slug="coaching" />
        </Card>
      </div>
    </div>
  );
}

function PagesTab() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Link to="/media/sales/coaching">
        <Card className="p-4 flex items-center gap-3 hover:bg-accent">
          <ExternalLink className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">Coaching Sales Page</span>
        </Card>
      </Link>
      <Link to="/media/sales/membership">
        <Card className="p-4 flex items-center gap-3 hover:bg-accent">
          <ExternalLink className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">JF Membership Page</span>
        </Card>
      </Link>
    </div>
  );
}

function LibraryTab() {
  return (
    <Card className="p-4 text-sm text-muted-foreground space-y-2">
      <div className="flex items-center gap-2 font-medium text-foreground"><Upload className="h-4 w-4" /> Uploads</div>
      Upload tools for marketing/public assets coming soon. For now, ask admin to upload and tag files as marketing or public.
    </Card>
  );
}

function ResourcesTab() {
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center gap-2 font-medium"><FolderOpen className="h-4 w-4" /> Resource Library</div>
      <p className="text-sm text-muted-foreground">Private files for the media manager team — folders, comments, and uploads.</p>
      <Link to="/media/resources" className="text-sm underline text-primary">Open library →</Link>
    </Card>
  );
}

function TestimonialsTab() {
  const { data } = useQuery({
    queryKey: ["media-testimonials"],
    queryFn: async () => {
      const { data } = await supabase
        .from("media_items")
        .select("id, file_name, thumbnail_url, drive_url, created_at")
        .in("marketing_visibility", ["marketing", "public"])
        .ilike("media_type", "%testimonial%");
      return data ?? [];
    },
  });
  return (
    <div>
      {(data ?? []).length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">No testimonials tagged yet.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {(data ?? []).map((m: any) => (
            <Card key={m.id} className="p-3">
              <div className="truncate font-medium text-sm">{m.file_name}</div>
              {m.drive_url && <a href={m.drive_url} target="_blank" rel="noreferrer" className="text-xs underline">Open</a>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ArchiveTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["media-archives-mm"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_archives")
        .select("id, file_name, drive_url, created_at, marketing_visibility")
        .in("marketing_visibility", ["marketing", "public"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!isLoading && (data ?? []).length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">No archived marketing media yet.</Card>
      )}
      {(data ?? []).map((m: any) => (
        <Card key={m.id} className="p-3 flex items-center justify-between">
          <span className="truncate">{m.file_name || "Untitled"}</span>
          {m.drive_url && <a href={m.drive_url} target="_blank" rel="noreferrer" className="text-xs underline">Open</a>}
        </Card>
      ))}
    </div>
  );
}