import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Copy, ExternalLink, Trash2, Pencil, Sparkles, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { OfferForm } from "@/components/offer-form";
import { AssignOfferDialog } from "@/components/assign-offer-dialog";
import { OfferDetailDialog } from "@/components/offer-detail-dialog";
import { Eye } from "lucide-react";
import { OFFER_TEMPLATES, blankOffer, type OfferLike } from "@/lib/offers";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { DoubleConfirmDeleteDialog } from "@/components/double-confirm-delete-dialog";

export const Route = createFileRoute("/_authenticated/admin/offers")({
  component: OffersPage,
});

function OffersPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<OfferLike | null>(null);
  const [assigning, setAssigning] = useState<any | null>(null);
  const [viewing, setViewing] = useState<any | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [deletingIds, setDeletingIds] = useState<string[] | null>(null);

  const { data: offers = [] } = useQuery({
    queryKey: ["offers", { archived: showArchived }],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").eq("archived", showArchived).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const visibleIds = useMemo(() => offers.map((o: any) => o.id), [offers]);
  const sel = useBulkSelection(visibleIds);

  // Look up purchase-record counts for whichever offers are selected or about to delete
  const idsForUsage = useMemo(() => Array.from(new Set([...(sel.selectedIds ?? []), ...(deletingIds ?? [])])), [sel.selectedIds, deletingIds]);
  const { data: usage = {} } = useQuery({
    queryKey: ["offer-usage", idsForUsage.sort().join(",")],
    enabled: idsForUsage.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("purchase_records").select("offer_id").in("offer_id", idsForUsage);
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) {
        if (!r.offer_id) continue;
        map[r.offer_id] = (map[r.offer_id] ?? 0) + 1;
      }
      return map;
    },
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const archiveOne = async (id: string) => {
    const { error } = await supabase.from("offers").update({ archived: true, status: "Archived" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Archived");
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const unarchiveOne = async (id: string) => {
    const { error } = await supabase.from("offers").update({ archived: false, status: "Draft" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Restored");
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const archiveBulk = async () => {
    const ids = sel.selectedIds;
    if (ids.length === 0) return;
    const { error } = await supabase.from("offers").update({ archived: true, status: "Archived" }).in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Archived ${ids.length} offer${ids.length === 1 ? "" : "s"}`);
    sel.clear();
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const performDelete = async () => {
    const ids = deletingIds ?? [];
    if (ids.length === 0) return;
    const { error } = await supabase.from("offers").delete().in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`Deleted ${ids.length} offer${ids.length === 1 ? "" : "s"}`);
    sel.clear();
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const duplicate = async (o: any) => {
    const { id, created_at, updated_at, version, ...rest } = o;
    const { error } = await supabase.from("offers").insert({ ...rest, name: `${o.name} (copy)`, status: "Draft" });
    if (error) return toast.error(error.message);
    toast.success("Duplicated");
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const createFromTemplate = async (tpl: any) => {
    const merged = { ...blankOffer(), ...tpl };
    const { error } = await supabase.from("offers").insert(merged as any);
    if (error) return toast.error(error.message);
    toast.success(`Created "${tpl.name}"`);
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const save = async (v: OfferLike) => {
    if ((editing as any)?.id) {
      const { id, created_at, updated_at, version, ...patch } = v as any;
      const { error } = await supabase.from("offers").update(patch).eq("id", (editing as any).id);
      if (error) return toast.error(error.message);
      toast.success("Saved");
    } else {
      const { error } = await supabase.from("offers").insert(v as any);
      if (error) return toast.error(error.message);
      toast.success("Offer created");
    }
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const deletingUsage = (deletingIds ?? []).reduce((sum, id) => sum + (usage[id] ?? 0), 0);
  const strongWarning = deletingUsage > 0
    ? `${deletingUsage} purchase record${deletingUsage === 1 ? "" : "s"} are linked to ${deletingIds && deletingIds.length === 1 ? "this offer" : "these offers"}. Purchase records will be kept, but the offer link will be lost. Archive is safer.`
    : undefined;

  return (
    <>
      <PageHeader
        title="Offers & Products"
        subtitle="Admin-only price card. Clients only see offers you assign to them."
        actions={
          <>
            <Link to="/admin/purchases"><Button variant="outline">Purchase Records</Button></Link>
            <Button className="bg-gradient-primary font-bold uppercase tracking-wide" onClick={() => setEditing(blankOffer())}>
              <Plus className="mr-2 h-4 w-4" /> New offer
            </Button>
          </>
        }
      />
      <div className="p-6 md:p-8 space-y-8">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Start from a template</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {OFFER_TEMPLATES.map((t) => (
              <Card key={t.name} className="border-border bg-card p-4 space-y-2">
                <div className="text-sm font-bold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.offer_type}</div>
                <Button size="sm" variant="outline" className="w-full" onClick={() => createFromTemplate(t)}>
                  <Plus className="mr-1.5 h-3 w-3" /> Use template
                </Button>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
              {showArchived ? "Archived offers" : "Price Card / Offer Menu"}
            </h2>
            <div className="flex items-center gap-3">
              {offers.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={sel.allSelected ? true : sel.someSelected ? "indeterminate" : false}
                    onCheckedChange={() => sel.toggleAll()}
                  />
                  Select all visible
                </label>
              )}
              <Button size="sm" variant="outline" onClick={() => { sel.clear(); setShowArchived((v) => !v); }}>
                {showArchived ? "Show active" : "Show archived"}
              </Button>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Admin-only · {offers.length} {showArchived ? "archived" : "active"}
              </span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {offers.length === 0 && (
              <div className="col-span-full rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                {showArchived ? "No archived offers." : "No offers yet. Pick a template above or create one from scratch."}
              </div>
            )}
            {offers.map((o: any) => (
              <Card
                key={o.id}
                className={`border-border bg-card p-5 space-y-3 transition ${sel.isSelected(o.id) ? "ring-2 ring-primary border-primary" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Checkbox
                      className="mt-1"
                      checked={sel.isSelected(o.id)}
                      onCheckedChange={(c) => sel.setOne(o.id, !!c)}
                      aria-label={`Select ${o.name}`}
                    />
                    <div className="min-w-0">
                      <div className="font-bold truncate">{o.name}</div>
                      <div className="text-xs text-muted-foreground">{o.offer_type} · v{o.version ?? 1}</div>
                    </div>
                  </div>
                  <Badge variant={o.status === "Active" ? "default" : "outline"} className={o.status === "Active" ? "bg-gradient-primary" : ""}>{o.status}</Badge>
                </div>
                {(o.full_payable_amount ?? o.price) != null && (
                  <div className="text-2xl font-black">{o.currency ?? "USD"} {Number(o.full_payable_amount ?? o.price).toLocaleString()}</div>
                )}
                {o.payment_structure && <div className="text-xs text-muted-foreground">{o.payment_structure}</div>}
                {o.short_description && <p className="text-sm text-muted-foreground line-clamp-2">{o.short_description}</p>}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => setAssigning(o)}>Assign to client</Button>
                  <Button size="sm" variant="outline" onClick={() => setViewing(o)}><Eye className="h-3 w-3" /></Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(o)}><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicate(o)}><Copy className="h-3 w-3" /></Button>
                  {o.stripe_payment_link && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copy(o.stripe_payment_link!)} title="Copy Stripe link"><Copy className="h-3 w-3" /></Button>
                      <a href={o.stripe_payment_link} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></a>
                    </>
                  )}
                  {showArchived ? (
                    <Button size="sm" variant="ghost" onClick={() => unarchiveOne(o.id)} title="Restore"><ArchiveRestore className="h-3 w-3" /></Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => archiveOne(o.id)} title="Archive"><Archive className="h-3 w-3" /></Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeletingIds([o.id])}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <BulkActionBar count={sel.count} onClear={() => sel.clear()} label={sel.count === 1 ? "offer selected" : "offers selected"}>
          <Button size="sm" variant="outline" onClick={archiveBulk} className="h-7">
            <Archive className="h-3.5 w-3.5 mr-1" /> Archive
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setDeletingIds(sel.selectedIds)} className="h-7">
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
        </BulkActionBar>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{(editing as any)?.id ? "Edit offer" : "New offer"}</DialogTitle></DialogHeader>
          {editing && <OfferForm initial={editing} onSubmit={save} />}
        </DialogContent>
      </Dialog>

      <AssignOfferDialog offer={assigning} onClose={() => setAssigning(null)} />
      <OfferDetailDialog
        offer={viewing}
        onClose={() => setViewing(null)}
        onAssign={(o) => { setViewing(null); setAssigning(o); }}
        onEdit={(o) => { setViewing(null); setEditing(o); }}
      />

      <DoubleConfirmDeleteDialog
        open={!!deletingIds && deletingIds.length > 0}
        onOpenChange={(o) => { if (!o) setDeletingIds(null); }}
        count={deletingIds?.length ?? 1}
        title={deletingIds && deletingIds.length > 1 ? "Delete offers?" : "Delete offer?"}
        message={
          deletingIds && deletingIds.length > 1
            ? `You are about to delete ${deletingIds.length} offers/products.`
            : "Are you sure you want to delete this offer/product?"
        }
        strongWarning={strongWarning}
        confirmLabel={deletingIds && deletingIds.length > 1 ? "Delete Selected Offers" : "Delete Offer"}
        onConfirm={performDelete}
      />
    </>
  );
}