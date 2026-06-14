import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { Eye, UserX } from "lucide-react";
import { toast } from "sonner";

/**
 * Global, app-shell-mounted Client POV quick picker.
 *
 * Opens via window event `open-client-pov-picker` — dispatched from the
 * floating bar's synthetic `__client_pov__` slot. Lets admins/coaches
 * fuzzy-search active clients and jump straight into their portal POV.
 */
export function ClientPovQuickPicker() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const impersonation = useClientImpersonation();
  const [open, setOpen] = useState(false);
  const canPov = role === "admin" || role === "coach";

  useEffect(() => {
    if (!canPov) return;
    const onOpen = () => setOpen(true);
    window.addEventListener("open-client-pov-picker", onOpen as EventListener);
    return () => window.removeEventListener("open-client-pov-picker", onOpen as EventListener);
  }, [canPov]);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["client-pov-quick-picker"],
    enabled: canPov && open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, user_id, status")
        .eq("archived", false)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!canPov) return null;

  const enter = (c: { id: string; user_id: string | null; full_name: string | null }) => {
    if (!c.user_id) {
      toast.error("This client has no account yet — send them a setup link first.");
      return;
    }
    impersonation.start(
      { id: c.id, user_id: c.user_id, full_name: c.full_name },
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null,
    );
    setOpen(false);
    navigate({ to: "/portal" });
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search a client to enter their POV…" />
      <CommandList>
        <CommandEmpty>
          {isLoading ? "Loading clients…" : "No clients match."}
        </CommandEmpty>
        <CommandGroup heading="Client POV">
          {clients.map((c) => {
            const hasAccount = !!c.user_id;
            return (
              <CommandItem
                key={c.id}
                value={`${c.full_name ?? ""} ${c.email ?? ""}`}
                onSelect={() => enter(c)}
                disabled={!hasAccount}
              >
                {hasAccount ? (
                  <Eye className="mr-2 h-4 w-4 text-warning" />
                ) : (
                  <UserX className="mr-2 h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{c.full_name ?? "Unnamed"}</span>
                <span className="ml-2 truncate text-[11px] text-muted-foreground">
                  {c.email ?? (hasAccount ? "" : "No account")}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}