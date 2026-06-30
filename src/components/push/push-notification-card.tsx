import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Smartphone, Share, Plus, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  detectPushSupport,
  currentPermission,
  enablePushOnThisDevice,
  disablePushOnThisDevice,
  hasPushSubscriptionLocally,
  isIos,
  isStandalonePwa,
} from "@/lib/push/push-client";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  sendTestPushNotification,
  listMyPushDevices,
} from "@/lib/push/push.functions";

type Prefs = {
  master_enabled: boolean;
  messages: boolean;
  check_ins: boolean;
  lift_reviews: boolean;
  workouts: boolean;
  billing: boolean;
  coaching_apps: boolean;
};

const CATEGORY_LABELS: Array<{ key: keyof Prefs; label: string; help: string }> = [
  { key: "messages", label: "Messages", help: "New coach or client messages" },
  { key: "check_ins", label: "Check-Ins", help: "Submissions and coach reviews" },
  { key: "lift_reviews", label: "Lift Reviews", help: "New videos and review completions" },
  { key: "workouts", label: "Workouts", help: "Assigned workouts and reminders" },
  { key: "billing", label: "Billing", help: "Failed payments and subscription alerts" },
  { key: "coaching_apps", label: "Coaching Applications", help: "Admin only — new applications" },
];

export function PushNotificationCard({ showCoachingApps = false }: { showCoachingApps?: boolean }) {
  const qc = useQueryClient();
  const getPrefs = useServerFn(getNotificationPreferences);
  const updatePrefs = useServerFn(updateNotificationPreferences);
  const sendTest = useServerFn(sendTestPushNotification);
  const listDevices = useServerFn(listMyPushDevices);

  const [support] = useState(() => (typeof window === "undefined" ? null : detectPushSupport()));
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [hasLocalSub, setHasLocalSub] = useState(false);
  const [busy, setBusy] = useState<null | "enable" | "disable" | "test">(null);

  useEffect(() => {
    setPermission(currentPermission());
    hasPushSubscriptionLocally().then(setHasLocalSub);
  }, []);

  const prefsQ = useQuery({
    queryKey: ["push", "prefs"],
    queryFn: () => getPrefs(),
  });
  const devicesQ = useQuery({
    queryKey: ["push", "devices"],
    queryFn: () => listDevices(),
    enabled: hasLocalSub || (permission === "granted"),
  });

  const prefs: Prefs = useMemo(() => ({
    master_enabled: true, messages: true, check_ins: true, lift_reviews: true,
    workouts: true, billing: true, coaching_apps: true,
    ...(prefsQ.data ?? {}),
  }), [prefsQ.data]);

  async function setPref<K extends keyof Prefs>(key: K, value: boolean) {
    await updatePrefs({ data: { [key]: value } as any });
    qc.setQueryData(["push", "prefs"], { ...prefs, [key]: value });
  }

  async function onEnable() {
    setBusy("enable");
    try {
      const r = await enablePushOnThisDevice();
      if (!r.ok) {
        toast.error(humanReason(r.reason));
      } else {
        toast.success("Notifications enabled on this device");
        setPermission("granted");
        setHasLocalSub(true);
        qc.invalidateQueries({ queryKey: ["push", "devices"] });
      }
    } catch (e: any) { toast.error(e?.message ?? "Could not enable notifications"); }
    finally { setBusy(null); }
  }

  async function onDisable() {
    setBusy("disable");
    try {
      await disablePushOnThisDevice();
      toast.success("Notifications disabled on this device");
      setHasLocalSub(false);
      qc.invalidateQueries({ queryKey: ["push", "devices"] });
    } finally { setBusy(null); }
  }

  async function onTest() {
    setBusy("test");
    try {
      const r: any = await sendTest();
      if (r?.sent > 0) toast.success(`Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}`);
      else toast.error("No active devices to send a test to");
    } catch (e: any) { toast.error(e?.message ?? "Test failed"); }
    finally { setBusy(null); }
  }

  // --- Render branches ---------------------------------------------------

  // SSR / unsupported environment
  if (!support) return null;

  if (!support.supported && support.reason === "ios_requires_install") {
    return (
      <Card className="border-border bg-card p-5 space-y-3">
        <Header icon={<Smartphone className="h-4 w-4" />} title="Install JF Effect First" />
        <p className="text-sm text-muted-foreground">
          To receive notifications on iPhone or iPad, open this page in Safari, tap{" "}
          <span className="inline-flex items-center gap-1 align-middle"><Share className="h-3.5 w-3.5" /> Share</span>, then{" "}
          <span className="inline-flex items-center gap-1 align-middle"><Plus className="h-3.5 w-3.5" /> Add to Home Screen</span>.
          Open the installed app and come back here to enable notifications.
        </p>
      </Card>
    );
  }

  if (!support.supported) {
    return (
      <Card className="border-border bg-card p-5 space-y-3">
        <Header icon={<BellOff className="h-4 w-4" />} title="Notifications Not Supported" />
        <p className="text-sm text-muted-foreground">
          This browser doesn't support web push notifications. Try Chrome, Edge, Safari (installed PWA), or Firefox on a recent device.
        </p>
      </Card>
    );
  }

  if (permission === "denied") {
    return (
      <Card className="border-border bg-card p-5 space-y-3">
        <Header icon={<AlertCircle className="h-4 w-4" />} title="Notifications Blocked" />
        <p className="text-sm text-muted-foreground">
          You blocked notifications for this site. To turn them back on, open your browser's site settings
          for this page (the lock icon in the URL bar) and allow Notifications, then return here.
        </p>
      </Card>
    );
  }

  const enabledHere = permission === "granted" && hasLocalSub;

  return (
    <Card className="border-border bg-card p-5 space-y-4">
      {!enabledHere ? (
        <>
          <Header icon={<Bell className="h-4 w-4" />} title="Turn On Notifications" />
          <p className="text-sm text-muted-foreground">
            Get workout updates, coach messages, check-in reminders, and billing alerts on your phone.
          </p>
          <Button onClick={onEnable} disabled={busy === "enable"} className="bg-gradient-primary font-bold uppercase">
            {busy === "enable" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
            Enable Notifications
          </Button>
          {isIos() && isStandalonePwa() ? (
            <p className="text-xs text-muted-foreground">iOS will prompt for permission once — tap Allow.</p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <Header icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} title="Notifications Enabled" />
            <span className="text-xs text-muted-foreground">on this device</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onTest} disabled={busy === "test"}>
              {busy === "test" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Test Notification
            </Button>
            <Button size="sm" variant="ghost" onClick={onDisable} disabled={busy === "disable"}>
              {busy === "disable" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BellOff className="mr-1.5 h-3.5 w-3.5" />}
              Disable on this device
            </Button>
          </div>
          {devicesQ.data && devicesQ.data.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {devicesQ.data.length} device{devicesQ.data.length === 1 ? "" : "s"} registered for this account.
            </div>
          )}
        </>
      )}

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">All Push Notifications</div>
            <div className="text-xs text-muted-foreground">Master switch — applies to every device.</div>
          </div>
          <Switch
            checked={!!prefs.master_enabled}
            onCheckedChange={(v) => setPref("master_enabled", v)}
          />
        </div>

        <div className="rounded-md border border-border divide-y">
          {CATEGORY_LABELS
            .filter((c) => c.key !== "coaching_apps" || showCoachingApps)
            .map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">{c.help}</div>
                </div>
                <Switch
                  checked={!!prefs[c.key]}
                  onCheckedChange={(v) => setPref(c.key, v)}
                  disabled={!prefs.master_enabled}
                />
              </div>
            ))}
        </div>
      </div>
    </Card>
  );
}

function Header({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-primary">{icon}</span>
      <h3 className="text-sm font-semibold uppercase tracking-wider">{title}</h3>
    </div>
  );
}

function humanReason(reason?: string): string {
  switch (reason) {
    case "permission_denied": return "Notifications were blocked. Update site permissions and try again.";
    case "permission_default": return "Notification prompt dismissed — try again.";
    case "ios_requires_install": return "Install JF Effect to your Home Screen first.";
    case "no_sw": case "no_push": return "This browser doesn't support web push.";
    case "no_vapid_key": return "Push isn't configured on the server yet.";
    case "missing_keys": return "Browser returned an incomplete push subscription.";
    default: return "Could not enable notifications.";
  }
}