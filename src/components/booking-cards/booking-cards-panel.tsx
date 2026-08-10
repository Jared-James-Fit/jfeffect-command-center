import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, CalendarPlus, Pencil, Copy, MoreHorizontal, Trash2, ArrowUp, ArrowDown,
  EyeOff, Eye, LayoutTemplate, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { BookingCardDialog } from "@/components/booking-cards/booking-card-dialog";
import {
  cardAccent, fmtDuration, SUGGESTED_CARDS, type BookingCard,
} from "@/lib/booking-cards";

export function BookingCardsPanel({
  clients,
  onBook,
}: {
  clients: any[];
  onBook: (card: BookingCard) => void;
}) {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BookingCard | null>(null);
  const [prefill, setPrefill] = useState<any>(null);
  const [deleteFor, setDeleteFor] = useState<BookingCard | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: cards = [], isLoading } = useQuery<BookingCard[]>({
    queryKey: ["booking-cards"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("booking_cards")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BookingCard[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["booking-cards"] });
  const nextSortOrder = cards.length ? Math.max(...cards.map((c) => c.sort_order ?? 0)) + 10 : 10;

  const openCreate = (suggestion?: (typeof SUGGESTED_CARDS)[number]) => {
    setEditing(null);
    setPrefill(suggestion ?? null);
    setEditorOpen(true);
  };
  const openEdit = (card: BookingCard) => {
    setEditing(card);
    setPrefill(null);
    setEditorOpen(true);
  };

  const duplicate = async (card: BookingCard) => {
    const { id, created_at, updated_at, ...rest } = card;
    const { error } = await (supabase as any).from("booking_cards").insert({
      ...rest,
      name: `${card.name} (Copy)`,
      sort_order: nextSortOrder,
    });
    if (error) return toast.error(error.message);
    toast.success("Card duplicated");
    refresh();
  };

  const toggleActive = async (card: BookingCard) => {
    const { error } = await (supabase as any).from("booking_cards").update({ is_active: !card.is_active }).eq("id", card.id);
    if (error) return toast.error(error.message);
    toast.success(card.is_active ? "Card deactivated — hidden from booking" : "Card activated");
    refresh();
  };

  const move = async (card: BookingCard, dir: -1 | 1) => {
    const idx = cards.findIndex((c) => c.id === card.id);
    const swap = cards[idx + dir];
    if (!swap) return;
    const a = card.sort_order ?? idx * 10;
    const b = swap.sort_order ?? (idx + dir) * 10;
    const { error: e1 } = await (supabase as any).from("booking_cards").update({ sort_order: b }).eq("id", card.id);
    const { error: e2 } = await (supabase as any).from("booking_cards").update({ sort_order: a }).eq("id", swap.id);
    if (e1 || e2) return toast.error((e1 ?? e2)?.message ?? "Reorder failed");
    refresh();
  };

  const confirmDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const { count, error: cErr } = await (supabase as any)
        .from("pt_sessions")
        .select("id", { count: "exact", head: true })
        .eq("booking_card_id", deleteFor.id);
      if (cErr) throw cErr;
      if ((count ?? 0) > 0) {
        toast.error(`This card was used for ${count} session${count === 1 ? "" : "s"} — deactivate it instead of deleting.`);
        setDeleteFor(null);
        return;
      }
      const { error } = await (supabase as any).from("booking_cards").delete().eq("id", deleteFor.id);
      if (error) throw error;
      toast.success("Booking card deleted");
      setDeleteFor(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading booking cards…</div>;
  }

  if (cards.length === 0) {
    return (
      <Card className="border-border bg-card p-6 sm:p-10 text-center space-y-4">
        <LayoutTemplate className="mx-auto h-10 w-10 text-muted-foreground" />
        <div>
          <p className="font-bold">No booking cards yet</p>
          <p className="text-sm text-muted-foreground">
            Booking cards are reusable session presets — pick a card when booking and skip the full form.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => openCreate()}>
            <Plus className="mr-2 h-4 w-4" /> Create Booking Card
          </Button>
        </div>
        <div className="pt-2">
          <p className="mb-2 flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Quick start
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTED_CARDS.map((s) => (
              <Button key={s.name} size="sm" variant="outline" onClick={() => openCreate(s)}>
                {s.name}
              </Button>
            ))}
          </div>
        </div>
        <BookingCardDialog open={editorOpen} onOpenChange={setEditorOpen} initial={editing} prefill={prefill} nextSortOrder={nextSortOrder} />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {cards.filter((c) => c.is_active).length} active · {cards.length} total
        </p>
        <Button size="sm" variant="outline" onClick={() => openCreate()}>
          <Plus className="mr-2 h-3.5 w-3.5" /> New Card
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, idx) => {
          const accent = cardAccent(card.color);
          return (
            <Card key={card.id} className={`relative overflow-hidden border-border bg-card p-3 pl-4 ${card.is_active ? "" : "opacity-60"}`}>
              <span className={`absolute inset-y-0 left-0 w-1 ${accent.bar}`} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold break-words">{card.name}</span>
                    {!card.is_active && <Badge variant="outline" className="border-border text-muted-foreground">Inactive</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground break-words">
                    {fmtDuration(card.duration_minutes)}
                    {card.location ? ` · ${card.location}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={card.uses_credit ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground"}>
                      {card.uses_credit ? "Uses 1 credit" : "No credit"}
                    </Badge>
                    <Badge variant="outline" className="border-border text-muted-foreground">
                      {card.session_type === "Custom Session" ? card.custom_type || card.session_type : card.session_type}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  className="bg-gradient-primary font-bold uppercase"
                  disabled={!card.is_active || clients.length === 0}
                  onClick={() => onBook(card)}
                >
                  <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Book
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(card)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => move(card, -1)} title="Move up">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={idx === cards.length - 1} onClick={() => move(card, 1)} title="Move down">
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => duplicate(card)}>
                      <Copy className="mr-2 h-4 w-4" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleActive(card)}>
                      {card.is_active ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                      {card.is_active ? "Deactivate" : "Activate"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteFor(card)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete (only if unused)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          );
        })}
      </div>

      <BookingCardDialog open={editorOpen} onOpenChange={setEditorOpen} initial={editing} prefill={prefill} nextSortOrder={nextSortOrder} />

      <AlertDialog open={!!deleteFor} onOpenChange={(o) => { if (!o) setDeleteFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteFor?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Cards can only be deleted if they have never been used for a booking. Used cards should be
              deactivated instead — existing sessions keep their template history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Card</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={deleting}>
              {deleting ? "Checking…" : "Delete Card"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}