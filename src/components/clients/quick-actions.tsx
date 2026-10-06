import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquare, CreditCard, ShoppingCart, Archive } from "lucide-react";
import { QuickSellSheet } from "./quick-sell-sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DirectoryRow } from "@/lib/clients-directory.functions";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The client row's one menu (three-dot): only what a coach does straight from the list,
 * without opening the client. Program, schedule, nutrition, cardio, reports, billing history
 * and account all live in the client profile, which "Open Client" opens.
 */
export function ClientMoreMenu({
  r,
  trigger,
  onArchive,
  tip,
}: {
  r: DirectoryRow;
  trigger: React.ReactNode;
  onArchive?: (r: DirectoryRow) => void;
  /** Optional hover hint for the trigger (needs a surrounding TooltipProvider). */
  tip?: string;
}) {
  const qc = useQueryClient();
  const isExempt = r.payment_state === "exempt";
  const setPaymentExempt = async (exempt: boolean) => {
    const { error } = await (supabase as any)
      .from("clients")
      .update({ payment_status: exempt ? "Complimentary" : "Not Sent" })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(exempt ? "Marked as no payment needed" : "Payment is required again");
    qc.invalidateQueries({ queryKey: ["clients-directory"] });
  };
  const [sellOpen, setSellOpen] = useState(false);
  return (
    <>
    <DropdownMenu>
      {tip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-snug">{tip}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">{r.full_name}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          {/* Straight to their conversation, like the profile's Message button. */}
          <Link to="/admin/communication" search={{ tab: "messages", client: r.id } as any} className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Send Message
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSellOpen(true); }}>
          <ShoppingCart className="mr-2 h-4 w-4 text-primary" /> Quick Sell / Send Payment Link
        </DropdownMenuItem>
        {(r.payment_state === "not_set_up" || r.payment_state === "pending" || isExempt) && (
          <DropdownMenuItem onSelect={() => void setPaymentExempt(!isExempt)}>
            <CreditCard className="mr-2 h-4 w-4" />
            {isExempt ? "Require payment again" : "Mark: no payment needed"}
          </DropdownMenuItem>
        )}

        {onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onArchive(r)}
              className="text-destructive focus:text-destructive"
            >
              <Archive className="mr-2 h-4 w-4" /> Archive Client
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <QuickSellSheet
      open={sellOpen}
      onOpenChange={setSellOpen}
      clientId={r.id}
      clientName={r.full_name}
    />
    </>
  );
}
