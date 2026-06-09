import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Loader2, MessageCircle, Trash2, RotateCcw, ExternalLink, FileText, ClipboardList,
} from "lucide-react";
import {
  listAllClientActionRequests,
  deleteClientActionRequest,
  resendClientActionRequest,
  actionStatus,
  actionKindLabel,
  getFileSignedUrl,
} from "@/lib/client-action-requests";
import { ClientActionRequestComposer } from "@/components/client-action-request-composer";

export const Route = createFileRoute("/_authenticated/admin/client-action-requests")({
  component: AdminClientActionRequests,
});

function AdminClientActionRequests() {
  const [tab, setTab] = useState<string>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const qc = useQueryClient();

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["client-action-requests", "all"],
    queryFn: () => listAllClientActionRequests(),
  });

  const items = all.filter((r) => (tab === "open" ? !r.completed_at : !!r.completed_at));
  const selected = all.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Client Action Requests"
        subtitle="Send forms, links, and files. Pops up for the client until they confirm complete."
        actions={
          <Button onClick={() => setComposerOpen(true)} className="bg-gradient-primary font-bold">
            <Plus className="mr-1 h-4 w-4" /> New Action Request
          </Button>
        }
      />
      <div className="grid gap-4 p-4 md:grid-cols-[360px_1fr] md:p-6">
        <div>
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelectedId(null); }}>
            <TabsList className="w-full">
              <TabsTrigger value="open" className="flex-1">Open</TabsTrigger>
              <TabsTrigger value="completed" className="flex-1">Completed</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-3">
              {isLoading ? (
                <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />
              ) : items.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">
                  {tab === "open" ? "No open requests. Click \"New Action Request\" above." : "No completed requests yet."}
                </Card>
              ) : (
                <ul className="space-y-2">
                  {items.map((r) => {
                    const st = actionStatus(r);
                    return (
                      <li key={r.id}>
                        <button
                          onClick={() => setSelectedId(r.id)}
                          className={`w-full rounded-md border p-3 text-left transition ${
                            selectedId === r.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-bold">{r.client?.full_name ?? "Client"}</div>
                            <Badge className={st.tone + " border text-[10px]"}>{st.label}</Badge>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{r.title} · {actionKindLabel(r)}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Sent {new Date(r.created_at).toLocaleString()}
                            {r.seen_at && <> · Viewed {new Date(r.seen_at).toLocaleString()}</>}
                            {r.completed_at && <> · Completed {new Date(r.completed_at).toLocaleString()}</>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div>
          {!selected ? (
            <Card className="p-6 text-sm text-muted-foreground">Select a request to view.</Card>
          ) : (
            <ActionDetail
              request={selected}
              onDeleted={() => {
                setSelectedId(null);
                qc.invalidateQueries({ queryKey: ["client-action-requests"] });
              }}
            />
          )}
        </div>
      </div>

      <ClientActionRequestComposer open={composerOpen} onOpenChange={setComposerOpen} />
    </>
  );
}

function ActionDetail({ request, onDeleted }: { request: any; onDeleted: () => void }) {
  const st = actionStatus(request);
  const qc = useQueryClient();
  const [resending, setResending] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  async function viewFile() {
    if (!request.file_path) return;
    try {
      const url = await getFileSignedUrl(request.file_path);
      setFileUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e.message ?? "Could not open file");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold">{request.client?.full_name ?? "Client"} — {request.title}</div>
            <div className="text-xs text-muted-foreground">
              {actionKindLabel(request)}
              {request.due_date ? ` · Due ${request.due_date}` : ""}
              {` · Sent ${new Date(request.created_at).toLocaleString()}`}
            </div>
          </div>
          <Badge className={st.tone + " border"}>{st.label}</Badge>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div>Sent: <span className="text-foreground">{new Date(request.created_at).toLocaleString()}</span></div>
          <div>Viewed: <span className="text-foreground">{request.seen_at ? new Date(request.seen_at).toLocaleString() : "—"}</span></div>
          <div>Completed: <span className="text-foreground">{request.completed_at ? new Date(request.completed_at).toLocaleString() : "—"}</span></div>
        </div>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Message</div>
        <div className="mt-2 whitespace-pre-wrap text-sm">{request.message}</div>
        {request.priority && (
          <div className="mt-3 text-xs text-muted-foreground">Priority: <span className="font-bold uppercase">{request.priority}</span></div>
        )}
      </Card>

      <Card className="border-border bg-card p-4 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Actions</div>
        {request.native_form && (
          <div className="flex items-center gap-2 text-sm">
            <ClipboardList className="h-4 w-4 text-primary" />
            Native form: <span className="font-bold">{request.native_form.title}</span>
          </div>
        )}
        {request.external_form_url && (
          <a href={request.external_form_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            External form <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {request.link_url && (
          <a href={request.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline">
            {request.link_label || "Open link"} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {request.file_path && (
          <Button variant="outline" size="sm" onClick={viewFile}>
            <FileText className="mr-1 h-4 w-4" /> {fileUrl ? "Re-open" : "View"} {request.file_name ?? "file"}
          </Button>
        )}
        {!request.native_form && !request.external_form_url && !request.link_url && !request.file_path && (
          <div className="text-xs text-muted-foreground">No action attached.</div>
        )}
      </Card>

      {request.internal_notes && (
        <Card className="border-amber-500/20 bg-amber-500/5 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">Admin-only Notes</div>
          <div className="mt-2 whitespace-pre-wrap text-sm">{request.internal_notes}</div>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Link to="/admin/messages" search={{ clientId: request.client_id } as any}>
          <Button variant="outline" size="sm"><MessageCircle className="mr-1 h-4 w-4" /> Open Messenger</Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={resending}
          onClick={async () => {
            setResending(true);
            try {
              await resendClientActionRequest(request.id);
              toast.success("Resent — status reset");
              qc.invalidateQueries({ queryKey: ["client-action-requests"] });
              qc.invalidateQueries({ queryKey: ["client-actions-for-client", request.client_id] });
            } catch (e: any) {
              toast.error(e.message ?? "Could not resend");
            } finally {
              setResending(false);
            }
          }}
        >
          {resending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
          Resend
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            if (!confirm("Delete this action request?")) return;
            try {
              await deleteClientActionRequest(request.id);
              toast.success("Deleted");
              onDeleted();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Delete
        </Button>
      </div>
    </div>
  );
}