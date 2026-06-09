import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, MessageCircle, Dumbbell, Apple, HeartPulse, Mail, KeyRound, Archive, Trash2, ShoppingCart, Library, Eye } from "lucide-react";

type ClientCardProps = {
  c: any;
  trainingLabel?: string | null;
  trainingTone?: string | null;
  nutritionLabel?: string | null;
  nutritionTone?: string | null;
  cardioLabel?: string | null;
  cardioTone?: string | null;
  unreadCount?: number;
  needsResponse?: boolean;
  hasActiveProduct?: boolean;
  setupNeeded?: boolean;
  onAssign: () => void;
  onSell: () => void;
  onSendSetup: () => void;
  onSendReset: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
};

function chip(label: string, tone?: string | null) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-semibold ${tone ?? "border-border text-muted-foreground"}`}
    >
      {label}
    </Badge>
  );
}

export function ClientMobileCard(props: ClientCardProps) {
  const {
    c, trainingLabel, trainingTone, nutritionLabel, nutritionTone,
    cardioLabel, cardioTone, unreadCount = 0, needsResponse,
    hasActiveProduct, setupNeeded,
    onAssign, onSell, onSendSetup, onSendReset, onToggleArchive, onDelete,
  } = props;

  const paymentLabel = c.payment_status ?? "—";
  const paymentTone =
    c.payment_status === "Overdue" || c.payment_status === "Failed"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : c.payment_status === "Pending" || c.payment_status === "Partially Paid"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-border text-muted-foreground";

  return (
    <Card className="border-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <UserAvatar src={c.profile_picture_url} name={c.full_name} size={44} />
        <div className="min-w-0 flex-1">
          <Link to="/admin/clients/$id" params={{ id: c.id }} className="block">
            <div className="font-semibold truncate">{c.full_name}</div>
            <div className="text-xs text-muted-foreground truncate">{c.coaching_type ?? "—"}</div>
          </Link>
          {c.email && <div className="text-xs text-muted-foreground truncate mt-0.5">{c.email}</div>}
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{c.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {chip(`Training: ${trainingLabel ?? "Needs Setup"}`, trainingLabel ? trainingTone : "border-warning/40 bg-warning/10 text-warning")}
        {chip(`Nutrition: ${nutritionLabel ?? "Needs Setup"}`, nutritionLabel ? nutritionTone : "border-warning/40 bg-warning/10 text-warning")}
        {chip(`Cardio: ${cardioLabel ?? "Needs Setup"}`, cardioLabel ? cardioTone : "border-warning/40 bg-warning/10 text-warning")}
        {chip(`Payment: ${paymentLabel}`, paymentTone)}
        {chip(
          unreadCount > 0 ? `Messages: ${unreadCount} unread` : needsResponse ? "Messages: Needs Response" : "Messages: 0",
          unreadCount > 0 || needsResponse ? "border-primary/40 bg-primary/10 text-primary" : null,
        )}
        {!hasActiveProduct && chip("No Active Product", "border-destructive/40 bg-destructive/10 text-destructive")}
        {setupNeeded && chip("Setup: Pending", "border-warning/40 bg-warning/10 text-warning")}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Link to="/admin/clients/$id" params={{ id: c.id }} className="flex-1">
          <Button variant="outline" size="sm" className="w-full font-semibold">
            <Eye className="mr-1.5 h-3.5 w-3.5" /> View
          </Button>
        </Link>
        <Link to="/admin/messages" search={{ client: c.id }} className="flex-1">
          <Button variant="outline" size="sm" className="w-full font-semibold">
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Message
          </Button>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Manage</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "training" }}>
                <Dumbbell className="mr-2 h-4 w-4" /> Add Training Phase
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAssign}>
              <Library className="mr-2 h-4 w-4" /> Assign from Library
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "nutrition" }}>
                <Apple className="mr-2 h-4 w-4" /> Add Nutrition Targets
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/admin/clients/$id" params={{ id: c.id }} search={{ tab: "cardio" }}>
                <HeartPulse className="mr-2 h-4 w-4" /> Add Cardio Targets
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSell}>
              <ShoppingCart className="mr-2 h-4 w-4" /> Sell Product
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSendSetup} disabled={!c.email}>
              <Mail className="mr-2 h-4 w-4" /> Send Setup Email
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSendReset} disabled={!c.email}>
              <KeyRound className="mr-2 h-4 w-4" /> Send Password Reset
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleArchive}>
              <Archive className="mr-2 h-4 w-4" /> {c.archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}