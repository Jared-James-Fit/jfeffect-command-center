import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listLiftVideos, markAdminViewed, statusTone, LIFT_VIDEO_STATUSES, type LiftVideoStatus } from "@/lib/lift-videos";
import { LiftVideoCard } from "@/components/lift-video-card";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { AlertTriangle, ExternalLink, Video } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/lift-videos")({
  component: AdminLiftVideos,
});

function AdminLiftVideos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LiftVideoStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: videos = [] } = useQuery({
    queryKey: ["lift-videos-admin"],
    queryFn: () => listLiftVideos(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, full_name, profile_picture_url");
      return data ?? [];
    },
  });
  const clientMap = useMemo(() => new Map(clients.map((c: any) => [c.id, c])), [clients]);

  useEffect(() => {
    const ch = supabase
      .channel("admin-lift-videos")
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" }, () => {
        qc.invalidateQueries({ queryKey: ["lift-videos-admin"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments" }, () => {
        qc.invalidateQueries({ queryKey: ["lift-videos-admin"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtered = videos.filter((v) => {
    if (statusFilter !== "all" && v.status !== statusFilter) return false;
    if (search) {
      const c = clientMap.get(v.client_id) as any;
      const hay = `${v.exercise} ${v.training_day ?? ""} ${v.program_day ?? ""} ${c?.full_name ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const openVideo = openId ? videos.find((v) => v.id === openId) : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["lift-videos-admin"] });

  // Mark as viewed (clears admin bell) when an admin opens a video
  useEffect(() => {
    if (!openId) return;
    markAdminViewed(openId).catch(() => {});
  }, [openId]);

  return (
    <>
      <PageHeader title="Lift Videos" subtitle="Review submitted lift footage across all clients." />
      <div className="space-y-4 p-6 md:p-8">
        <Card className="border-border bg-card p-4 flex flex-wrap items-center gap-3">
          <Input className="max-w-xs" placeholder="Search by client, exercise, day…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {LIFT_VIDEO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} of {videos.length}</div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {filtered.length === 0 && (
              <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">No videos match.</Card>
            )}
            {filtered.map((v) => {
              const c = clientMap.get(v.client_id) as any;
              return (
                <Card
                  key={v.id}
                  className={`cursor-pointer p-4 transition ${openId === v.id ? "border-primary" : "border-border"} ${v.is_urgent ? "bg-destructive/5" : "bg-card"}`}
                  onClick={() => setOpenId(v.id)}
                >
                  <div className="flex items-start gap-3">
                    {c?.profile_picture_url ? (
                      <img src={c.profile_picture_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">{(c?.full_name ?? "?").slice(0, 1)}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold truncate">{c?.full_name ?? "Client"}</span>
                        <span className="text-xs text-muted-foreground">· {v.exercise}</span>
                        {v.is_urgent && <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3 w-3" />Urgent</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {v.training_day && <>{v.training_day} · </>}
                        Uploaded {formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}
                        {v.date_performed && <> · performed {format(parseISO(v.date_performed), "MMM d")}</>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={statusTone(v.status)}>{v.status}</Badge>
                        <Link to="/admin/clients/$id" params={{ id: v.client_id }} search={{ tab: "lift-videos" as any }} onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]">Profile <ExternalLink className="ml-1 h-3 w-3" /></Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div>
            {openVideo ? (
              <LiftVideoCard
                video={openVideo}
                role="admin"
                userId={user?.id ?? null}
                onChanged={refresh}
              />
            ) : (
              <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">
                <Video className="mx-auto mb-2 h-6 w-6" />
                Select a video to review.
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}