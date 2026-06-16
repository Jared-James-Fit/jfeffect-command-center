import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone, Share, Plus, Download, Check, Copy, ExternalLink, ChevronRight, AlertTriangle,
} from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { recordInstall, recordInstallDismissed } from "@/lib/install-tracking.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [
      { title: "Install JF Effect — Add to your phone" },
      { name: "description", content: "Install the JF Effect app on your iPhone or Android phone in under 30 seconds." },
      { property: "og:title", content: "Install JF Effect" },
      { property: "og:description", content: "Install the JF Effect app on your iPhone or Android phone." },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const info = usePwaInstall();
  const fireInstall = useServerFn(recordInstall);
  const fireDismiss = useServerFn(recordInstallDismissed);
  const [signedIn, setSignedIn] = useState<boolean>(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session?.user));
  }, []);

  // Auto-record install when the app is detected as standalone for the first time.
  useEffect(() => {
    if (info.isStandalone && signedIn) {
      fireInstall({ data: { platform: info.platform } }).catch(() => {});
    }
  }, [info.isStandalone, signedIn, info.platform, fireInstall]);

  return (
    <div className="min-h-screen bg-background safe-pt safe-pb">
      <div className="mx-auto max-w-xl px-4 py-8 sm:py-12">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Smartphone className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Install JF Effect</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Add JF Effect to your home screen for a one-tap app experience — full-screen, fast, and offline-ready.
          </p>
        </header>

        {info.isStandalone ? <AlreadyInstalled /> : (
          <>
            {info.isInAppBrowser && <InAppBrowserWarning />}
            {info.platform === "ios" && !info.isInAppBrowser && (
              <IosInstructions onConfirm={() => {
                if (signedIn) fireInstall({ data: { platform: "ios" } }).catch(() => {});
                toast.success("Nice — open JF Effect from your home screen any time.");
              }} />
            )}
            {info.platform === "android" && !info.isInAppBrowser && (
              <AndroidInstructions
                canPrompt={info.canPrompt}
                onInstall={async (cb) => {
                  const r = await cb();
                  if (r === "accepted") {
                    if (signedIn) fireInstall({ data: { platform: "android" } }).catch(() => {});
                    toast.success("Installing JF Effect — check your home screen.");
                  } else if (r === "dismissed") {
                    if (signedIn) fireDismiss().catch(() => {});
                  }
                }}
              />
            )}
            {info.platform === "desktop" && <DesktopInstructions />}
            {info.platform === "unknown" && <IosInstructions onConfirm={() => {}} />}
          </>
        )}

        <div className="mt-8 text-center text-xs text-muted-foreground">
          <Link to="/" className="underline-offset-4 hover:underline">← Back to JF Effect</Link>
        </div>
      </div>
    </div>
  );
}

function AlreadyInstalled() {
  return (
    <Card className="border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
        <Check className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold">JF Effect is installed</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You're using the installed app. Tap the icon on your home screen to open it next time.
      </p>
      <div className="mt-4">
        <Link to="/m">
          <Button>Continue to your dashboard</Button>
        </Link>
      </div>
    </Card>
  );
}

function InAppBrowserWarning() {
  return (
    <Card className="mb-4 border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium">You're inside another app's browser</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tap the menu (three dots) and choose <strong>Open in Safari</strong> (iPhone) or
            <strong> Open in Chrome</strong> (Android), then come back to this page to install.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {n}
      </div>
      <div className="pt-0.5">
        <p className="text-sm font-medium leading-snug">{title}</p>
        {children && <div className="mt-1 text-xs text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

function IosInstructions({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Add to your iPhone</h2>
        <Badge variant="secondary">iOS · Safari</Badge>
      </div>
      <ol className="space-y-4">
        <Step n={1} title="Tap the Share button">
          <span className="inline-flex items-center gap-1">
            Look at the bottom toolbar in Safari and tap <Share className="inline h-3.5 w-3.5" />.
          </span>
        </Step>
        <Step n={2} title="Choose “Add to Home Screen”">
          Scroll down the share sheet and tap{" "}
          <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
            <Plus className="h-3 w-3" /> Add to Home Screen
          </span>.
        </Step>
        <Step n={3} title="Tap Add">
          Confirm the name (<strong>JF Effect</strong>) and tap <strong>Add</strong> in the top right.
        </Step>
        <Step n={4} title="Open from your home screen">
          Find the JF Effect icon on your home screen and tap to launch — it opens full-screen, no browser bars.
        </Step>
      </ol>
      <div className="mt-6">
        <Button className="w-full" onClick={onConfirm}>I added JF Effect to my home screen</Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Don't see Share? Make sure you're using Safari, not Chrome or another browser.
        </p>
      </div>
    </Card>
  );
}

function AndroidInstructions({
  canPrompt,
  onInstall,
}: {
  canPrompt: boolean;
  onInstall: (run: () => Promise<"accepted" | "dismissed" | "unavailable">) => void;
}) {
  const info = usePwaInstall();
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Add to your Android phone</h2>
        <Badge variant="secondary">Android · Chrome</Badge>
      </div>
      {canPrompt ? (
        <>
          <p className="text-sm text-muted-foreground">
            Tap the button below — Chrome will show the official install dialog. Confirm and JF Effect
            lands on your home screen.
          </p>
          <Button
            className="mt-4 w-full"
            onClick={() => onInstall(info.promptInstall)}
          >
            <Download className="mr-2 h-4 w-4" />
            Install JF Effect
          </Button>
        </>
      ) : (
        <ol className="space-y-4">
          <Step n={1} title="Tap the three-dot menu">
            Top right of Chrome.
          </Step>
          <Step n={2} title="Tap “Install app” or “Add to Home Screen”">
            Confirm when prompted. JF Effect will be added to your home screen.
          </Step>
          <Step n={3} title="Open from your home screen">
            Launch JF Effect like any other app.
          </Step>
        </ol>
      )}
    </Card>
  );
}

function DesktopInstructions() {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/install`
    : "https://jfeffect.com/install";

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#0a0a0a", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(null));
  }, [url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Install JF Effect on your phone</h2>
        <Badge variant="secondary">Desktop</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        JF Effect is designed to live on your phone. Scan this QR code with your iPhone or Android
        camera to open the installer on your device.
      </p>
      <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-4">
        {qr ? (
          <img src={qr} alt="Scan with your phone to install JF Effect" width={220} height={220} />
        ) : (
          <div className="grid h-[220px] w-[220px] place-items-center text-xs text-muted-foreground">
            Generating QR code…
          </div>
        )}
        <code className="break-all text-center text-xs text-muted-foreground">{url}</code>
        <div className="flex w-full gap-2">
          <Button variant="outline" className="flex-1" onClick={copyLink}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <a href={`sms:?&body=${encodeURIComponent("Install JF Effect on your phone: " + url)}`} className="flex-1">
            <Button variant="outline" className="w-full">
              <ExternalLink className="mr-2 h-4 w-4" /> Text to phone
            </Button>
          </a>
        </div>
      </div>

      <details className="mt-6 rounded-md border border-border bg-card/50 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Install on this desktop instead</summary>
        <ol className="mt-3 space-y-3">
          <Step n={1} title="Open in Chrome or Edge" />
          <Step n={2} title="Click the install icon in the address bar">
            Looks like a small monitor with a down arrow, on the right side of the URL bar.
          </Step>
          <Step n={3} title="Confirm “Install”">
            JF Effect opens in its own window with no browser tabs.
          </Step>
        </ol>
      </details>
    </Card>
  );
}