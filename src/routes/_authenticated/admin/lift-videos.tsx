import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listLiftVideos, markAdminViewed, deleteLiftVideos, statusTone,
  type LiftVideo, type LiftVideoStatus,
} from "@/lib/lift-videos";
import { LiftVideoCard } from "@/components/lift-video-card";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, Video, Trash2, Play, ChevronRight, ChevronLeft,
  MoreVertical, User, ExternalLink, Settings2, Inbox,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/lift-videos")({
  component: AdminLiftVideos,
});

type FilterKey = "all" | "new" | "in-review" | "reviewed" | "follow-up" | "urgent" | "archived";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "in-review", label: "In Review" },
  { key: "reviewed", label: "Reviewed" },
  { key: "follow-up", label: "Needs Follow-Up" },
  { key: "urgent", label: "Urgent" },
  { key: "archived", label: "Archived" },
];

function matchesFilter(v: LiftVideo, f: FilterKey): boolean {
  switch (f) {
    case "all": return v.status !== "Archived";
    case "new": return v.status === "New Upload" || v.status === "Awaiting Review";
    case "in-review": return v.status === "Watched" || v.status === "Commented";
    case "reviewed": return v.status === "Reviewed";
    case "follow-up": return v.status === "Needs Follow-Up";
    case "urgent": return v.is_urgent && v.status !== "Archived";
    case "archived": return v.status === "Archived";
  }
}

type Submission = {
  key: string;
  clientId: string;
  clips: LiftVideo[];
  latest: LiftVideo;
  isUrgent: boolean;
  dayLabel: string | null;
  status: LiftVideoStatus;
};

function groupSubmissions(videos: LiftVideo[]): Submission[] {
  const buckets = new Map<string, LiftVideo[]>();
  for (const v of videos) {
    const day = v.training_day === "Custom" ? v.custom_training_day : v.training_day;
    const key = v.batch_id
      ? `b:${v.batch_id}`
      : `c:${v.client_id}|${day ?? ""}|${v.date_performed ?? v.created_at.slice(0, 10)}`;
    const list = buckets.get(key) ?? [];
    list.push(v);
    buckets.set(key, list);
  }
  const subs: Submission[] = [];
  for (const [key, clips] of buckets) {
    clips.sort((a, b) => (a.batch_index ?? 0) - (b.batch_index ?? 0) || a.created_at.localeCompare(b.created_at));
    const latest = clips.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    const isUrgent = clips.some((c) => c.is_urgent);
    const day = latest.training_day === "Custom" ? latest.custom_training_day : latest.training_day;
    // Submission status: surface the most-pending status
    const order: LiftVideoStatus[] = [
      "Needs Follow-Up", "New Upload", "Awaiting Review", "Watched",
      "Commented", "Reviewed", "Archived",
    ];
    const status = order.find((s) => clips.some((c) => c.status === s)) ?? latest.status;
    subs.push({ key, clientId: latest.client_id, clips, latest, isUrgent, dayLabel: day ?? null, status });
  }
  subs.sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
  return subs;
}

