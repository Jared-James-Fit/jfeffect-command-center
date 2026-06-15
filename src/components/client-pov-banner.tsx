import { useNavigate } from "@tanstack/react-router";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClientImpersonation } from "@/lib/client-impersonation";

export function ClientPovBanner() {
  const { client, isImpersonating, stop, returnTo } = useClientImpersonation();
  const navigate = useNavigate();
  if (!isImpersonating || !client) return null;

  const back = returnTo ?? `/admin/clients/${client.id}`;

  const exit = () => {
    const target = back;
    stop();
    navigate({ to: target });
  };

  return (
    <div
      className="sticky top-0 z-50 w-full border-b border-warning/40 bg-warning/15 text-warning-foreground backdrop-blur"
      style={{ minHeight: 48 }}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-sm sm:px-4">
        <Eye className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex items-center gap-2">
          <span className="truncate font-semibold">Viewing as {client.full_name ?? "client"}</span>
          <span className="hidden sm:inline-flex shrink-0 rounded-full border border-warning/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-warning">
            Client POV
          </span>
        </div>
        <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={exit}>
          <X className="mr-1 h-3.5 w-3.5" /> Exit
        </Button>
      </div>
    </div>
  );
}