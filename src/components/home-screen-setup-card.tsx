import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Smartphone, Share, Plus, CheckCircle2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const VIDEO_URL = "https://vimeo.com/1200330134";
const VIDEO_EMBED = "https://player.vimeo.com/video/1200330134?title=0&byline=0&portrait=0&badge=0&dnt=1";

type Platform = "ios" | "android-installable" | "android-manual" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  if (isIOS) return "ios";
  const isAndroid = /Android/.test(ua);
  if (isAndroid) return "android-manual";
  return "desktop";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari
  // @ts-ignore
  if (window.navigator.standalone) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

type Props = {
  clientId: string;
  status: string | null | undefined;
  remindAfter: string | null | undefined;
};

export function HomeScreenSetupCard({ clientId, status, remindAfter }: Props) {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const standalone = useMemo(() => isStandalone(), []);

  useEffect(() => {
    setPlatform(detectPlatform());
    const handler = (e: any) => {
      e.preventDefault();
      setInstallEvent(e);
      setPlatform("android-installable");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Auto-mark complete if running in standalone (already installed).
  useEffect(() => {
    if (standalone && status !== "complete") {
      void update({
        home_screen_setup_status: "complete",
        home_screen_setup_completed_at: new Date().toISOString(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone]);

  const hidden =
    status === "complete" ||
    standalone ||
    (status === "reminded" && remindAfter && new Date(remindAfter).getTime() > Date.now());

  if (hidden) return null;

  async function update(patch: Record<string, any>) {
    const { error } = await (supabase.from("clients") as any).update(patch).eq("id", clientId);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["my-client"] });
  }

  const markDone = async () => {
    await update({
      home_screen_setup_status: "complete",
      home_screen_setup_completed_at: new Date().toISOString(),
    });
    toast.success("Nice — you're all set.");
  };

  const remindLater = async () => {
    const dt = new Date();
    dt.setDate(dt.getDate() + 3);
    await update({
      home_screen_setup_status: "reminded",
      home_screen_setup_remind_after: dt.toISOString(),
    });
    toast("We'll remind you in a few days.");
  };

  const triggerInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice?.outcome === "accepted") {
      await markDone();
    }
    setInstallEvent(null);
  };

  const isIOS = platform === "ios";
  const canInstall = platform === "android-installable" && !!installEvent;

  return (
    <>
      <Card className="border-primary/30 bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-primary text-primary-foreground shadow-glow">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              {isIOS ? "Add JF Effect to Your Home Screen" : "Install the JF Effect App"}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isIOS
                ? "Use this like a normal app by saving it to your iPhone home screen."
                : "Get the full app experience with a one-tap icon on your device."}
            </p>

            <div className="mt-3 overflow-hidden rounded-md border border-border bg-black">
              <div className="relative aspect-video w-full">
                {!videoLoaded && (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 text-xs text-white/70">
                    Loading video…
                  </div>
                )}
                <iframe
                  src={VIDEO_EMBED}
                  title="Add JF Effect to Your Home Screen"
                  allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                  allowFullScreen
                  loading="lazy"
                  onLoad={() => setVideoLoaded(true)}
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            </div>
            <div className="mt-1 text-right">
              <a href={VIDEO_URL} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground underline">
                Open on Vimeo
              </a>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canInstall && (
                <Button size="sm" onClick={triggerInstall} className="bg-gradient-primary uppercase text-xs font-bold">
                  Install App
                </Button>
              )}
              {isIOS && (
                <Button size="sm" onClick={() => setShowSteps(true)} className="bg-gradient-primary uppercase text-xs font-bold">
                  Show Steps
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={markDone} className="text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Mark as Done
              </Button>
              <Button size="sm" variant="ghost" onClick={remindLater} className="text-xs text-muted-foreground">
                Remind Me Later
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={showSteps} onOpenChange={setShowSteps}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to Home Screen</DialogTitle>
            <DialogDescription>
              Three quick steps in Safari on your iPhone.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 py-2">
            <li className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <div className="text-sm">
                Tap the <span className="inline-flex items-center gap-1 font-semibold"><Share className="h-3.5 w-3.5" /> Share</span> button in Safari.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              <div className="text-sm">
                Tap <span className="inline-flex items-center gap-1 font-semibold"><Plus className="h-3.5 w-3.5" /> Add to Home Screen</span>.
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
              <div className="text-sm">
                Tap <span className="font-semibold">Add</span> in the top right. Done — open JF Effect from your home screen.
              </div>
            </li>
          </ol>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button size="sm" onClick={async () => { setShowSteps(false); await markDone(); }} className="bg-gradient-primary uppercase text-xs font-bold">
              Mark as Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}