import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck, ExternalLink, Camera, Video as VideoIcon, CalendarDays, MessageCircle, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { MediaUploadDialog } from "@/components/media-upload-dialog";
import { MediaItemCard } from "@/components/media-item-card";
import { listMediaItems, type MediaType, uploadToDrive } from "@/lib/media";
import { initMediaUpload, finalizeMediaUpload, createSubmission } from "@/lib/drive.functions";
import { friendlyDriveError, isDriveSetupError } from "@/lib/drive-errors";
import { buildDriveDisplayName } from "@/lib/media-naming";

export const Route = createFileRoute("/_authenticated/portal/check-in")({ component: CheckIn });

function CheckIn() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadType, setUploadType] = useState<MediaType>("Check-In Videos");
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [uploadsUnavailable, setUploadsUnavailable] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const initFn = useServerFn(initMediaUpload);
  const finalizeFn = useServerFn(finalizeMediaUpload);
  const createSubFn = useServerFn(createSubmission);

  const { data: client } = useQuery({
    queryKey: ["my-client", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: assignedLink } = useQuery({
    queryKey: ["my-assigned-checkin-link", (client as any)?.assigned_check_in_link_id],
    enabled: !!(client as any)?.assigned_check_in_link_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("check_in_links" as any)
        .select("*")
        .eq("id", (client as any).assigned_check_in_link_id)
        .maybeSingle();
      return data as any;
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

  // Prefer the assigned check-in link record; fall back to legacy per-client fields.
  const link = assignedLink ?? null;
  const formUrl: string | null = link?.url ?? client?.checkin_form_link ?? null;
  const title: string = link?.title ?? "Submit Weekly Check-In";
  const dueDay: string | null = link?.due_day ?? client?.checkin_due_day ?? null;
  const instructions: string | null = link?.description ?? client?.checkin_instructions ?? null;
  const noteForClient: string | null = link?.notes_client ?? client?.checkin_notes_client ?? null;
  const requireVideo = link ? link.require_video !== false : client?.checkin_allow_video !== false;
  const allowPhotos = link ? link.require_photos === true : client?.checkin_allow_photos !== false;
  const hasLink = !!formUrl;

  // Has the client uploaded a check-in video in the last 7 days?
  const recentVideo = (checkInVideos as any[]).find((v) => {
    const created = new Date(v.created_at).getTime();
    return Date.now() - created < 7 * 24 * 60 * 60 * 1000;
  });

  function openUpload(type: MediaType) {
    setUploadType(type);
    setUploadOpen(true);
  }

  async function uploadCheckInVideo(file: File) {
    if (!client?.id) return;
    setVideoUploading(true);
    setVideoProgress(0);
    try {
      const now = new Date();
      const todayCount = (checkInVideos as any[]).filter((v) => {
        const d = new Date(v.created_at);
        return d.toDateString() === now.toDateString();
      }).length + 1;
      const displayName = buildDriveDisplayName({
        clientName: client.full_name,
        type: "Check-In Videos",
        index: todayCount,
        total: todayCount,
        at: now,
      });

      const sub = await createSubFn({ data: {
        clientId: client.id, submissionType: "Check-In Videos", batchNote: null,
        urgent: false, painNote: null, clipCount: 1, role: "client",
      }});
      const init = await initFn({ data: {
        clientId: client.id, mediaType: "Check-In Videos",
        fileName: file.name, mimeType: file.type || "video/mp4", sizeBytes: file.size,
        displayName,
      }});
      const uploaded = await uploadToDrive(init.uploadUrl, file, setVideoProgress);
      await finalizeFn({ data: {
        clientId: client.id, submissionId: sub.id, mediaType: "Check-In Videos",
        driveFileId: uploaded.id, clipNote: null, clipOrder: 0, urgent: false,
        painNote: null, uploadedByRole: "client",
      }});
      toast.success("Check-in video uploaded.");
      qc.invalidateQueries({ queryKey: ["my-checkin-videos", client.id] });
    } catch (err: any) {
      console.error(err);
      const setup = isDriveSetupError(err);
      if (setup) setUploadsUnavailable(true);
      toast.error(friendlyDriveError(err, "client"));
    } finally {
      setVideoUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  return (
    <>
      <PageHeader title="Weekly Check-In" subtitle="Submit your week — Coach Jared reviews every one." />
      <div className="space-y-6 p-4 md:p-8">
        {/* Heading card */}
        <Card className="border-border bg-card p-6 md:p-8">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-primary/10">
              <ClipboardCheck className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black">{title}</h2>
              {dueDay && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Due: <span className="font-semibold text-foreground">{dueDay}</span>
                </div>
              )}
              {instructions ? (
                <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{instructions}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Upload your quick check-in video, then submit your weekly check-in form.</p>
              )}
              {noteForClient && (
                <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">Note from Coach Jared</div>
                  <p className="whitespace-pre-wrap">{noteForClient}</p>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Step 1 — Upload Check-In Video */}
        <Card className="border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary font-black">1</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-black flex items-center gap-2"><VideoIcon className="h-5 w-5 text-primary" />Upload Check-In Video</h3>
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
{`Quick check-in video first. This does not need to be perfect. Just record a quick video so Coach Jared can see how you're looking and moving this week.

Keep it simple:
• Front view
• Side view
• Back view if needed
• Good lighting
• Full body visible
• 30–60 seconds is enough

Then upload it here before filling out your check-in form.`}
              </p>

              {recentVideo && !videoUploading && (
                <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> Check-in video uploaded.
                </div>
              )}

              {uploadsUnavailable && (
                <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
                  Video uploads are being set up. Message Coach Jared if you need help.
                  <div className="mt-3">
                    <a href="/portal/messages">
                      <Button variant="outline" size="sm">
                        <MessageCircle className="mr-2 h-4 w-4" />Message Coach
                      </Button>
                    </a>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCheckInVideo(f); }}
                />
                <Button
                  size="lg"
                  variant={recentVideo ? "outline" : "default"}
                  disabled={videoUploading || !client?.id}
                  onClick={() => videoInputRef.current?.click()}
                  className={recentVideo ? "" : "bg-gradient-primary font-bold uppercase"}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {videoUploading ? "Uploading…" : (recentVideo ? "Upload Another Video" : "Upload Check-In Video")}
                </Button>
              </div>
              {videoUploading && (
                <div className="mt-3">
                  <Progress value={videoProgress} className="h-2" />
                  <div className="mt-1 text-xs text-muted-foreground">Uploading… {videoProgress}%</div>
                </div>
              )}

              {checkInVideos.length > 0 && (
                <div className="mt-4 space-y-2">
                  {(checkInVideos as any[]).slice(0, 3).map((it: any) => (
                    <MediaItemCard key={it.id} item={it} role="client" userId={user?.id ?? null} onChanged={() => qc.invalidateQueries({ queryKey: ["my-checkin-videos", client?.id] })} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Optional progress photos */}
        {allowPhotos && (
          <Card className="border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <Camera className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <div className="font-bold">Progress Photos</div>
                <div className="text-xs text-muted-foreground">{link?.require_photos ? "Required this week." : "Optional weekly photos."}</div>
              </div>
              <Button size="sm" disabled={!client?.id} onClick={() => openUpload("Progress Photos")}>Upload</Button>
            </div>
            {progressPhotos.length > 0 && (
              <div className="mt-4 space-y-2">
                {(progressPhotos as any[]).slice(0, 3).map((it: any) => (
                  <MediaItemCard key={it.id} item={it} role="client" userId={user?.id ?? null} onChanged={() => qc.invalidateQueries({ queryKey: ["my-progress-photos", client?.id] })} />
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Step 2 — Submit form */}
        <Card className="border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary font-black">2</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-black">Submit Weekly Check-In</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {requireVideo && !recentVideo
                  ? "Upload your check-in video above, then tap the button below to fill out your weekly check-in form."
                  : "Tap the button below to fill out your weekly check-in form."}
              </p>
              <div className="mt-4">
                {hasLink ? (
                  <a href={formUrl!} target="_blank" rel="noreferrer">
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
      </div>

      {client?.id && (
        <MediaUploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          clientId={client.id}
          clientName={(client as any).full_name}
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