import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Copy, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/offers")({
  component: OffersPage,
});

const OFFER_TYPES = ["1:1 Online Coaching", "In-Person Coaching", "Hybrid Coaching", "Powerlifting Coaching", "Fat Loss Coaching", "12 Week Program PDF", "Custom Training Program", "Nutrition Plan", "Consultation Call", "Monthly Subscription", "Paid Challenge", "VIP Coaching Package"];
const PAY_STRUCTURES = ["One-time payment", "Weekly payment", "Bi-weekly payment", "Monthly payment", "3-month commitment", "6-month commitment", "12-month commitment", "Paid in full", "Custom payment plan"];
const STATUSES = ["Draft", "Active", "Private", "Archived", "Testing"];

function OffersPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: offers = [] } = useQuery({
    queryKey: ["offers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("offers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const del = async (id: string) => {
    if (!confirm("Delete this offer?")) return;
    const { error } = await supabase.from("offers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  return (
    <>
      <PageHeader
        title="Offers & Products"
        subtitle="Create offers, attach Stripe links, sell fast."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> New offer
              </Button>
            </DialogTrigger>
            <NewOfferDialog onClose={() => setOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["offers"] })} />
          </Dialog>
        }
      />
      <div className="grid gap-4 p-6 md:grid-cols-2 lg:grid-cols-3 md:p-8">
        {offers.length === 0 && (
          <div className="col-span-full rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No offers yet. Create your first one — paste an existing Stripe payment link and start sending.
          </div>
        )}
        {offers.map((o) => (
          <Card key={o.id} className="border-border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold">{o.name}</div>
                <div className="text-xs text-muted-foreground">{o.offer_type}</div>
              </div>
              <Badge variant={o.status === "Active" ? "default" : "outline"} className={o.status === "Active" ? "bg-gradient-primary" : ""}>{o.status}</Badge>
            </div>
            {o.price != null && (
              <div className="text-2xl font-black">{o.currency ?? "USD"} {Number(o.price).toLocaleString()}</div>
            )}
            {o.payment_structure && <div className="text-xs text-muted-foreground">{o.payment_structure}</div>}
            {o.description && <p className="text-sm text-muted-foreground line-clamp-2">{o.description}</p>}
            <div className="flex gap-2 pt-2">
              {o.stripe_payment_link && (
                <>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => copy(o.stripe_payment_link!)}><Copy className="mr-1.5 h-3 w-3" />Copy link</Button>
                  <a href={o.stripe_payment_link} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></a>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => del(o.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function NewOfferDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", offer_type: OFFER_TYPES[0], description: "", price: "",
    currency: "USD", payment_structure: PAY_STRUCTURES[0], stripe_payment_link: "", status: "Active",
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("offers").insert({
      ...form,
      price: form.price ? Number(form.price) : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Offer created");
    onCreated();
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>New offer</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={form.offer_type} onValueChange={(v) => setForm({ ...form, offer_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{OFFER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Price</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div><Label>Currency</Label><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></div>
          <div className="col-span-2">
            <Label>Payment structure</Label>
            <Select value={form.payment_structure} onValueChange={(v) => setForm({ ...form, payment_structure: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAY_STRUCTURES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>Stripe payment link</Label><Input value={form.stripe_payment_link} onChange={(e) => setForm({ ...form, stripe_payment_link: e.target.value })} placeholder="https://buy.stripe.com/…" /></div>
        <div><Label>Description</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} className="bg-gradient-primary font-bold uppercase">{busy ? "Saving…" : "Create"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}