import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, FolderPlus, RefreshCw, FolderOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getClientDriveFolderInfo } from "@/lib/media-archive.functions";
import { provisionClientFolder } from "@/lib/drive.functions";

const SUBFOLDER_ORDER = [
  "Chat Media",
  "Lift Videos",
  "Check-In Videos",
  "Progress Photos",
  "Documents",
  "Agreements",
  "Other Media",
];

export function ClientDriveFolderPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const getInfo = useServerFn(getClientDriveFolderInfo);
  const provision = useServerFn(provisionClientFolder);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["client-drive-folder", clientId],
    queryFn: () => getInfo({ data: { clientId } }),
  });

  const subs = (data?.subfolders ?? {}) as Record<string, string>;
  const status = data?.status ?? "Not Created";

  const handleProvision = async (label: string) => {
    try {
      await provision({ data: { clientId } });
      toast.success(label);
      qc.invalidateQueries({ queryKey: ["client-drive-folder", clientId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Drive folder action failed");
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Google Drive Folder</div>
          <Badge variant={status === "Created" ? "default" : "outline"}>{status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.folder_url && (
            <Button asChild variant="outline" size="sm">
              <a href={data.folder_url} target="_blank" rel="noopener noreferrer">
                Open <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {!data?.folder_id ? (
            <Button size="sm" onClick={() => handleProvision("Drive folders created")}>
              <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> Create Drive Folders
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => handleProvision("Drive folders repaired")}>
              <FolderPlus className="mr-1.5 h-3.5 w-3.5" /> Repair / Sync
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !data?.folder_id ? (
        <p className="text-xs text-muted-foreground">
          This client doesn't have a Drive folder yet. Click <strong>Create Drive Folders</strong> to provision one inside your connected JF Effect Drive.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SUBFOLDER_ORDER.map((name) => {
            const id = subs[name];
            return (
              <div key={name} className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5">
                <span className="text-xs">{name}</span>
                {id ? (
                  <a
                    href={`https://drive.google.com/drive/folders/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Missing</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}
      {data?.last_error && (
        <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          Last error: {data.last_error}
        </div>
      )}
    </Card>
  );
}