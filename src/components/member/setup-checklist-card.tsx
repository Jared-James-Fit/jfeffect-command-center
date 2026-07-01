import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Circle, ChevronRight, Smartphone, Bell, ClipboardList, Dumbbell, UserCircle,
} from "lucide-react";
import { getMySetupStatus } from "@/lib/member-setup.functions";
import {
  recordNotificationStatus,
} from "@/lib/onboarding.functions";
import { supabase } from "@/integrations/supabase/client";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { useNotificationPermission } from "@/hooks/use-notification-permission";
import { Badge } from "@/components/ui/badge";

type Item = {
  key: string;
  label: string;
  description?: string;
  icon: any;
  done: boolean;
  to?: string;
  onClick?: () => void;
  cta: string;
  disabled?: boolean;
};

function useSetupChecklistData() {
  const fetchStatus = useServerFn(getMySetupStatus);
  const fireNotif = useServerFn(recordNotificationStatus);
  const qc = useQueryClient();
  const install = usePwaInstall();
  const notif = useNotificationPermission();

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
        .select("id, install_detected_at, notifications_status, setup_completed_at")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!cancel) setMe(data);
    })();
    return () => { cancel = true; };
  }, [status]);

  // Sync detected permission to the server when it diverges from stored status.
  useEffect(() => {
    if (!me) return;
    if (notif.state === "unsupported") return;
    if (me.notifications_status !== notif.state) {
      fireNotif({ data: { status: notif.state } }).catch(() => {});
    }
  }, [me, notif.state, fireNotif]);

  // Auto-record install detection.
  useEffect(() => {
    if (install.isStandalone && me && !me.install_detected_at) {
      // The /install page handles the server write; trigger refetch here so checklist updates.
      qc.invalidateQueries({ queryKey: ["m-setup-status"] });
    }
  }, [install.isStandalone, me, qc]);

  const setupComplete = status?.complete === true;
  const isInstalled = !!me?.install_detected_at || install.isStandalone;
  const notifGranted = notif.granted || me?.notifications_status === "granted";

  async function requestNotifications() {
    if (notif.unsupported) {
      await fireNotif({ data: { status: "unsupported" } }).catch(() => {});
      toast.info("Notifications aren't supported on this browser.");
      return;
    }
    if (notif.denied) {
      toast.info("Notifications are blocked. Enable them in your browser settings, then refresh.");
      return;
    }
    const result = await notif.request();
    await fireNotif({ data: { status: result } }).catch(() => {});
    if (result === "granted") {
      toast.success("Notifications enabled — we'll only ping you about workouts, replies, and reminders.");
      qc.invalidateQueries({ queryKey: ["m-setup-status"] });
    } else if (result === "denied") {
      toast.info("No problem — you can turn them on later in your browser settings.");
    } else {
      toast.info("You can enable notifications anytime from this checklist.");
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
      description: notif.denied
        ? "Blocked — enable in your browser settings"
        : notif.unsupported
          ? "Not supported on this browser"
          : "Workout reminders, coach replies, and check-ins",
      icon: Bell,
      done: notifGranted,
      onClick: requestNotifications,
      cta: notifGranted ? "On" : notif.denied ? "Blocked" : notif.unsupported ? "Unavailable" : "Enable",
      disabled: notif.unsupported,
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
  ], [setupComplete, isInstalled, notifGranted, notif.denied, notif.unsupported]);

  return {
    items,
    setupComplete,
    isInstalled,
  };
}

export function SetupChecklist({ activeEnrollment }: { activeEnrollment?: any }) {
  const data = useSetupChecklistData();

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
  const nextItem = items.find((i) => !i.done) ?? items[0];

  return (
    <Card className="relative overflow-hidden border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black tracking-tight sm:text-lg">Complete your setup</h2>
            <Badge variant="secondary" className="text-[10px]">{done}/{total}</Badge>
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Finish a few quick steps so your training, plans, and reminders are ready. You can keep using the app while you do this.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <Progress value={pct} />
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((it) => {
          const Icon = it.icon;
          const rowClass =
            "flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5 text-sm transition hover:bg-background " +
            (it.done ? "opacity-60" : "");
          const inner = (
            <>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={"font-semibold " + (it.done ? "line-through" : "")}>{it.label}</span>
                  {it.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                {it.description && !it.done ? (
                  <div className="text-[11px] text-muted-foreground sm:text-xs">{it.description}</div>
                ) : null}
              </div>
              {!it.done && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </>
          );
          if (it.done || it.disabled) {
            return <li key={it.key}><div className={rowClass}>{inner}</div></li>;
          }
          return (
            <li key={it.key}>
              {it.onClick
                ? <button type="button" className={rowClass + " w-full text-left"} onClick={it.onClick}>{inner}</button>
                : <Link to={it.to!} className={rowClass}>{inner}</Link>}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        {nextItem.onClick ? (
          <Button size="sm" onClick={nextItem.onClick}>Continue setup</Button>
        ) : (
          <Button asChild size="sm">
            <Link to={nextItem.to!}>Continue setup</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}