import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, ExternalLink, Camera, Video as VideoIcon, CalendarDays, MessageCircle } from "lucide-react";
import { MediaUploadDialog } from "@/components/media-upload-dialog";
import { MediaItemCard } from "@/components/media-item-card";
import { listMediaItems, type MediaType } from "@/lib/media";

export const Route = createFileRoute("/_authenticated/portal/check-in")({ component: CheckIn });

function CheckIn() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<MediaType>("Check-In Videos");

  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: checkInVideos = [] } = useQuery({
    queryKey: ["my-checkin-videos", client?.id],
    enabled: !!client?.id,
    queryFn: () => listMediaItems({ clientId: client!.id, type: "Check-In Videos" }),
  });
  const { data: progressPhotos = [] } = useQuery({
    queryKey: ["my-progress-photos", client?.id],
    enabled: !!client?.id,
    queryFn: () => listMediaItems({ clientId: client!.id, type: "Progress Photos" }),
  });

  useEffect(() => {
    if (!client?.id) return;
    const ch = supabase.channel(`my-checkin-${client.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items", filter: `client_id=eq.${client.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-checkin-videos", client.id] });
        qc.invalidateQueries({ queryKey: ["my-progress-photos", client.id] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [client?.id, qc]);

  const allowVideo = client?.checkin_allow_video !== false;
  const allowPhotos = client?.checkin_allow_photos !== false;
  const hasLink = !!client?.checkin_form_link;

  function openUpload(type: MediaType) {
    setUploadType(type);
    setUploadOpen(true);
  }

  return (
    <>
      <PageHeader title="Weekly Check-In" subtitle="Submit your week — Coach Jared reviews every one." />
      <div className="space-y-6 p-4 md:p-8">
        {/* Submit check-in card */}
        <Card className="border-border bg-card p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/10">
              <ClipboardCheck className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black">Submit Weekly Check-In</h2>
              {client?.checkin_due_day && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Due: <span className="font-semibold text-foreground">{client.checkin_due_day}</span>
                </div>
              )}
              {client?.checkin_instructions ? (
                <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{client.checkin_instructions}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Tap the button below to open your check-in form.</p>
              )}
              {client?.checkin_notes_client && (
                <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">Note from Coach Jared</div>
                  <p className="whitespace-pre-wrap">{client.checkin_notes_client}</p>
                </div>
              )}
              <div className="mt-5">
                {hasLink ? (
                  <a href={client!.checkin_form_link!} target="_blank" rel="noreferrer">
                    <Button size="lg" className="bg-gradient-primary font-bold uppercase">
                      Submit Weekly Check-In <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  </a>
                ) : (
                  <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
                    Your weekly check-in link has not been added yet. Message Coach Jared if you need help.
                    <div className="mt-3">
                      <a href="/portal/messages"><Button variant="outline" size="sm"><MessageCircle className="mr-2 h-4 w-4" />Message Coach</Button></a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Optional uploads */}
        {(allowVideo || allowPhotos) && (
          <div className="grid gap-4 md:grid-cols-2">
            {allowVideo && (
              <Card className="border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <VideoIcon className="h-5 w-5 text-primary" />
                  <div className="flex-1">
                    <div className="font-bold">Check-In Video</div>
                    <div className="text-xs text-muted-foreground">Optional weekly video update.</div>
                  </div>
                  <Button size="sm" disabled={!client?.id} onClick={() => openUpload("Check-In Videos")}>Upload</Button>
                </div>
                {checkInVideos.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {checkInVideos.slice(0, 3).map((it: any) => (
                      <MediaItemCard key={it.id} item={it} role="client" userId={user?.id ?? null} onChanged={() => qc.invalidateQueries({ queryKey: ["my-checkin-videos", client?.id] })} />
                    ))}
                  </div>
                )}
              </Card>
            )}
            {allowPhotos && (
              <Card className="border-border bg-card p-5">
                <div className="flex items-center gap-3">
                  <Camera className="h-5 w-5 text-primary" />
                  <div className="flex-1">
                    <div className="font-bold">Progress Photos</div>
                    <div className="text-xs text-muted-foreground">Optional weekly photos.</div>
                  </div>
                  <Button size="sm" disabled={!client?.id} onClick={() => openUpload("Progress Photos")}>Upload</Button>
                </div>
                {progressPhotos.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {progressPhotos.slice(0, 3).map((it: any) => (
                      <MediaItemCard key={it.id} item={it} role="client" userId={user?.id ?? null} onChanged={() => qc.invalidateQueries({ queryKey: ["my-progress-photos", client?.id] })} />
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        )}
      </div>

      {client?.id && (
        <MediaUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          clientId={client.id}
          role="client"
          defaultType={uploadType}
          restrictTypes={[uploadType]}
          onUploaded={() => {
            qc.invalidateQueries({ queryKey: ["my-checkin-videos", client.id] });
            qc.invalidateQueries({ queryKey: ["my-progress-photos", client.id] });
          }}
        />
      )}
    </>
  );
}