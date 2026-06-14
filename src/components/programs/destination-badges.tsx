import { Badge } from "@/components/ui/badge";
import { Lock, Users, Send, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { DestinationSummary } from "@/lib/programs/sharing";
import { destinationLabel } from "@/lib/programs/sharing";

/**
 * Renders destination + status badges for a program card.
 * Keep these clickable upstream via wrapping <button>.
 */
export function DestinationBadges({
  summary,
  ownerRole,
  compact = false,
}: {
  summary: DestinationSummary;
  ownerRole?: "admin" | "coach";
  compact?: boolean;
}) {
  const items: { key: string; label: string; tone: string; icon?: any }[] = [];

  if (summary.visibility === "private") {
    items.push({ key: "private", label: "Private", tone: "muted", icon: <Lock className="h-3 w-3" /> });
  } else if (summary.visibility === "team") {
    items.push({ key: "team", label: "Team Live", tone: "live", icon: <Users className="h-3 w-3" /> });
  }

  if (summary.coachShareCount > 0) {
    items.push({
      key: "coaches",
      label: `Shared with ${summary.coachShareCount} ${summary.coachShareCount === 1 ? "Coach" : "Coaches"}`,
      tone: "info",
      icon: <Send className="h-3 w-3" />,
    });
  }

  for (const d of summary.pendingSubmissions) {
    items.push({
      key: `pending-${d}`,
      label: `Pending Approval — ${destinationLabel(d)}`,
      tone: "warn",
      icon: <AlertTriangle className="h-3 w-3" />,
    });
  }

  for (const d of summary.changesRequested) {
    items.push({
      key: `changes-${d}`,
      label: `Changes Requested — ${destinationLabel(d)}`,
      tone: "warn",
      icon: <AlertTriangle className="h-3 w-3" />,
    });
  }

  for (const d of summary.rejectedSubmissions) {
    items.push({
      key: `rejected-${d}`,
      label: `Rejected — ${destinationLabel(d)}`,
      tone: "destructive",
      icon: <XCircle className="h-3 w-3" />,
    });
  }

  if (ownerRole) {
    items.unshift({
      key: "owner",
      label: ownerRole === "admin" ? "Admin Owned" : "Coach Owned",
      tone: "outline",
      icon: <CheckCircle2 className="h-3 w-3" />,
    });
  }

  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "text-[10px]" : "text-xs"}`}>
      {items.map((it) => (
        <Badge key={it.key} variant={toneToVariant(it.tone)} className="gap-1">
          {it.icon}
          {it.label}
        </Badge>
      ))}
    </div>
  );
}

function toneToVariant(tone: string): any {
  switch (tone) {
    case "live": return "default";
    case "warn": return "secondary";
    case "destructive": return "destructive";
    case "info": return "secondary";
    case "outline": return "outline";
    default: return "outline";
  }
}