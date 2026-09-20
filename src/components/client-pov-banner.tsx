import { useNavigate } from "@tanstack/react-router";
import { ArrowRightLeft, Eye, ShieldCheck } from "lucide-react";
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

  const switchClient = () => {
    window.dispatchEvent(new CustomEvent("open-client-pov-picker"));
  };

  return (
    <div
      className="sticky top-0 z-50 w-full border-b border-warning/40 bg-warning/15 text-warning-foreground backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex min-h-12 items-center gap-2 px-3 py-2 text-sm sm:px-4">
        <Eye className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">Viewing as {client.full_name ?? "client"}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-warning">Client POV</div>
        </div>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={switchClient}>
          <ArrowRightLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Switch</span>
        </Button>
        <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 px-2 text-xs" onClick={exit}>
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Coach</span>
        </Button>
      </div>
    </div>
  );
}