function AdminLiftVideos() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_videos" },
        () => qc.invalidateQueries({ queryKey: ["lift-videos-admin"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "lift_video_comments" },
        () => qc.invalidateQueries({ queryKey: ["lift-videos-admin"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const submissions = useMemo(() => {
    const filtered = videos.filter((v) => {
      if (!matchesFilter(v, filter)) return false;
      if (search) {
        const c = clientMap.get(v.client_id) as any;
        const hay = `${v.exercise} ${v.training_day ?? ""} ${v.program_day ?? ""} ${c?.full_name ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
    return groupSubmissions(filtered);
  }, [videos, filter, search, clientMap]);

  const openSub = openKey ? submissions.find((s) => s.key === openKey) ?? null : null;
  const activeClip: LiftVideo | null =
    openSub
      ? (openSub.clips.find((c) => c.id === activeClipId) ?? openSub.clips[0] ?? null)
      : null;

  // Reset active clip when switching submissions
  useEffect(() => {
    if (openSub) setActiveClipId(openSub.clips[0]?.id ?? null);
    else setActiveClipId(null);
  }, [openKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark active clip as viewed
  useEffect(() => {
    if (activeClip) markAdminViewed(activeClip.id).catch(() => {});
  }, [activeClip?.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["lift-videos-admin"] });

  // Bulk selection (manage mode)
  const toggleOne = (key: string) => setSelected((p) => {
    const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const allSelected = submissions.length > 0 && submissions.every((s) => selected.has(s.key));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(submissions.map((s) => s.key)));
  };
  const doDelete = async () => {
    const subs = submissions.filter((s) => selected.has(s.key));
    const ids = subs.flatMap((s) => s.clips.map((c) => c.id));
    setDeleting(true);
    try {
      await deleteLiftVideos(ids);
      toast.success(`Deleted ${subs.length} submission${subs.length === 1 ? "" : "s"}`);
      if (openKey && selected.has(openKey)) setOpenKey(null);
      setSelected(new Set());
      setManageMode(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader title="Lift Video Review" subtitle="Coaching review inbox — tap a submission to review." />

      <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
        {/* Mobile: show detail full-screen when a submission is open */}
        <div className={cn("lg:hidden", openSub ? "block" : "hidden")}>
          {openSub && activeClip && (
            <ReviewDetail
              sub={openSub}
              activeClip={activeClip}
              onSelectClip={setActiveClipId}
              client={clientMap.get(openSub.clientId)}
              userId={user?.id ?? null}
              onBack={() => setOpenKey(null)}
              onChanged={refresh}
              isMobile
            />
          )}
        </div>

        {/* Inbox + (desktop) detail split */}
        <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]", openSub && "max-lg:hidden")}>
          {/* Inbox column */}
          <div className="space-y-3">
            <Card className="border-border bg-card p-3 space-y-3">
              <Input
                placeholder="Search client, lift, or day"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10"
              />
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      filter === f.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {submissions.length} submission{submissions.length === 1 ? "" : "s"}
                </span>
                <Button
                  size="sm"
                  variant={manageMode ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => { setManageMode((m) => !m); setSelected(new Set()); }}
                >
                  <Settings2 className="mr-1 h-3 w-3" />
                  {manageMode ? "Done" : "Manage"}
                </Button>
              </div>
              {manageMode && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/40 p-2">
                  <label className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                    />
                    Select all
                  </label>
                  <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                  <div className="ml-auto">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="destructive" disabled={selected.size === 0 || deleting} className="h-7">
                          <Trash2 className="mr-1 h-3 w-3" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete {selected.size} submission{selected.size === 1 ? "" : "s"}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Removes these video submissions from the review inbox. Files in Google Drive are not affected. This will not delete the client.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={doDelete}>Delete submissions</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              )}
            </Card>

            <div className="space-y-2 pb-28 lg:pb-6">
              {submissions.length === 0 && (
                <Card className="border-border bg-card p-10 text-center">
                  <Inbox className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                  <div className="text-sm font-medium">Inbox empty</div>
                  <div className="text-xs text-muted-foreground">No submissions match your filters.</div>
                </Card>
              )}
              {submissions.map((s) => (
                <SubmissionRow
                  key={s.key}
                  sub={s}
                  client={clientMap.get(s.clientId)}
                  active={openKey === s.key}
                  manageMode={manageMode}
                  selected={selected.has(s.key)}
                  onToggle={() => toggleOne(s.key)}
                  onOpen={() => setOpenKey(s.key)}
                />
              ))}
            </div>
          </div>

          {/* Desktop detail panel */}
          <div className="hidden lg:block">
            {openSub && activeClip ? (
              <div className="sticky top-4">
                <ReviewDetail
                  sub={openSub}
                  activeClip={activeClip}
                  onSelectClip={setActiveClipId}
                  client={clientMap.get(openSub.clientId)}
                  userId={user?.id ?? null}
                  onBack={() => setOpenKey(null)}
                  onChanged={refresh}
                />
              </div>
            ) : (
              <Card className="border-border bg-card p-14 text-center">
                <Video className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <div className="text-base font-semibold">Select a video to review</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Choose a submission from the inbox on the left.
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------- Submission row ------------------------- */

function ClientAvatar({ client, size = 40 }: { client: any; size?: number }) {
  const initials = (client?.full_name ?? "?").trim().slice(0, 1).toUpperCase();
  return client?.profile_picture_url ? (
    <img
      src={client.profile_picture_url}
      alt=""
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-foreground"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}

function ThumbBlock({ count, urgent }: { count: number; urgent: boolean }) {
  return (
    <div
      className={cn(
        "relative grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-md border bg-black",
        urgent ? "border-destructive/40" : "border-border"
      )}
    >
      <Play className="h-6 w-6 text-white/70" />
      <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/90">
        {count > 1 ? `${count} clips` : "Video"}
      </div>
    </div>
  );
}

function SubmissionRow({
  sub, client, active, manageMode, selected, onToggle, onOpen,
}: {
  sub: Submission;
  client: any;
  active: boolean;
  manageMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const exerciseLabel = sub.clips.length > 1 ? `${sub.clips.length} clips` : sub.latest.exercise || "Video";
  return (
    <Card
      onClick={() => { if (!manageMode) onOpen(); }}
      className={cn(
        "group cursor-pointer p-3 transition hover:border-primary/50",
        active ? "border-primary" : "border-border",
        sub.isUrgent && "bg-destructive/5"
      )}
    >
      <div className="flex items-center gap-3">
        {manageMode && (
          <div onClick={(e) => e.stopPropagation()} className="pl-1">
            <Checkbox checked={selected} onCheckedChange={onToggle} />
          </div>
        )}
        <ThumbBlock count={sub.clips.length} urgent={sub.isUrgent} />
        <ClientAvatar client={client} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{client?.full_name ?? "Client"}</span>
            {sub.isUrgent && (
              <Badge variant="outline" className="h-5 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] text-destructive">
                <AlertTriangle className="mr-0.5 h-3 w-3" />Urgent
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {sub.dayLabel && <>{sub.dayLabel} · </>}{exerciseLabel}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", statusTone(sub.status))}>
              {sub.status}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(parseISO(sub.latest.created_at), { addSuffix: true })}
              {sub.latest.date_performed && <> · {format(parseISO(sub.latest.date_performed), "MMM d")}</>}
            </span>
          </div>
        </div>
        {!manageMode && (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
        )}
      </div>
    </Card>
  );
}

/* -------------------------- Review detail -------------------------- */

function ReviewDetail({
  sub, activeClip, onSelectClip, client, userId, onBack, onChanged, isMobile,
}: {
  sub: Submission;
  activeClip: LiftVideo;
  onSelectClip: (id: string) => void;
  client: any;
  userId: string | null;
  onBack: () => void;
  onChanged: () => void;
  isMobile?: boolean;
}) {
  return (
    <div className="space-y-4 pb-28 lg:pb-4">
      {/* Header */}
      <Card className="border-border bg-card p-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <Button size="sm" variant="ghost" onClick={onBack} className="h-8 px-2">
              <ChevronLeft className="mr-1 h-4 w-4" /> Inbox
            </Button>
          )}
          <ClientAvatar client={client} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{client?.full_name ?? "Client"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {sub.dayLabel && <>{sub.dayLabel} · </>}
              {sub.clips.length} clip{sub.clips.length === 1 ? "" : "s"} · Uploaded{" "}
              {formatDistanceToNow(parseISO(sub.latest.created_at), { addSuffix: true })}
            </div>
          </div>
          <Badge variant="outline" className={cn("h-6", statusTone(sub.status))}>{sub.status}</Badge>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link
                  to="/admin/clients/$id"
                  params={{ id: sub.clientId }}
                  search={{ tab: "lift-videos" as any }}
                >
                  <User className="mr-2 h-4 w-4" /> Open Client Profile
                </Link>
              </DropdownMenuItem>
              {activeClip.video_url && (
                <DropdownMenuItem asChild>
                  <a href={activeClip.video_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Open in Drive
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Clip switcher */}
        {sub.clips.length > 1 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sub.clips.map((c, i) => (
              <button
                key={c.id}
                onClick={() => onSelectClip(c.id)}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition",
                  c.id === activeClip.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
                )}
              >
                Clip {i + 1}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Reuse existing player + feedback */}
      <LiftVideoCard
        key={activeClip.id}
        video={activeClip}
        role="admin"
        userId={userId}
        onChanged={onChanged}
      />
    </div>
  );
}