import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useOverlayClientId, useCloseClientProfile } from "@/lib/open-client-profile";

// Lazy-load the heavy workspace so it only ships when a client is opened.
const ClientProfileWorkspace = lazy(async () => {
  const mod = await import("@/routes/_authenticated/admin/clients.$id");
  return { default: mod.ClientProfileWorkspace };
});

function Skeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading client">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function ClientProfileOverlayMount() {
  const { clientId, clientTab } = useOverlayClientId();
  const close = useCloseClientProfile();
  const triggerRef = useRef<Element | null>(null);

  // Remember the element that opened the overlay so focus can be restored.
  useEffect(() => {
    if (clientId && typeof document !== "undefined") {
      triggerRef.current = document.activeElement;
    }
  }, [clientId]);

  return (
    <DialogPrimitive.Root
      open={!!clientId}
      onOpenChange={(open) => {
        if (!open) {
          close();
          // Restore focus after the dialog closes.
          setTimeout(() => {
            const el = triggerRef.current as HTMLElement | null;
            if (el && typeof el.focus === "function") el.focus();
          }, 0);
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={[
            "fixed z-50 flex flex-col bg-background text-foreground shadow-2xl outline-none",
            // Mobile: full-screen sheet with safe-area padding.
            "inset-0 h-[100dvh] w-screen",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            // md+: centered large workspace.
            "md:inset-auto md:left-1/2 md:top-[4vh] md:h-[92vh] md:w-[95vw] md:max-w-[1400px] md:-translate-x-1/2 md:rounded-2xl md:border md:border-border",
            "lg:w-[90vw]",
            "overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4",
          ].join(" ")}
          onOpenAutoFocus={(e) => {
            // Prevent the initial focus jump; let the workspace body receive focus naturally.
            e.preventDefault();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Client workspace</DialogPrimitive.Title>

          {/* Fixed close button (top-right on md+, top-left back-arrow on mobile inside content). */}
          <DialogPrimitive.Close
            aria-label="Back"
            style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
            className="absolute left-3 z-30 inline-flex h-10 min-w-[72px] items-center justify-center gap-1 rounded-full border border-border bg-background/95 px-3 text-sm font-semibold text-foreground shadow-sm backdrop-blur hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring md:left-auto md:right-3 md:top-3"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Back</span>
          </DialogPrimitive.Close>

          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={<Skeleton />}>
              {clientId ? (
                <ClientProfileWorkspace
                  key={clientId}
                  clientId={clientId}
                  initialTab={clientTab as any}
                  embedded
                  onClose={close}
                />
              ) : null}
            </Suspense>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}