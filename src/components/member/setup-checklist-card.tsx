import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Check, ChevronRight, Smartphone, Bell, ClipboardList, Dumbbell, UserCircle, X,
} from "lucide-react";
import { getMySetupStatus } from "@/lib/member-setup.functions";
import {
  dismissSetupChecklist,
  recordNotificationStatus,
} from "@/lib/onboarding.functions";
import { supabase } from "@/integrations/supabase/client";
import { usePwaInstall } from "@/hooks/use-pwa-install";

type Item = {
  key: string;
  label: string;
  icon: any;
  done: boolean;
  to?: string;
  onClick?: () => void;
  cta: string;
};

function useSetupChecklistData() {
  const fetchStatus = useServerFn(getMySetupStatus);
  const fireDismiss = useServerFn(dismissSetupChecklist);
  const fireNotif = useServerFn(recordNotificationStatus);
  const qc = useQueryClient();
  const install = usePwaInstall();

  const { data: status } = useQuery({
    queryKey: ["m-setup-status"],
    queryFn: () => fetchStatus(),
    staleTime: 30_000,
  });

  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || cancel) return;
      const { data } = await supabase
        .from("app_members")
        .select("id, install_detected_at, notifications_status, setup_dismissed_until, setup_completed_at")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!cancel) setMe(data);
    })();
    return () => { cancel = true; };
  }, [status]);

  const dismissedUntil = me?.setup_dismissed_until ? new Date(me.setup_dismissed_until).getTime() : 0;
  const isDismissed = dismissedUntil > Date.now();

  // Detect notification permission status on mount.
  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    const perm = Notification.permission as "granted" | "denied" | "default";
    if (me && me.notifications_status !== perm) {
      fireNotif({ data: { status: perm } }).catch(() => {});
    }
  }, [me, fireNotif]);

  // Auto-record install detection.
  useEffect(() => {
    if (install.isStandalone && me && !me.install_detected_at) {
      // The /install page handles the server write; trigger refetch here so checklist updates.
      qc.invalidateQueries({ queryKey: ["m-setup-status"] });
    }
  }, [install.isStandalone, me, qc]);

  const setupComplete = status?.complete === true;
  const isInstalled = !!me?.install_detected_at || install.isStandalone;
  const notifGranted = me?.notifications_status === "granted"
    || (typeof Notification !== "undefined" && Notification.permission === "granted");

  async function requestNotifications() {
    if (typeof Notification === "undefined") {
      await fireNotif({ data: { status: "unsupported" } }).catch(() => {});
      toast.info("Notifications aren't supported on this browser.");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      await fireNotif({ data: { status: result as any } }).catch(() => {});
      if (result === "granted") {
        toast.success("Notifications enabled.");
        qc.invalidateQueries({ queryKey: ["m-setup-status"] });
      } else {
        toast.info("You can turn notifications on later in your browser settings.");
      }
    } catch {
      toast.error("Couldn't request notifications.");
    }
  }

  const items: Item[] = useMemo(() => [
    {
      key: "profile",
      label: "Complete your profile",
      icon: UserCircle,
      done: setupComplete,
      to: "/m/account",
      cta: setupComplete ? "Review" : "Finish profile",
    },
    {
      key: "install",
      label: "Install JF Effect on your phone",
      icon: Smartphone,
      done: isInstalled,
      to: "/install",
      cta: isInstalled ? "Installed" : "Install app",
    },
    {
      key: "notifications",
      label: "Turn on notifications",
      icon: Bell,
      done: notifGranted,
      onClick: requestNotifications,
      cta: notifGranted ? "On" : "Enable",
    },
    {
      key: "plan",
      label: "Pick your first program",
      icon: ClipboardList,
      done: false, // wired in caller via active enrollment if needed
      to: "/m/plans",
      cta: "Browse library",
    },
    {
      key: "workout",
      label: "Open your first workout",
      icon: Dumbbell,
      done: false,
      to: "/m/my-plans",
      cta: "Start training",
    },
  ], [setupComplete, isInstalled, notifGranted]);

  return { items, isDismissed, setupComplete, isInstalled, dismissChecklist: async (hours: number) => {
    await fireDismiss({ data: { hours } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["m-setup-status"] });
    toast.success(hours >= 24 ? "We'll remind you tomorrow." : "Hidden for a few hours.");
  } };
}

export function SetupChecklist({ activeEnrollment }: { activeEnrollment?: any }) {
  const data = useSetupChecklistData();
  if (data.isDismissed) return null;

  // Patch dynamic completion based on caller-supplied data.
  const items = data.items.map((it) => {
    if (it.key === "plan") return { ...it, done: !!activeEnrollment };
    if (it.key === "workout") return { ...it, done: !!activeEnrollment && (activeEnrollment.workouts_completed ?? 0) > 0 };
    return it;
  });
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  if (done === total) return null;
  const pct = Math.round((done / total) * 100);

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Get set up</div>
          <div className="mt-1 text-lg font-bold">Finish setting up JF Effect</div>
          <div className="text-sm text-muted-foreground">{done} of {total} done · {pct}%</div>
        </div>
        <button
          aria-label="Hide setup checklist"
          onClick={() => data.dismissChecklist(24)}
          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <Progress value={pct} className="mt-3" />
      <ul className="mt-4 divide-y divide-border">
        {items.map((it) => {
          const Icon = it.icon;
          const inner = (
            <div className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  it.done ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
                }`}>
                  {it.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-sm font-medium ${it.done ? "text-muted-foreground line-through" : ""}`}>
                    {it.label}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                {it.cta} <ChevronRight className="h-4 w-4" />
              </div>
            </div>
          );
          if (it.done) {
            return <li key={it.key} className="opacity-70">{inner}</li>;
          }
          return (
            <li key={it.key}>
              {it.onClick
                ? <button className="w-full text-left" onClick={it.onClick}>{inner}</button>
                : <Link to={it.to!}>{inner}</Link>}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => data.dismissChecklist(4)}>Hide for now</Button>
        <Button variant="ghost" size="sm" onClick={() => data.dismissChecklist(24)}>Remind me tomorrow</Button>
      </div>
    </Card>
  );
}