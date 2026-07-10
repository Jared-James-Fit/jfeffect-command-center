import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useOverlayMemberId, useCloseMemberProfile } from "@/lib/open-member-profile";

// Lazy-load the workspace so it only ships when a member is opened.
const MemberProfileWorkspace = lazy(async () => {
  const mod = await import("@/routes/_authenticated/admin/members.$memberId");
  return { default: mod.MemberProfileWorkspace };
});

function Skeleton() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading member">
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

export function MemberProfileOverlayMount() {
  const { memberId, memberTab } = useOverlayMemberId();
  const close = useCloseMemberProfile();
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (memberId && typeof document !== "undefined") {
      triggerRef.current = document.activeElement;
    }
  }, [memberId]);

  return (
    <DialogPrimitive.Root
      open={!!memberId}
      onOpenChange={(open) => {
        if (!open) {
          close();
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
            "inset-0 h-[100dvh] w-screen",
            "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            "md:inset-auto md:left-1/2 md:top-[4vh] md:h-[92vh] md:w-[95vw] md:max-w-[1400px] md:-translate-x-1/2 md:rounded-2xl md:border md:border-border",
            "lg:w-[90vw]",
            "overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4",
          ].join(" ")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Member workspace</DialogPrimitive.Title>

          <DialogPrimitive.Close
            aria-label="Close member workspace"
            className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>

          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={<Skeleton />}>
              {memberId ? (
                <MemberProfileWorkspace
                  key={memberId}
                  memberId={memberId}
                  initialTab={memberTab as any}
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