import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, RotateCcw, Trash2, Search, Eye } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import {
  listArchived, restoreArchivedItems, permanentlyDeleteArchivedItems,
  archiveTypeOptions, type ArchivedRow,
} from "@/lib/archives.functions";

export const Route = createFileRoute("/_authenticated/admin/archives")({
  component: ArchivesPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Couldn't load archives: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

function ArchivesPage() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [confirmDelete, setConfirmDelete] = useState<{ items: ArchivedRow[] } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const listFn = useServerFn(listArchived);
  const restoreFn = useServerFn(restoreArchivedItems);
  const deleteFn = useServerFn(permanentlyDeleteArchivedItems);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["archives", typeFilter, search],
    queryFn: () => listFn({
      data: {
        types: typeFilter === "all" ? undefined : [typeFilter],
        search: search || undefined,
        limit: 300,
      },
    }),
  });

  const rows = (data?.rows ?? []) as ArchivedRow[];
  const rowKey = (r: ArchivedRow) => `${r.type}:${r.id}`;

  const allVisibleKeys = useMemo(() => rows.map(rowKey), [rows]);
  const allSelected = allVisibleKeys.length > 0 && allVisibleKeys.every((k) => selected.has(k));
  const someSelected = selected.size > 0;

  const toggleOne = (k: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((s) => {
      if (allSelected) return new Set();
      const next = new Set(s);
      allVisibleKeys.forEach((k) => next.add(k));
      return next;
    });
  };
  const clear = () => setSelected(new Set());

  const selectedItems = useMemo(
    () => rows.filter((r) => selected.has(rowKey(r))),
    [rows, selected],
  );

  const handleRestore = async (items: ArchivedRow[]) => {
    if (items.length === 0) return;
    try {
      const res = await restoreFn({ data: { items: items.map((i) => ({ type: i.type, id: i.id })) } });
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.length - ok;
      toast.success(`Restored ${ok}${fail ? `, ${fail} failed` : ""}`);
      clear();
      qc.invalidateQueries({ queryKey: ["archives"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
    }
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await deleteFn({
        data: {
          items: confirmDelete.items.map((i) => ({ type: i.type, id: i.id })),
          confirm: "DELETE",
        },
      });
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.length - ok;
      toast.success(`Permanently deleted ${ok}${fail ? `, ${fail} failed` : ""}`);
      setConfirmDelete(null);
      setDeleteConfirmText("");
      clear();
      qc.invalidateQueries({ queryKey: ["archives"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  };

  const bulkDeleteRequiresType = (confirmDelete?.items.length ?? 0) > 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Archive Manager"
        description="One place to view, restore, or permanently delete everything archived across the app."
        icon={Archive}
      />

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); clear(); }}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All archived</SelectItem>
              {archiveTypeOptions.map((o) => (
                <SelectItem key={o.type} value={o.type}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by name / title"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline">{rows.length} archived</Badge>
            {someSelected && (
              <>
                <Badge>{selected.size} selected</Badge>
                <Button variant="outline" size="sm" onClick={clear}>Clear</Button>
                <Button size="sm" onClick={() => handleRestore(selectedItems)}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => { setConfirmDelete({ items: selectedItems }); setDeleteConfirmText(""); }}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete permanently
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all visible"
                  />
                </th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Client</th>
                <th className="p-2 text-left">Archived</th>
                <th className="p-2 text-left">By</th>
                <th className="p-2 w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Nothing archived.</td></tr>
              )}
              {rows.map((r) => {
                const k = rowKey(r);
                const checked = selected.has(k);
                return (
                  <tr key={k} className="border-t hover:bg-muted/30">
                    <td className="p-2">
                      <Checkbox checked={checked} onCheckedChange={() => toggleOne(k)} />
                    </td>
                    <td className="p-2 font-medium">{r.name}</td>
                    <td className="p-2"><Badge variant="secondary">{r.type_label}</Badge></td>
                    <td className="p-2">
                      {r.client_id ? (
                        <Link to="/admin/clients/$id" params={{ id: r.client_id }} className="text-primary hover:underline">
                          {r.client_name ?? r.client_id.slice(0, 8)}
                        </Link>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {r.archived_at ? new Date(r.archived_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.archived_by_name ?? "—"}</td>
                    <td className="p-2">
                      <div className="flex justify-end gap-1">
                        {r.type === "clients" && (
                          <Button asChild size="icon" variant="ghost">
                            <Link to="/admin/clients/$id" params={{ id: r.id }} title="View"><Eye className="h-4 w-4" /></Link>
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" title="Restore" onClick={() => handleRestore([r])}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete permanently"
                          onClick={() => { setConfirmDelete({ items: [r] }); setDeleteConfirmText(""); }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) { setConfirmDelete(null); setDeleteConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDeleteRequiresType
                ? `Permanently delete ${confirmDelete?.items.length} archived items?`
                : "Permanently delete this item?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The records will be removed from the database.
              {bulkDeleteRequiresType && (
                <span className="block mt-2">
                  To confirm, type <strong>DELETE</strong> below.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {bulkDeleteRequiresType && (
            <Input
              autoFocus
              placeholder="Type DELETE to confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleteRequiresType && deleteConfirmText !== "DELETE"}
              onClick={performDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Permanently Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}