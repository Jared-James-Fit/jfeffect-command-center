import { Link, useNavigate } from "@tanstack/react-router";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClientImpersonation } from "@/lib/client-impersonation";

export function ClientPovBanner() {
  const { client, isImpersonating, stop } = useClientImpersonation();
  const navigate = useNavigate();
  if (!isImpersonating || !client) return null;

  const exit = () => {
    const id = client.id;
    stop();
    navigate({ to: "/admin/clients/$id", params: { id } });
  };

  return (
    <div className="sticky top-0 z-50 w-full border-b border-warning/40 bg-warning/15 text-warning-foreground backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 text-warning shrink-0" />
          <span className="truncate">
            <span className="font-bold">Client POV</span>
            <span className="text-muted-foreground"> — viewing as </span>
            <span className="font-semibold">{client.full_name ?? "client"}</span>
            <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">read-only</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/clients/$id" params={{ id: client.id }}>
            <Button size="sm" variant="ghost" className="h-7 text-xs">Back to profile</Button>
          </Link>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exit}>
            <X className="mr-1 h-3.5 w-3.5" /> Exit Client POV
          </Button>
        </div>
      </div>
    </div>
  );
}