import { Link } from "@tanstack/react-router";
import {
  Dumbbell, Plus, BookOpen, CalendarDays, Apple, HeartPulse,
  MessageSquare, ClipboardCheck, CreditCard, User, Zap, Eye,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DirectoryRow } from "@/lib/clients-directory.functions";

/** Compact "Quick Actions" launcher for a client row. */
export function QuickActionsMenu({ r }: { r: DirectoryRow }) {
  const hasProgram = !!r.block_id;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 md:h-9 md:w-9"
              aria-label="Quick actions"
            >
              <Zap className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Quick actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs">Training</DropdownMenuLabel>
        {hasProgram ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Open Program
              </Link>
            </DropdownMenuItem>
            {r.block_id && (
              <DropdownMenuItem asChild>
                <Link to="/admin/blocks/$blockId" params={{ blockId: r.block_id }} className="flex items-center gap-2">
                  <Dumbbell className="h-4 w-4" /> Edit Current Program
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> Build Next Phase
              </Link>
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem asChild>
            <Link to="/admin/program-assign/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Assign Program
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "training" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> View Schedule
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Nutrition &amp; Cardio</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "nutrition" } as any} className="flex items-center gap-2">
            <Apple className="h-4 w-4" /> {r.nut_end ? "Update Nutrition" : "Add Nutrition"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "cardio" } as any} className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" /> {r.card_end ? "Update Cardio" : "Add Cardio"}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Client</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "messages" } as any} className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Send Message
          </Link>
        </DropdownMenuItem>
        {r.pending_reviews > 0 && (
          <DropdownMenuItem asChild>
            <Link to="/admin/check-in-reviews" className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Review Check-In
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "sessions" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Book Session
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "billing" } as any} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Add Payment
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} className="flex items-center gap-2">
            <User className="h-4 w-4" /> Open Profile
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Expanded sectioned "More" menu (three-dot). */
export function ClientMoreMenu({
  r,
  trigger,
  onArchive,
}: {
  r: DirectoryRow;
  trigger: React.ReactNode;
  onArchive?: (r: DirectoryRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">{r.full_name}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Open Client
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "training" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> View Schedule
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Training</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          {r.block_id ? (
            <Link to="/admin/client-programs/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Open Program
            </Link>
          ) : (
            <Link to="/admin/program-assign/$clientId" params={{ clientId: r.id }} className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4" /> Assign Program
            </Link>
          )}
        </DropdownMenuItem>
        {r.block_id && (
          <DropdownMenuItem asChild>
            <Link to="/admin/blocks/$blockId" params={{ blockId: r.block_id }} className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" /> Edit Current Program
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/admin/client-programs/$clientId/history" params={{ clientId: r.id }} className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Program History
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Coaching</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "nutrition" } as any} className="flex items-center gap-2">
            <Apple className="h-4 w-4" /> {r.nut_end ? "Update Nutrition" : "Add Nutrition"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "cardio" } as any} className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" /> {r.card_end ? "Update Cardio" : "Add Cardio"}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "messages" } as any} className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Send Message
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "sessions" } as any} className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Book Session
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Billing</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "billing" } as any} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> View Payments
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "purchases" } as any} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Manage Package
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Account</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "info" } as any} className="flex items-center gap-2">
            <User className="h-4 w-4" /> Edit Client
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "account" } as any} className="flex items-center gap-2">
            <User className="h-4 w-4" /> Manage Access
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/clients/$id" params={{ id: r.id }} search={{ tab: "agreements" } as any} className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> View Agreements
          </Link>
        </DropdownMenuItem>

        {onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onArchive(r)}
              className="text-destructive focus:text-destructive"
            >
              Archive Client
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}