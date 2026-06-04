import { createFileRoute } from "@tanstack/react-router";
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
import { AlertTriangle, Video, Image as ImageIcon, FileText as FileIcon } from "lucide-react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { listMediaItems, MEDIA_STATUSES, MEDIA_TYPES, statusTone, type MediaStatus, type MediaType } from "@/lib/media";
import { MediaItemCard } from "@/components/media-item-card";

export const Route = createFileRoute("/_authenticated/admin/media-review")({
  component: AdminMediaReview,
});

function typeIcon(t: string) {
  if (t === "Progress Photos") return <ImageIcon className="h-4 w-4" />;
  if (t === "Documents") return <FileIcon className="h-4 w-4" />;
  return <Video className="h-4 w-4" />;
}

function AdminMediaReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"all" | MediaStatus>("Pending Review");
  const [type, setType] = useState<"all" | MediaType>("all");
  const [urgent, setUrgent] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

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

  return (
    <>
      <PageHeader title="Media Review Inbox" subtitle="All client uploads needing coach attention." />
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
                    {c?.profile_picture_url ? <img src={c.profile_picture_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                      : <div className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">{(c?.full_name ?? "?").slice(0,1)}</div>}
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