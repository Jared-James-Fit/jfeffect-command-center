import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Plus, Trash2, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listCoachingProducts,
  createCoachingProduct,
  deleteCoachingProduct,
  toggleCoachingProductActive,
} from "@/lib/coaching-products.functions";

export const Route = createFileRoute("/_authenticated/admin/payment-links")({
  component: PaymentLinksPage,
});

type Product = {
  id: string;
  name: string;
  description: string | null;
  details: string | null;
  price_cents: number;
  currency: string;
  image_url: string | null;
  image_signed_url: string | null;
  payment_link_url: string | null;
  stripe_product_id: string | null;
  active: boolean;
  created_at: string;
};

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() })
      .format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function PaymentLinksPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCoachingProducts);
  const createFn = useServerFn(createCoachingProduct);
  const deleteFn = useServerFn(deleteCoachingProduct);
  const toggleFn = useServerFn(toggleCoachingProductActive);

  const { data, isLoading } = useQuery({
    queryKey: ["coaching-products"],
    queryFn: () => listFn(),
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);

  function resetForm() {
    setName(""); setDescription(""); setDetails(""); setPriceUsd("");
    setImageFile(null); setImagePreview(null);
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setImageFile(f);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const cents = Math.round(parseFloat(priceUsd) * 100);
      if (!name.trim()) throw new Error("Name is required");
      if (!Number.isFinite(cents) || cents < 50) throw new Error("Price must be at least $0.50");

      let imagePath: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop() || "jpg";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(path, imageFile, { contentType: imageFile.type, upsert: false });
        if (upErr) throw new Error(`Image upload failed: ${upErr.message}`);
        imagePath = path;
      }

      return createFn({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          details: details.trim() || null,
          priceCents: cents,
          currency: "usd",
          imagePath,
        },
      });
    },
    onSuccess: () => {
      toast.success("Product created and Stripe payment link generated.");
      resetForm();
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create product"),
    onSettled: () => setSubmitting(false),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Product removed.");
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["coaching-products"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
  });

  const toggleMutation = useMutation({
    mutationFn: (p: Product) => toggleFn({ data: { id: p.id, active: !p.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coaching-products"] }),
    onError: (e: any) => toast.error(e?.message ?? "Failed to update"),
  });

  const items = (data?.items ?? []) as Product[];

  async function copyLink(url: string | null) {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Payment link copied");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Links"
        subtitle="Create coaching products. Each one auto-generates a Stripe payment link."
      />

      <Card className="p-5">
        <h2 className="text-lg font-semibold mb-4">Add a coaching product</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); setSubmitting(true); createMutation.mutate(); }}
          className="grid gap-4 md:grid-cols-2"
        >
          <div className="md:col-span-2 grid md:grid-cols-[160px_1fr] gap-4 items-start">
            <div>
              <Label>Image</Label>
              <label className="mt-1 flex h-32 w-32 cursor-pointer items-center justify-center rounded-md border border-dashed bg-muted/30 overflow-hidden">
                {imagePreview ? (
                  <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
                <input type="file" accept="image/*" className="hidden" onChange={onPickImage} />
              </label>
            </div>
            <div className="grid gap-4">
              <div>
                <Label htmlFor="cp-name">Product name *</Label>
                <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="1:1 Coaching - 3 month" required />
              </div>
              <div>
                <Label htmlFor="cp-price">Price (USD) *</Label>
                <Input id="cp-price" type="number" min="0.5" step="0.01" value={priceUsd}
                  onChange={(e) => setPriceUsd(e.target.value)} placeholder="499.00" required />
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="cp-desc">Short description</Label>
            <Input id="cp-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line summary shown on Stripe checkout" />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="cp-details">Details</Label>
            <Textarea id="cp-details" rows={5} value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What's included, scheduling, deliverables, terms..." />
            <p className="text-xs text-muted-foreground mt-1">
              Stored in your app. The short description is what appears on Stripe.
            </p>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={submitting || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create product & payment link
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Your products</h2>
        {isLoading ? (
          <Card className="p-8 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Loading…</Card>
        ) : items.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">No coaching products yet.</Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((p) => (
              <Card key={p.id} className="p-4 flex gap-4">
                <div className="h-24 w-24 shrink-0 rounded-md bg-muted overflow-hidden">
                  {p.image_signed_url ? (
                    <img src={p.image_signed_url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full grid place-items-center text-muted-foreground text-xs">No image</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{p.name}</h3>
                        <Badge variant={p.active ? "default" : "secondary"}>
                          {p.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatPrice(p.price_cents, p.currency)}
                      </div>
                    </div>
                  </div>
                  {p.description && (
                    <p className="text-sm mt-1 line-clamp-2">{p.description}</p>
                  )}
                  {p.details && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">{p.details}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" type="button" onClick={() => copyLink(p.payment_link_url)}>
                      <Copy className="mr-1 h-3.5 w-3.5" /> Copy link
                    </Button>
                    {p.payment_link_url && (
                      <Button size="sm" variant="outline" type="button" asChild>
                        <a href={p.payment_link_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                        </a>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" type="button"
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate(p)}>
                      {p.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button size="sm" variant="ghost" type="button" className="text-destructive"
                      onClick={() => setPendingDelete(p)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This deactivates the product and payment link in Stripe and removes it from this list.
              Existing past payments in Stripe are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}