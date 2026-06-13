import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Video, Image as ImageIcon, FileText as FileIcon, Trash2 } from "lucide-react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { listMediaItems, deleteMediaItems, MEDIA_STATUSES, MEDIA_TYPES, statusTone, type MediaStatus, type MediaType } from "@/lib/media";
import { MediaItemCard } from "@/components/media-item-card";
import { UserAvatar } from "@/components/user-avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/media-review")({
  component: MediaReviewRedirect,
});

function MediaReviewRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/content", search: { tab: "inbox" } as any, replace: true });
  }, [navigate]);
  return null;
}

function typeIcon(t: string) {
  if (t === "Progress Photos") return <ImageIcon className="h-4 w-4" />;
  if (t === "Documents") return <FileIcon className="h-4 w-4" />;
  return <Video className="h-4 w-4" />;
}

export function AdminMediaReview({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"all" | MediaStatus>("Pending Review");
  const [type, setType] = useState<"all" | MediaType>("all");
  const [urgent, setUrgent] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["media-inbox", status, type, urgent],
    queryFn: () => listMediaItems({ status, type, urgentOnly: urgent }),
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
    const ch = supabase.channel("media-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "media_items" }, () => {
        qc.invalidateQueries({ queryKey: ["media-inbox"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtered = items.filter((v: any) => {
    if (!search) return true;
    const c = clientMap.get(v.client_id) as any;
    return `${c?.full_name ?? ""} ${v.file_name ?? ""} ${v.media_type}`.toLowerCase().includes(search.toLowerCase());
  });
  const open = openId ? items.find((v: any) => v.id === openId) : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["media-inbox"] });

  const allSelected = filtered.length > 0 && filtered.every((v: any) => selected.has(v.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((v: any) => v.id)));
  };
  const doDelete = async () => {
    const ids = Array.from(selected);
    setDeleting(true);
    try {
      await deleteMediaItems(ids);
      toast.success(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`);
      if (openId && selected.has(openId)) setOpenId(null);
      setSelected(new Set());
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {!embedded && <PageHeader title="Media Review Inbox" subtitle="All client uploads needing coach attention." />}
      <div className="space-y-4 p-4 md:p-8">
        <Card className="border-border bg-card p-4 flex flex-wrap items-center gap-3">
          <Input className="max-w-xs" placeholder="Search client, file…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {MEDIA_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => setType(v as any)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All media types</SelectItem>
              {MEDIA_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm"><Switch checked={urgent} onCheckedChange={setUrgent} /> Urgent only</label>
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} shown</div>
        </Card>

        <Card className="border-border bg-card p-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} />
            Select all ({filtered.length})
          </label>
          <div className="text-xs text-muted-foreground">{selected.size} selected</div>
          <div className="ml-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={selected.size === 0 || deleting}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete selected
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} item{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>This removes the metadata records from the inbox. Files in Google Drive are not affected.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            {filtered.length === 0 && (
              <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">Nothing here. Inbox zero!</Card>
            )}
            {filtered.map((v: any) => {
              const c = clientMap.get(v.client_id) as any;
              return (
                <Card key={v.id} className={`cursor-pointer p-3 transition ${openId === v.id ? "border-primary" : "border-border"} ${v.urgent_flag ? "bg-rose-500/5" : "bg-card"}`} onClick={() => setOpenId(v.id)}>
                  <div className="flex items-start gap-3 min-w-0">
                    <div onClick={(e) => e.stopPropagation()} className="pt-1">
                      <Checkbox checked={selected.has(v.id)} onCheckedChange={() => toggleOne(v.id)} />
                    </div>
                    <UserAvatar src={c?.profile_picture_url} name={c?.full_name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold truncate">{c?.full_name ?? "Client"}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">{typeIcon(v.media_type)} {v.media_type}</span>
                        {v.urgent_flag && <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-300"><AlertTriangle className="mr-1 h-3 w-3" />Urgent</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{v.file_name}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="outline" className={statusTone(v.status)}>{v.status}</Badge>
                        <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(parseISO(v.created_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <div>
            {open ? <MediaItemCard item={open} role="admin" userId={user?.id ?? null} onChanged={refresh} />
              : <Card className="border-border bg-card p-10 text-center text-sm text-muted-foreground">Select an upload to review.</Card>}
          </div>
        </div>
      </div>
    </>
  );
}