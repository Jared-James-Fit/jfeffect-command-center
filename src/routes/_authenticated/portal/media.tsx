import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Camera } from "lucide-react";
import { CLIENT_MEDIA_TYPES, listMediaItems, type MediaType } from "@/lib/media";
import { MediaUploadDialog } from "@/components/media-upload-dialog";
import { MediaItemCard } from "@/components/media-item-card";

export const Route = createFileRoute("/_authenticated/portal/media")({
  component: ClientMedia,
});

function ClientMedia() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<MediaType>("Lift Videos");
  const [open, setOpen] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["my-client-id", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["my-media", client?.id, tab],
    enabled: !!client?.id,
    queryFn: () => listMediaItems({ clientId: client!.id, type: tab }),
  });

  useEffect(() => {
    if (!client?.id) return;
    const ch = supabase.channel(`my-media-${client.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items", filter: `client_id=eq.${client.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-media", client.id] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [client?.id, qc]);

  return (
    <>
      <PageHeader title="Media" subtitle="Upload videos and progress photos for Coach Jared to review." />
      <div className="space-y-4 p-4 md:p-8">
        <Card className="border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Camera className="h-5 w-5 text-primary" />
            <div>
              <div className="font-bold">Upload media</div>
              <div className="text-xs text-muted-foreground">Videos and photos are sent straight to Coach Jared.</div>
            </div>
          </div>
          <Button onClick={() => setOpen(true)} disabled={!client?.id}><Plus className="mr-1 h-4 w-4" />Upload</Button>
        </Card>

        <Tabs value={tab} onValueChange={(v) => setTab(v as MediaType)}>
          <TabsList className="flex w-full overflow-x-auto">
            {CLIENT_MEDIA_TYPES.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
          </TabsList>
          {CLIENT_MEDIA_TYPES.map((t) => (
            <TabsContent key={t} value={t} className="space-y-3">
              {items.length === 0 && (
                <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing here yet. Tap Upload to send your first {t.toLowerCase()}.</Card>
              )}
              {items.map((it: any) => <MediaItemCard key={it.id} item={it} role="client" userId={user?.id ?? null} onChanged={() => qc.invalidateQueries({ queryKey: ["my-media", client?.id] })} />)}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {client?.id && (
        <MediaUploadDialog
          open={open}
          onOpenChange={setOpen}
          clientId={client.id}
          role="client"
          defaultType={tab}
          onUploaded={() => qc.invalidateQueries({ queryKey: ["my-media", client.id] })}
        />
      )}
    </>
  );
}