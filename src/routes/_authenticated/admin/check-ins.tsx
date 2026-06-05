import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Plus, ExternalLink, Copy, MoreHorizontal, Pencil, Archive, Trash2, ArchiveRestore, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { listCheckInLinks, archiveCheckInLink, deleteCheckInLink, type CheckInLink } from "@/lib/check-ins";
import { CheckInLinkDialog } from "@/components/check-in-link-dialog";
import { DoubleConfirmDeleteDialog } from "@/components/double-confirm-delete-dialog";

export const Route = createFileRoute("/_authenticated/admin/check-ins")({ component: CheckInsPage });

function CheckInsPage() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CheckInLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CheckInLink | null>(null);

  const { data: links = [], isLoading } = useQuery({
    queryKey: ["check-in-links", showArchived],
    queryFn: () => listCheckInLinks({ includeArchived: showArchived }),
  });

  function refresh() { qc.invalidateQueries({ queryKey: ["check-in-links"] }); }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
  }

  return (
    <>
      <PageHeader title="Check-Ins" subtitle="Manage reusable check-in links and assign them to clients." />
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant={showArchived ? "outline" : "default"} size="sm" onClick={() => setShowArchived(false)}>Active</Button>
            <Button variant={showArchived ? "default" : "outline"} size="sm" onClick={() => setShowArchived(true)}>Include archived</Button>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> New Check-In Link
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : links.length === 0 ? (
          <Card className="border-border bg-card p-8 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-3 font-semibold">No check-in links yet</div>
            <p className="text-sm text-muted-foreground">Add your first Fillout check-in link to assign to clients.</p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {links.map((link) => (
              <Card key={link.id} className="border-border bg-card p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-bold truncate">{link.title}</div>
                      <Badge variant="outline" className="text-xs">{link.check_in_type}{link.custom_type ? `: ${link.custom_type}` : ""}</Badge>
                      <Badge variant="outline" className="text-xs">{link.frequency}</Badge>
                      {link.due_day && <Badge variant="outline" className="text-xs">Due: {link.due_day}</Badge>}
                      {!link.active && <Badge variant="outline" className="text-xs border-amber-500/40 bg-amber-500/10 text-amber-300">Inactive</Badge>}
                      {link.archived && <Badge variant="outline" className="text-xs">Archived</Badge>}
                      {link.require_video && <Badge variant="outline" className="text-xs">Video required</Badge>}
                      {link.require_photos && <Badge variant="outline" className="text-xs">Photos required</Badge>}
                    </div>
                    {link.description && <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>}
                    <div className="mt-1 text-xs text-muted-foreground truncate">{link.url}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => copyUrl(link.url)}><Copy className="h-3.5 w-3.5" /></Button>
                    <a href={link.url} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</Button></a>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditing(link); setDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={async () => { await archiveCheckInLink(link.id, !link.archived); refresh(); toast.success(link.archived ? "Restored" : "Archived"); }}>
                          {link.archived ? <><ArchiveRestore className="mr-2 h-4 w-4" />Restore</> : <><Archive className="mr-2 h-4 w-4" />Archive</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(link)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CheckInLinkDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSaved={refresh} />
      <DoubleConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        title="Delete check-in link?"
        message={`This will permanently remove "${deleteTarget?.title}". Clients assigned to it will lose this link.`}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteCheckInLink(deleteTarget.id);
          setDeleteTarget(null);
          refresh();
          toast.success("Deleted");
        }}
      />
    </>
  );
}