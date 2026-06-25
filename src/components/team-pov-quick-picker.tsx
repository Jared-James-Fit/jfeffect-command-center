import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useTeamImpersonation } from "@/lib/team-impersonation";
import { useAuth } from "@/lib/auth";
import { listStaff } from "@/lib/media-manager.functions";
import { Eye } from "lucide-react";

/**
 * Global Team POV quick picker. Admin-only.
 * Opens via window event `open-team-pov-picker`.
 */
export function TeamPovQuickPicker() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const impersonation = useTeamImpersonation();
  const [open, setOpen] = useState(false);
  const canPov = role === "admin";
  const fetchStaff = useServerFn(listStaff);

  useEffect(() => {
    if (!canPov) return;
    const onOpen = () => setOpen(true);
    window.addEventListener("open-team-pov-picker", onOpen as EventListener);
    return () => window.removeEventListener("open-team-pov-picker", onOpen as EventListener);
  }, [canPov]);

  const { data, isLoading } = useQuery({
    queryKey: ["team-pov-quick-picker"],
    enabled: canPov && open,
    staleTime: 60_000,
    queryFn: async () => fetchStaff(),
  });

  if (!canPov) return null;

  const members = (data?.members ?? []).filter((m: any) => m.user_id && m.user_id !== user?.id);

  const enter = (m: any) => {
    impersonation.start(
      {
        user_id: m.user_id,
        full_name: m.profile?.full_name ?? null,
        email: m.profile?.email ?? null,
        role: "media_manager",
      },
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null,
    );
    setOpen(false);
    navigate({ to: "/media" });
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search a team member to view their POV…" />
      <CommandList>
        <CommandEmpty>
          {isLoading ? "Loading team…" : "No team members available."}
        </CommandEmpty>
        <CommandGroup heading="Team POV">
          {members.map((m: any) => (
            <CommandItem
              key={m.user_id}
              value={`${m.profile?.full_name ?? ""} ${m.profile?.email ?? ""}`}
              onSelect={() => enter(m)}
            >
              <Eye className="mr-2 h-4 w-4 text-sky-500" />
              <span className="flex-1 truncate">
                {m.profile?.full_name ?? "Unnamed team member"}
              </span>
              <span className="ml-2 truncate text-[11px] text-muted-foreground">
                {m.profile?.email ?? ""}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}