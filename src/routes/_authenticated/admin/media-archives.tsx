import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, RotateCcw, Search, Eye } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listMediaArchives, retryArchive, setArchiveVisibility } from "@/lib/media-archive.functions";

export const Route = createFileRoute("/_authenticated/admin/media-archives")({
  component: MediaArchivesPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Couldn't load media archives: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

const STATUS_COLOR: Record<string, string> = {
  queued: "outline",
  archiving: "secondary",
  archived: "default",
  failed: "destructive",
  restored: "secondary",
};

const SOURCE_LABEL: Record<string, string> = {
  message_attachment: "Chat",
  lift_video: "Lift Video",
  media_item: "Media Item",
};

function MediaArchivesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");

  const listFn = useServerFn(listMediaArchives);
  const retryFn = useServerFn(retryArchive);
  const visFn = useServerFn(setArchiveVisibility);

  const { data, isLoading } = useQuery({
    queryKey: ["media-archives", status, source, search],
    queryFn: () => listFn({
      data: {
        status: status as any,
        sourceType: source as any,
        search: search || undefined,
        limit: 300,
      },
    }),
  });

  const rows = (data?.rows ?? []) as any[];

  const handleRetry = async (id: string) => {
    try {
      const r: any = await retryFn({ data: { archiveId: id } });
      r.ok ? toast.success("Archived to Drive") : toast.error(r.error ?? "Retry failed");
      qc.invalidateQueries({ queryKey: ["media-archives"] });
    } catch (e: any) { toast.error(e?.message ?? "Retry failed"); }
  };

  const handleVisibility = async (id: string, v: string) => {
    try {
      await visFn({ data: { archiveId: id, visibility: v as any } });
      qc.invalidateQueries({ queryKey: ["media-archives"] });
    } catch (e: any) { toast.error(e?.message ?? "Update failed"); }
  };

  return (
    <>
      <PageHeader
        title="Media Archives"
        subtitle="Every media file that has been offloaded to Google Drive."
      />
      <div className="p-6 space-y-4">
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search file name…"
                className="pl-8"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="archiving">Archiving</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="message_attachment">Chat</SelectItem>
                <SelectItem value="lift_video">Lift Videos</SelectItem>
                <SelectItem value="media_item">Media Items</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No archives match these filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Visibility</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 align-top">
                    <td className="px-3 py-2">
                      <Link to="/admin/clients/$id" params={{ id: r.client_id }} className="hover:underline">
                        {r.clients?.full_name ?? r.client_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">{SOURCE_LABEL[r.source_type] ?? r.source_type}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="truncate max-w-[280px]">{r.file_name ?? "—"}</div>
                      {r.drive_folder_path && (
                        <div className="text-[10px] text-muted-foreground truncate max-w-[280px]">{r.drive_folder_path}</div>
                      )}
                      {r.last_error && (
                        <div className="mt-1 text-[10px] text-destructive truncate max-w-[280px]">{r.last_error}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {r.archived_at ? new Date(r.archived_at).toLocaleDateString() : new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={(STATUS_COLOR[r.archive_status] as any) ?? "outline"} className="capitalize">
                        {r.archive_status}
                      </Badge>
                      {r.attempts > 1 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{r.attempts} attempts</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select value={r.visibility} onValueChange={(v) => handleVisibility(r.id, v)}>
                        <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="follow_original">Follow original</SelectItem>
                          <SelectItem value="visible_to_client">Visible to client</SelectItem>
                          <SelectItem value="admin_only">Admin only</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {r.drive_url && (
                          <Button asChild variant="outline" size="sm" title="Open in Drive">
                            <a href={r.drive_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        {(r.archive_status === "failed" || r.archive_status === "queued") && (
                          <Button variant="outline" size="sm" onClick={() => handleRetry(r.id)} title="Retry">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}