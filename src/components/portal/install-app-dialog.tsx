import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share, Plus, Copy, Check, Smartphone, Download, CheckCircle2 } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function InstallAppDialog({ open, onOpenChange }: Props) {
  const info = usePwaInstall();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const appUrl = typeof window !== "undefined" ? window.location.origin : "https://jfeffect.com";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      toast.success("App link copied. Paste it into Safari.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy it manually.");
    }
  };

  const triggerNativePrompt = async () => {
    setBusy(true);
    const result = await info.promptInstall();
    setBusy(false);
    if (result === "accepted") {
      toast.success("JF Effect is installing on your device.");
      onOpenChange(false);
    } else if (result === "unavailable") {
      toast("Your browser didn't offer an install prompt. Follow the steps below.");
    }
  };

  // ── Already installed ────────────────────────────────────────────────
  if (info.isStandalone) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <DialogTitle className="text-center">JF Effect Installed</DialogTitle>
            <DialogDescription className="text-center">
              JF Effect is already installed on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p>Open the JF Effect icon from your home screen to use the full app.</p>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Can't find the icon?</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>Swipe through your home screen pages and app library.</li>
                <li>Search for "JF Effect" on your phone.</li>
                <li>If it's missing, reinstall by tapping the install action again from a regular browser.</li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── iOS / iPadOS ────────────────────────────────────────────────────
  if (info.platform === "ios") {
    const inSafari = info.browser === "safari";
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
              <Smartphone className="h-6 w-6" />
            </div>
            <DialogTitle className="text-center">Install JF Effect on iPhone</DialogTitle>
            <DialogDescription className="text-center">
              {inSafari
                ? "Three quick steps in Safari."
                : "Apple only allows Add to Home Screen through Safari."}
            </DialogDescription>
          </DialogHeader>

          {!inSafari && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              You're using {info.browser === "in-app" ? "an in-app browser" : info.browser}. Tap below to copy
              the app link, then open it in Safari.
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={copyLink} className="gap-2">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy App Link"}
                </Button>
              </div>
            </div>
          )}

          <ol className="space-y-3 py-2">
            <Step n={1}>
              Open JF Effect in <span className="font-semibold">Safari</span>.
            </Step>
            <Step n={2}>
              Tap the{" "}
              <span className="inline-flex items-center gap-1 font-semibold">
                <Share className="h-3.5 w-3.5" /> Share
              </span>{" "}
              icon at the bottom of the screen.
            </Step>
            <Step n={3}>
              Tap{" "}
              <span className="inline-flex items-center gap-1 font-semibold">
                <Plus className="h-3.5 w-3.5" /> Add to Home Screen
              </span>
              .
            </Step>
            <Step n={4}>
              Tap <span className="font-semibold">Add</span> in the top right. Open JF Effect from your home
              screen.
            </Step>
          </ol>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {inSafari && (
              <Button variant="outline" size="sm" onClick={copyLink} className="gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy App Link"}
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Android ─────────────────────────────────────────────────────────
  if (info.platform === "android") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
              <Download className="h-6 w-6" />
            </div>
            <DialogTitle className="text-center">Install JF Effect on Android</DialogTitle>
            <DialogDescription className="text-center">
              {info.canPrompt
                ? "Tap Install App to add JF Effect to your phone."
                : "Use your browser's menu to install JF Effect."}
            </DialogDescription>
          </DialogHeader>

          {info.canPrompt ? (
            <div className="space-y-3 py-3">
              <Button onClick={triggerNativePrompt} disabled={busy} className="w-full gap-2">
                <Download className="h-4 w-4" />
                {busy ? "Opening prompt…" : "Install App"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                You'll see a confirmation from your browser.
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              {info.isInAppBrowser && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  You're inside another app's browser. Tap the menu (⋮) and choose{" "}
                  <span className="font-semibold">Open in Chrome</span> first, then try Install again.
                </div>
              )}
              <ol className="space-y-3">
                <Step n={1}>
                  Open JF Effect in <span className="font-semibold">Chrome</span> (or another modern browser).
                </Step>
                <Step n={2}>
                  Tap the menu (<span className="font-semibold">⋮</span>) in the top right.
                </Step>
                <Step n={3}>
                  Tap{" "}
                  <span className="font-semibold">
                    Install app
                  </span>{" "}
                  or <span className="font-semibold">Add to Home screen</span>.
                </Step>
                <Step n={4}>
                  Confirm <span className="font-semibold">Install</span>. Open JF Effect from your home
                  screen.
                </Step>
              </ol>
              <div>
                <Button variant="outline" size="sm" onClick={copyLink} className="gap-2">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy App Link"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Desktop / unknown ───────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-primary/15 text-primary">
            <Smartphone className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Install JF Effect on Your Phone</DialogTitle>
          <DialogDescription className="text-center">
            Open JF Effect on your phone to install it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p>
            Open <span className="font-semibold">{appUrl}</span> on your iPhone, iPad, or Android phone, then
            tap the Install JF Effect button on your dashboard.
          </p>
          {info.canPrompt && (
            <Button onClick={triggerNativePrompt} disabled={busy} className="w-full gap-2">
              <Download className="h-4 w-4" />
              {busy ? "Opening prompt…" : "Install on this computer"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={copyLink} className="gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy App Link"}
          </Button>
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <div className="text-sm">{children}</div>
    </li>
  );
}