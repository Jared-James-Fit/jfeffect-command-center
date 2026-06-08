import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { setPovPersona } from "@/lib/pov.functions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eye, ChevronDown, X } from "lucide-react";
import { toast } from "sonner";

const POV_FLAG_KEY = "jf-pov-active";
const POV_PERSONA_KEY = "jf-pov-persona";

export function setPovFlag(persona: string | null) {
  try {
    if (persona) {
      localStorage.setItem(POV_FLAG_KEY, "1");
      localStorage.setItem(POV_PERSONA_KEY, persona);
    } else {
      localStorage.removeItem(POV_FLAG_KEY);
      localStorage.removeItem(POV_PERSONA_KEY);
    }
  } catch {}
}

export function getPovFlag(): { active: boolean; persona: string | null } {
  try {
    return {
      active: localStorage.getItem(POV_FLAG_KEY) === "1",
      persona: localStorage.getItem(POV_PERSONA_KEY),
    };
  } catch {
    return { active: false, persona: null };
  }
}

const PERSONA_LABELS: Record<string, string> = {
  app_member: "App Member",
  app_member_premium: "App Member (Premium)",
  program_only: "Program-Only Buyer",
  none: "Locked / No Access",
};

export function AdminPovMenu({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setPersona = useServerFn(setPovPersona);
  const [busy, setBusy] = useState(false);

  const enter = async (persona: keyof typeof PERSONA_LABELS) => {
    if (busy) return;
    setBusy(true);
    try {
      await setPersona({ data: { persona } as any });
      setPovFlag(persona);
      await qc.invalidateQueries({ queryKey: ["m-me"] });
      toast.success(`POV: ${PERSONA_LABELS[persona]}`);
      navigate({ to: "/m" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to enter POV");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy}>
          <Eye className="h-3.5 w-3.5" />
          {!compact && <span>Preview as Member</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Enter POV</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => enter("app_member")}>App Member</DropdownMenuItem>
        <DropdownMenuItem onClick={() => enter("app_member_premium")}>App Member (Premium)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => enter("program_only")}>Program-Only Buyer</DropdownMenuItem>
        <DropdownMenuItem onClick={() => enter("none")}>Locked / No Access</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Uses a sandbox member tied to your account. Real subscribers are unaffected.
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PovBanner() {
  const navigate = useNavigate();
  const { active, persona } = getPovFlag();
  if (!active) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-900 dark:text-amber-100">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Eye className="h-4 w-4" />
        Previewing as <span className="font-bold">{PERSONA_LABELS[persona ?? ""] ?? persona}</span>
        <span className="hidden text-xs opacity-70 sm:inline">— writes go to your admin sandbox member, not real subscribers.</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5"
        onClick={() => {
          setPovFlag(null);
          navigate({ to: "/admin" });
        }}
      >
        <X className="h-3.5 w-3.5" /> Exit POV
      </Button>
    </div>
  );
}