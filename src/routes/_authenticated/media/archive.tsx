import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { MediaHeader } from "@/components/media/media-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Undo2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/media/archive")({
  component: ArchivePage,
});

type Kind = "content" | "tasks" | "drafts" | "assets" | "links" | "campaigns" | "testimonials";

const TABLES: Record<Kind, { table: string; flag: "archived" | "is_archived" | "archived_at"; title: string; subtitle?: string }> = {
  content:     { table: "media_content_records", flag: "archived",      title: "title",       subtitle: "content_type" },
  tasks:       { table: "tasks",                 flag: "archived_at",   title: "title",       subtitle: "status" },
  drafts:      { table: "media_drafts",          flag: "is_archived",   title: "title",       subtitle: "channel" },
  assets:      { table: "media_resources",       flag: "is_archived",   title: "name",        subtitle: "kind" },
  links:       { table: "media_pages",           flag: "archived",      title: "title",       subtitle: "url" },
  campaigns:   { table: "media_campaigns",       flag: "archived",      title: "name",        subtitle: "status" },
  testimonials:{ table: "media_testimonials",    flag: "is_archived",   title: "client_name", subtitle: "quote" },
};

function ArchivePage() {
  const [kind, setKind] = useState<Kind>("content");
  const { role } = useAuth();
  const canDelete = role === "admin";
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <MediaHeader
        title="Archive"
        description="Recover or permanently remove archived content, tasks, drafts, assets, links, campaigns, and testimonials."
      />
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList className="flex h-auto flex-wrap">
          {(Object.keys(TABLES) as Kind[]).map((k) => (
            <TabsTrigger key={k} value={k} className="capitalize">{k}</TabsTrigger>
          ))}
        </TabsList>
        {(Object.keys(TABLES) as Kind[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <ArchiveList kind={k} canDelete={canDelete} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ArchiveList({ kind, canDelete }: { kind: Kind; canDelete: boolean }) {
  const cfg = TABLES[kind];
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["media-archive", kind],
    queryFn: async () => {
      const db: any = supabase;
      let q = db.from(cfg.table)
        .select(`id, ${cfg.title}${cfg.subtitle ? `, ${cfg.subtitle}` : ""}, updated_at`)
        .order("updated_at", { ascending: false })
        .limit(200);
      q = cfg.flag === "archived_at" ? q.not("archived_at", "is", null) : q.eq(cfg.flag, true);
      const { data } = await q;
      return (data ?? []) as any[];
    },
  });

  async function restore(id: string) {
    const payload = cfg.flag === "archived_at" ? { archived_at: null } : { [cfg.flag]: false };
    const { error } = await ((supabase as any).from(cfg.table)).update(payload).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Restored");
    qc.invalidateQueries({ queryKey: ["media-archive", kind] });
  }

  async function hardDelete(id: string) {
    const { error } = await ((supabase as any).from(cfg.table)).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Permanently deleted");
    qc.invalidateQueries({ queryKey: ["media-archive", kind] });
  }

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!data || data.length === 0) return <Card className="p-6 text-center text-sm text-muted-foreground">Nothing archived here.</Card>;

  return (
    <Card className="divide-y">
      {data.map((row) => (
        <div key={row.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{row[cfg.title] || "Untitled"}</div>
            {cfg.subtitle && (
              <div className="truncate text-xs text-muted-foreground">
                {String(row[cfg.subtitle] ?? "").slice(0, 120)}
              </div>
            )}
          </div>
          <Badge variant="outline" className="hidden md:inline-flex">
            {row.updated_at ? new Date(row.updated_at).toLocaleDateString() : ""}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => restore(row.id)}>
            <Undo2 className="mr-1 h-3.5 w-3.5" />Restore
          </Button>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Permanently delete this record?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This cannot be undone. The record will be removed from the database forever.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => hardDelete(row.id)}>Delete forever</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      ))}
    </Card>
  );
}