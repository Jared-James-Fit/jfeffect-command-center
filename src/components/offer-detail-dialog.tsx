import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="col-span-2 text-sm">{value}</div>
    </div>
  );
}

function List({ items }: { items?: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="list-disc pl-5 space-y-0.5">
      {items.map((i, idx) => <li key={idx}>{i}</li>)}
    </ul>
  );
}

export function OfferDetailDialog({ offer, onClose, onAssign, onEdit }: {
  offer: any | null;
  onClose: () => void;
  onAssign?: (o: any) => void;
  onEdit?: (o: any) => void;
}) {
  if (!offer) return null;
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success("Copied"); };

  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {offer.name}
            <Badge variant="outline">{offer.status}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Row label="Offer type" value={offer.offer_type} />
          <Row label="Description" value={offer.short_description ?? offer.description} />
          <Row label="Price" value={offer.price != null ? `${offer.currency ?? "USD"} ${Number(offer.price).toLocaleString()}` : null} />
          <Row label="Full payable amount" value={offer.full_payable_amount != null ? `${offer.currency ?? "USD"} ${Number(offer.full_payable_amount).toLocaleString()}` : null} />
          <Row label="Amount due today" value={offer.amount_due_today != null ? `${offer.currency ?? "USD"} ${Number(offer.amount_due_today).toLocaleString()}` : null} />
          <Row label="Payment structure" value={offer.payment_structure} />
          <Row label="Payment frequency" value={offer.payment_frequency} />
          <Row label="Number of payments" value={offer.number_of_payments} />
          <Row label="Payment amount" value={offer.payment_amount != null ? `${offer.currency ?? "USD"} ${Number(offer.payment_amount).toLocaleString()}` : null} />
          <Row label="Term duration" value={offer.term_duration ? `${offer.term_duration} ${offer.term_duration_unit ?? ""}`.trim() : offer.access_length} />
          <Row label="Start date" value={offer.term_start_date ?? offer.commitment_start_date ?? offer.payment_start_date} />
          <Row label="End date" value={offer.term_end_date ?? offer.commitment_end_date ?? offer.final_payment_date ?? offer.expiration_date} />
          <Row label="Sessions included" value={offer.sessions_included} />
          <Row label="Session length" value={offer.session_length_minutes ? `${offer.session_length_minutes} min` : null} />
          <Row label="Location" value={offer.location} />
          <Row label="What's included" value={<List items={offer.included_features} />} />
          <Row label="What's not included" value={<List items={offer.excluded_features} />} />
          <Row label="Cancellation policy" value={offer.cancellation_policy} />
          <Row label="Refund policy" value={offer.refund_policy} />
          <Row label="Rescheduling policy" value={offer.rescheduling_policy} />
          <Row label="No-show policy" value={offer.no_show_policy} />
          <Row label="Transferability" value={offer.transferability_policy} />
          <Row label="Agreement required" value={offer.requires_agreement ? "Yes" : "No"} />
          <Row label="Purchase disclaimer" value={offer.purchase_disclaimer} />
          <Row
            label="Stripe payment link"
            value={offer.stripe_payment_link ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate max-w-xs font-mono text-xs">{offer.stripe_payment_link}</span>
                <Button size="sm" variant="ghost" onClick={() => copy(offer.stripe_payment_link)}><Copy className="h-3 w-3" /></Button>
                <a href={offer.stripe_payment_link} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></a>
              </div>
            ) : null}
          />
          <Row label="Admin notes" value={offer.admin_notes} />
        </div>
        <div className="flex flex-wrap gap-2 pt-4">
          {onAssign && <Button className="bg-gradient-primary font-bold uppercase" onClick={() => onAssign(offer)}>Assign to client</Button>}
          {onEdit && <Button variant="outline" onClick={() => onEdit(offer)}>Edit</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}