import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { HomeScreenSetupCard } from "@/components/home-screen-setup-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // @ts-ignore
  if (window.navigator.standalone) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

const SESSION_KEY = "jf-home-screen-setup-shown";

export function HomeScreenSetupGate() {
  const { user } = useAuth();
  const standalone = useMemo(() => isStandalone(), []);
  const [open, setOpen] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["my-client-hs-setup", user?.id],
    enabled: !!user?.id && !standalone,
    queryFn: async () => {
      const { data } = await (supabase.from("clients") as any)
        .select("id, home_screen_setup_status, home_screen_setup_remind_after")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!client || standalone) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    const status = client.home_screen_setup_status;
    const remindAfter = client.home_screen_setup_remind_after;
    if (status === "complete") return;
    if (status === "reminded" && remindAfter && new Date(remindAfter).getTime() > Date.now()) return;
    setOpen(true);
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
  }, [client, standalone]);

  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Install JF Effect</DialogTitle>
          <DialogDescription>
            Save the app to your home screen so you can open it like any other app.
          </DialogDescription>
        </DialogHeader>
        <HomeScreenSetupCard
          clientId={client.id}
          status={client.home_screen_setup_status}
          remindAfter={client.home_screen_setup_remind_after}
        />
        <DialogFooter>
          <button
            onClick={() => setOpen(false)}
            className="text-xs text-muted-foreground underline"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}